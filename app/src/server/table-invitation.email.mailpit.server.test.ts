import assert from "node:assert/strict";
import test from "node:test";
import { createMailpitTableInvitationEmailProvider, MailpitTableInvitationError } from "./table-invitation.email.mailpit.server.ts";

const invitationId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const input = { invitationId, attemptId, recipientEmail: "member@example.test",
  table: { title: "The Dinner Table", localDate: "2026-12-01", startLocalTime: "19:00", neighborhood: "Midtown" } };
const config = { baseUrl: "http://127.0.0.1:56424", appOrigin: "http://127.0.0.1:8085", fromEmail: "fifthwheel@example.test" };

test("Mailpit Table provider accepts only loopback endpoints and never generates a magic link", async () => {
  assert.throws(() => createMailpitTableInvitationEmailProvider({ ...config, baseUrl: "https://mail.example.com" }), MailpitTableInvitationError);
  let requestUrl: URL | undefined; let payload: Record<string, any> | undefined;
  const provider = createMailpitTableInvitationEmailProvider(config, async (url, init) => {
    requestUrl = new URL(String(url)); payload = JSON.parse(String(init?.body)) as Record<string, any>;
    return Response.json({ ID: "mailpit-id-1" });
  });
  assert.deepEqual(await provider.sendInvitation(input), { state: "accepted", providerMessageId: "mailpit-id-1" });
  assert.equal(requestUrl?.origin, "http://127.0.0.1:56424");
  assert.equal(requestUrl?.pathname, "/api/v1/send");
  assert.deepEqual(payload?.To, [{ Email: "member@example.test" }]);
  assert.equal(payload?.Headers["Message-ID"], `<fw-table-${invitationId}-${attemptId}@fifthwheel.local>`);
  assert.equal(payload?.Text.includes(`/sign-in?returnTo=${encodeURIComponent(`/invitations/${invitationId}`)}`), true);
  assert.equal(payload?.Text.toLowerCase().includes("magic link"), false);
  assert.equal(payload?.Text.includes("The Dinner Table"), true);
});

test("Mailpit uncertain send remains unknown and recovery requires exact Message-ID plus recipient", async () => {
  let requested: URL | undefined;
  const timedOut = createMailpitTableInvitationEmailProvider(config, async () => { throw new Error("network failure"); });
  assert.deepEqual(await timedOut.sendInvitation(input), { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" });
  const provider = createMailpitTableInvitationEmailProvider(config, async (url) => {
    requested = new URL(String(url));
    return Response.json({ messages: [{ ID: "mailpit-id-2", MessageID: `<fw-table-${invitationId}-${attemptId}@fifthwheel.local>`,
      To: [{ Address: "member@example.test" }] }] });
  });
  const match = await provider.reconcile({ invitationId, attemptId, recipientEmail: "member@example.test" });
  assert.deepEqual(match, { state: "accepted", providerMessageId: "mailpit-id-2" });
  assert.equal(requested?.pathname, "/api/v1/search");
  const mismatch = await provider.reconcile({ invitationId, attemptId, recipientEmail: "other@example.test" });
  assert.deepEqual(mismatch, { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" });
});
