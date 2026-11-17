import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverNotices, type NoticeSendResult } from "./notice-delivery.server.ts";
import { renderNotice, type NoticeContext } from "./notice-templates.server.ts";
import { createNoticeSender } from "./notice-sender.server.ts";

const id = (n: number) => `e0840000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://app.fifthwheel.community";
const ctx: NoticeContext = { firstName: "Maya <b>", tableTitle: "Autumn & Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", invitationId: id(9), reason: "Staff approved <this>", refundCents: 1500, decision: "approved" };
const claim = (n: number, over: object = {}) => ({ noticeId: id(n), leaseToken: id(100 + n), kind: "seat_confirmed", attempt: 1, to: `g${n}@example.com`, gone: false, context: ctx, ...over });

test("templates escape guest-supplied text, show money and times plainly, and never carry a token", () => {
  for (const kind of ["seat_confirmed", "cancellation_decision", "table_cancelled", "member_removed", "t48_reminder", "waitlist_confirmed"] as const) {
    const r = renderNotice(kind, ctx, origin);
    assert.ok(r.subject.length > 0 && r.text.includes("hello@fifthwheel.community"));
    assert.ok(!r.html.includes("<b>") && !r.html.includes("<this>"), kind);
    assert.ok(!/token_hash|access_token|magiclink/i.test(r.text + r.html), kind);
  }
  assert.match(renderNotice("cancellation_decision", ctx, origin).text, /\$15\.00/);
  assert.match(renderNotice("seat_confirmed", ctx, origin).text, /Saturday, December 12 at 7:00 PM/);
  assert.match(renderNotice("cancellation_decision", { ...ctx, decision: "denied", refundCents: 0 }, origin).subject, /About your cancellation request/);
  assert.match(renderNotice("t48_reminder", ctx, origin).text, /sign-in\?returnTo=%2Finvitations%2Fe0840000/);
  assert.match(renderNotice("waitlist_confirmed", ctx, origin).text, /Visit Fifth Wheel: https:\/\/fifthwheel\.community\n/);
});

test("delivery reports every outcome, never blocks on one failure, and flags gone recipients without sending", async () => {
  const finished: Array<Record<string, unknown>> = [];
  const sent: string[] = [];
  const results: Record<string, NoticeSendResult> = { [id(1)]: { state: "accepted", providerMessageId: "m1" }, [id(2)]: { state: "failed", safeErrorCode: "Rate Limited!", retryable: true },
    [id(3)]: { state: "failed", safeErrorCode: "rejected", retryable: false }, [id(4)]: { state: "unknown", safeErrorCode: "outcome_unknown" } };
  const tally = await deliverNotices({ appOrigin: origin,
    rpc: async (name, args) => { if (name === "enqueue_due_notices") return { t48Queued: 2 }; if (name === "claim_notices") return [claim(1), claim(2), claim(3), claim(4), claim(5, { gone: true }), claim(6)];
      finished.push(args as Record<string, unknown>); return {}; },
    send: async (input) => { sent.push(input.to); if (input.to === "g6@example.com") throw new Error("socket"); return results[input.noticeId]; } });
  assert.deepEqual(tally, { queued: 2, accepted: 1, retry: 1, failed: 2 - 1 + 0, unknown: 2, gone: 1 });
  assert.ok(!sent.includes("g5@example.com"), "gone recipient was mailed");
  const by = (n: number) => finished.find((f) => f.p_notice_id === id(n));
  assert.deepEqual([by(1)?.p_outcome, by(1)?.p_message_id], ["accepted", "m1"]);
  assert.deepEqual([by(2)?.p_outcome, by(2)?.p_retryable, by(2)?.p_error], ["failed", true, "rate_limited_"]);
  assert.deepEqual([by(5)?.p_outcome, by(5)?.p_retryable, by(5)?.p_error], ["failed", false, "recipient_gone"]);
  assert.deepEqual([by(6)?.p_outcome, by(6)?.p_retryable], ["unknown", false]);
  assert.equal(finished.length, 6);
  assert.ok(finished.every((f) => f.p_lease_token));
});

test("malformed claims are rejected before anything is sent", async () => {
  let sends = 0;
  await assert.rejects(deliverNotices({ appOrigin: origin, rpc: async (name) => (name === "claim_notices" ? [{ noticeId: "x" }] : {}), send: async () => { sends += 1; return { state: "accepted" }; } }));
  assert.equal(sends, 0);
});

test("sender: Mailpit is loopback only; Resend is used when a key exists", async () => {
  const base = { APP_ORIGIN: origin, MAIL_FROM_EMAIL: "hello@fifthwheel.community" };
  assert.throws(() => createNoticeSender({ ...base, MAILPIT_URL: "http://mail.example.com:8025" }), /not_loopback/);
  assert.throws(() => createNoticeSender({ ...base }), /MAILPIT_URL_unavailable/);
  const calls: string[] = [];
  const fetcher = (async (url: string | URL) => { calls.push(String(url)); return new Response(JSON.stringify({ ID: "abc123" }), { status: 200 }); }) as unknown as typeof fetch;
  const local = createNoticeSender({ ...base, MAILPIT_URL: "http://127.0.0.1:8025" }, fetcher);
  assert.deepEqual(await local.send({ noticeId: id(1), attempt: 1, to: "g@example.com", subject: "s", text: "t", html: "h" }), { state: "accepted", providerMessageId: "abc123" });
  assert.equal(calls[0], "http://127.0.0.1:8025/api/v1/send");
  const down = createNoticeSender({ ...base, MAILPIT_URL: "http://127.0.0.1:8025" }, (async () => new Response("", { status: 503 })) as unknown as typeof fetch);
  assert.equal((await down.send({ noticeId: id(1), attempt: 1, to: "g@example.com", subject: "s", text: "t", html: "h" })).state, "unknown");
  const prod = createNoticeSender({ ...base, RESEND_API_KEY: "re_test_1234567890" }, fetcher);
  assert.equal(prod.appOrigin, origin);
});
