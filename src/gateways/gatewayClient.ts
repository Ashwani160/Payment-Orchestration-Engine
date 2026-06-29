import type { GatewayId, GatewayResponse } from "../domain/gateway.js";
import type { ChargeRequest } from "../domain/payment.js";

// Where each gateway lives. For the thin slice we point all ids at the one
// mock gateway (Step 7); the map is here so failover has somewhere to grow.
const GATEWAY_URLS: Record<GatewayId, string> = {
  "gateway-a": "http://localhost:4001/charge",
  "gateway-b": "http://localhost:4002/charge",
  "gateway-c": "http://localhost:4003/charge",
};

const TIMEOUT_MS = 3000;

// Call one gateway. Returns the outcome as DATA — never throws.
export async function callGateway(
  gatewayId: GatewayId,
  request: ChargeRequest,
): Promise<GatewayResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GATEWAY_URLS[gatewayId], {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: request.amount,
        currency: request.currency,
        customerId: request.customerId,
      }),
      signal: controller.signal,
    });

    // The gateway declined the charge (business failure, not a transport error).
    if (res.status === 402) {
      const body = (await res.json()) as { code?: string };
      return { outcome: "declined", code: body.code ?? "unknown" };
    }

    // Any other non-2xx is a gateway-side error.
    if (!res.ok) {
      return { outcome: "error", message: `gateway status ${res.status}` };
    }

    const body = (await res.json()) as { gatewayRef: string };
    return { outcome: "success", gatewayRef: body.gatewayRef };
  } catch (err) {
    // AbortError = we hit our own timeout. Everything else = transport error.
    if (err instanceof Error && err.name === "AbortError") {
      return { outcome: "timeout" };
    }
    return {
      outcome: "error",
      message: err instanceof Error ? err.message : "unknown transport error",
    };
  }
}