/** Browser-safe W07.1 checkout DTOs. Import types only from client modules. */

export type CheckoutEligibilityReason =
  | "disclosure_not_configured"
  | "profile_review_required"
  | "roster_stale"
  | "invitation_closed"
  | "table_closed"
  | "seat_exists"
  | "capacity_unavailable"
  | "payment_unresolved"
  | "attempt_recovery_required"
  | "provider_unavailable";

export type CheckoutEligibilityDTO = Readonly<{
  invitationId: string;
  expectedProposalRevision: number;
  expectedProfileRevision: number;
  eligibility: Readonly<{
    status: "ready" | "blocked";
    reasonCode: CheckoutEligibilityReason | null;
  }>;
  price: Readonly<{ amountCents: 2500; currency: "USD" }>;
  disclosure:
    | Readonly<{ status: "not_configured" }>
    | Readonly<{ status: "ready"; version: string; text: string; requiresAcknowledgement: boolean }>;
  /** Server readiness only; UI also requires a matching public Stripe key. */
  provider: Readonly<{ ready: boolean; mode: "test" | "live" | null; publishableKey: string | null }>;
  activeAttempt: CheckoutAttemptDTO | null;
}>;

export type CheckoutAttemptState =
  | "creating"
  | "open"
  | "unknown"
  | "processing"
  | "expired"
  | "released"
  | "consumed";

export type CheckoutAttemptDTO = Readonly<{
  attemptId: string;
  invitationId: string;
  state: CheckoutAttemptState;
  holdUntil: string;
  providerSessionExpiresAt: string;
}>;

export type BeginCheckoutRequest = Readonly<{
  operationId: string;
  expectedProposalRevision: number;
  expectedProfileRevision: number;
  /** Must equal the server-owned checkout disclosure version. */
  acceptedDisclosureVersion: string;
}>;

export type CheckoutBeginDTO = Readonly<{
  attempt: CheckoutAttemptDTO;
  price: Readonly<{ amountCents: 2500; currency: "USD" }>;
  /** Returned only after the attempt/session binding is durably stored and owner-checked. */
  checkoutClientSecret: string;
}>;

export type CheckoutRecoveryDTO = Readonly<{
  attempt: CheckoutAttemptDTO;
  paymentState: "not_started" | "processing" | "confirmed" | "refund_pending" | "unknown";
  seatId: string | null;
}>;

export type CheckoutErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "ineligible"
  | "table_closed"
  | "capacity_unavailable"
  | "provider_unavailable"
  | "outcome_unknown"
  | "temporarily_unavailable";

export type CheckoutResponse<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{
      ok: false;
      correlationId: string;
      error: Readonly<{
        code: CheckoutErrorCode;
        safeMessage: string;
        retryable: boolean;
        correlationId: string;
      }>;
    }>;
