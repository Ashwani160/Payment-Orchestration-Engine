import { redis } from "./redis.js";

// A cached charge outcome, keyed by idempotency key.
export interface StoredResult {
  readonly gatewayRef: string;
}

const PENDING = "__pending__";
const keyFor = (idempotencyKey: string) => `idem:${idempotencyKey}`;

// Atomically claim the right to charge. SET NX succeeds for EXACTLY ONE caller
// across all concurrent requests — that's the whole correctness guarantee.
// Returns true if WE won (we must charge); false if someone else already holds it.
export async function claim(idempotencyKey: string): Promise<boolean> {
  const res = await redis.set(keyFor(idempotencyKey), PENDING, "EX", 300, "NX");
  return res === "OK";
}

// Three-state read: null = never seen, "pending" = claimed but unfinished,
// StoredResult = a completed charge we can safely replay.
export async function getResult(
  idempotencyKey: string,
): Promise<StoredResult | "pending" | null> {
  const raw = await redis.get(keyFor(idempotencyKey));
    if (raw === null) return null;
  if (raw === PENDING) return "pending";
  return JSON.parse(raw) as StoredResult;
}

// Persist the result so future duplicates return it instead of re-charging.
// Overwrite the pending marker with the real result. No NX — we already own the key.
export async function saveResult(
  idempotencyKey: string,
  result: StoredResult,
): Promise<void> {
  await redis.set(keyFor(idempotencyKey), JSON.stringify(result), "EX", 300);
}
// Store
// Key:
// idem:abc123
// Value:
// {"gatewayRef":"txn_111"}
// Expire after:
// 300 seconds

// Release the claim so a failed charge doesn't lock the key for the full TTL.
export async function release(idempotencyKey: string): Promise<void> {
  await redis.del(keyFor(idempotencyKey));
}