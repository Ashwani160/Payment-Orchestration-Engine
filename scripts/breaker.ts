const ENGINE = "http://localhost:3000";
const A = "http://localhost:4001", B = "http://localhost:4002", C = "http://localhost:4003";
const json = (r: Response) => r.json();

async function main() {
  await Promise.all([A, B, C].map((g) => fetch(`${g}/admin/reset`, { method: "POST" })));
  await fetch(`${ENGINE}/admin/breakers/reset`, { method: "POST" });

  // gateway-a faults on every call.
  await fetch(`${A}/admin/behavior`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "down" }),
  });

  // Fire 8 charges SEQUENTIALLY with unique keys so the breaker accrues failures
  // deterministically (concurrent would race the count — a noted tradeoff).
  const statuses: number[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${ENGINE}/v1/charge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `brk-${Date.now()}-${i}` },
      body: JSON.stringify({ amount: 1500, currency: "INR", customerId: "cust-1" }),
    });
    statuses.push(res.status);
  }

  const statsA = await json(await fetch(`${A}/admin/stats`));
  const statsB = await json(await fetch(`${B}/admin/stats`));
  const breakers = await json(await fetch(`${ENGINE}/admin/breakers`));

  console.log("charge statuses :", statuses.join(" "));
  console.log("A requests      :", statsA.totalRequests, "(should stop at the threshold)");
  console.log("B charges       :", statsB.totalCharges);
  console.log("breaker[a]      :", breakers["gateway-a"]);

  const ok =
    statuses.every((s) => s === 200) &&
    statsA.totalRequests === 3 &&
    statsB.totalCharges === 8 &&
    breakers["gateway-a"]?.status === "open";

  console.log(ok ? "\n✅ CIRCUIT BREAKER WORKS" : "\n❌ BREAKER TEST FAILED");
  process.exit(ok ? 0 : 1);
}

main();