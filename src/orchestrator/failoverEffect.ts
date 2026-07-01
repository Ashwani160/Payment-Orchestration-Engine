import { Effect } from "effect";
import type { GatewayId } from "../domain/gateway.js";
import type { ChargeRequest } from "../domain/payment.js";
import { chargeEffect } from "../gateways/gatewayEffect.js";
import {
  BreakerOpen,
  GatewayDeclined,
  GatewayFault,
  GatewayTimeout,
  NoHealthyGateway,
} from "../domain/errors.js";
import { beforeAttempt, afterResult, defaultBreakerConfig } from "../resilience/circuitBreaker.js";
import { getBreaker, setBreaker } from "../resilience/breakerStore.js";
import { recordAttempt } from "../health/healthStore.js";

type Success = { gatewayId: GatewayId; gatewayRef: string };

// One candidate as an Effect: breaker gate → timed charge → record health + fold
// the breaker. The breaker read must happen at RUN time (not construction time),
// which is why the whole body is wrapped in Effect.suspend — in the failover
// chain, a later candidate is only built lazily and must see current breaker state.
//
// The error channel carries ALL four failure modes: BreakerOpen from the gate,
// and the three from chargeEffect. The failover chain below decides, per tag,
// which ones advance to the next candidate and which are terminal.
function attemptOne(
  gatewayId: GatewayId,
  request: ChargeRequest,
): Effect.Effect<Success, BreakerOpen | GatewayDeclined | GatewayTimeout | GatewayFault> {
  return Effect.suspend((): Effect.Effect<
    Success,
    BreakerOpen | GatewayDeclined | GatewayTimeout | GatewayFault
  > => {
    // Breaker gate (time-driven transition happens here).
    const decision = beforeAttempt(getBreaker(gatewayId), Date.now(), defaultBreakerConfig);
    setBreaker(gatewayId, decision.state);
    if (!decision.allow) {
      // No call is made → no health attempt is recorded for a breaker-skip.
      return Effect.fail(new BreakerOpen({ gatewayId }));
    }

    const startedAt = Date.now();
    return chargeEffect(gatewayId, request).pipe(
      // SUCCESS: record healthy, close the breaker, pass the value through.
      // Sequenced via Effect.promise so the health INCR is actually awaited as
      // part of this effect (not detached), matching the imperative version.
      Effect.tap(() =>
        Effect.promise(async () => {
          const latencyMs = Date.now() - startedAt;
          setBreaker(gatewayId, afterResult(decision.state, true, Date.now(), defaultBreakerConfig));
          await recordAttempt(gatewayId, true, latencyMs);
        }),
      ),
      // FAILURE: a decline is HEALTHY (gateway worked), a timeout/fault is NOT.
      // tapError folds the breaker + health without consuming the error, so the
      // typed error still propagates to the failover chain below.
      Effect.tapError((err) =>
        Effect.promise(async () => {
          const latencyMs = Date.now() - startedAt;
          const healthy = err._tag === "GatewayDeclined";
          setBreaker(gatewayId, afterResult(decision.state, healthy, Date.now(), defaultBreakerConfig));
          await recordAttempt(gatewayId, healthy, latencyMs);
        }),
      ),
    );
  });
}

// Fold the ranked candidates into ONE effect: try first, fall through to the next
// ONLY on a retryable failure. A GatewayDeclined is terminal and must abort the
// whole chain immediately — so it is deliberately NOT handled here, which lets it
// escape the chain untouched. That omission is the terminal-vs-retryable rule
// encoded in the type system, not in a comment: the compiler shows GatewayDeclined
// surviving in the error channel while the three retryable tags are consumed.
export function failoverEffect(
  ranked: readonly GatewayId[],
  request: ChargeRequest,
): Effect.Effect<Success, GatewayDeclined | NoHealthyGateway> {
  if (ranked.length === 0) {
    return Effect.fail(new NoHealthyGateway({ lastReason: "no candidates" }));
  }

  // link0 orElse-on-retryable link1 orElse-on-retryable link2…
  // catchTags fires the fallback (`next`) ONLY for the three retryable tags.
  // GatewayDeclined has no handler → it short-circuits out of the chain.
  const chain = ranked
    .map((id) => attemptOne(id, request))
    .reduce((acc, next) =>
      acc.pipe(
        Effect.catchTags({
          BreakerOpen: () => next,
          GatewayTimeout: () => next,
          GatewayFault: () => next,
          // GatewayDeclined intentionally absent → terminal, aborts failover.
        }),
      ),
    );

  // Every candidate exhausted → collapse the remaining retryable tags into
  // NoHealthyGateway. GatewayDeclined passes through untouched (terminal), and the
  // caller maps it to a failed charge.
  return chain.pipe(
    Effect.catchTags({
      BreakerOpen: (e) => Effect.fail(new NoHealthyGateway({ lastReason: e._tag })),
      GatewayTimeout: (e) => Effect.fail(new NoHealthyGateway({ lastReason: e._tag })),
      GatewayFault: (e) => Effect.fail(new NoHealthyGateway({ lastReason: e._tag })),
    }),
  );
}