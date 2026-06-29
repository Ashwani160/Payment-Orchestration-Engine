import express from "express";

type Behavior = "success" | "decline" | "timeout" | "down";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Build one fully independent gateway with its own state and admin controls.
function makeGateway(name: string, port: number) {
  let behavior: Behavior = "success";
  let latencyMs = 0;
  let failureRate = 0;
  let totalCharges = 0;
  const chargesByCustomer = new Map<string, number>();

  const app = express();
  app.use(express.json());

  app.post("/charge", async (req, res) => {
    if (latencyMs > 0) await sleep(latencyMs);

    if (behavior === "down") {
      res.status(500).json({ error: `${name} down` });
      return;
    }
    if (behavior === "timeout") {
      await sleep(5000); // exceeds the client's 3s timeout → client aborts
      res.status(200).json({ gatewayRef: "late" });
      return;
    }
    if (behavior === "decline" || Math.random() < failureRate) {
      res.status(402).json({ code: "insufficient_funds" });
      return;
    }

    totalCharges += 1;
    const customerId = String(req.body?.customerId ?? "unknown");
    chargesByCustomer.set(customerId, (chargesByCustomer.get(customerId) ?? 0) + 1);
    res.status(200).json({ gatewayRef: crypto.randomUUID() });
  });

  app.post("/admin/behavior", (req, res) => {
    const b = req.body ?? {};
    if (b.behavior) behavior = b.behavior;
    if (typeof b.latencyMs === "number") latencyMs = b.latencyMs;
    if (typeof b.failureRate === "number") failureRate = b.failureRate;
    res.json({ name, behavior, latencyMs, failureRate });
  });

  app.get("/admin/stats", (_req, res) => {
    res.json({ name, totalCharges, chargesByCustomer: Object.fromEntries(chargesByCustomer) });
  });

  app.post("/admin/reset", (_req, res) => {
    totalCharges = 0;
    chargesByCustomer.clear();
    behavior = "success";
    latencyMs = 0;
    failureRate = 0;
    res.json({ name, ok: true });
  });

  app.listen(port, () => console.log(`mock ${name} listening on :${port}`));
}

makeGateway("gateway-a", 4001);
makeGateway("gateway-b", 4002);
makeGateway("gateway-c", 4003);