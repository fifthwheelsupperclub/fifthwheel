/** W07.1 checkout use cases; actor and price are always server-derived. */

import { authorize } from "./authorization.server.ts";
import type {
  CheckoutAttemptInput, CheckoutFailure, CheckoutInput, CheckoutResult, CheckoutService,
  CheckoutServiceDependencies, BeginCheckoutInput,
} from "./checkout.contract.server.ts";
import { checkoutAttemptDTO } from "./checkout.contract.server.ts";
import type { CheckoutBeginDTO, CheckoutEligibilityDTO, CheckoutRecoveryDTO } from "../checkout.contract.ts";
import { StripeCheckoutError } from "./stripe.checkout.server.ts";
import { CheckoutRepositoryError } from "./checkout.repository.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = <T>(code: CheckoutFailure["code"], safeMessage: string, retryable = false): CheckoutResult<T> =>
  ({ ok: false, error: { code, safeMessage, retryable } });
function repositoryFailure<T>(error: unknown): CheckoutResult<T> {
  if (!(error instanceof CheckoutRepositoryError)) return fail("temporarily_unavailable", "Checkout is temporarily unavailable.", true);
  switch (error.code) {
    case "not_found": return fail("not_found", "This Table invitation could not be found.");
    case "forbidden": return fail("forbidden", "Member access is not active for this account.");
    case "invalid_input": return fail("invalid_input", "Check the checkout details and try again.");
    case "table_closed": return fail("table_closed", "Checkout is closed for this Table.");
    case "capacity_unavailable": return fail("capacity_unavailable", "No Seat checkout capacity is available right now.");
    case "operation_conflict": return fail("conflict", "This checkout operation was already used for different details.");
    case "stale_checkout":
    case "ineligible":
    case "profile_review_required":
    case "seat_exists":
    case "attempt_recovery_required": return fail("ineligible", "This invitation needs review before checkout can continue.");
    case "configuration_invalid":
    case "request_failed":
    case "response_invalid": return fail("temporarily_unavailable", "Checkout is temporarily unavailable.", true);
  }
}

export function createCheckoutService(deps: CheckoutServiceDependencies): CheckoutService {
  async function member(token: string | null | undefined): Promise<
    | Readonly<{ ok: true; principal: import("./authorization.server.ts").ServerVerifiedPrincipal }>
    | Readonly<{ ok: false; code: "unauthenticated" | "forbidden" | "temporarily_unavailable" }>
  > {
    if (typeof token !== "string" || token.trim() === "") return { ok: false, code: "unauthenticated" };
    let principal: import("./authorization.server.ts").ServerVerifiedPrincipal | null;
    try { principal = await deps.resolvePrincipal(token); }
    catch { return { ok: false, code: "temporarily_unavailable" }; }
    if (!principal) return { ok: false, code: "unauthenticated" };
    if (!authorize(principal, { workspace: "member", action: "member:read-own" }).allowed) return { ok: false, code: "forbidden" };
    return { ok: true, principal };
  }
  function memberFailure<T>(result: Exclude<Awaited<ReturnType<typeof member>>, { ok: true }>): CheckoutResult<T> {
    if (result.code === "unauthenticated") return fail("unauthenticated", "Sign in to continue.");
    if (result.code === "forbidden") return fail("forbidden", "Member access is not active for this account.");
    return fail("temporarily_unavailable", "Checkout is temporarily unavailable.", true);
  }
  function validDisclosureVersion(version: string | undefined): boolean {
    if (!deps.disclosure || !deps.disclosure.version || !deps.disclosure.text.trim()) return false;
    return version === deps.disclosure.version;
  }

  return Object.freeze({
    async readEligibility(input: CheckoutInput): Promise<CheckoutResult<CheckoutEligibilityDTO>> {
      if (!uuid.test(input.invitationId)) return fail("invalid_input", "Check the invitation and try again.");
      const resolution = await member(input.accessToken);
      if (!resolution.ok) return memberFailure(resolution);
      const principal = resolution.principal;
      try {
        const eligibility = await deps.repository.readEligibility(principal.userId, input.invitationId, deps.disclosure);
        const fulfillmentReady = deps.providerConfigured !== false && deps.fulfillmentReady !== false;
        const value = Object.freeze({ ...eligibility,
          provider: Object.freeze({ ready: fulfillmentReady, mode: fulfillmentReady ? deps.mode : null,
            publishableKey: fulfillmentReady ? deps.publishableKey ?? null : null }),
          eligibility: !fulfillmentReady && eligibility.eligibility.status === "ready"
            ? { status: "blocked" as const, reasonCode: "provider_unavailable" as const }
            : eligibility.eligibility,
        });
        return { ok: true, value };
      }
      catch (error) { return repositoryFailure(error); }
    },

    async beginCheckout(input: BeginCheckoutInput): Promise<CheckoutResult<CheckoutBeginDTO>> {
      if (!uuid.test(input.invitationId) || !uuid.test(input.request.operationId)
        || !Number.isSafeInteger(input.request.expectedProposalRevision) || input.request.expectedProposalRevision < 1
        || !Number.isSafeInteger(input.request.expectedProfileRevision) || input.request.expectedProfileRevision < 1
        || typeof input.request.acceptedDisclosureVersion !== "string" || input.request.acceptedDisclosureVersion.length > 100) {
        return fail("invalid_input", "Check the checkout details and try again.");
      }
      const resolution = await member(input.accessToken);
      if (!resolution.ok) return memberFailure(resolution);
      const principal = resolution.principal;
      if (!validDisclosureVersion(input.request.acceptedDisclosureVersion)) {
        return fail("ineligible", "Checkout is unavailable until the approved payment disclosure is configured.");
      }
      const origin = safeOrigin(deps.appOrigin);
      if (!origin) return fail("temporarily_unavailable", "Checkout is temporarily unavailable.", true);
      if (deps.providerConfigured === false || deps.fulfillmentReady === false) return fail("provider_unavailable", "Checkout is temporarily unavailable.", true);
      const acceptedAt = new Date((deps.now ?? Date.now)()).toISOString();
      let reservedAttemptId: string | null = null;
      try {
        const reservation = await deps.repository.reserve({
          actorUserId: principal.userId,
          invitationId: input.invitationId,
          request: input.request,
          disclosure: { version: deps.disclosure!.version, acceptedAt },
          mode: deps.mode,
        });
        reservedAttemptId = reservation.attemptId;
        if (reservation.providerSessionId) {
          if (Date.parse(reservation.holdUntil) <= (deps.now ?? Date.now)()) {
            try { await deps.repository.markProviderUnknown(principal.userId, reservation.attemptId); } catch { /* capacity remains released and recovery remains visible */ }
            return fail("outcome_unknown", "The checkout window ended. Confirm payment status before trying again.", true);
          }
          const session = await deps.provider.retrieveSession(reservation.providerSessionId);
          if (Date.parse(reservation.holdUntil) <= (deps.now ?? Date.now)()) {
            try { await deps.repository.markProviderUnknown(principal.userId, reservation.attemptId); } catch { /* capacity remains released */ }
            return fail("outcome_unknown", "The checkout window ended. Confirm payment status before trying again.", true);
          }
          if (session.id === reservation.providerSessionId && session.clientSecret !== null && session.amountTotal === 2500 && session.currency === "usd"
            && session.livemode === (reservation.mode === "live") && session.expiresAt === Math.ceil(Date.parse(reservation.providerSessionExpiresAt) / 1000)
            && session.status === "open" && session.paymentStatus === "unpaid") {
            const bound = await deps.repository.bindProviderSession(principal.userId, reservation.attemptId, session);
            return { ok: true, value: { attempt: checkoutAttemptDTO(bound), price: { amountCents: 2500 as const, currency: "USD" as const }, checkoutClientSecret: session.clientSecret } };
          }
          return fail("outcome_unknown", "Checkout status is being confirmed. Refresh the status before trying again.", true);
        }
        if (reservation.state === "released" || reservation.state === "expired" || reservation.state === "consumed") {
          return fail("conflict", "This checkout attempt has ended. Reload the invitation before trying again.");
        }
        if (!reservation.dispatchClaimed) {
          return fail("outcome_unknown", "Checkout is being confirmed. Refresh the status before trying again.", true);
        }
        const session = await deps.provider.createSession({
          idempotencyKey: reservation.providerIdempotencyKey,
          expiresAt: Math.ceil(Date.parse(reservation.providerSessionExpiresAt) / 1000),
          attemptId: reservation.attemptId,
          invitationId: reservation.invitationId,
          appOrigin: origin,
          providerReplay: reservation.providerReplay,
        });
        if (session.amountTotal !== 2500 || session.currency !== "usd" || session.livemode !== (reservation.mode === "live")) {
          await deps.repository.markProviderUnknown(principal.userId, reservation.attemptId);
          return fail("outcome_unknown", "Checkout is being confirmed. Refresh the status before trying again.", true);
        }
        const bound = await deps.repository.bindProviderSession(principal.userId, reservation.attemptId, session);
        if (bound.providerSessionId !== session.id || bound.state !== "open" || session.clientSecret === null || session.status !== "open" || session.paymentStatus !== "unpaid") {
          return fail("outcome_unknown", "Checkout is being confirmed. Refresh the status before trying again.", true);
        }
        if (Date.parse(bound.holdUntil) <= (deps.now ?? Date.now)()) {
          try { await deps.repository.markProviderUnknown(principal.userId, bound.attemptId); } catch { /* capacity remains released */ }
          return fail("outcome_unknown", "The checkout window ended. Confirm payment status before trying again.", true);
        }
        return { ok: true, value: { attempt: checkoutAttemptDTO(bound), price: { amountCents: 2500 as const, currency: "USD" as const }, checkoutClientSecret: session.clientSecret } };
      } catch (error) {
        if (reservedAttemptId === null) return repositoryFailure(error);
        // Provider/repository failures may occur after Stripe accepted the request.
        // Mark unknown only best-effort; never create a new provider key here.
        if (reservedAttemptId && error instanceof StripeCheckoutError
          && (error.code === "session_expiry_too_soon" || error.code === "provider_rejected")) {
          try { await deps.repository.releaseAttempt(principal.userId, reservedAttemptId, error.code); } catch { /* safe state remains recoverable */ }
          return fail("provider_unavailable", "Checkout could not be started. You can try again.", true);
        }
        if (reservedAttemptId) {
          try { await deps.repository.markProviderUnknown(principal.userId, reservedAttemptId); } catch { /* replay remains bound to the same operation key */ }
        }
        return fail("outcome_unknown", "Checkout is being confirmed. Refresh the status before trying again.", true);
      }
    },

    async readAttempt(input: CheckoutAttemptInput): Promise<CheckoutResult<CheckoutRecoveryDTO>> {
      if (!uuid.test(input.attemptId)) return fail("invalid_input", "Check the checkout status link and try again.");
      const resolution = await member(input.accessToken);
      if (!resolution.ok) return memberFailure(resolution);
      const principal = resolution.principal;
      try { return { ok: true, value: await deps.repository.readAttempt(principal.userId, input.attemptId) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async finalizeReturn(input: Parameters<CheckoutService["finalizeReturn"]>[0]): Promise<CheckoutResult<CheckoutRecoveryDTO>> {
      if (!uuid.test(input.invitationId) || !uuid.test(input.attemptId)
        || typeof input.sessionId !== "string" || !/^cs_(?:test_|live_)[A-Za-z0-9]+$/.test(input.sessionId)) {
        return fail("invalid_input", "Check the checkout return details and try again.");
      }
      const resolution = await member(input.accessToken);
      if (!resolution.ok) return memberFailure(resolution);
      const actorUserId = resolution.principal.userId;
      let binding;
      try { binding = await deps.repository.readReturnBinding(actorUserId, input.invitationId, input.attemptId); }
      catch (error) { return repositoryFailure(error); }
      if (binding.providerSessionId !== input.sessionId || binding.mode !== deps.mode) {
        return fail("not_found", "This checkout could not be found.");
      }
      try {
        const session = await deps.provider.retrieveSession(binding.providerSessionId);
        if (session.id !== binding.providerSessionId || session.livemode !== (binding.mode === "live")
          || session.expiresAt !== Math.ceil(Date.parse(binding.providerSessionExpiresAt) / 1000)) {
          return fail("outcome_unknown", "Payment status is being confirmed. Refresh the status shortly.", true);
        }
        if (session.status === "complete" && session.paymentStatus === "paid") {
          await deps.repository.fulfillPaidSession({ event: null, attemptId: binding.attemptId, session,
            verifiedAt: new Date((deps.now ?? Date.now)()).toISOString() });
        } else if (session.status === "expired" && session.paymentStatus === "unpaid") {
          await deps.repository.expireProviderSession(binding.mode, binding.providerSessionId);
        }
        return { ok: true, value: await deps.repository.readAttempt(actorUserId, binding.attemptId) };
      } catch (error) {
        if (error instanceof StripeCheckoutError) return fail("outcome_unknown", "Payment status is being confirmed. Refresh the status shortly.", true);
        return repositoryFailure(error);
      }
    },
  });
}

function safeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!(["http:", "https:"].includes(url.protocol) && url.username === "" && url.password === "" && url.pathname === "/" && !url.search && !url.hash)) return null;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
