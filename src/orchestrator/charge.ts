import type { ChargeRequest, PaymentState } from "../domain/payment.js";
import type { GatewayHealth, GatewayId } from "../domain/gateway.js";
import { rankGateways } from "../routing/rankGateways.js";
import { getResult, saveResult, claim, release } from "../idempotency/store.js";
import { callGateway } from "../gateways/gatewayClient.js";
import { beforeAttempt, afterResult, defaultBreakerConfig } from "../resilience/circuitBreaker.js";
import { getBreaker, setBreaker } from "../resilience/breakerStore.js";
import { recordAttempt, readCounts } from "../health/healthStore.js";
import { deriveHealth } from "../health/deriveHealth.js";

const ALL_GATEWAYS: readonly GatewayId[] = ["gateway-a", "gateway-b", "gateway-c"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Read live counters for every gateway and derive the health snapshot.
async function liveHealth(): Promise<readonly GatewayHealth[]> {
  return Promise.all(
    ALL_GATEWAYS.map(async (id) => deriveHealth(id, await readCounts(id))),
  );
}

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

    // Ask the breaker before spending a network call on this gateway.
    const decision = beforeAttempt(getBreaker(gatewayId), Date.now(), defaultBreakerConfig);
    setBreaker(gatewayId, decision.state); // persist any open → half-open flip

    if (!decision.allow) {
      lastReason = `breaker open on ${gatewayId}`;
      continue; // fail fast — don't even try a gateway we know is down
    }

    const startedAt = Date.now();
    const response = await callGateway(gatewayId, request);
    const latencyMs = Date.now() - startedAt;
    
    // KEY DISTINCTION: a decline means the gateway WORKED (it just said no to the
    // card). Only timeout/error are gateway *faults*. So declines keep the breaker
    // healthy even though they're terminal for the customer.
    const healthy = response.outcome === "success" || response.outcome === "declined";
    // Feed BOTH the breaker (in-memory) and the health store (Redis).
    // A timeout is recorded at the client's timeout ceiling, not 0.
    await recordAttempt(gatewayId, healthy, latencyMs);
    setBreaker(gatewayId, afterResult(decision.state, healthy, Date.now(), defaultBreakerConfig));

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
    const ranked = rankGateways(await liveHealth());
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
