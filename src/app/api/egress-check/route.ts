// Diagnostic route: does this container's egress IP reach the FPL API?
//
// The FPL API sits behind Cloudflare and rejects many datacenter IPs. Railway's egress
// address is redrawn on every deploy and is scored on its own reputation, so this answers
// "is it us, is it them, or is it the address today" in one request. See ARCHITECTURE.md
// ("Egress and Cloudflare"); it diagnosed the 2026-09-01 outage in minutes, which is why
// it has outlived the "delete once settled" note it used to carry.
//
// **Token-guarded, and that is not optional.** It was open until 2026-09-07, when the app
// was about to be linked publicly. Two reasons it cannot be:
//
//   - it discloses the egress IP and response timings to anyone who asks;
//   - every call makes this server fire four requests at the FPL API, so an open loop over
//     it is a stranger's lever on the one number that decides whether the app works at all.
//     Being blocked is not hypothetical here — it has happened, and this endpoint would be
//     a way to cause it rather than merely observe it.

import { authorisedJobRequest } from '@/lib/jobs-auth'

export const dynamic = 'force-dynamic'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

const TARGETS = {
  bootstrap: 'https://fantasy.premierleague.com/api/bootstrap-static/',
  eventStatus: 'https://fantasy.premierleague.com/api/event-status/',
  standings: 'https://fantasy.premierleague.com/api/leagues-classic/9999999/standings/',
  history: 'https://fantasy.premierleague.com/api/entry/1/history/',
} as const

type Probe = {
  ok: boolean
  status?: number
  ms: number
  bytes?: number
  // A Cloudflare block returns an HTML challenge page rather than JSON, so the
  // content type distinguishes "blocked" from "genuinely failed".
  contentType?: string | null
  error?: string
}

async function probe(url: string): Promise<Probe> {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      cache: 'no-store',
    })
    const body = await res.arrayBuffer()
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      bytes: body.byteLength,
      contentType: res.headers.get('content-type'),
    }
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function egressIp(): Promise<string | null> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
    const data = (await res.json()) as { ip?: string }
    return data.ip ?? null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  // Same token as the capture job: both are operator-only and there is no reason for a
  // second credential to keep in step.
  if (!authorisedJobRequest(req)) {
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  }

  const [ip, entries] = await Promise.all([
    egressIp(),
    Promise.all(
      Object.entries(TARGETS).map(async ([name, url]) => [name, await probe(url)] as const),
    ),
  ])

  const results = Object.fromEntries(entries) as Record<keyof typeof TARGETS, Probe>
  const reachable = Object.values(results).every((r) => r.ok)

  return Response.json(
    {
      verdict: reachable ? 'FPL API reachable from this container' : 'BLOCKED or failing',
      reachable,
      egressIp: ip,
      checkedAt: new Date().toISOString(),
      results,
    },
    { status: reachable ? 200 : 503 },
  )
}
