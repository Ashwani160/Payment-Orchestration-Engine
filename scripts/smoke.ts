const ENGINE = "http://localhost:3000";
const MOCK = "http://localhost:4001";

async function main() {
  // Reset the gateway's counters.
  await fetch(`${MOCK}/admin/reset`, { method: "POST" });

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

  // 3. The gateway should have seen exactly ONE charge.
  const stats = await (await fetch(`${MOCK}/admin/stats`)).json();
  console.log("stats  :", stats);

  const ok =
    first.status === 200 &&
    second.status === 200 &&
    firstJson.gatewayRef === secondJson.gatewayRef &&
    stats.totalCharges === 1;

  console.log(ok ? "\n✅ SMOKE PASSED" : "\n❌ SMOKE FAILED");
  process.exit(ok ? 0 : 1);
}

main();