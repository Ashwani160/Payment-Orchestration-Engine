import type { GatewayHealth, GatewayId } from "../domain/gateway.js";
import type { RawCounts } from "./healthStore.js";

// Cold-start latency for a gateway we haven't tried yet. Deliberately NOT 0:
// a 0 would make every untried gateway win the latency tie-break and out-rank a
// proven-fast gateway forever, so routing would chase the least-used gateway and
// never settle. A neutral baseline keeps a new gateway eligible to be tried
// (optimistic success rate) without preferring the unknown over the proven-good.
const NEUTRAL_LATENCY_MS = 250;

// PURE: turn raw counters into the GatewayHealth shape rankGateways consumes.
// We surface `attempts` so the ranking knows how much evidence each rate carries.
export function deriveHealth(id: GatewayId, counts: RawCounts): GatewayHealth {
  if (counts.attempts === 0) {
    // Optimistic but neutral: eligible to be tried, not artificially preferred.
    return { gatewayId: id, successRate: 1, avgLatencyMs: NEUTRAL_LATENCY_MS, attempts: 0 };
  }
  return {
    gatewayId: id,
    successRate: counts.successes / counts.attempts,
    avgLatencyMs: counts.latencyTotalMs / counts.attempts,
    attempts: counts.attempts,
  };
}
