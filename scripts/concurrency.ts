const ENGINE = "http://localhost:3000";
const MOCK = "http://localhost:4001";
const N = 20; // identical concurrent requests

async function main() {
  // Fresh gateway counters.
  await fetch(`${MOCK}/admin/reset`, { method: "POST" });

  // ONE key, shared by every request. A correct system charges exactly once.
  const key = `conc-${Date.now()}`;
  const body = JSON.stringify({ amount: 1500, currency: "INR", customerId: "cust-1" });
  const headers = { "Content-Type": "application/json", "Idempotency-Key": key };

  // Fire all N at once — no awaits in between, so they race.
  const responses = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(`${ENGINE}/v1/charge`, { method: "POST", headers, body }).then((r) => r.json()),
    ),
  );

  // How many DISTINCT gatewayRefs came back? Each distinct ref = a separate charge.
  const distinctRefs = new Set(responses.map((r) => r.gatewayRef).filter(Boolean));

  // The source of truth: how many charges the gateway actually executed.
  const stats = await (await fetch(`${MOCK}/admin/stats`)).json();

  console.log(`fired           : ${N} identical concurrent requests`);
  console.log(`distinct refs   : ${distinctRefs.size}`);
  console.log(`gateway charges : ${stats.totalCharges}`);

  const ok = stats.totalCharges === 1;
  console.log(ok ? "\n✅ EXACTLY ONE CHARGE" : `\n❌ RACE PROVEN — ${stats.totalCharges} charges from one key`);
  process.exit(ok ? 0 : 1);
}

main();