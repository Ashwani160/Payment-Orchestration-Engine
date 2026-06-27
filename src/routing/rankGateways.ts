import type { GatewayHealth, GatewayId } from "../domain/gateway.js";

// Rank gateways best-first. Pure: same inputs always give the same output.
// Strategy: prefer higher success rate; break ties by lower latency.
// Gateways below a minimum success rate are dropped entirely.
export function rankGateways(
  gateways: readonly GatewayHealth[],
  minSuccessRate: number = 0.5,
): readonly GatewayId[] {
  return gateways
    .filter((g) => g.successRate >= minSuccessRate)
    .slice() // copy before sorting — never mutate the input
    .sort((a, b) => {
      // Higher success rate wins.
      if (b.successRate !== a.successRate) {
        return b.successRate - a.successRate;
      }
      // Tie on success rate → lower latency wins.
      return a.avgLatencyMs - b.avgLatencyMs;
    })
    .map((g) => g.gatewayId);
}