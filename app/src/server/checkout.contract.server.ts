/** W07.1 server-only checkout dependency and provider types. */

import type {
  BeginCheckoutRequest, CheckoutAttemptDTO, CheckoutBeginDTO, CheckoutEligibilityDTO,
  CheckoutRecoveryDTO,
} from "../checkout.contract.ts";

export type CheckoutActor = Readonly<{ userId: string; accessToken: string }>;
export type CheckoutInput = Readonly<{ accessToken?: string | null; invitationId: string }>;
export type BeginCheckoutInput = CheckoutInput & Readonly<{ request: BeginCheckoutRequest }>;
export type CheckoutAttemptInput = Readonly<{ accessToken?: string | null; attemptId: string }>;

export type CheckoutFailure = Readonly<{
  code: import("../checkout.contract.ts").CheckoutErrorCode;
  safeMessage: string;
  retryable: boolean;
}>;
export type CheckoutResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: CheckoutFailure }>;

export type DisclosureConfiguration = Readonly<{
  version: string;
  text: string;
  requiresAcknowledgement: boolean;
}> | null;

export type CheckoutReservation = Readonly<{
  attemptId: string;
  invitationId: string;
  state: "creating" | "open" | "unknown" | "processing" | "expired" | "released" | "consumed";
  holdUntil: string;
  providerSessionExpiresAt: string;
  expectedAmountCents: 2500;
  currency: "USD";
  mode: "test" | "live";
  providerIdempotencyKey: string;
  providerSessionId: string | null;
  lastProviderErrorCode: string | null;
  dispatchClaimed: boolean;
  providerReplay: boolean;
}>;

export type CheckoutReturnBinding = Readonly<{
  attemptId: string;
  invitationId: string;
  providerSessionId: string;
  mode: "test" | "live";
  holdUntil: string;
  providerSessionExpiresAt: string;
}>;

export type VerifiedPaymentResult = Readonly<{
  paymentState: "confirmed" | "refund_pending" | "processing" | "unknown";
  seatId: string | null;
  paymentId: string | null;
  refundObligationId: string | null;
}>;

export type StripeEventEnvelope = Readonly<{
  eventId: string;
  eventType: string;
  mode: "test" | "live";
  accountId: string;
  eventCreatedAt: string;
  sessionId: string;
}>;

export type ReserveCheckoutInput = Readonly<{
  actorUserId: string;
  invitationId: string;
  request: BeginCheckoutRequest;
  disclosure: Readonly<{ version: string; acceptedAt: string | null }>;
  mode: "test" | "live";
}>;

export interface CheckoutRepository {
  readEligibility(actorUserId: string, invitationId: string, disclosure: DisclosureConfiguration): Promise<CheckoutEligibilityDTO>;
  reserve(actor: ReserveCheckoutInput): Promise<CheckoutReservation>;
  bindProviderSession(actorUserId: string, attemptId: string, session: EmbeddedCheckoutSession): Promise<CheckoutReservation>;
  markProviderUnknown(actorUserId: string, attemptId: string): Promise<void>;
  expireProviderSession(mode: "test" | "live", sessionId: string): Promise<void>;
  releaseFailedProviderSession(event: StripeEventEnvelope, sessionId: string): Promise<void>;
  releaseAttempt(actorUserId: string, attemptId: string, safeCode: string): Promise<void>;
  readAttempt(actorUserId: string, attemptId: string): Promise<CheckoutRecoveryDTO>;
  readReturnBinding(actorUserId: string, invitationId: string, attemptId: string): Promise<CheckoutReturnBinding>;
  readReturnBindingByProviderSession(mode: "test" | "live", sessionId: string): Promise<CheckoutReturnBinding>;
  persistStripeEvent(event: StripeEventEnvelope): Promise<Readonly<{ eventId: string; state: string }>>;
  markStripeEventResult(event: StripeEventEnvelope, state: "processed" | "ignored" | "retryable", safeCode: string | null): Promise<void>;
  fulfillPaidSession(input: Readonly<{
    event: StripeEventEnvelope | null;
    attemptId: string;
    session: EmbeddedCheckoutSession;
    verifiedAt: string;
  }>): Promise<VerifiedPaymentResult>;
}

export type EmbeddedCheckoutSession = Readonly<{
  id: string;
  clientSecret: string | null;
  livemode: boolean;
  status: "open" | "complete" | "expired";
  paymentStatus: "unpaid" | "paid" | "no_payment_required";
  amountTotal: number;
  currency: string;
  expiresAt: number;
  paymentIntentId: string | null;
}>;

export interface EmbeddedCheckoutProvider {
  createSession(input: Readonly<{
    idempotencyKey: string;
    expiresAt: number;
    attemptId: string;
    invitationId: string;
    appOrigin: string;
    providerReplay: boolean;
  }>): Promise<EmbeddedCheckoutSession>;
  retrieveSession(sessionId: string): Promise<EmbeddedCheckoutSession>;
}

export type CheckoutServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: CheckoutRepository;
  provider: EmbeddedCheckoutProvider;
  disclosure: DisclosureConfiguration;
  mode: "test" | "live";
  providerConfigured?: boolean;
  fulfillmentReady?: boolean;
  publishableKey?: string | null;
  now?: () => number;
  appOrigin: string;
}>;

export interface CheckoutService {
  readEligibility(input: CheckoutInput): Promise<CheckoutResult<CheckoutEligibilityDTO>>;
  beginCheckout(input: BeginCheckoutInput): Promise<CheckoutResult<CheckoutBeginDTO>>;
  readAttempt(input: CheckoutAttemptInput): Promise<CheckoutResult<CheckoutRecoveryDTO>>;
  finalizeReturn(input: Readonly<CheckoutInput & { attemptId: string; sessionId: string }>): Promise<CheckoutResult<CheckoutRecoveryDTO>>;
}

export function checkoutAttemptDTO(value: CheckoutReservation): CheckoutAttemptDTO {
  return {
    attemptId: value.attemptId,
    invitationId: value.invitationId,
    state: value.state,
    holdUntil: value.holdUntil,
    providerSessionExpiresAt: value.providerSessionExpiresAt,
  };
}
