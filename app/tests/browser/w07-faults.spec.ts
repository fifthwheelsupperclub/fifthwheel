import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { A, B, C, T2, appOrigin, beginApi, cancelAndApprove, db, fx, obligationOf, postEvent, seatOf, sendRefund, sessionOf, signedEvent, signedIn, startPayment, stripe, workerPass } from "./w077-helpers.ts";

const proxy = process.env.FAULT_PROXY!;
const arm = (match: string, times = 1) => fetch(`${proxy}/arm?times=${times}&match=${encodeURIComponent(match)}`, { method: "POST" });
const disarm = () => fetch(`${proxy}/disarm`, { method: "POST" });
const piOf = (inv: string) => db(`select p.provider_payment_id from public.app_payments p join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${inv}'`);

test.describe.configure({ mode: "serial" });
test.afterEach(async () => { await disarm(); });

test("G1 refund response lost AFTER Stripe created it: obligation goes unknown, is never re-sent, and Try again resolves it without a second payout", async ({ browser }) => {
  const { ctx } = await startPayment(browser, A);
  await expect.poll(() => seatOf(A.invitation), { timeout: 90_000 }).not.toBe("");
  const seat = seatOf(A.invitation); const pi = piOf(A.invitation);
  const { admin, ap } = await cancelAndApprove(browser, ctx, seat, {});
  // G5 (mail outage): the app's mail target is a dead port for this whole suite; approval above must have succeeded regardless.
  const ob = obligationOf(seat); await sendRefund(ap, ob);
  await arm("POST /v1/refunds");
  await workerPass();
  await disarm();
  await expect.poll(() => db(`select state from public.app_refund_obligations where obligation_id='${ob}'`), { timeout: 30_000 }).toBe("unknown");
  const live = await stripe(`/refunds?payment_intent=${pi}`);
  expect(live.json.data).toHaveLength(1);                       // Stripe DID refund once...
  expect(live.json.data[0].amount).toBe(2500);
  expect(db(`select count(*) from public.app_refund_operations where obligation_id='${ob}' and provider_refund_id is not null`)).toBe("0"); // ...but the app never learned the refund id
  await workerPass();                                           // an unknown outcome must never be auto-resent
  expect((await stripe(`/refunds?payment_intent=${pi}`)).json.data).toHaveLength(1);
  await ap.goto(`${appOrigin}/admin/refunds/${ob}`);
  await expect(ap.getByRole("heading", { name: "Unconfirmed" })).toBeVisible();
  // No provider refund id is stored, so "Check status" is not offered; "Try again" re-sends with the SAME idempotency key.
  await expect(ap.getByRole("button", { name: "Check status" })).toHaveCount(0);
  await ap.getByRole("button", { name: "Try again" }).click();
  await ap.getByRole("button", { name: "Try again", exact: true }).last().click();
  await workerPass();
  console.log("W077 G1 after Try again:", db(`select o.state from public.app_refund_obligations o where o.obligation_id='${ob}'`), db(`select string_agg(state||':'||coalesce(safe_code,'')||':'||coalesce(provider_refund_id,''),',') from public.app_refund_operations where obligation_id='${ob}'`));
  // scheduler behaviour: keep running worker passes (the retry may sit behind a short backoff)
  await expect.poll(async () => { await workerPass(); return db(`select state from public.app_refund_obligations where obligation_id='${ob}'`); }, { timeout: 120_000, intervals: [5_000] }).toBe("succeeded");
  expect((await stripe(`/refunds?payment_intent=${pi}`)).json.data).toHaveLength(1); // still exactly one refund
  const memberId = db(`select id from auth.users where email='${A.email}'`);
  console.log("W077 G5 member notices:", db(`select coalesce(string_agg(kind||':'||state,','),'none') from public.app_notice_outbox where recipient_user_id='${memberId}'`));
  expect(db(`select count(*) from public.app_notice_outbox where recipient_user_id='${memberId}' and state='accepted'`)).toBe("0");
  await admin.close(); await ctx.close();
});

test("G2 checkout create response lost: retrying the same operation reuses the provider session (one Stripe session)", async ({ browser }) => {
  const ctx = await signedIn(browser, B.email); const op = randomUUID();
  await arm("POST /v1/checkout/sessions");
  const first = await beginApi(ctx, B.invitation, op);
  await disarm();
  console.log("W077 G2 first begin ->", first.status(), (await first.text()).slice(0, 160));
  expect(first.status()).not.toBe(200);
  const attempt = db(`select attempt_id||'|'||state from public.app_checkout_attempts where invitation_id='${B.invitation}'`);
  console.log("W077 G2 attempt:", attempt);
  const attemptId = attempt.split("|")[0];
  const retry = await beginApi(ctx, B.invitation, op);
  console.log("W077 G2 same-operation retry ->", retry.status());
  expect(retry.status()).toBe(200);
  const sessions = await stripe("/checkout/sessions?limit=40");
  const mine = (sessions.json.data as any[]).filter((x) => x.metadata?.attempt_id === attemptId);
  expect(mine).toHaveLength(1);
  expect(db(`select count(*) from public.app_checkout_attempts where invitation_id='${B.invitation}'`)).toBe("1");
  await ctx.close();
});

test("G3 browser-return and webhook race: parallel return calls and signed webhooks yield exactly one Seat and one payment", async ({ browser }) => {
  const { ctx, page } = await startPayment(browser, C);
  const session = await expect.poll(() => sessionOf(C.invitation), { timeout: 30_000 }).toMatch(/^cs_test_/).then(() => sessionOf(C.invitation));
  await expect.poll(async () => (await stripe(`/checkout/sessions/${session}`)).json.status, { timeout: 90_000, intervals: [500] }).toBe("complete");
  const attemptId = db(`select attempt_id from public.app_checkout_attempts where provider_session_id='${session}'`);
  const pi = (await stripe(`/checkout/sessions/${session}`)).json.payment_intent as string;
  const returns = Array.from({ length: 4 }, () => ctx.request.post(`${appOrigin}/api/me/table-invitations/${C.invitation}/checkout/return`, { headers: { origin: appOrigin }, data: { attemptId, sessionId: session } }));
  const hooks = Array.from({ length: 4 }, () => postEvent(signedEvent({ sessionId: session, pi })));
  const results = await Promise.all([...returns, ...hooks]);
  console.log("W077 G3 statuses:", (await Promise.all(results.map(async (r) => ("status" in r && typeof r.status === "function") ? (r as any).status() : (r as Response).status))).join(","));
  await expect.poll(() => seatOf(C.invitation), { timeout: 60_000 }).not.toBe("");
  await page.waitForTimeout(3_000);
  expect(db(`select count(*) from public.app_seats where invitation_id='${C.invitation}'`)).toBe("1");
  expect(db(`select count(*) from public.app_payments p join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${C.invitation}'`)).toBe("1");
  // Out-of-order delivery: a stale "expired/unpaid" event arriving AFTER completion must not release or alter the paid Seat.
  const stale = await postEvent(signedEvent({ sessionId: session, pi, type: "checkout.session.expired", status: "expired", paymentStatus: "unpaid" }));
  console.log("W077 G3 stale expired event ->", stale.status);
  await page.waitForTimeout(2_000);
  expect(db(`select count(*) from public.app_seats where invitation_id='${C.invitation}' and state='confirmed'`)).toBe("1");
  expect(db(`select count(*) from public.app_payments p join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${C.invitation}' and p.state='verified_paid'`)).toBe("1");
  await ctx.close();
});

test("G4 late charge from a FULL Table: capacity taken while the payer's hold had lapsed → no Seat, full refund owed, refund settles", async ({ browser }) => {
  const [h1, h2, h3, h4, h5, h6] = T2;
  const others = await Promise.all([h2, h3, h4, h5].map((m) => signedIn(browser, m.email)));
  for (let i = 0; i < 4; i++) expect((await beginApi(others[i], [h2, h3, h4, h5][i].invitation)).status()).toBe(200);
  const e6 = await signedIn(browser, h6.email);
  const { ctx } = await startPayment(browser, h1, async () => {
    db(`update public.app_checkout_attempts set hold_until=now()-interval '5 minutes', provider_session_expires_at=now()-interval '4 minutes' where invitation_id='${h1.invitation}'`);
    expect((await beginApi(e6, h6.invitation)).status()).toBe(200); // freed slot is taken by someone else
  });
  const session = sessionOf(h1.invitation);
  await expect.poll(() => db(`select string_agg(event_type||':'||state||':'||coalesce(result_code,''),',') from public.app_stripe_checkout_events where session_id='${session}'`), { timeout: 90_000, intervals: [2_000] }).toContain("processed");
  expect(seatOf(h1.invitation)).toBe("");
  const ob = db(`select o.obligation_id||'|'||o.source||'|'||o.amount_cents from public.app_refund_obligations o join public.app_payments p on p.payment_id=o.payment_id join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${h1.invitation}'`);
  expect(ob).toMatch(/\|late_checkout_ineligible\|2500$/);
  const admin = await signedIn(browser, fx.adminEmail); const ap = await admin.newPage(); const id = ob.split("|")[0];
  await sendRefund(ap, id); await workerPass();
  await expect.poll(() => db(`select state from public.app_refund_obligations where obligation_id='${id}'`), { timeout: 60_000, intervals: [2_000] }).toBe("succeeded");
  await admin.close(); await ctx.close(); await e6.close(); await Promise.all(others.map((c) => c.close()));
});
