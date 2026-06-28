import { createServer } from "./api/server.js";
import { config } from "./config.js";

const app = createServer();
app.listen(config.port, () => {
  console.log(`payment-orchestrator listening on :${config.port}`);
});