import { ENGINE, A, B, C, resetAll, totalChargesAcross } from "./helpers.js";

async function main() {
  await resetAll();

  const key = `smoke-${Date.now()}`;
  const body = JSON.stringify({ amount: 1500, currency: "INR", customerId: "cust-1" });
  const headers = { "Content-Type": "application/json", "Idempotency-Key": key };

  // 1. First charge → should succeed.
  const first = await fetch(`${ENGINE}/v1/charge`, { method: "POST", headers, body });
  const firstJson = await first.json();
  console.log("first  :", first.status, firstJson);

  // 2. Same key again → should return the cached result, NOT re-charge.
  const second = await fetch(`${ENGINE}/v1/charge`, { method: "POST", headers, body });
  const secondJson = await second.json();
  console.log("second :", second.status, secondJson);

  // 3. Exactly ONE charge across ALL gateways — routing-agnostic. (Adaptive
  //    routing may pick any gateway; we don't care which, only that it's once.)
  const charges = await totalChargesAcross(A, B, C);
  console.log("charges (all gateways):", charges);

  const ok =
    first.status === 200 &&
    second.status === 200 &&
    firstJson.gatewayRef === secondJson.gatewayRef &&
    charges === 1;

  console.log(ok ? "\n✅ SMOKE PASSED" : "\n❌ SMOKE FAILED");
  process.exit(ok ? 0 : 1);
}

main();
