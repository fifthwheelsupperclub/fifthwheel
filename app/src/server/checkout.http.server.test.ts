import assert from "node:assert/strict";
import test from "node:test";
import type { BeginCheckoutInput, CheckoutAttemptInput, CheckoutInput, CheckoutService } from "./checkout.contract.server.ts";
import { createCheckoutHttpHandlers } from "./checkout.http.server.ts";

const appOrigin = "http://127.0.0.1:8085";
const invitationId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature";
const calls: Array<{ method: string; input: unknown }> = [];
let eligibilityResult: unknown;
let attemptResult: unknown;

function service(): CheckoutService {
  return {
    async readEligibility(input: CheckoutInput) { calls.push({ method: "eligibility", input }); return eligibilityResult as never; },
    async beginCheckout(input: BeginCheckoutInput) { calls.push({ method: "begin", input }); return { ok: true, value: {
      attempt: { attemptId, invitationId, state: "open", holdUntil: "2026-11-13T13:30:00.000Z", providerSessionExpiresAt: "2026-11-13T13:32:00.000Z" },
      price: { amountCents: 2500, currency: "USD" }, checkoutClientSecret: "client_secret_owner_only",
    } }; },
    async readAttempt(input: CheckoutAttemptInput) { calls.push({ method: "attempt", input }); return attemptResult as never; },
    async finalizeReturn(input) { calls.push({ method: "return", input }); return attemptResult as never; },
  };
}

function handlers() { return createCheckoutHttpHandlers(service, appOrigin); }
function makeRequest(path: string, options: RequestInit = {}) { return new Request(`${appOrigin}${path}`, options); }
function beginBody(extra: Record<string, unknown> = {}) {
  return { operationId, expectedProposalRevision: 3, expectedProfileRevision: 7, acceptedDisclosureVersion: "seat-checkout-v1", ...extra };
}
async function json(response: Response): Promise<Record<string, any>> { return response.json() as Promise<Record<string, any>>; }
function successEligibility(extra: Record<string, unknown> = {}) {
  return { ok: true, value: {
    invitationId, expectedProposalRevision: 3, expectedProfileRevision: 7,
    eligibility: { status: "ready", reasonCode: null }, price: { amountCents: 2500, currency: "USD" },
    disclosure: { status: "not_configured" }, provider: { ready: false, mode: null, publishableKey: null }, activeAttempt: null, ...extra,
  } };
}

test("eligibility is cookie-derived, no-store and projects only safe DTO fields", async () => {
  calls.length = 0;
  eligibilityResult = successEligibility({ checkoutClientSecret: "must-not-leak" });
  const response = await handlers().readEligibility(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`, {
    headers: { cookie: `fw_access_token=${token}` },
  }), invitationId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("vary"), "Cookie, Origin");
  const body = await json(response);
  assert.match(body.correlationId, /^[0-9a-f-]{36}$/i);
  assert.equal(body.ok, true);
  assert.deepEqual(calls[0], { method: "eligibility", input: { accessToken: token, invitationId } });
  assert.equal(JSON.stringify(body).includes("clientSecret"), false);
});

test("begin requires exact same origin and validates a bounded strict JSON body", async () => {
  calls.length = 0;
  const badOrigin = await handlers().beginCheckout(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`, {
    method: "POST", headers: { origin: "http://localhost:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify(beginBody()),
  }), invitationId);
  assert.equal(badOrigin.status, 403);

  const extraKey = await handlers().beginCheckout(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`, {
    method: "POST", headers: { origin: appOrigin, "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify(beginBody({ amountCents: 1 })),
  }), invitationId);
  assert.equal(extraKey.status, 400);

  const wrongType = await handlers().beginCheckout(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`, {
    method: "POST", headers: { origin: appOrigin, "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify(beginBody({ expectedProfileRevision: "7" })),
  }), invitationId);
  assert.equal(wrongType.status, 400);

  const unsupportedMedia = await handlers().beginCheckout(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`, {
    method: "POST", headers: { origin: appOrigin, "content-type": "text/plain", cookie: `fw_access_token=${token}` }, body: JSON.stringify(beginBody()),
  }), invitationId);
  assert.equal(unsupportedMedia.status, 400);

  const oversized = await handlers().beginCheckout(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`, {
    method: "POST", headers: { origin: appOrigin, "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify(beginBody({ padding: "x".repeat(5000) })),
  }), invitationId);
  assert.equal(oversized.status, 413);
  assert.equal(calls.length, 0);
});

test("begin passes only validated caller fields and exposes the client secret only in its owner result", async () => {
  calls.length = 0;
  const response = await handlers().beginCheckout(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`, {
    method: "POST", headers: { origin: appOrigin, "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify(beginBody()),
  }), invitationId);
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { method: "begin", input: { accessToken: token, invitationId,
    request: { operationId, expectedProposalRevision: 3, expectedProfileRevision: 7, acceptedDisclosureVersion: "seat-checkout-v1" } } });
  const body = await json(response);
  assert.equal(body.data.checkoutClientSecret, "client_secret_owner_only");
  assert.equal(body.data.price.amountCents, 2500);
});

test("service failures map to safe status and retryable envelopes", async () => {
  calls.length = 0;
  eligibilityResult = { ok: false, error: { code: "unauthenticated", safeMessage: "Sign in to continue.", retryable: false } };
  const denied = await handlers().readEligibility(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`), invitationId);
  assert.equal(denied.status, 401);
  const deniedBody = await json(denied);
  assert.match(deniedBody.correlationId, /^[0-9a-f-]{36}$/i);
  assert.match(deniedBody.error.correlationId, /^[0-9a-f-]{36}$/i);
  assert.equal(deniedBody.error.correlationId, deniedBody.correlationId);
  assert.deepEqual(deniedBody.error, { code: "unauthenticated", safeMessage: "Sign in to continue.", retryable: false, correlationId: deniedBody.correlationId });

  eligibilityResult = { ok: false, error: { code: "outcome_unknown", safeMessage: "Check payment status before retrying.", retryable: true } };
  const uncertain = await handlers().readEligibility(makeRequest(`/api/me/table-invitations/${invitationId}/checkout`), invitationId);
  assert.equal(uncertain.status, 503);
  assert.equal((await json(uncertain)).error.retryable, true);
});

test("attempt recovery is owner-scoped through cookie service input and omits any client secret", async () => {
  calls.length = 0;
  attemptResult = { ok: true, value: {
    attempt: { attemptId, invitationId, state: "unknown", holdUntil: "2026-11-13T13:30:00.000Z", providerSessionExpiresAt: "2026-11-13T13:32:00.000Z", clientSecret: "must-not-leak" },
    paymentState: "unknown", seatId: null, clientSecret: "must-not-leak",
  } };
  const response = await handlers().readAttempt(makeRequest(`/api/me/checkout-attempts/${attemptId}`, {
    headers: { cookie: `fw_access_token=${token}` },
  }), attemptId);
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { method: "attempt", input: { accessToken: token, attemptId } });
  const body = await json(response);
  assert.equal(body.data.attempt.state, "unknown");
  assert.equal(JSON.stringify(body).includes("clientSecret"), false);
});

test("invalid resource identifiers fail before service calls", async () => {
  calls.length = 0;
  const badInvitation = await handlers().readEligibility(makeRequest("/api/me/table-invitations/not-a-uuid/checkout"), "not-a-uuid");
  const badAttempt = await handlers().readAttempt(makeRequest("/api/me/checkout-attempts/not-a-uuid"), "not-a-uuid");
  assert.equal(badInvitation.status, 400);
  assert.equal(badAttempt.status, 400);
  assert.equal(calls.length, 0);
});
