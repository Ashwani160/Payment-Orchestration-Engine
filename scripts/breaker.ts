import { ENGINE, A, B, C, resetAll, statsOf, post } from "./helpers.js";

const CHARGES = 6;   // more than enough to trip, then prove fast-fail
const THRESHOLD = 3; // matches defaultBreakerConfig.failureThreshold

async function main() {
  await resetAll();

  // ALL gateways down. This is the honest way to test the breaker in isolation:
  // with a healthy alternative present, adaptive routing would simply demote the
  // faulting gateway, and the breaker would rarely be the thing that stops the
  // traffic. With every gateway failing, the breaker is unambiguously what makes
  // the engine STOP spending network calls after the threshold.
  await Promise.all([A, B, C].map((g) => post(`${g}/admin/behavior`, { behavior: "down" })));

  // Sequential, unique keys → each gateway accrues failures deterministically.
  const statuses: number[] = [];
  for (let i = 0; i < CHARGES; i++) {
    const res = await fetch(`${ENGINE}/v1/charge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `brk-${Date.now()}-${i}` },
      body: JSON.stringify({ amount: 1500, currency: "INR", customerId: "cust-1" }),
    });
    statuses.push(res.status);
  }

  const [sa, sb, sc] = await Promise.all([statsOf(A), statsOf(B), statsOf(C)]);
  const breakers = await (await fetch(`${ENGINE}/admin/breakers`)).json();

  console.log("charge statuses :", statuses.join(" "), "(all 422 — every gateway is down)");
  console.log(`requests  A/B/C : ${sa.totalRequests}/${sb.totalRequests}/${sc.totalRequests} (each should plateau at ${THRESHOLD})`);
  console.log("breakers        :", breakers);

  const allOpen = ["gateway-a", "gateway-b", "gateway-c"].every((g) => breakers[g]?.status === "open");

  // The key proof: despite CHARGES (6) attempts, each gateway received only
  // THRESHOLD (3) requests — after that the open breaker skipped it entirely.
  const plateaued =
    sa.totalRequests === THRESHOLD &&
    sb.totalRequests === THRESHOLD &&
    sc.totalRequests === THRESHOLD;

  const ok = statuses.every((s) => s === 422) && plateaued && allOpen;
  console.log(ok ? "\n✅ CIRCUIT BREAKER WORKS" : "\n❌ BREAKER TEST FAILED");
  process.exit(ok ? 0 : 1);
}

main();
