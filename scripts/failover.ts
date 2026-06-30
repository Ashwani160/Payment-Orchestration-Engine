import { ENGINE, A, B, C, resetAll, statsOf, post } from "./helpers.js";

async function main() {
  await resetAll();

  // Knock gateway-a DOWN — the engine must route around it.
  await post(`${A}/admin/behavior`, { behavior: "down" });

  const key = `failover-${Date.now()}`;
  const res = await fetch(`${ENGINE}/v1/charge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ amount: 1500, currency: "INR", customerId: "cust-1" }),
  });
  const json = await res.json();
  console.log("charge :", res.status, json);

  const [sa, sb, sc] = await Promise.all([statsOf(A), statsOf(B), statsOf(C)]);
  console.log(`A charges: ${sa.totalCharges} | B charges: ${sb.totalCharges} | C charges: ${sc.totalCharges}`);

  // Assert the PROPERTY, not a specific fallback gateway: the charge succeeded,
  // the down gateway charged nothing, and exactly one charge landed on a healthy
  // fallback (whichever one adaptive routing preferred).
  const ok =
    res.status === 200 &&
    json.gatewayId !== "gateway-a" &&
    sa.totalCharges === 0 &&
    sb.totalCharges + sc.totalCharges === 1;

  console.log(ok ? "\n✅ FAILOVER WORKS" : "\n❌ FAILOVER FAILED");
  process.exit(ok ? 0 : 1);
}

main();
