// Diagnostic route: does this container's egress IP reach the FPL API?
//
// The FPL API sits behind Cloudflare and rejects many datacenter IPs. Residential
// IPs work; Railway's egress is the open question. See ARCHITECTURE.md
// ("Egress and Cloudflare"). Delete this route once the answer is settled.

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

export async function GET() {
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
