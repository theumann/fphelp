import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendEmail } from './send'

const base = {
  subject: 'GW3',
  html: '<p>hi</p>',
  text: 'hi',
}

function ok(id = 'abc') {
  return new Response(JSON.stringify({ id }), { status: 200 })
}

function bodyOf(call: number): Record<string, unknown> {
  const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
  return JSON.parse(fetchMock.mock.calls[call][1].body)
}

describe('sendEmail', () => {
  beforeEach(() => {
    process.env.AUTH_RESEND_KEY = 'key'
    process.env.AUTH_EMAIL_FROM = 'league@example.com'
    global.fetch = vi.fn().mockResolvedValue(ok()) as never
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** The one that silently publishes fourteen private addresses to fourteen people. */
  it('bccs the recipients and never puts them in to', async () => {
    await sendEmail({ ...base, to: ['a@example.com', 'b@example.com'] })

    const sent = bodyOf(0)
    expect(sent.bcc).toEqual(['a@example.com', 'b@example.com'])
    expect(sent.to).toEqual(['league@example.com'])
  })

  it('splits large leagues into batches of 50', async () => {
    const to = Array.from({ length: 120 }, (_, i) => `m${i}@example.com`)
    const result = await sendEmail({ ...base, to })

    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect((bodyOf(0).bcc as string[]).length).toBe(50)
    expect((bodyOf(2).bcc as string[]).length).toBe(20)
  })

  it('reports which batch failed, since the earlier ones went out', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response('nope', { status: 422 }))
    global.fetch = fetchMock as never

    const to = Array.from({ length: 60 }, (_, i) => `m${i}@example.com`)
    const result = await sendEmail({ ...base, to })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('batch 2 of 2')
  })

  it('fails rather than reporting a send with no key configured', async () => {
    delete process.env.AUTH_RESEND_KEY
    const result = await sendEmail({ ...base, to: ['a@example.com'] })

    expect(result.ok).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses an empty recipient list', async () => {
    expect((await sendEmail({ ...base, to: [] })).ok).toBe(false)
  })

  it('surfaces a network error instead of throwing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as never
    const result = await sendEmail({ ...base, to: ['a@example.com'] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('ECONNRESET')
  })
})
