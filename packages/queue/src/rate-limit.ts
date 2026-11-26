import { Redis } from "ioredis";

let client: Redis | null = null;

function redis(): Redis {
  if (!client) {
    // Fail fast: rate limits fail open, so a Redis outage must not queue or
    // retry commands and add latency to every request.
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: 500,
    });
    client.on("error", () => {
      // Connection errors surface on individual commands; avoid unhandled events.
    });
  }
  return client;
}

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the next attempt is allowed (0 when allowed). */
  retryAfterSec: number;
};

/**
 * Fixed-window counter: allows `limit` hits per `windowSec` for `key`.
 * The window is created and the counter incremented in one MULTI, and a key
 * that somehow lost its TTL gets one again, so a counter can never get stuck.
 * Fails open if Redis is unavailable, so an outage never blocks writes.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  try {
    const r = redis();
    const fullKey = `rl:${key}`;
    const res = await r
      .multi()
      .set(fullKey, 0, "EX", windowSec, "NX")
      .incr(fullKey)
      .ttl(fullKey)
      .exec();
    if (!res) return { allowed: true, retryAfterSec: 0 };
    const count = Number(res[1]?.[1] ?? 0);
    let ttl = Number(res[2]?.[1] ?? -1);
    if (ttl < 0) {
      await r.expire(fullKey, windowSec);
      ttl = windowSec;
    }
    if (count <= limit) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: ttl };
  } catch {
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * Checks a limit without counting a hit (consume it with `consumeRateLimit`
 * once the action succeeded). Fails open.
 */
export async function peekRateLimit(key: string, limit: number): Promise<RateLimitResult> {
  try {
    const r = redis();
    const fullKey = `rl:${key}`;
    const [count, ttl] = await Promise.all([r.get(fullKey), r.ttl(fullKey)]);
    if (Number(count ?? 0) < limit) return { allowed: true, retryAfterSec: 0 };
    if (ttl === -1) {
      // Stuck counter without TTL: treat as expired and clean it up.
      await r.del(fullKey);
      return { allowed: true, retryAfterSec: 0 };
    }
    return { allowed: false, retryAfterSec: Math.max(ttl, 1) };
  } catch {
    return { allowed: true, retryAfterSec: 0 };
  }
}

/** One hit per `ttlSec` for `key` (e.g. one poke per friend per 10 minutes). */
export function consumeCooldown(key: string, ttlSec: number): Promise<RateLimitResult> {
  return consumeRateLimit(`cd:${key}`, 1, ttlSec);
}

/** Whether a cooldown for `key` is currently active, without starting one. */
export function peekCooldown(key: string): Promise<RateLimitResult> {
  return peekRateLimit(`cd:${key}`, 1);
}
