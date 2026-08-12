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

  it('warns that earlier batches already arrived, so a retry duplicates them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response('nope', { status: 422 }))
    global.fetch = fetchMock as never

    const to = Array.from({ length: 60 }, (_, i) => `m${i}@example.com`)
    const result = await sendEmail({ ...base, to })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('first 50 recipients did already receive it')
      // The cause sentence must not also assert the opposite. A message saying both
      // "nothing was sent" and "50 already got it" leaves the owner unable to decide
      // whether to retry, which is the only question it exists to answer.
      expect(result.error).not.toContain('Nothing was sent')
    }
  })

  it('does not claim anything arrived when the very first batch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 500 })) as never
    const result = await sendEmail({ ...base, to: ['a@example.com'] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Nothing was sent')
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

  /** The message the owner reads must not name a variable only an operator can set. */
  describe('what the owner is shown', () => {
    it('does not leak env var names', async () => {
      delete process.env.AUTH_RESEND_KEY
      const result = await sendEmail({ ...base, to: ['a@example.com'] })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).not.toContain('AUTH_RESEND_KEY')
        // …while the diagnosable detail is still recorded for the deliveries row.
        expect(result.detail).toContain('AUTH_RESEND_KEY')
      }
    })

    it('does not leak the provider response body', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(new Response('{"message":"domain not verified"}', { status: 403 })) as never
      const result = await sendEmail({ ...base, to: ['a@example.com'] })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).not.toContain('domain not verified')
        expect(result.detail).toContain('domain not verified')
      }
    })

    it('keeps the network error in detail, not in the message', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as never
      const result = await sendEmail({ ...base, to: ['a@example.com'] })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).not.toContain('ECONNRESET')
        expect(result.detail).toContain('ECONNRESET')
      }
    })
  })
})
