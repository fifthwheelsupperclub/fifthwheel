import assert from "node:assert/strict";
import test from "node:test";
import {
  createMailpitMagicLinkEmailProvider,
  MailpitAdmissionEmailError,
} from "./admission.email.mailpit.server.ts";

const config = {
  baseUrl: "http://127.0.0.1:56424",
  fromEmail: "admissions@example.test",
  fromName: "Fifth Wheel",
};
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
      () => createMailpitMagicLinkEmailProvider({ ...config, baseUrl }, async () => new Response()),
      MailpitAdmissionEmailError,
    );
  }
  for (const fromEmail of ["one,two@example.test", '"two"@example.test', "one@two@example.test"]) {
    assert.throws(
      () => createMailpitMagicLinkEmailProvider({ ...config, fromEmail }, async () => new Response()),
      MailpitAdmissionEmailError,
    );
  }
});

test("rejects a non-loopback action link without making an HTTP request", async () => {
  let calls = 0;
  const provider = createMailpitMagicLinkEmailProvider(config, async () => {
    calls += 1;
    return new Response();
  });
  const result = await provider.sendSignInLink({
    recipientEmail,
    actionLink: "https://app.example.com/auth/v1/verify?token=secret",
    kind: "magiclink",
  });
  assert.deepEqual(result, { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false });
  assert.equal(calls, 0);
});

test("sends returning sign-in links through the local HTTP API", async () => {
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
