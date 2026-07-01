import { Effect } from "effect";
import type { ChargeRequest, PaymentState } from "../domain/payment.js";
import type { GatewayHealth, GatewayId } from "../domain/gateway.js";
import { rankGateways } from "../routing/rankGateways.js";
import { getResult, saveResult, claim, release } from "../idempotency/store.js";
import { readCounts } from "../health/healthStore.js";
import { deriveHealth } from "../health/deriveHealth.js";
import { failoverEffect } from "./failoverEffect.js";

const ALL_GATEWAYS: readonly GatewayId[] = ["gateway-a", "gateway-b", "gateway-c"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function liveHealth(): Promise<readonly GatewayHealth[]> {
  return Promise.all(ALL_GATEWAYS.map(async (id) => deriveHealth(id, await readCounts(id))));
}

// A duplicate that LOST the claim waits here for the winner to finish.
async function waitForResult(request: ChargeRequest): Promise<PaymentState> {
  const key = request.idempotencyKey;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const r = await getResult(key);
    if (r === null) {
      return { status: "failed", request, reason: "concurrent charge failed; please retry" };
    }
    if (r !== "pending") {
      return { status: "succeeded", request, gatewayId: "gateway-a", gatewayRef: r.gatewayRef };
    }
  }
  return { status: "failed", request, reason: "timed out waiting for concurrent charge" };
}

export async function charge(request: ChargeRequest): Promise<PaymentState> {
  const key = request.idempotencyKey;

  // 1. Already completed? Replay, never re-charge.
  const existing = await getResult(key);
  if (existing !== null && existing !== "pending") {
    return { status: "succeeded", request, gatewayId: "gateway-a", gatewayRef: existing.gatewayRef };
  }

  // 2. Atomic gate — exactly one concurrent caller wins.
  const won = await claim(key);
  if (!won) {
    return await waitForResult(request);
  }

  // 3. We own the claim. The failover + breaker + health logic now lives entirely
  //    in failoverEffect; we run it at the edge and translate its typed result
  //    (success value | GatewayDeclined | NoHealthyGateway) into a PaymentState.
  try {
    const ranked = rankGateways(await liveHealth());
    const exit = await Effect.runPromiseExit(failoverEffect(ranked, request));

    if (exit._tag === "Success") {
      await saveResult(key, { gatewayRef: exit.value.gatewayRef });
      return { status: "succeeded", request, gatewayId: exit.value.gatewayId, gatewayRef: exit.value.gatewayRef };
    }

    // Failure: pull the tagged error out of the Cause and map it to a reason.
    await release(key);
    const err = (exit.cause as { error?: { _tag: string; code?: string; lastReason?: string } }).error;
    if (err?._tag === "GatewayDeclined") {
      return { status: "failed", request, reason: `declined: ${err.code ?? "unknown"}` };
    }
    if (err?._tag === "NoHealthyGateway") {
      return { status: "failed", request, reason: `all gateways exhausted (${err.lastReason ?? "unknown"})` };
    }
    return { status: "failed", request, reason: "charge failed" };
  } catch (err) {
    await release(key);
    throw err;
  }
}