// What the API accepts after validation — a clean, typed charge request.
export interface ChargeRequest {
  readonly idempotencyKey: string;
  readonly amount: number;        // in minor units (paise/cents)
  readonly currency: string;      // e.g. "INR"
  readonly customerId: string;
}

// The lifecycle of a single payment, as a discriminated union.
// Every state carries exactly the data that state implies — nothing more.
export type PaymentState =
  | { readonly status: "pending"; readonly request: ChargeRequest }
  | {
      readonly status: "succeeded";
      readonly request: ChargeRequest;
      readonly gatewayId: string;
      readonly gatewayRef: string;   // the gateway's transaction id
    }
  | {
      readonly status: "failed";
      readonly request: ChargeRequest;
      readonly reason: string;
    };