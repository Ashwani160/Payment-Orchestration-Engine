import type { GatewayHealth, GatewayId } from "../domain/gateway.js";

// A gateway needs at least this many attempts before a poor success rate is
// allowed to drop it. Below the floor we lack the evidence to condemn it, so we
// keep it eligible and let the CIRCUIT BREAKER be the fast tripwire instead.
// This MUST exceed the breaker's failureThreshold — otherwise the success-rate
// filter would exclude a faulting gateway before the breaker ever trips, and the
// breaker would be dead code. (Fast tripwire = breaker; slow trend = this filter.)
const MIN_ATTEMPTS_TO_JUDGE = 10;

// Rank gateways best-first. Pure: same inputs always give the same output.
// Strategy: prefer higher success rate; break ties by lower latency.
// A well-sampled gateway below the minimum success rate is dropped entirely;
// an under-sampled one is kept (we don't yet have the evidence to judge it).
export function rankGateways(
  gateways: readonly GatewayHealth[],
  minSuccessRate: number = 0.5,
): readonly GatewayId[] {
  return gateways
    .slice()
    .sort((a, b) => {
      const aBad = a.attempts >= MIN_ATTEMPTS_TO_JUDGE && a.successRate < minSuccessRate;
      const bBad = b.attempts >= MIN_ATTEMPTS_TO_JUDGE && b.successRate < minSuccessRate;
      if (aBad !== bBad) return aBad ? 1 : -1;        // proven-bad sinks to the bottom
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return a.avgLatencyMs - b.avgLatencyMs;
    })
    .map((g) => g.gatewayId);
}
