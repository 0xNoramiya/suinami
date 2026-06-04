/**
 * Tiny in-memory sliding-window rate limiter.
 *
 * Single-process and best-effort — exactly right for this hackathon API (no
 * Redis): it keeps a short list of recent hit timestamps per key, prunes them on
 * access, and caps the number of tracked keys so it can't grow unbounded. For a
 * horizontally-scaled deploy you'd swap the Map for a shared store, but the
 * `rateLimit(key, limit, windowMs)` signature would stay the same.
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000;

export interface RateResult {
  ok: boolean;
  /** Milliseconds until the oldest hit ages out of the window (0 when ok). */
  retryAfterMs: number;
  /** Hits left in the current window after this call (0 when limited). */
  remaining: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateResult {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) {
    buckets.set(key, recent); // store the pruned list
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)), remaining: 0 };
  }

  recent.push(now);
  buckets.set(key, recent);

  // Opportunistic GC when the keyspace grows: drop buckets whose hits all aged
  // out, so abandoned IPs don't leak memory.
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) {
      const live = v.filter((t) => now - t < windowMs);
      if (live.length === 0) buckets.delete(k);
      else buckets.set(k, live);
    }
  }

  return { ok: true, retryAfterMs: 0, remaining: limit - recent.length };
}

/**
 * Best-effort client key for rate limiting: the first `x-forwarded-for` hop, or
 * `anon` when there's no proxy in front (dev). Never throws.
 */
export function clientIp(forwardedFor: string | undefined | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "anon";
}
