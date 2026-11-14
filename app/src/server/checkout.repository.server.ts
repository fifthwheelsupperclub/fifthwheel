/** Service-role PostgREST adapter for private W07.1 checkout RPCs. */

import type { CheckoutEligibilityDTO, CheckoutRecoveryDTO } from "../checkout.contract.ts";
import type {
  CheckoutRepository, CheckoutReservation, CheckoutReturnBinding, DisclosureConfiguration, EmbeddedCheckoutSession, ReserveCheckoutInput,
  StripeEventEnvelope, VerifiedPaymentResult,
} from "./checkout.contract.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

type Config = SupabaseServerConfig & Readonly<{ fetch?: typeof fetch }>;
export type CheckoutRepositoryErrorCode = "configuration_invalid" | "request_failed" | "response_invalid" | "not_found"
  | "forbidden" | "invalid_input" | "ineligible" | "operation_conflict" | "stale_checkout" | "table_closed"
  | "capacity_unavailable" | "seat_exists" | "profile_review_required" | "attempt_recovery_required";
export class CheckoutRepositoryError extends Error {
  readonly code: CheckoutRepositoryErrorCode;
  constructor(code: CheckoutRepositoryErrorCode) { super(code); this.name = "CheckoutRepositoryError"; this.code = code; }
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instant = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
function validate(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new CheckoutRepositoryError("configuration_invalid"); }
  if (!(["http:","https:"].includes(url.protocol)) || (url.protocol === "http:" && !["localhost","127.0.0.1","[::1]"].includes(url.hostname))
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !config.secretKey || !config.publishableKey) {
    throw new CheckoutRepositoryError("configuration_invalid");
  }
  return url;
}
function parseReservation(value: unknown): CheckoutReservation {
  if (!isRecord(value) || typeof value.attemptId !== "string" || !uuid.test(value.attemptId)
    || typeof value.invitationId !== "string" || !uuid.test(value.invitationId)
    || !["creating","open","unknown","processing","expired","released","consumed"].includes(String(value.state))
    || !instant(value.holdUntil) || !instant(value.providerSessionExpiresAt) || value.expectedAmountCents !== 2500
    || value.currency !== "USD" || !["test","live"].includes(String(value.mode)) || typeof value.providerIdempotencyKey !== "string"
    || !(value.providerSessionId === null || typeof value.providerSessionId === "string")
    || !(value.lastProviderErrorCode === null || typeof value.lastProviderErrorCode === "string")
    || typeof value.dispatchClaimed !== "boolean" || typeof value.providerReplay !== "boolean") {
    throw new CheckoutRepositoryError("response_invalid");
  }
  return Object.freeze({ attemptId: value.attemptId, invitationId: value.invitationId, state: value.state as CheckoutReservation["state"],
    holdUntil: value.holdUntil, providerSessionExpiresAt: value.providerSessionExpiresAt, expectedAmountCents: 2500,
    currency: "USD", mode: value.mode as "test" | "live", providerIdempotencyKey: value.providerIdempotencyKey,
    providerSessionId: value.providerSessionId as string | null, lastProviderErrorCode: value.lastProviderErrorCode as string | null,
    dispatchClaimed: value.dispatchClaimed, providerReplay: value.providerReplay });
}
function parseEligibility(value: unknown): CheckoutEligibilityDTO {
  if (!isRecord(value) || typeof value.invitationId !== "string" || !uuid.test(value.invitationId) || !Number.isSafeInteger(value.expectedProposalRevision)
    || !Number.isSafeInteger(value.expectedProfileRevision) || !isRecord(value.eligibility)
    || !["ready","blocked"].includes(String(value.eligibility.status)) || !isRecord(value.price)
    || value.price.amountCents !== 2500 || value.price.currency !== "USD"
    || !isRecord(value.disclosure) || !["not_configured","ready"].includes(String(value.disclosure.status))) throw new CheckoutRepositoryError("response_invalid");
  let disclosure: CheckoutEligibilityDTO["disclosure"];
  if (value.disclosure.status === "not_configured") disclosure = { status: "not_configured" };
  else if (typeof value.disclosure.version === "string" && typeof value.disclosure.text === "string" && typeof value.disclosure.requiresAcknowledgement === "boolean") {
    disclosure = { status: "ready", version: value.disclosure.version, text: value.disclosure.text, requiresAcknowledgement: value.disclosure.requiresAcknowledgement };
  } else throw new CheckoutRepositoryError("response_invalid");
  const reason = value.eligibility.reasonCode;
  const reasons = [null,"disclosure_not_configured","profile_review_required","roster_stale","invitation_closed","table_closed","seat_exists","capacity_unavailable","payment_unresolved","attempt_recovery_required","provider_unavailable"];
  if (!reasons.includes(reason as null | string)) throw new CheckoutRepositoryError("response_invalid");
  let active: CheckoutEligibilityDTO["activeAttempt"] = null;
  if (value.activeAttempt !== null) {
    const item = value.activeAttempt;
    if (!isRecord(item) || typeof item.attemptId !== "string" || !uuid.test(item.attemptId)
      || typeof item.invitationId !== "string" || !uuid.test(item.invitationId)
      || !["creating","open","unknown","processing","expired","released","consumed"].includes(String(item.state))
      || !instant(item.holdUntil) || !instant(item.providerSessionExpiresAt)) throw new CheckoutRepositoryError("response_invalid");
    active = { attemptId: item.attemptId, invitationId: item.invitationId, state: item.state as NonNullable<CheckoutEligibilityDTO["activeAttempt"]>["state"],
      holdUntil: item.holdUntil, providerSessionExpiresAt: item.providerSessionExpiresAt };
  }
  return Object.freeze({ invitationId: value.invitationId, expectedProposalRevision: Number(value.expectedProposalRevision),
    expectedProfileRevision: Number(value.expectedProfileRevision),
    eligibility: { status: value.eligibility.status as "ready" | "blocked", reasonCode: reason as CheckoutEligibilityDTO["eligibility"]["reasonCode"] },
    price: { amountCents: 2500 as const, currency: "USD" as const }, disclosure,
    provider: { ready: false, mode: null, publishableKey: null }, activeAttempt: active });
}
function parseRecovery(value: unknown): CheckoutRecoveryDTO {
  if (!isRecord(value) || !(value.paymentState && ["not_started","processing","confirmed","refund_pending","unknown"].includes(String(value.paymentState)))
    || !(value.seatId === null || uuid.test(String(value.seatId)))) throw new CheckoutRepositoryError("response_invalid");
  const attempt = parseReservation(value.attempt);
  return Object.freeze({ attempt: { attemptId: attempt.attemptId, invitationId: attempt.invitationId, state: attempt.state,
    holdUntil: attempt.holdUntil, providerSessionExpiresAt: attempt.providerSessionExpiresAt },
    paymentState: value.paymentState as CheckoutRecoveryDTO["paymentState"], seatId: value.seatId as string | null });
}
function parseReturnBinding(value: unknown): CheckoutReturnBinding {
  if (!isRecord(value) || !uuid.test(String(value.attemptId)) || !uuid.test(String(value.invitationId))
    || !/^cs_(?:test_|live_)[A-Za-z0-9]+$/.test(String(value.providerSessionId))
    || !["test","live"].includes(String(value.mode)) || !instant(value.holdUntil) || !instant(value.providerSessionExpiresAt)) {
    throw new CheckoutRepositoryError("response_invalid");
  }
  return Object.freeze({ attemptId: value.attemptId as string, invitationId: value.invitationId as string,
    providerSessionId: value.providerSessionId as string, mode: value.mode as "test" | "live",
    holdUntil: value.holdUntil as string, providerSessionExpiresAt: value.providerSessionExpiresAt as string });
}
function parseVerifiedPayment(value: unknown): VerifiedPaymentResult {
  if (!isRecord(value) || !["confirmed","refund_pending","processing","unknown"].includes(String(value.paymentState))
    || !(value.seatId === null || uuid.test(String(value.seatId)))
    || !(value.paymentId === null || uuid.test(String(value.paymentId)))
    || !(value.refundObligationId === null || uuid.test(String(value.refundObligationId)))) throw new CheckoutRepositoryError("response_invalid");
  return Object.freeze({ paymentState: value.paymentState as VerifiedPaymentResult["paymentState"],
    seatId: value.seatId as string | null, paymentId: value.paymentId as string | null,
    refundObligationId: value.refundObligationId as string | null });
}

export function createCheckoutRepository(config: Config): CheckoutRepository {
  const base = validate(config); const fetcher = config.fetch ?? globalThis.fetch;
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), { method: "POST", headers: {
      apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
    }, body: JSON.stringify(args), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new CheckoutRepositoryError("request_failed"); }
    let body: unknown;
    try { body = await response.json() as unknown; } catch { if (response.ok) throw new CheckoutRepositoryError("response_invalid"); body = null; }
    if (!response.ok) {
      const message = isRecord(body) && typeof body.message === "string" ? body.message : "";
      const mapped: Record<string, CheckoutRepositoryErrorCode> = {
        not_found: "not_found", invalid_input: "invalid_input", operation_conflict: "operation_conflict", stale_checkout: "stale_checkout",
        table_closed: "table_closed", capacity_unavailable: "capacity_unavailable", seat_exists: "seat_exists",
        profile_review_required: "profile_review_required", attempt_recovery_required: "attempt_recovery_required",
        invitation_ineligible: "ineligible", member_not_admitted: "forbidden",
      };
      if (mapped[message]) throw new CheckoutRepositoryError(mapped[message]!);
      if (response.status === 401 || response.status === 403) throw new CheckoutRepositoryError("forbidden");
      throw new CheckoutRepositoryError("request_failed");
    }
    return body;
  }
  async function readAttemptRaw(actorUserId: string, attemptId: string): Promise<CheckoutReservation> {
    const value = await rpc("read_my_checkout_attempt", { p_actor: actorUserId, p_attempt_id: attemptId });
    if (!isRecord(value) || !isRecord(value.attempt)) throw new CheckoutRepositoryError("response_invalid");
    return parseReservation(value.attempt);
  }
  return Object.freeze({
    async readEligibility(actorUserId: string, invitationId: string, disclosure: DisclosureConfiguration) {
      return parseEligibility(await rpc("read_checkout_eligibility", { p_actor: actorUserId, p_invitation_id: invitationId,
        p_disclosure_version: disclosure?.version ?? null, p_disclosure_text: disclosure?.text ?? null,
        p_requires_ack: disclosure?.requiresAcknowledgement ?? false }));
    },
    async reserve(input: ReserveCheckoutInput) {
      const value = await rpc("reserve_table_checkout_attempt", { p_actor: input.actorUserId, p_invitation_id: input.invitationId,
        p_operation_id: input.request.operationId, p_expected_proposal_revision: input.request.expectedProposalRevision,
        p_expected_profile_revision: input.request.expectedProfileRevision, p_disclosure_version: input.disclosure.version,
        p_disclosure_accepted_at: input.disclosure.acceptedAt, p_provider_mode: input.mode });
      return parseReservation(value);
    },
    async bindProviderSession(actorUserId: string, attemptId: string, session: EmbeddedCheckoutSession) {
      return parseReservation(await rpc("bind_table_checkout_session", { p_actor: actorUserId, p_attempt_id: attemptId,
        p_session_id: session.id, p_mode: session.livemode ? "live" : "test", p_expires_at: new Date(session.expiresAt * 1000).toISOString() }));
    },
    async markProviderUnknown(actorUserId: string, attemptId: string) {
      await rpc("mark_table_checkout_unknown", { p_actor: actorUserId, p_attempt_id: attemptId });
    },
    async expireProviderSession(mode: "test" | "live", sessionId: string) {
      await rpc("expire_table_checkout_session", { p_provider_mode: mode, p_session_id: sessionId });
    },
    async releaseFailedProviderSession(event: StripeEventEnvelope, sessionId: string) {
      await rpc("release_failed_checkout_session", { p_event_id: event.eventId, p_provider_mode: event.mode,
        p_provider_account_id: event.accountId, p_session_id: sessionId });
    },
    async releaseAttempt(actorUserId: string, attemptId: string, safeCode: string) {
      await rpc("release_table_checkout_attempt", { p_actor: actorUserId, p_attempt_id: attemptId, p_safe_error_code: safeCode });
    },
    async readAttempt(actorUserId: string, attemptId: string) {
      return parseRecovery(await rpc("read_my_checkout_attempt", { p_actor: actorUserId, p_attempt_id: attemptId }));
    },
    async readReturnBinding(actorUserId: string, invitationId: string, attemptId: string) {
      return parseReturnBinding(await rpc("read_checkout_return_binding", { p_actor: actorUserId,
        p_invitation_id: invitationId, p_attempt_id: attemptId }));
    },
    async readReturnBindingByProviderSession(mode: "test" | "live", sessionId: string) {
      return parseReturnBinding(await rpc("read_checkout_webhook_binding", { p_provider_mode: mode, p_session_id: sessionId }));
    },
    async persistStripeEvent(event: StripeEventEnvelope) {
      const value = await rpc("persist_stripe_checkout_event", { p_event_id: event.eventId, p_event_type: event.eventType,
        p_provider_mode: event.mode, p_provider_account_id: event.accountId, p_event_created_at: event.eventCreatedAt,
        p_session_id: event.sessionId });
      if (!isRecord(value) || value.eventId !== event.eventId || typeof value.state !== "string") throw new CheckoutRepositoryError("response_invalid");
      return Object.freeze({ eventId: value.eventId as string, state: value.state });
    },
    async markStripeEventResult(event: StripeEventEnvelope, state: "processed" | "ignored" | "retryable", safeCode: string | null) {
      await rpc("mark_stripe_checkout_event_result", { p_event_id: event.eventId, p_provider_mode: event.mode,
        p_provider_account_id: event.accountId, p_state: state, p_safe_code: safeCode });
    },
    async fulfillPaidSession(input: Parameters<CheckoutRepository["fulfillPaidSession"]>[0]) {
      return parseVerifiedPayment(await rpc("fulfill_paid_checkout_session", { p_event_id: input.event?.eventId ?? null,
        p_provider_mode: input.session.livemode ? "live" : "test", p_provider_account_id: input.event?.accountId ?? "",
        p_attempt_id: input.attemptId,
        p_session_id: input.session.id, p_payment_intent_id: input.session.paymentIntentId,
        p_session_status: input.session.status, p_payment_status: input.session.paymentStatus,
        p_amount_total: input.session.amountTotal, p_currency: input.session.currency,
        p_verified_at: input.verifiedAt }));
    },
  });
}
