import assert from "node:assert/strict";
import { test } from "node:test";
import { createResendEmail, ResendConfigError } from "./email.resend.server.ts";

const base = { apiKey: "re_test_1234567890", fromEmail: "hello@fifthwheel.community", fromName: "Fifth Wheel", appOrigin: "https://app.fifthwheel.community" };
const link = "https://app.fifthwheel.community/auth/callback?token_hash=abcdefghijklmnopqrstuv&type=invite";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function fake(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init); }) as unknown as typeof fetch;
  return { calls, email: createResendEmail(base, fetcher) };
}

test("rejects insecure origin, bad key and bad sender", () => {
  for (const bad of [{ appOrigin: "http://app.fifthwheel.community" }, { apiKey: "nope" }, { fromEmail: "x" }]) {
    assert.throws(() => createResendEmail({ ...base, ...bad }), ResendConfigError);
  }
});

test("sends the invitation with bearer auth and an idempotency key", async () => {
  const { calls, email } = fake(() => json(200, { id: "abc123" }));
  const input = { recipientEmail: "guest@example.com", actionLink: link, deliveryId: "d1", attemptId: "a1", idempotencyKey: "k1" };
  assert.deepEqual(await email.admission.sendAppInvitation(input), { state: "accepted", providerMessageId: "abc123" });
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(headers.authorization, "Bearer re_test_1234567890");
  assert.equal(headers["idempotency-key"], "admission-k1");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)).to, ["guest@example.com"]);
});

test("refuses links off the app origin or off the callback path without calling Resend", async () => {
  const { calls, email } = fake(() => json(200, { id: "x" }));
  for (const actionLink of ["https://evil.example/auth/callback?token_hash=abcdefghijklmnopqrstuv&type=invite", "https://app.fifthwheel.community/other?token_hash=abcdefghijklmnopqrstuv&type=invite"]) {
    const r = await email.magicLink.sendSignInLink({ recipientEmail: "guest@example.com", actionLink, kind: "magiclink" });
    assert.equal(r.state, "failed");
  }
  assert.equal(calls.length, 0);
});

test("maps 5xx and network errors to unknown, 429 to retryable, other 4xx to failed", async () => {
  const input = { recipientEmail: "guest@example.com", actionLink: link, deliveryId: "d1", attemptId: "a1", idempotencyKey: "k1" };
  assert.equal((await fake(() => json(503, {})).email.admission.sendAppInvitation(input)).state, "unknown");
  assert.equal((await fake(() => { throw new Error("net"); }).email.admission.sendAppInvitation(input)).state, "unknown");
  assert.deepEqual(await fake(() => json(429, {})).email.admission.sendAppInvitation(input), { state: "failed", safeErrorCode: "resend_rate_limited", retryable: true });
  assert.deepEqual(await fake(() => json(422, {})).email.admission.sendAppInvitation(input), { state: "failed", safeErrorCode: "resend_rejected", retryable: false });
});

test("reconcile needs a provider id and an exact recipient match", async () => {
  const input = { deliveryId: "d1", attemptId: "a1", recipientEmail: "guest@example.com", providerMessageId: "abc123" };
  assert.deepEqual(await fake(() => json(200, { id: "abc123", to: ["Guest@Example.com"], last_event: "delivered" })).email.admission.reconcile(input), { state: "delivered", providerMessageId: "abc123" });
  assert.equal((await fake(() => json(200, { id: "abc123", to: ["other@example.com"], last_event: "delivered" })).email.admission.reconcile(input)).state, "unknown");
  assert.equal((await fake(() => json(200, { id: "abc123", to: ["guest@example.com"], last_event: "bounced" })).email.admission.reconcile(input)).state, "failed");
  assert.equal((await fake(() => json(404, {})).email.admission.reconcile(input)).state, "unknown");
  assert.equal((await fake(() => json(200, {})).email.admission.reconcile({ ...input, providerMessageId: undefined })).state, "unknown");
});

test("table invitation links to sign-in with the invitation return path", async () => {
  const { calls, email } = fake(() => json(200, { id: "t1" }));
  const r = await email.tableInvitation.sendInvitation({ invitationId: "11111111-1111-4111-8111-111111111111", attemptId: "22222222-2222-4222-8222-222222222222",
    recipientEmail: "guest@example.com", table: { title: "Fifth Wheel", localDate: "2026-12-01", startLocalTime: "19:00", neighborhood: "Midtown" } });
  assert.deepEqual(r, { state: "accepted", providerMessageId: "t1" });
  assert.match(JSON.parse(String(calls[0].init.body)).text, /https:\/\/app\.fifthwheel\.community\/sign-in\?returnTo=%2Finvitations%2F1111/);
});
