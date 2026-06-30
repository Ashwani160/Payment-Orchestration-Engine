import { redis } from "../idempotency/redis.js";
import type { GatewayId } from "../domain/gateway.js";

// Raw, atomically-incremented counters per gateway. We store COUNTS (trivially
// atomic via INCR/INCRBY) and derive rates at read time — never store a computed
// rate, so concurrent writers can't clobber each other's math.
const k = (id: GatewayId) => ({
  attempts: `health:${id}:attempts`,
  successes: `health:${id}:successes`,
  latency: `health:${id}:latencyTotalMs`,
});

// One atomic pipeline per recorded attempt. INCR can't race — that's the point.
export async function recordAttempt(
  id: GatewayId,
  success: boolean,
  latencyMs: number,
): Promise<void> {
  const keys = k(id);
  const p = redis.pipeline();
  p.incr(keys.attempts);
  if (success) p.incr(keys.successes);
  p.incrby(keys.latency, Math.round(latencyMs));
  await p.exec();
}

export interface RawCounts {
  readonly attempts: number;
  readonly successes: number;
  readonly latencyTotalMs: number;
}

export async function readCounts(id: GatewayId): Promise<RawCounts> {
  const keys = k(id);
  const [a, s, l] = await redis.mget(keys.attempts, keys.successes, keys.latency);
  return {
    attempts: Number(a ?? 0),
    successes: Number(s ?? 0),
    latencyTotalMs: Number(l ?? 0),
  };
}

export async function resetHealth(ids: readonly GatewayId[]): Promise<void> {
  const p = redis.pipeline();
  for (const id of ids) {
    const keys = k(id);
    p.del(keys.attempts, keys.successes, keys.latency);
  }
  await p.exec();
}