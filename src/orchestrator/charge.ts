import type { ChargeRequest, PaymentState } from "../domain/payment.js";
import type { GatewayHealth, GatewayId } from "../domain/gateway.js";
import { rankGateways } from "../routing/rankGateways.js";
import { getResult, saveResult, claim, release } from "../idempotency/store.js";
import { callGateway } from "../gateways/gatewayClient.js";

// Hardcoded health for the thin slice. Later this comes from Redis (health/ store).
// All three healthy so rankGateways has real data to sort.
const STATIC_HEALTH: readonly GatewayHealth[] = [
  { gatewayId: "gateway-a", successRate: 0.99, avgLatencyMs: 120 },
  { gatewayId: "gateway-b", successRate: 0.97, avgLatencyMs: 90 },
  { gatewayId: "gateway-c", successRate: 0.95, avgLatencyMs: 200 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A duplicate that LOST the claim waits here for the winner to finish.
async function waitForResult(request: ChargeRequest): Promise<PaymentState> {
  const key = request.idempotencyKey;
  for (let i = 0; i < 50; i++) {            // up to ~5s
    await sleep(100);
    const r = await getResult(key);
    if (r === null) {
      // Winner released on failure → key is free. Report the in-flight failure.
      return { status: "failed", request, reason: "concurrent charge failed; please retry" };
    }
    if (r !== "pending") {
      return { status: "succeeded", request, gatewayId: "gateway-a", gatewayRef: r.gatewayRef };
    }
  }
  return { status: "failed", request, reason: "timed out waiting for concurrent charge" };
}

// Walk the ranked candidates. Returns the first success, or the last failure
// reason if every candidate is exhausted. PURE-ish: all I/O is callGateway.
async function attemptWithFailover(
  ranked: readonly GatewayId[],
  request: ChargeRequest,
): Promise<{ gatewayId: GatewayId; gatewayRef: string } | { failed: true; reason: string }> {
  let lastReason = "no candidates";

  for (const gatewayId of ranked) {
    const response = await callGateway(gatewayId, request);
    switch (response.outcome) {
      case "success":
        return { gatewayId, gatewayRef: response.gatewayRef };
      case "declined":
        // TERMINAL — another gateway won't approve a declined card. Stop now.
        return { failed: true, reason: `declined: ${response.code}` };
      case "timeout":
        lastReason = `timeout on ${gatewayId}`;
        continue; // RETRYABLE — try the next candidate.
      case "error":
        lastReason = `error on ${gatewayId}: ${response.message}`;
        continue; // RETRYABLE — try the next candidate.
    }
  }
  return { failed: true, reason: `all gateways exhausted (${lastReason})` };
}

export async function charge(request: ChargeRequest): Promise<PaymentState> {
  const key = request.idempotencyKey;

  // 1. Already completed? Replay the cached result, never re-charge.
  const existing = await getResult(key);
  if (existing !== null && existing !== "pending") {
    return { status: "succeeded", request, gatewayId: "gateway-a", gatewayRef: existing.gatewayRef };
  }

  // 2. Atomic gate. Exactly one concurrent caller wins this.
  const won = await claim(key);
  if (!won) {
    // Lost the race (or saw "pending") → wait for the winner instead of charging.
    return await waitForResult(request);
  }

  // 3. We own the claim — we are the ONLY caller that will hit the gateway.
  try {
    const ranked = rankGateways(STATIC_HEALTH);
    if (ranked.length === 0) {
      await release(key);
      return { status: "failed", request, reason: "no healthy gateway available" };
    }

    const result = await attemptWithFailover(ranked, request);

    if ("failed" in result) {
      await release(key);
      return { status: "failed", request, reason: result.reason };
    }

    await saveResult(key, { gatewayRef: result.gatewayRef });
    return { status: "succeeded", request, gatewayId: result.gatewayId, gatewayRef: result.gatewayRef };
    
  } catch (err) {
    await release(key); // never leave a dangling lock
    throw err;
  }
}
