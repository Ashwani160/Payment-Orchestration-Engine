import { Effect } from "effect";
import { backoffSchedule } from "../src/resilience/backoff.js";

let attempts = 0;

// A SAFE-TO-REPEAT (idempotent) flaky effect: fails twice, then succeeds.
// Effect.suspend re-evaluates the whole thunk on each retry, so the counter moves.
const flaky = Effect.suspend(() => {
  attempts += 1;
  console.log(`  attempt ${attempts}`);
  return attempts < 3 ? Effect.fail(new Error("transient")) : Effect.succeed("ok");
});

const program = flaky.pipe(Effect.retry(backoffSchedule));

Effect.runPromise(program)
  .then((r) => {
    console.log(`result: "${r}" after ${attempts} attempts (jittered backoff between each)`);
    console.log(attempts === 3 ? "\n✅ EFFECT RETRY WORKS" : "\n❌ unexpected attempt count");
    process.exit(attempts === 3 ? 0 : 1);
  })
  .catch((e) => {
    console.error("failed:", e);
    process.exit(1);
  });