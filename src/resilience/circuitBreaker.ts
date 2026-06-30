// PURE: a per-gateway circuit breaker. No I/O, no Date.now() — time and config
// arrive as parameters, exactly like rankGateways takes health as a parameter.

export interface BreakerConfig {
  readonly failureThreshold: number; // consecutive faults in `closed` that trip it
  readonly cooldownMs: number;       // how long `open` waits before a trial
}

export const defaultBreakerConfig: BreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 10_000,
};

// Three states as a discriminated union — each carries only what it needs.
export type BreakerState =
  | { readonly status: "closed"; readonly failures: number }
  | { readonly status: "open"; readonly openedAt: number }
  | { readonly status: "half-open" };

export const initialBreaker: BreakerState = { status: "closed", failures: 0 };

// Should a request go through? An open breaker past its cooldown flips to
// half-open here (time-driven transition) and permits one trial.
export function beforeAttempt(
  state: BreakerState,
  now: number,
  config: BreakerConfig,
): { readonly allow: boolean; readonly state: BreakerState } {
  switch (state.status) {
    case "closed":
      return { allow: true, state };
    case "half-open":
      return { allow: true, state }; // permit the single trial
    case "open": {
      const cooled = now - state.openedAt >= config.cooldownMs;
      return cooled
        ? { allow: true, state: { status: "half-open" } }
        : { allow: false, state };
    }
  }
}

// Fold an attempt's outcome back in (outcome-driven transition).
export function afterResult(
  state: BreakerState,
  healthy: boolean,
  now: number,
  config: BreakerConfig,
): BreakerState {
  if (healthy) {
    return { status: "closed", failures: 0 }; // any healthy call closes it
  }
  switch (state.status) {
    case "closed": {
      const failures = state.failures + 1;
      return failures >= config.failureThreshold
        ? { status: "open", openedAt: now }
        : { status: "closed", failures };
    }
    case "half-open":
      return { status: "open", openedAt: now }; // trial failed → reopen
    case "open":
      return { status: "open", openedAt: now }; // defensive
  }
}