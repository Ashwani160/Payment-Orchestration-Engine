// The gateways we can route to. A union of string literals, not an enum.
export type GatewayId = "gateway-a" | "gateway-b" | "gateway-c";

// Health snapshot the routing core reads to rank gateways.
// This is plain data — the SHELL fetches it from Redis, the CORE consumes it.
export interface GatewayHealth {
  readonly gatewayId: GatewayId;
  readonly successRate: number;   // 0..1
  readonly avgLatencyMs: number;
  readonly attempts: number;      // sample size behind the rates above
}

// The result of calling a gateway — errors as DATA, never thrown.
// The orchestrator pattern-matches on `outcome` instead of try/catch.
export type GatewayResponse =
  | { readonly outcome: "success"; readonly gatewayRef: string }
  | { readonly outcome: "declined"; readonly code: string }
  | { readonly outcome: "timeout" }
  | { readonly outcome: "error"; readonly message: string };