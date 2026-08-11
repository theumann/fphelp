import { describe, expect, it } from 'vitest'

import { parseRecipientList } from './recipients'

describe('parseRecipientList', () => {
  it('parses a plain address', () => {
    expect(parseRecipientList('a@example.com').valid).toEqual([{ email: 'a@example.com', name: null }])
  })

  it('splits on commas, semicolons and newlines', () => {
    const { valid } = parseRecipientList('a@example.com, b@example.com; c@example.com\nd@example.com')
    expect(valid.map((r) => r.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ])
  })

  /** The form a paste out of any mail client actually takes. */
  it('reads a display name from `Name <email>`', () => {
    expect(parseRecipientList('Reese Andersson <Steve@Example.com>').valid).toEqual([
      { email: 'steve@example.com', name: 'Reese Andersson' },
    ])
  })

  it('strips the quotes mail clients add around names containing commas', () => {
    expect(parseRecipientList('"Okafor, Sam" <s@example.com>').valid[0].name).toBe('Okafor, Sam')
  })

  it('lower-cases addresses, since uniqueness depends on it', () => {
    expect(parseRecipientList('MiXeD@Example.COM').valid[0].email).toBe('mixed@example.com')
  })

  /** Nothing is dropped silently — a member missing from the digest is invisible. */
  it('reports unparseable entries rather than skipping them', () => {
    const { valid, invalid } = parseRecipientList('good@example.com, not-an-email, also bad')
    expect(valid.map((r) => r.email)).toEqual(['good@example.com'])
    expect(invalid).toEqual(['not-an-email', 'also bad'])
  })

  it('reports duplicates within the input, case-insensitively', () => {
    const { valid, duplicates } = parseRecipientList('a@example.com, A@EXAMPLE.COM')
    expect(valid).toHaveLength(1)
    expect(duplicates).toEqual(['a@example.com'])
  })

  it('ignores blank entries and trailing separators', () => {
    const { valid, invalid } = parseRecipientList('a@example.com,\n\n, ;')
    expect(valid).toHaveLength(1)
    expect(invalid).toEqual([])
  })

  it('rejects an address with no dot in the domain', () => {
    expect(parseRecipientList('someone@localhost').invalid).toEqual(['someone@localhost'])
  })

  it('returns empty results for empty input', () => {
    expect(parseRecipientList('')).toEqual({ valid: [], invalid: [], duplicates: [] })
  })
})
