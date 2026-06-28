import type { ChargeRequest } from "../domain/payment.js";
import type { PaymentState } from "../domain/payment.js";
import type { GatewayHealth } from "../domain/gateway.js";
import { rankGateways } from "../routing/rankGateways.js";
import { getResult, saveResult } from "../idempotency/store.js";
import { callGateway } from "../gateways/gatewayClient.js";

// Hardcoded health for the thin slice. Later this comes from Redis (health/ store).
// All three healthy so rankGateways has real data to sort.
const STATIC_HEALTH: readonly GatewayHealth[] = [
  { gatewayId: "gateway-a", successRate: 0.99, avgLatencyMs: 120 },
  { gatewayId: "gateway-b", successRate: 0.97, avgLatencyMs: 90 },
  { gatewayId: "gateway-c", successRate: 0.95, avgLatencyMs: 200 },
];

// The charge workflow. Returns a PaymentState — success or failure as DATA.
export async function charge(request: ChargeRequest): Promise<PaymentState> {
  // 1. Idempotency gate (NAIVE — has a deliberate race, fixed in the depth spike).
  const existing = await getResult(request.idempotencyKey);
  if (existing !== null) {
    return {
      status: "succeeded",
      request,
      gatewayId: "gateway-a", // cached path; gateway id isn't re-derived in the slice
      gatewayRef: existing.gatewayRef,
    };
  }

  // 2. Route (PURE). Best gateway first.
  const ranked = rankGateways(STATIC_HEALTH);
  const best = ranked[0];
  if (best === undefined) {
    return { status: "failed", request, reason: "no healthy gateway available" };
  }

  // 3. Execute. Thin slice calls only the first candidate (no failover yet).
  const response = await callGateway(best, request);

  // 4. Interpret the outcome — compiler forces us to handle every case.
  switch (response.outcome) {
    case "success":
      await saveResult(request.idempotencyKey, { gatewayRef: response.gatewayRef });
      return { status: "succeeded", request, gatewayId: best, gatewayRef: response.gatewayRef };
    case "declined":
      return { status: "failed", request, reason: `declined: ${response.code}` };
    case "timeout":
      return { status: "failed", request, reason: "gateway timeout" };
    case "error":
      return { status: "failed", request, reason: response.message };
  }
}