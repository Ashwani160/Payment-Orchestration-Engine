import { Router } from "express";
import type { ChargeRequest } from "../domain/payment.js";
import { charge } from "../orchestrator/charge.js";

export const routes: Router = Router();

// Validate raw input into a typed ChargeRequest, or return what's wrong.
function parseChargeRequest(
  body: unknown,
  idempotencyKey: string | undefined,
): { ok: true; value: ChargeRequest } | { ok: false; error: string } {
  if (!idempotencyKey) return { ok: false, error: "missing Idempotency-Key header" };
  if (typeof body !== "object" || body === null) return { ok: false, error: "body must be an object" };

  const b = body as Record<string, unknown>;
  if (typeof b.amount !== "number" || b.amount <= 0) return { ok: false, error: "amount must be a positive number" };
  if (typeof b.currency !== "string") return { ok: false, error: "currency must be a string" };
  if (typeof b.customerId !== "string") return { ok: false, error: "customerId must be a string" };

  return {
    ok: true,
    value: { idempotencyKey, amount: b.amount, currency: b.currency, customerId: b.customerId },
  };
}

routes.post("/v1/charge", async (req, res) => {
  const parsed = parseChargeRequest(req.body, req.header("Idempotency-Key"));
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const result = await charge(parsed.value);

  switch (result.status) {
    case "succeeded":
      res.status(200).json({ status: "succeeded", gatewayRef: result.gatewayRef, gatewayId: result.gatewayId });
      return;
    case "failed":
      res.status(422).json({ status: "failed", reason: result.reason });
      return;
    case "pending": {
      // charge() never returns pending, but the compiler makes us be explicit.
      res.status(500).json({ error: "unexpected pending state" });
      return;
    }
    default: {
      const _exhaustive: never = result;
      throw new Error(`unhandled payment state: ${JSON.stringify(_exhaustive)}`);
    }
  }

});