import { ENGINE, A, B, C, resetAll, totalChargesAcross } from "./helpers.js";

const N = 20; // identical concurrent requests

async function main() {
  await resetAll();

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

  // The source of truth: how many charges the gateways actually executed (summed
  // across all three, since adaptive routing decides which one handles it).
  const charges = await totalChargesAcross(A, B, C);

  console.log(`fired                 : ${N} identical concurrent requests`);
  console.log(`distinct refs         : ${distinctRefs.size}`);
  console.log(`charges (all gateways): ${charges}`);

  const ok = charges === 1 && distinctRefs.size === 1;
  console.log(ok ? "\n✅ EXACTLY ONE CHARGE" : `\n❌ RACE PROVEN — ${charges} charges from one key`);
  process.exit(ok ? 0 : 1);
}

main();
