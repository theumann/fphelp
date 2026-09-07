import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Bearer-token check for the operator-only HTTP routes.
 *
 * Extracted so the two routes that need it cannot drift apart. It lived in
 * `capture-history` alone while that was the only guarded endpoint; copying it to a second
 * one would have meant two implementations of a security check, and the copy is always the
 * one that misses the next fix.
 *
 * **Fails closed.** An unset `JOBS_TOKEN` rejects every request rather than leaving the
 * endpoint open — a missing variable is the most likely way this is misconfigured, and the
 * safe reading of it is "nobody", not "everybody".
 *
 * Both sides are hashed before comparing so `timingSafeEqual` gets equal lengths and
 * cannot throw, and so the token's length is not leaked by an early return.
 */
export function authorisedJobRequest(req: Request): boolean {
  const expected = process.env.JOBS_TOKEN
  if (!expected) return false

  const header = req.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  const digest = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(digest(provided), digest(expected))
}
