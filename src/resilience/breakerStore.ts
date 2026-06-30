import type { GatewayId } from "../domain/gateway.js";
import { initialBreaker, type BreakerState } from "./circuitBreaker.js";

// Per-gateway breaker state, in-memory for this process (see README tradeoff note).
const states = new Map<GatewayId, BreakerState>();

export const getBreaker = (id: GatewayId): BreakerState =>
  states.get(id) ?? initialBreaker;

export const setBreaker = (id: GatewayId, state: BreakerState): void => {
  states.set(id, state);
};

export const snapshotBreakers = (): Record<string, BreakerState> =>
  Object.fromEntries(states);

export const resetBreakers = (): void => states.clear();