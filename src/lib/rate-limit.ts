/**
 * A fixed-window counter, held in memory.
 *
 * Deliberately not a table. This protects one thing — an owner's inbox from being flooded
 * with sign-in emails — and that threat does not survive a process restart, which an
 * attacker cannot trigger anyway. A `signin_attempts` table would be durable and correct
 * across instances, at the cost of a migration, a write per attempt, and a third thing
 * that grows without pruning alongside `sessions` and `verification_tokens`.
 *
 * **The assumption it rests on: one container.** The app runs as a single persistent
 * Railway service, so one process sees every attempt. Scale beyond that and each instance
 * counts separately, multiplying the effective limit by the instance count — which fails
 * open rather than shut, but fails. That is the day this moves to Postgres.
 *
 * Fixed window rather than sliding or token bucket: the extra precision buys nothing when
 * the limit exists to make flooding tedious rather than to meter a paid API.
 */

export interface RateLimitResult {
  allowed: boolean
  /** How long until the oldest attempt in the window expires, for the message. */
  retryAfterMs: number
}

interface Bucket {
  hits: number[]
}

/**
 * Keyed buckets, pruned lazily.
 *
 * No timer and no cleanup job: a key is only ever examined when it is used, and expired
 * hits are dropped on that read. An abandoned key holds a few timestamps until the process
 * restarts, which is a rounding error next to the session data already in memory.
 */
const buckets = new Map<string, Bucket>()

export interface RateLimitRule {
  limit: number
  windowMs: number
}

/**
 * Records an attempt and says whether it may proceed.
 *
 * Counts the attempt **whether or not it is allowed**, so hammering a limited key keeps it
 * limited rather than letting a burst drain the window while the attacker waits. The clock
 * is injectable because a test that asserts a window expires should not sleep for it.
 */
export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitRule,
  now = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(key) ?? { hits: [] }
  const cutoff = now - windowMs

  bucket.hits = bucket.hits.filter((t) => t > cutoff)
  bucket.hits.push(now)
  buckets.set(key, bucket)

  if (bucket.hits.length <= limit) return { allowed: true, retryAfterMs: 0 }

  // The oldest hit still in the window is what has to age out before another is allowed.
  const oldest = bucket.hits[0]
  return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - now) }
}

/** Test-only: the counters are process-global, so a test must be able to start clean. */
export function resetRateLimits(): void {
  buckets.clear()
}

/**
 * Sign-in limits.
 *
 * Per address, because the abuse this exists for is flooding one owner's inbox: the
 * allowlist already refuses unknown addresses before any mail is sent, so an attacker can
 * only target someone they know is an owner. Five in a quarter of an hour is far above
 * normal use — an owner sends one, occasionally two when a chat app's link preview eats
 * the first, which has happened three times in production — and far below useful flooding.
 *
 * Per IP as well, because enumeration is possible on this page, so someone could spray
 * several known addresses and stay under every per-address limit while still sending a
 * lot of mail.
 */
export const SIGNIN_PER_EMAIL: RateLimitRule = { limit: 5, windowMs: 15 * 60 * 1000 }
export const SIGNIN_PER_IP: RateLimitRule = { limit: 20, windowMs: 60 * 60 * 1000 }
