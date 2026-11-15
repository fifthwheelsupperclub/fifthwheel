import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";
const fx = JSON.parse(process.env.W077_FIXTURE!) as { db: string; adminEmail: string; members: { email: string; invitation: string; table: number }[]; tables: { id: string; title: string }[] };
const stripeKey = process.env.STRIPE_SECRET_KEY!;
const whsec = process.env.STRIPE_WEBHOOK_SECRET!;
const stripeHost = (h: string) => /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(h);
const [A, B, C, D] = fx.members.slice(0, 4);
const T2 = fx.members.slice(4);

function db(sql: string): string {
  const r = spawnSync("psql", [fx.db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.slice(0, 300)}`);
  return r.stdout.trim();
}
async function stripe(path: string, method = "GET", body?: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${stripeKey}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, ...(body ? { body: new URLSearchParams(body) } : {}) });
  return { status: r.status, json: await r.json() as Record<string, any> };
}
async function signedIn(browser: Browser, email: string, withStripe = false): Promise<BrowserContext> {
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY!, svc = process.env.SUPABASE_SECRET_KEY!;
  const context = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.origin === appOrigin || u.origin === supabaseOrigin || (withStripe && stripeHost(u.hostname)) ? route.continue() : route.abort();
  });
  const gen = await context.request.post(`${supabaseOrigin}/auth/v1/admin/generate_link`, { headers: { apikey: svc, authorization: `Bearer ${svc}`, "content-type": "application/json" }, data: { type: "magiclink", email, redirect_to: `${appOrigin}/auth/callback` } });
  const hashed = ((await gen.json()) as { hashed_token?: string }).hashed_token;
  const ver = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, { headers: { apikey: pub, "content-type": "application/json" }, data: { token_hash: hashed, type: "magiclink" } });
  const s = (await ver.json()) as { access_token: string; refresh_token: string };
  await context.addCookies([
    { name: "fw_access_token", value: s.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: s.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}
const beginApi = (ctx: BrowserContext, invitation: string) => ctx.request.post(`${appOrigin}/api/me/table-invitations/${invitation}/checkout`, {
  headers: { origin: appOrigin }, data: { operationId: randomUUID(), expectedProposalRevision: 1, expectedProfileRevision: 1, acceptedDisclosureVersion: "seat-checkout-v1" } });

async function fillAndPay(page: Page, email: string, beforePay?: () => Promise<void>) {
  await expect.poll(() => page.frames().some((f) => f.url().includes("embedded-checkout-inner")), { timeout: 60_000 }).toBe(true);
  const frame = page.frames().find((f) => f.url().includes("embedded-checkout-inner"))!;
  await frame.locator("#email").fill(email);
  await frame.getByTestId("card-accordion-item-button").dispatchEvent("click");
  await expect.poll(() => frame.getByPlaceholder("1234 1234 1234 1234").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await frame.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await frame.getByPlaceholder("MM / YY").fill("1234");
  await frame.getByPlaceholder("CVC").fill("123");
  const name = frame.getByPlaceholder("Full name on card"); if (await name.count()) await name.fill("W077 Member");
  const zip = frame.getByPlaceholder("ZIP"); if (await zip.count()) await zip.fill("30307");
  const save = frame.getByLabel(/Save my information with Link/); if (await save.count()) await save.uncheck();
  if (beforePay) await beforePay();
  await page.waitForTimeout(2_000);
  await frame.getByTestId("hosted-payment-submit-button").click();
}
async function startPayment(browser: Browser, m: { email: string; invitation: string }, beforePay?: () => Promise<void>) {
  const ctx = await signedIn(browser, m.email, true); const page = await ctx.newPage();
  await page.goto(`${appOrigin}/invitations/${m.invitation}`);
  await page.getByRole("checkbox", { name: /I acknowledge this disclosure/ }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await fillAndPay(page, m.email, beforePay);
  return { ctx, page };
}
const seatOf = (inv: string) => db(`select coalesce(max(seat_id::text),'') from public.app_seats where invitation_id='${inv}'`);
const sessionOf = (inv: string) => db(`select provider_session_id from public.app_checkout_attempts where invitation_id='${inv}' and provider_session_id is not null order by created_at desc limit 1`);

async function cancelAndApprove(browser: Browser, memberCtx: BrowserContext, seatId: string, refund: { partial?: string }) {
  const res = await memberCtx.request.post(`${appOrigin}/api/me/seats/${seatId}/cancellation-requests`, { headers: { origin: appOrigin }, data: { operationId: randomUUID(), memberReason: "W07.7" } });
  expect(res.status()).toBe(200);
  const admin = await signedIn(browser, fx.adminEmail); const ap = await admin.newPage();
  await ap.goto(`${appOrigin}/admin/cancellations`);
  const row = ap.locator("a", { hasText: "Review request" });
  await expect(row.first()).toBeVisible(); // queue is per-run; reviewing the first pending item
  await row.first().click();
  await expect(ap.getByRole("heading", { name: "Cancel this seat?" })).toBeVisible();
  await ap.getByLabel("Message to the guest").fill("Approved.");
  if (refund.partial) { await ap.getByLabel("Partial refund").check(); await ap.getByLabel(/Refund amount in dollars/).fill(refund.partial); } else await ap.getByLabel(/Full refund/).check();
  await ap.getByRole("button", { name: "Approve cancellation" }).click();
  await ap.getByRole("button", { name: /^(Approve|Decline)$/ }).last().click();
  await expect(ap.getByRole("heading", { name: "Approved" })).toBeVisible();
  return { admin, ap };
}
async function sendRefund(ap: Page, obligation: string) {
  await ap.goto(`${appOrigin}/admin/refunds/${obligation}`);
  await expect(ap.getByRole("heading", { name: "Owed, not sent" })).toBeVisible();
  await ap.getByRole("button", { name: "Send refund" }).click();
  await ap.getByRole("button", { name: "Send refund", exact: true }).last().click();
  await expect(ap.getByRole("heading", { name: "Queued" })).toBeVisible();
}
async function workerPass() {
  const r = await fetch(`${appOrigin}/api/internal/worker`, { method: "POST", headers: { authorization: `Bearer ${process.env.JOB_SECRET}` } });
  const body = await r.text(); console.log("W077 worker:", r.status, body.slice(0, 160)); return r.status;
}
const obligationOf = (seat: string) => db(`select o.obligation_id from public.app_refund_obligations o join public.app_seats s on s.payment_id=o.payment_id where s.seat_id='${seat}' order by o.created_at desc limit 1`);
function signedEvent(over: { sessionId: string; pi: string; amount?: number; livemode?: boolean; id?: string; type?: string; badSig?: boolean }) {
  const livemode = over.livemode ?? false;
  const payload = JSON.stringify({ id: over.id ?? `evt_w077${randomUUID().replaceAll("-", "").slice(0, 20)}`, object: "event", type: over.type ?? "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode,
    data: { object: { id: over.sessionId, object: "checkout.session", livemode, status: "complete", payment_status: "paid", amount_total: over.amount ?? 2500, currency: "usd", expires_at: Math.floor(Date.now() / 1000) + 3600, payment_intent: over.pi } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", over.badSig ? "whsec_wrong" : whsec).update(`${t}.${payload}`).digest("hex");
  return { payload, header: `t=${t},v1=${sig}` };
}
const postEvent = (e: { payload: string; header: string }) => fetch(`${appOrigin}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": e.header, "content-type": "application/json" }, body: e.payload });

test.describe.configure({ mode: "serial" });

test("S1 webhook replay, duplicate, forged signature and wrong-mode events change nothing", async ({ browser }) => {
  const { ctx } = await startPayment(browser, A);
  await expect.poll(() => seatOf(A.invitation), { timeout: 90_000 }).not.toBe("");
  const session = sessionOf(A.invitation); const pi = db(`select p.provider_payment_id from public.app_payments p join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${A.invitation}'`);
  const snap = () => db(`select (select count(*) from public.app_seats where invitation_id='${A.invitation}')||'|'||(select count(*) from public.app_payments p join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${A.invitation}')||'|'||(select p.amount_cents from public.app_payments p join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${A.invitation}')`);
  expect(snap()).toBe("1|1|2500");
  expect((await postEvent(signedEvent({ sessionId: session, pi, badSig: true }))).status).toBeGreaterThanOrEqual(400);
  expect((await postEvent(signedEvent({ sessionId: session, pi, livemode: true }))).status).toBeGreaterThanOrEqual(400);
  const dup = signedEvent({ sessionId: session, pi });
  const r1 = await postEvent(dup), r2 = await postEvent(dup);
  expect([r1.status, r2.status]).toEqual([200, 200]);
  expect(db(`select count(*) from public.app_stripe_checkout_events where event_id='${JSON.parse(dup.payload).id}'`)).toBe("1");
  const fresh = await postEvent(signedEvent({ sessionId: session, pi })); expect(fresh.status).toBe(200); // replay of a completed payment with a new event id
  const wrongAmount = await postEvent(signedEvent({ sessionId: session, pi, amount: 100 })); console.log("W077 wrong-amount event ->", wrongAmount.status);
  expect(snap()).toBe("1|1|2500");
  console.log("W077 S1 events:", db(`select string_agg(event_type||':'||state||':'||coalesce(result_code,''),', ') from public.app_stripe_checkout_events where session_id='${session}'`));
  await ctx.close();
});

test("S2 repeated cancellation is rejected, then a PARTIAL ($12.50) refund settles in Stripe", async ({ browser }) => {
  const seat = seatOf(A.invitation); expect(seat).not.toBe("");
  const ctx = await signedIn(browser, A.email);
  const first = await ctx.request.post(`${appOrigin}/api/me/seats/${seat}/cancellation-requests`, { headers: { origin: appOrigin }, data: { operationId: randomUUID(), memberReason: "first" } });
  expect(first.status()).toBe(200);
  const second = await ctx.request.post(`${appOrigin}/api/me/seats/${seat}/cancellation-requests`, { headers: { origin: appOrigin }, data: { operationId: randomUUID(), memberReason: "second" } });
  expect(second.status()).toBe(409);
  // approve the already-pending request (partial); helper posts a new request, so use the admin queue directly
  const admin = await signedIn(browser, fx.adminEmail); const ap = await admin.newPage();
  await ap.goto(`${appOrigin}/admin/cancellations`); await ap.getByRole("link", { name: "Review request" }).first().click();
  await expect(ap.getByRole("heading", { name: "Cancel this seat?" })).toBeVisible();
  await ap.getByLabel("Message to the guest").fill("Partial refund approved.");
  await ap.getByLabel("Partial refund").check(); await ap.getByLabel(/Refund amount in dollars/).fill("12.50");
  await ap.getByRole("button", { name: "Approve cancellation" }).click();
  await expect(ap.getByRole("alertdialog")).toContainText("$12.50");
  await ap.getByRole("button", { name: /^(Approve|Decline)$/ }).last().click();
  await expect(ap.getByRole("heading", { name: "Approved" })).toBeVisible();
  const ob = obligationOf(seat); expect(db(`select amount_cents from public.app_refund_obligations where obligation_id='${ob}'`)).toBe("1250");
  await sendRefund(ap, ob); expect(await workerPass()).toBe(200);
  await expect.poll(() => db(`select state from public.app_refund_obligations where obligation_id='${ob}'`), { timeout: 60_000, intervals: [2_000] }).toBe("succeeded");
  const reId = db(`select provider_refund_id from public.app_refund_operations where obligation_id='${ob}' and state='succeeded'`);
  const re = await stripe(`/refunds/${reId}`); expect(re.json.amount).toBe(1250);
  const again = await ctx.request.post(`${appOrigin}/api/me/seats/${seat}/cancellation-requests`, { headers: { origin: appOrigin }, data: { operationId: randomUUID(), memberReason: "after" } });
  expect(again.status()).toBe(409); // a cancelled Seat cannot be cancelled again
  await admin.close(); await ctx.close();
});

test("S3 Stripe rejects a refund for an already-refunded charge: obligation fails, stays visible, no retry button", async ({ browser }) => {
  const { ctx } = await startPayment(browser, B);
  await expect.poll(() => seatOf(B.invitation), { timeout: 90_000 }).not.toBe("");
  const seat = seatOf(B.invitation);
  const pi = db(`select p.provider_payment_id from public.app_payments p join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${B.invitation}'`);
  expect((await stripe("/refunds", "POST", { payment_intent: pi })).status).toBe(200); // refunded out-of-band, behind the app's back
  const { admin, ap } = await cancelAndApprove(browser, ctx, seat, {});
  const ob = obligationOf(seat); await sendRefund(ap, ob); await workerPass();
  await expect.poll(() => db(`select state from public.app_refund_obligations where obligation_id='${ob}'`), { timeout: 60_000, intervals: [2_000] }).toBe("failed");
  console.log("W077 S3 op:", db(`select state||':'||coalesce(safe_code,'') from public.app_refund_operations where obligation_id='${ob}'`));
  await ap.goto(`${appOrigin}/admin/refunds/${ob}`);
  await expect(ap.getByRole("heading", { name: "Failed" })).toBeVisible();
  await expect(ap.getByRole("button", { name: "Send refund", exact: true })).toHaveCount(0);
  await admin.close(); await ctx.close();
});

test("S4 abandoned checkout: expiring the Stripe session releases the hold via the real webhook, and payment can restart", async ({ browser }) => {
  const ctx = await signedIn(browser, C.email);
  const first = await beginApi(ctx, C.invitation); expect(first.status()).toBe(200);
  const session = sessionOf(C.invitation); expect(session).toMatch(/^cs_test_/);
  const before = db(`select state from public.app_checkout_attempts where invitation_id='${C.invitation}' order by created_at desc limit 1`);
  expect((await stripe(`/checkout/sessions/${session}/expire`, "POST", {})).status).toBe(200);
  await expect.poll(() => db(`select string_agg(event_type||':'||state||':'||coalesce(result_code,''),',') from public.app_stripe_checkout_events where session_id='${session}'`), { timeout: 60_000, intervals: [2_000] }).toMatch(/checkout\.session\.expired:(processed|ignored)/);
  const after = db(`select state from public.app_checkout_attempts where provider_session_id='${session}'`);
  console.log("W077 S4 attempt state", before, "->", after);
  expect(seatOf(C.invitation)).toBe("");
  const restart = await beginApi(ctx, C.invitation); expect(restart.status()).toBe(200);
  console.log("W077 S4 restart session reused:", sessionOf(C.invitation) === session, "| attempts:", db(`select string_agg(state,',' order by created_at) from public.app_checkout_attempts where invitation_id='${C.invitation}'`));
  await ctx.close();
});

test("S5 late charge: paying after the invitation was revoked creates no Seat and owes a full refund, which then settles", async ({ browser }) => {
  const { ctx } = await startPayment(browser, D, async () => {
    db(`update public.app_table_invitations set state='revoked', revoked_at=now() where invitation_id='${D.invitation}'`); // invitation revoked while the member is mid-payment
  }).catch((e) => { throw e; });
  const session = sessionOf(D.invitation);
  await expect.poll(() => db(`select string_agg(event_type||':'||state||':'||coalesce(result_code,''),',') from public.app_stripe_checkout_events where session_id='${session}'`), { timeout: 90_000, intervals: [2_000] }).toContain("processed");
  console.log("W077 S5 event:", db(`select string_agg(event_type||':'||state||':'||coalesce(result_code,''),',') from public.app_stripe_checkout_events where session_id='${session}'`));
  expect(seatOf(D.invitation)).toBe("");
  const ob = db(`select o.obligation_id||'|'||o.source||'|'||o.amount_cents from public.app_refund_obligations o join public.app_payments p on p.payment_id=o.payment_id join public.app_checkout_attempts a on a.attempt_id=p.attempt_id where a.invitation_id='${D.invitation}'`);
  expect(ob).toMatch(/\|late_checkout_ineligible\|2500$/);
  const id = ob.split("|")[0];
  const admin = await signedIn(browser, fx.adminEmail); const ap = await admin.newPage();
  await sendRefund(ap, id); await workerPass();
  await expect.poll(() => db(`select state from public.app_refund_obligations where obligation_id='${id}'`), { timeout: 60_000, intervals: [2_000] }).toBe("succeeded");
  await admin.close(); await ctx.close();
});

test("S6 last-slot concurrency: six members race for five slots; exactly five holds exist", async ({ browser }) => {
  expect(T2).toHaveLength(6);
  const ctxs = await Promise.all(T2.map((m) => signedIn(browser, m.email)));
  const results = await Promise.all(ctxs.map((c, i) => beginApi(c, T2[i].invitation)));
  const statuses = results.map((r) => r.status()).sort();
  console.log("W077 S6 statuses:", statuses.join(","));
  expect(statuses.filter((s) => s === 200)).toHaveLength(5);
  const holds = db(`select count(*) from public.app_checkout_attempts a where a.table_id='${fx.tables[1].id}' and a.hold_until > now() and a.state not in ('expired','abandoned','released','failed')`);
  console.log("W077 S6 live holds:", holds, "| attempts by state:", db(`select string_agg(state||'='||n,',') from (select state, count(*) n from public.app_checkout_attempts where table_id='${fx.tables[1].id}' group by 1) x`));
  expect(Number(holds)).toBe(5);
  expect(db(`select count(*) from public.app_seats where table_id='${fx.tables[1].id}'`)).toBe("0");
  await Promise.all(ctxs.map((c) => c.close()));
});
