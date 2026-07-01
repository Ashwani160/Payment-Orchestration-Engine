import { Data } from "effect";

// Each gateway failure mode as a distinct tagged error. The orchestrator will
// branch on the _tag instead of pattern-matching a data union — same idea,
// but now it flows through Effect's typed error channel.

// Retryable-via-FAILOVER (try another gateway) — but NEVER retry the same one;
// see the double-charge note below.
export class GatewayTimeout extends Data.TaggedError("GatewayTimeout")<{
  readonly gatewayId: string;
}> {}

export class GatewayFault extends Data.TaggedError("GatewayFault")<{
  readonly gatewayId: string;
  readonly message: string;
}> {}

// Terminal — another gateway won't approve a declined card. Do not failover.
export class GatewayDeclined extends Data.TaggedError("GatewayDeclined")<{
  readonly gatewayId: string;
  readonly code: string;
}> {}

// The breaker says skip this gateway entirely.
export class BreakerOpen extends Data.TaggedError("BreakerOpen")<{
  readonly gatewayId: string;
}> {}

// Every candidate exhausted.
export class NoHealthyGateway extends Data.TaggedError("NoHealthyGateway")<{
  readonly lastReason: string;
}> {}