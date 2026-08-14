/** One parsed recipient, ready to persist. */
export interface ParsedRecipient {
  email: string
  name: string | null
}

export interface ParseResult {
  valid: ParsedRecipient[]
  /** Entries that could not be parsed, verbatim, so the owner can see what was skipped. */
  invalid: string[]
  /** Duplicates within the pasted input, after normalisation. Silently dropped otherwise. */
  duplicates: string[]
}

/**
 * Deliberately permissive. Full RFC 5322 is unimplementable in a regex and rejecting a
 * real address is worse here than accepting a bad one: a member silently missing from
 * the digest is invisible, while a bad address bounces and says so.
 */
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

/** Matches `Name <email@example.com>`, the form that survives a copy-paste from a mail client. */
const NAMED = /^\s*(.*?)\s*<([^>]+)>\s*$/

/**
 * Parses a single entry, in either `address` or `Name <address>` form.
 *
 * Exported because the owners list validates one address at a time with exactly the same
 * permissiveness — an owner's address and a member's address are the same kind of thing,
 * and two regexes that disagree about what an address is would be worse than one.
 */
export function parseRecipient(raw: string): ParsedRecipient | null {
  return parseOne(raw)
}

function parseOne(raw: string): ParsedRecipient | null {
  const entry = raw.trim()
  if (!entry) return null

  const named = NAMED.exec(entry)
  const email = (named ? named[2] : entry).trim().toLowerCase()
  // Mail clients wrap names containing commas in quotes; they are not part of the name.
  const name = named ? named[1].trim().replace(/^"|"$/g, '') || null : null

  return EMAIL.test(email) ? { email, name } : null
}

/**
 * Splits the pasted list into entries, respecting quotes and angle brackets.
 *
 * A plain `split(/[,;\n]/)` looks correct until a mail client contributes
 * `"Okafor, Sam" <s@example.com>` — the comma inside the quoted display name tears one
 * recipient into two fragments, and both then fail to parse. Since the name is exactly
 * the part the owner pasted to keep, that is silent data loss dressed up as a typo.
 */
function splitEntries(raw: string): string[] {
  const entries: string[] = []
  let current = ''
  let inQuotes = false
  let inAngle = false

  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === '<') inAngle = true
    else if (ch === '>') inAngle = false

    if ((ch === ',' || ch === ';' || ch === '\n') && !inQuotes && !inAngle) {
      entries.push(current)
      current = ''
      continue
    }

    current += ch
  }

  entries.push(current)
  return entries
}

/**
 * Parses a pasted list of addresses.
 *
 * The owner maintains this list by hand — the FPL API exposes no contact details — so
 * the realistic input is a paste from a mail client or a phone's contacts, separated by
 * commas, semicolons or newlines and possibly carrying display names.
 *
 * Nothing is silently discarded: unparseable entries come back in `invalid` and
 * duplicates in `duplicates`, so the UI can report exactly what happened. A list that
 * quietly loses two of fourteen members is the failure mode worth avoiding, and it
 * would not be noticed until someone complains they never get the digest.
 */
export function parseRecipientList(raw: string): ParseResult {
  const entries = splitEntries(raw)

  const valid: ParsedRecipient[] = []
  const invalid: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry.trim()) continue

    const parsed = parseOne(entry)
    if (!parsed) {
      invalid.push(entry.trim())
      continue
    }

    if (seen.has(parsed.email)) {
      duplicates.push(parsed.email)
      continue
    }

    seen.add(parsed.email)
    valid.push(parsed)
  }

  return { valid, invalid, duplicates }
}
