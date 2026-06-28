import express from "express";

const app = express();
app.use(express.json());

// ── Chaos state: flip these at runtime via the admin endpoints ──
let behavior: "success" | "decline" | "timeout" | "down" = "success";
let latencyMs = 0;
let failureRate = 0; // 0..1 — random declines even while in "success" mode

// ── Charge counting: the number we assert against in the depth spike ──
let totalCharges = 0;
const chargesByCustomer = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The endpoint the engine's gatewayClient calls.
app.post("/charge", async (req, res) => {
  if (latencyMs > 0) await sleep(latencyMs);

  if (behavior === "down") {
    res.status(500).json({ error: "gateway down" });
    return;
  }
  if (behavior === "timeout") {
    await sleep(5000); // longer than the client's 3s timeout → client aborts
    res.status(200).json({ gatewayRef: "late" });
    return;
  }
  if (behavior === "decline" || Math.random() < failureRate) {
    res.status(402).json({ code: "insufficient_funds" });
    return;
  }

  // Success: THIS is a real charge — count it.
  totalCharges += 1;
  const customerId = String(req.body?.customerId ?? "unknown");
  chargesByCustomer.set(customerId, (chargesByCustomer.get(customerId) ?? 0) + 1);

  res.status(200).json({ gatewayRef: crypto.randomUUID() });
});

// ── Admin / chaos controls ──
app.post("/admin/behavior", (req, res) => {
  const b = req.body ?? {};
  if (b.behavior) behavior = b.behavior;
  if (typeof b.latencyMs === "number") latencyMs = b.latencyMs;
  if (typeof b.failureRate === "number") failureRate = b.failureRate;
  res.json({ behavior, latencyMs, failureRate });
});

app.get("/admin/stats", (_req, res) => {
  res.json({ totalCharges, chargesByCustomer: Object.fromEntries(chargesByCustomer) });
});

app.post("/admin/reset", (_req, res) => {
  totalCharges = 0;
  chargesByCustomer.clear();
  behavior = "success";
  latencyMs = 0;
  failureRate = 0;
  res.json({ ok: true });
});

app.listen(4001, () => console.log("mock-gateway listening on :4001"));