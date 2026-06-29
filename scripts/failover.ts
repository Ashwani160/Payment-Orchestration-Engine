const ENGINE = "http://localhost:3000";
const A = "http://localhost:4001", B = "http://localhost:4002", C = "http://localhost:4003";

async function main() {
  // Reset all three, then knock gateway-a DOWN.
  await Promise.all([A, B, C].map((g) => fetch(`${g}/admin/reset`, { method: "POST" })));
  await fetch(`${A}/admin/behavior`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "down" }),
  });

  const key = `failover-${Date.now()}`;
  const res = await fetch(`${ENGINE}/v1/charge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ amount: 1500, currency: "INR", customerId: "cust-1" }),
  });
  const json = await res.json();
  console.log("charge :", res.status, json);

  const statsA = await (await fetch(`${A}/admin/stats`)).json();
  const statsB = await (await fetch(`${B}/admin/stats`)).json();
  console.log("A charges:", statsA.totalCharges, "| B charges:", statsB.totalCharges);

  // Success, A charged nothing (it's down), B picked up the charge.
  const ok = res.status === 200 && json.gatewayId === "gateway-b"
    && statsA.totalCharges === 0 && statsB.totalCharges === 1;
  console.log(ok ? "\n✅ FAILOVER WORKS" : "\n❌ FAILOVER FAILED");
  process.exit(ok ? 0 : 1);
}

main();