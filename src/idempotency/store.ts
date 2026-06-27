import { redis } from "./redis.js";

// A cached charge outcome, keyed by idempotency key.
export interface StoredResult {
  readonly gatewayRef: string;
}

const keyFor = (idempotencyKey: string) => `idem:${idempotencyKey}`;

// Look up a previously completed result. null = we've never seen this key.
export async function getResult(
  idempotencyKey: string,
): Promise<StoredResult | null> {
  const raw = await redis.get(keyFor(idempotencyKey));
  return raw === null ? null : (JSON.parse(raw) as StoredResult);
}

// Persist the result so future duplicates return it instead of re-charging.
export async function saveResult(
  idempotencyKey: string,
  result: StoredResult,
): Promise<void> {
  // EX 300 → expire after 5 minutes, matching the roadmap's lock TTL.
  await redis.set(keyFor(idempotencyKey), JSON.stringify(result), "EX", 300);
}