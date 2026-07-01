import { Schedule, Duration } from "effect";

// A pure VALUE describing timing — it runs nothing on its own. Exponential
// backoff (50ms base, ×2 each step), JITTERED to avoid a thundering herd when
// many requests back off in lockstep, bounded to 3 retries.
//
// IMPORTANT (stored for README): this schedule is for operations that are SAFE
// TO REPEAT. It is deliberately NOT applied to same-gateway charge retries —
// see effect-retry demo notes. It exists for failover-hop spacing and any
// idempotent operation we may add later.
export const backoffSchedule = Schedule.exponential(Duration.millis(50), 2.0).pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)), // recur only while BOTH continue → caps at 3
);