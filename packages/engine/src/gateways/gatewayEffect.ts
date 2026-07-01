import { Effect, Duration } from "effect";
import type { GatewayId } from "../domain/gateway.js";
import type { ChargeRequest } from "../domain/payment.js";
import { callGateway } from "./gatewayClient.js";
import {
  GatewayDeclined,
  GatewayFault,
  GatewayTimeout,
} from "../domain/errors.js";

const CHARGE_TIMEOUT = Duration.seconds(3);

// The charge outcome as an Effect: the success shape in the value channel,
// the three gateway failure modes in the typed error channel. Named once so the
// flatMap callback and chargeEffect's signature can't drift apart.
type ChargeOutcome = Effect.Effect<
  { gatewayId: GatewayId; gatewayRef: string },
  GatewayDeclined | GatewayFault | GatewayTimeout
>;

// The charge as an Effect: success in the VALUE channel, every failure mode as a
// tagged error in the ERROR channel. We reuse the existing callGateway (which
// already returns outcomes as data and never throws), then translate its result
// into Effect's two channels. This is the bridge from the data-union world into
// the typed-error world — the boundary is explicit and one-directional.
export function chargeEffect(
  gatewayId: GatewayId,
  request: ChargeRequest,
): ChargeOutcome {
  const call = Effect.promise(() => callGateway(gatewayId, request)).pipe(
    Effect.flatMap((response): ChargeOutcome => {
      switch (response.outcome) {
        case "success":
          return Effect.succeed({ gatewayId, gatewayRef: response.gatewayRef });
        case "declined":
          return Effect.fail(new GatewayDeclined({ gatewayId, code: response.code }));
        case "timeout":
          return Effect.fail(new GatewayTimeout({ gatewayId }));
        case "error":
          return Effect.fail(new GatewayFault({ gatewayId, message: response.message }));
      }
    }),
  );

  return call.pipe(
    Effect.timeoutFail({
      duration: CHARGE_TIMEOUT,
      onTimeout: () => new GatewayTimeout({ gatewayId }),
    }),
  );
}