import { ENGINE, A, B, C, resetAll, statsOf, post } from "./helpers.js";

async function main() {
  await resetAll();

  // gateway-a stays HEALTHY but slow (400ms). It should keep a perfect success
  // rate yet get demoted purely by latency — adaptive routing moving traffic off
  // it without the breaker or the success-rate filter ever firing.
  await post(`${A}/admin/behavior`, { latencyMs: 400 });

  // Drive traffic with unique idempotency keys so each is a real attempt.
  for (let i = 0; i < 12; i++) {
    await fetch(`${ENGINE}/v1/charge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `adp-${Date.now()}-${i}` },
      body: JSON.stringify({ amount: 1500, currency: "INR", customerId: "cust-1" }),
    });
  }

  const health = await (await fetch(`${ENGINE}/admin/health`)).json();
  console.log("live health:");
  for (const h of health) {
    console.log(
      `  ${h.gatewayId}: successRate=${h.successRate.toFixed(2)} avgLatencyMs=${Math.round(h.avgLatencyMs)} attempts=${h.attempts}`,
    );
  }

  const [sa, sb, sc] = await Promise.all([statsOf(A), statsOf(B), statsOf(C)]);
  console.log(`charges   A/B/C : ${sa.totalCharges}/${sb.totalCharges}/${sc.totalCharges}`);

  const a = health.find((h: any) => h.gatewayId === "gateway-a");

  // gateway-a is HEALTHY (successRate 1) but SLOW (>=300ms), and the traffic
  // demonstrably shifted away from it onto the faster gateways. That shift is the
  // whole point — routing adapted to observed behavior, not to a static config.
  const ok =
    a &&
    a.successRate === 1 &&
    a.avgLatencyMs >= 300 &&
    sa.totalCharges <= 2 &&
    sb.totalCharges + sc.totalCharges >= 10;

  console.log(ok ? "\n✅ ADAPTIVE ROUTING SHIFTS TRAFFIC" : "\n❌ ADAPTIVE TEST FAILED");
  process.exit(ok ? 0 : 1);
}

main();
