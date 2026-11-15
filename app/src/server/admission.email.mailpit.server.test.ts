import assert from "node:assert/strict";
import test from "node:test";
import {
  createMailpitAdmissionEmailProvider,
  createMailpitMagicLinkEmailProvider,
  MailpitAdmissionEmailError,
} from "./admission.email.mailpit.server.ts";

const config = {
  baseUrl: "http://127.0.0.1:56424",
  fromEmail: "admissions@example.test",
  fromName: "Fifth Wheel",
};
const ids = {
  deliveryId: "12000000-0000-4000-8000-000000000001",
  attemptId: "22000000-0000-4000-8000-000000000002",
  idempotencyKey: "32000000-0000-4000-8000-000000000003",
};
const actionLink = "http://127.0.0.1:8085/auth/callback?token_hash=abcdefghijklmnop&type=invite";
const stableMessageId = `<fw-admission-${ids.deliveryId}-${ids.attemptId}@fifthwheel.local>`;
const recipientEmail = "member@example.test";

test("rejects non-loopback, HTTPS, credentialed or path-bearing Mailpit configuration", () => {
  for (const baseUrl of [
    "https://127.0.0.1:56424",
    "http://mailpit:56424",
    "http://example.test:56424",
    "http://user:password@127.0.0.1:56424",
    "http://127.0.0.1:56424/nested",
    "http://127.0.0.1:56424?query=unsafe",
  ]) {
    assert.throws(
      () => createMailpitAdmissionEmailProvider({ ...config, baseUrl }, async () => new Response()),
      MailpitAdmissionEmailError,
    );
  }
  for (const fromEmail of ["one,two@example.test", '"two"@example.test', "one@two@example.test"]) {
    assert.throws(
      () => createMailpitAdmissionEmailProvider({ ...config, fromEmail }, async () => new Response()),
      MailpitAdmissionEmailError,
    );
  }
});

test("sends an invitation only to the local HTTP API with escaped link and attempt identity headers", async () => {
  let requestUrl: URL | undefined;
  let requestInit: RequestInit | undefined;
  const provider = createMailpitAdmissionEmailProvider(config, async (input, init) => {
    requestUrl = new URL(String(input));
    requestInit = init;
    return new Response(JSON.stringify({ ID: "mailpit-message-1" }), { status: 200 });
  });

  const result = await provider.sendAppInvitation({
    recipientEmail: "member@example.test",
    actionLink: `${actionLink}&safeReturnTo=%2F%22%3E%3Cscript%3E`,
    ...ids,
  });

  assert.deepEqual(result, { state: "accepted", providerMessageId: "mailpit-message-1" });
  assert.equal(requestUrl?.href, "http://127.0.0.1:56424/api/v1/send");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.redirect, "error");
  const payload = JSON.parse(String(requestInit?.body)) as {
    To: Array<{ Email: string }>;
    Headers: Record<string, string>;
    HTML: string;
    Text: string;
  };
  assert.deepEqual(payload.To, [{ Email: "member@example.test" }]);
  assert.equal(payload.Headers["Message-ID"], stableMessageId);
  assert.equal(payload.Headers["X-FifthWheel-Delivery-ID"], ids.deliveryId);
  assert.equal(payload.Headers["X-FifthWheel-Attempt-ID"], ids.attemptId);
  assert.equal(payload.Headers["X-FifthWheel-Idempotency-Key"], ids.idempotencyKey);
  assert.match(payload.HTML, /&amp;safeReturnTo=%2F%22%3E%3Cscript%3E/);
  assert.match(payload.Text, /You’re off the waitlist\. Sign in, finish your profile/);
});

test("rejects a non-loopback action link without making an HTTP request", async () => {
  let calls = 0;
  const provider = createMailpitAdmissionEmailProvider(config, async () => {
    calls += 1;
    return new Response();
  });
  const result = await provider.sendAppInvitation({
    recipientEmail: "member@example.test",
    actionLink: "https://app.example.com/auth/v1/verify?token=secret",
    ...ids,
  });
  assert.deepEqual(result, { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false });
  assert.equal(calls, 0);
});

test("sends returning sign-in links separately from invitation delivery attempts", async () => {
  let init: RequestInit | undefined;
  const provider = createMailpitMagicLinkEmailProvider(config, async (_input, requestInit) => {
    init = requestInit;
    return new Response(JSON.stringify({ ID: "sign-in-mail-1" }), { status: 200 });
  });
  const result = await provider.sendSignInLink({ recipientEmail, actionLink: "http://127.0.0.1:8085/auth/callback?token_hash=abcdefghijklmnop&type=magiclink", kind: "magiclink" });
  assert.deepEqual(result, { state: "accepted", providerMessageId: "sign-in-mail-1" });
  const payload = JSON.parse(String(init?.body)) as { To: Array<{ Email: string }>; Subject: string; Text: string };
  assert.deepEqual(payload.To, [{ Email: recipientEmail }]);
  assert.equal(payload.Subject, "Your Fifth Wheel sign-in link");
  assert.match(payload.Text, /token_hash=abcdefghijklmnop/);
});

test("rejects comma/quote recipient strings and malformed Mailpit IDs without using them", async () => {
  let calls = 0;
  const invalidRecipientProvider = createMailpitAdmissionEmailProvider(config, async () => {
    calls += 1;
    return new Response(JSON.stringify({ ID: "validMessageId1" }), { status: 200 });
  });
  assert.deepEqual(await invalidRecipientProvider.sendAppInvitation({
    recipientEmail: "one,two@example.test",
    actionLink,
    ...ids,
  }), { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false });
  assert.deepEqual(await invalidRecipientProvider.sendAppInvitation({
    recipientEmail: '"two"@example.test',
    actionLink,
    ...ids,
  }), { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false });
  assert.equal(calls, 0);

  const maliciousId = createMailpitAdmissionEmailProvider(config, async () =>
    new Response(JSON.stringify({ ID: "../../other-host/path" }), { status: 200 }));
  assert.deepEqual(await maliciousId.sendAppInvitation({
    recipientEmail: "member@example.test",
    actionLink,
    ...ids,
  }), { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" });
});

test("maps explicit rejection, server uncertainty and transport uncertainty safely", async () => {
  const rejected = createMailpitAdmissionEmailProvider(config, async () => new Response("invalid", { status: 400 }));
  assert.deepEqual(await rejected.sendAppInvitation({ recipientEmail: "member@example.test", actionLink, ...ids }), {
    state: "failed", safeErrorCode: "mailpit_rejected", retryable: false,
  });

  const serverError = createMailpitAdmissionEmailProvider(config, async () => new Response("error", { status: 503 }));
  assert.deepEqual(await serverError.sendAppInvitation({ recipientEmail: "member@example.test", actionLink, ...ids }), {
    state: "unknown", safeErrorCode: "mailpit_outcome_unknown",
  });

  const networkError = createMailpitAdmissionEmailProvider(config, async () => { throw new Error("private transport details"); });
  assert.deepEqual(await networkError.sendAppInvitation({ recipientEmail: "member@example.test", actionLink, ...ids }), {
    state: "unknown", safeErrorCode: "mailpit_outcome_unknown",
  });
});

test("reconciles a stored Mailpit ID only when Message-ID and exact recipient match", async () => {
  const provider = createMailpitAdmissionEmailProvider(config, async (input) => {
    assert.equal(String(input), "http://127.0.0.1:56424/api/v1/message/mailpit-message-1");
    return new Response(JSON.stringify({
      ID: "mailpit-message-1",
      MessageID: stableMessageId,
      To: [{ Address: "member@example.test" }],
    }), { status: 200 });
  });
  assert.deepEqual(await provider.reconcile({ ...ids, recipientEmail, providerMessageId: "mailpit-message-1" }), {
    state: "accepted", providerMessageId: "mailpit-message-1",
  });

  const wrongRecipient = createMailpitAdmissionEmailProvider(config, async () => new Response(JSON.stringify({
    ID: "mailpit-message-1",
    MessageID: stableMessageId,
    To: [{ Address: "other@example.test" }],
  }), { status: 200 }));
  assert.deepEqual(await wrongRecipient.reconcile({ ...ids, recipientEmail, providerMessageId: "mailpit-message-1" }), { state: "unknown" });

  const multipleRecipients = createMailpitAdmissionEmailProvider(config, async () => new Response(JSON.stringify({
    ID: "mailpit-message-1",
    MessageID: stableMessageId,
    To: [{ Address: recipientEmail }, { Address: "other@example.test" }],
  }), { status: 200 }));
  assert.deepEqual(await multipleRecipients.reconcile({ ...ids, recipientEmail, providerMessageId: "mailpit-message-1" }), { state: "unknown" });

  const unrelated = createMailpitAdmissionEmailProvider(config, async () => new Response(JSON.stringify({
    ID: "mailpit-message-1",
    MessageID: "<unrelated@fifthwheel.local>",
  }), { status: 200 }));
  assert.deepEqual(await unrelated.reconcile({ ...ids, recipientEmail, providerMessageId: "mailpit-message-1" }), { state: "unknown" });

  let calls = 0;
  const unsafeId = createMailpitAdmissionEmailProvider(config, async () => {
    calls += 1;
    return new Response();
  });
  assert.deepEqual(await unsafeId.reconcile({ ...ids, recipientEmail, providerMessageId: "../../other-host/path" }), { state: "unknown" });
  assert.equal(calls, 0);
});

test("searches by the deterministic attempt Message-ID and fails closed when absent or malformed", async () => {
  let searchUrl: URL | undefined;
  const provider = createMailpitAdmissionEmailProvider(config, async (input) => {
    searchUrl = new URL(String(input));
    return new Response(JSON.stringify({
      messages: [{
        ID: "mailpit-message-2",
        MessageID: stableMessageId,
        To: [{ Address: "member@example.test" }],
      }],
      messages_count: 1,
    }), { status: 200 });
  });
  assert.deepEqual(await provider.reconcile({ ...ids, recipientEmail }), {
    state: "accepted", providerMessageId: "mailpit-message-2",
  });
  assert.equal(searchUrl?.pathname, "/api/v1/search");
  assert.equal(searchUrl?.searchParams.get("query"), `message-id:fw-admission-${ids.deliveryId}-${ids.attemptId}@fifthwheel.local`);

  for (const fakeFetch of [
    async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    async () => new Response(JSON.stringify({ notMessages: [] }), { status: 200 }),
    async () => new Response("unavailable", { status: 500 }),
    async () => { throw new Error("network"); },
  ] satisfies Array<typeof fetch>) {
    const unavailable = createMailpitAdmissionEmailProvider(config, fakeFetch);
    assert.deepEqual(await unavailable.reconcile({ ...ids, recipientEmail }), { state: "unknown" });
  }

  let calls = 0;
  const invalidRecipient = createMailpitAdmissionEmailProvider(config, async () => {
    calls += 1;
    return new Response();
  });
  assert.deepEqual(await invalidRecipient.reconcile({ ...ids, recipientEmail: "invalid recipient" }), { state: "unknown" });
  assert.equal(calls, 0);
});
