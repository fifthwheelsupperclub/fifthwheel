/** Same-origin HTTP boundary for member checkout begin, eligibility and recovery. */

import { randomUUID } from "node:crypto";
import type { CheckoutErrorCode, CheckoutResponse, BeginCheckoutRequest, CheckoutEligibilityDTO, CheckoutRecoveryDTO } from "../checkout.contract.ts";
import type { CheckoutService, CheckoutResult } from "./checkout.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", vary: "Cookie, Origin" };
type Factory = () => CheckoutService;
function status(code: CheckoutErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not_found": return 404;
    case "invalid_input": return 400;
    case "conflict":
    case "ineligible":
    case "table_closed":
    case "capacity_unavailable": return 409;
    case "outcome_unknown": return 503;
    case "provider_unavailable":
    case "temporarily_unavailable": return 503;
  }
}
function output(body: unknown, code = 200): Response { return Response.json(body, { status: code, headers }); }
function failure(code: CheckoutErrorCode, safeMessage: string, retryable: boolean, correlationId: string): Response {
  const body: CheckoutResponse<never> = { ok: false, correlationId, error: { code, safeMessage, retryable, correlationId } };
  return output(body, status(code));
}
function serviceResult<T>(result: CheckoutResult<T>, correlationId: string): Response {
  if (!result.ok) return failure(result.error.code, result.error.safeMessage, result.error.retryable, correlationId);
  const body: CheckoutResponse<T> = { ok: true, data: result.value, correlationId };
  return output(body);
}
async function parseJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return { ok: false, status: 400 };
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > 4_096)) {
    return { ok: false, status: Number(contentLength) > 4_096 ? 413 : 400 };
  }
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 4_096) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch { return { ok: false, status: 400 }; }
}
function parseBegin(value: unknown): BeginCheckoutRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => !["operationId","expectedProposalRevision","expectedProfileRevision","acceptedDisclosureVersion"].includes(key))
    || typeof body.operationId !== "string" || !uuid.test(body.operationId)
    || !Number.isSafeInteger(body.expectedProposalRevision) || Number(body.expectedProposalRevision) < 1
    || !Number.isSafeInteger(body.expectedProfileRevision) || Number(body.expectedProfileRevision) < 1
    || (body.acceptedDisclosureVersion !== undefined && (typeof body.acceptedDisclosureVersion !== "string" || body.acceptedDisclosureVersion.length > 100))) return null;
  if (typeof body.acceptedDisclosureVersion !== "string" || body.acceptedDisclosureVersion.length > 100) return null;
  return Object.freeze({ operationId: body.operationId, expectedProposalRevision: Number(body.expectedProposalRevision),
    expectedProfileRevision: Number(body.expectedProfileRevision),
    acceptedDisclosureVersion: body.acceptedDisclosureVersion });
}
function projectEligibility(value: CheckoutEligibilityDTO) {
  return {
    invitationId: value.invitationId,
    expectedProposalRevision: value.expectedProposalRevision,
    expectedProfileRevision: value.expectedProfileRevision,
    eligibility: { status: value.eligibility.status, reasonCode: value.eligibility.reasonCode },
    price: { amountCents: 2500 as const, currency: "USD" as const },
    disclosure: value.disclosure.status === "ready"
      ? { status: "ready" as const, version: value.disclosure.version, text: value.disclosure.text, requiresAcknowledgement: value.disclosure.requiresAcknowledgement }
      : { status: "not_configured" as const },
    provider: { ready: value.provider.ready, mode: value.provider.mode, publishableKey: value.provider.publishableKey },
    activeAttempt: value.activeAttempt ? { attemptId: value.activeAttempt.attemptId, invitationId: value.activeAttempt.invitationId,
      state: value.activeAttempt.state, holdUntil: value.activeAttempt.holdUntil, providerSessionExpiresAt: value.activeAttempt.providerSessionExpiresAt } : null,
  };
}
function projectRecovery(value: CheckoutRecoveryDTO) {
  return { attempt: { attemptId: value.attempt.attemptId, invitationId: value.attempt.invitationId, state: value.attempt.state,
    holdUntil: value.attempt.holdUntil, providerSessionExpiresAt: value.attempt.providerSessionExpiresAt },
    paymentState: value.paymentState, seatId: value.seatId };
}
export function createCheckoutHttpHandlers(getService: Factory, appOrigin: string) {
  return Object.freeze({
    async readEligibility(request: Request, invitationId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuid.test(invitationId)) return failure("invalid_input", "Check the invitation and try again.", false, correlationId);
      try {
        const result = await getService().readEligibility({ accessToken: getAccessTokenForPrincipal(request), invitationId });
        return result.ok ? serviceResult({ ok: true, value: projectEligibility(result.value) }, correlationId) : serviceResult(result, correlationId);
      }
      catch { return failure("temporarily_unavailable", "Checkout is temporarily unavailable.", true, correlationId); }
    },
    async beginCheckout(request: Request, invitationId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuid.test(invitationId)) return failure("invalid_input", "Check the invitation and try again.", false, correlationId);
      const origin = assertExactOrigin(request, appOrigin);
      if (!origin.allowed) return failure("forbidden", "This checkout request could not be verified.", false, correlationId);
      const parsed = await parseJson(request);
      if (!parsed.ok) return output({ ok: false, correlationId, error: { code: "invalid_input", safeMessage: "Check the checkout details and try again.", retryable: false, correlationId } }, parsed.status);
      const body = parseBegin(parsed.value);
      if (!body) return failure("invalid_input", "Check the checkout details and try again.", false, correlationId);
      try { return serviceResult(await getService().beginCheckout({ accessToken: getAccessTokenForPrincipal(request), invitationId, request: body }), correlationId); }
      catch { return failure("temporarily_unavailable", "Checkout is temporarily unavailable.", true, correlationId); }
    },
    async readAttempt(request: Request, attemptId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuid.test(attemptId)) return failure("invalid_input", "Check the checkout status link and try again.", false, correlationId);
      try {
        const result = await getService().readAttempt({ accessToken: getAccessTokenForPrincipal(request), attemptId });
        return result.ok ? serviceResult({ ok: true, value: projectRecovery(result.value) }, correlationId) : serviceResult(result, correlationId);
      }
      catch { return failure("temporarily_unavailable", "Checkout is temporarily unavailable.", true, correlationId); }
    },
    async finalizeReturn(request: Request, invitationId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuid.test(invitationId)) return failure("invalid_input", "Check the checkout return details and try again.", false, correlationId);
      const origin = assertExactOrigin(request, appOrigin);
      if (!origin.allowed) return failure("forbidden", "This checkout request could not be verified.", false, correlationId);
      const parsed = await parseJson(request);
      if (!parsed.ok) return failure("invalid_input", "Check the checkout return details and try again.", false, correlationId);
      if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
        return failure("invalid_input", "Check the checkout return details and try again.", false, correlationId);
      }
      const body = parsed.value as Record<string, unknown>;
      if (Object.keys(body).some((key) => !["attemptId","sessionId"].includes(key))
        || typeof body.attemptId !== "string" || !uuid.test(body.attemptId)
        || typeof body.sessionId !== "string" || !/^cs_(?:test_|live_)[A-Za-z0-9]+$/.test(body.sessionId)) {
        return failure("invalid_input", "Check the checkout return details and try again.", false, correlationId);
      }
      try {
        const result = await getService().finalizeReturn({ accessToken: getAccessTokenForPrincipal(request), invitationId,
          attemptId: body.attemptId, sessionId: body.sessionId });
        return result.ok ? serviceResult({ ok: true, value: projectRecovery(result.value) }, correlationId) : serviceResult(result, correlationId);
      } catch { return failure("temporarily_unavailable", "Checkout is temporarily unavailable.", true, correlationId); }
    },
  });
}
