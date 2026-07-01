import { Effect } from "effect";
import { failoverEffect } from "../packages/engine/src/orchestrator/failoverEffect.js";
import type { ChargeRequest } from "../packages/engine/src/domain/payment.js";
import { redis } from "../packages/engine/src/idempotency/redis.js";

const A = "http://localhost:4001", B = "http://localhost:4002", C = "http://localhost:4003";
const ENGINE = "http://localhost:3000";
const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

const ranked = ["gateway-a", "gateway-b", "gateway-c"] as const;
const req: ChargeRequest = { idempotencyKey: "x", amount: 1500, currency: "INR", customerId: "c-1" };

async function reset() {
  await Promise.all([A, B, C].map((g) => post(`${g}/admin/reset`)));
  await post(`${ENGINE}/admin/breakers/reset`);
  await post(`${ENGINE}/admin/health/reset`);
}

async function run(label: string) {
  const exit = await Effect.runPromiseExit(failoverEffect([...ranked], req));
  if (exit._tag === "Success") return `${label}: SUCCESS on ${exit.value.gatewayId}`;
  const err = (exit.cause as any).error ?? (exit.cause as any).defect;
  return `${label}: FAIL tag=${err?._tag ?? "?"}`;
}

async function main() {
  // 1. A down → should fail over to B, no charge on A.
  await reset();
  await post(`${A}/admin/behavior`, { behavior: "down" });
  console.log(await run("A down   "));
  const b1 = await (await fetch(`${B}/admin/stats`)).json();
  console.log(`   → B charges: ${b1.totalCharges} (expect 1)`);

  // 2. A declines → TERMINAL, must NOT try B or C.
  await reset();
  await post(`${A}/admin/behavior`, { behavior: "decline" });
  console.log(await run("A decline"));
  const [sa, sb, sc] = await Promise.all([A, B, C].map(async (g) => (await fetch(`${g}/admin/stats`)).json()));
  console.log(`   → requests A/B/C: ${sa.totalRequests}/${sb.totalRequests}/${sc.totalRequests} (expect 1/0/0 — decline short-circuits)`);

  await reset();
  console.log("\n✅ EFFECT FAILOVER: failover on fault, short-circuit on decline");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => redis.quit());