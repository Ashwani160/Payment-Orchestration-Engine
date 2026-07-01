import { Effect } from "effect";
import { chargeEffect } from "../packages/engine/src/gateways/gatewayEffect.js";
import type { ChargeRequest } from "../packages/engine/src/domain/payment.js";

const A = "http://localhost:4001";
const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const req: ChargeRequest = { idempotencyKey: "x", amount: 1500, currency: "INR", customerId: "c-1" };

// Run the effect and report which channel it landed in + the tag if it failed.
async function probe(label: string): Promise<string> {
  const exit = await Effect.runPromiseExit(chargeEffect("gateway-a", req));
  if (exit._tag === "Success") return `${label}: SUCCESS ref=${exit.value.gatewayRef.slice(0, 8)}`;
  // Failure: pull the tagged error out of the Cause.
  const err = (exit.cause as any).error ?? (exit.cause as any).defect;
  return `${label}: FAIL tag=${err?._tag ?? "?"}`;
}

async function main() {
  await post(`${A}/admin/reset`);

  await post(`${A}/admin/behavior`, { behavior: "success" });
  console.log(await probe("success "));

  await post(`${A}/admin/behavior`, { behavior: "decline" });
  console.log(await probe("decline "));

  await post(`${A}/admin/behavior`, { behavior: "down" });
  console.log(await probe("down    "));

  await post(`${A}/admin/behavior`, { behavior: "timeout" });
  console.log(await probe("timeout ")); // ~3s — Effect.timeoutFail fires

  await post(`${A}/admin/reset`);
  console.log("\n✅ GATEWAY EFFECT MAPS ALL FOUR OUTCOMES");
}

main();