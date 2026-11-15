import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export const appOrigin = "http://127.0.0.1:8086";
export const supabaseOrigin = "http://127.0.0.1:57421";
export const fx = JSON.parse(process.env.W077_FIXTURE!) as { db: string; adminEmail: string; members: { email: string; invitation: string; table: number }[]; tables: { id: string; title: string }[] };
export const stripeKey = process.env.STRIPE_SECRET_KEY!;
export const whsec = process.env.STRIPE_WEBHOOK_SECRET!;
export const stripeHost = (h: string) => /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(h);
export const [A, B, C, D] = fx.members.slice(0, 4);
export const T2 = fx.members.slice(4);

export function db(sql: string): string {
  const r = spawnSync("psql", [fx.db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.slice(0, 300)}`);
  return r.stdout.trim();
}
export async function stripe(path: string, method = "GET", body?: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${stripeKey}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, ...(body ? { body: new URLSearchParams(body) } : {}) });
  return { status: r.status, json: await r.json() as Record<string, any> };
}
export async function signedIn(browser: Browser, email: string, withStripe = false): Promise<BrowserContext> {
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
export const beginApi = (ctx: BrowserContext, invitation: string, operationId: string = randomUUID()) => ctx.request.post(`${appOrigin}/api/me/table-invitations/${invitation}/checkout`, {
  headers: { origin: appOrigin }, data: { operationId, expectedProposalRevision: 1, expectedProfileRevision: 1, acceptedDisclosureVersion: "seat-checkout-v1" } });

export async function fillAndPay(page: Page, email: string, beforePay?: () => Promise<void>) {
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
export async function startPayment(browser: Browser, m: { email: string; invitation: string }, beforePay?: () => Promise<void>) {
  const ctx = await signedIn(browser, m.email, true); const page = await ctx.newPage();
  await page.goto(`${appOrigin}/invitations/${m.invitation}`);
  await page.getByRole("checkbox", { name: /I acknowledge this disclosure/ }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await fillAndPay(page, m.email, beforePay);
  return { ctx, page };
}
export const seatOf = (inv: string) => db(`select coalesce(max(seat_id::text),'') from public.app_seats where invitation_id='${inv}'`);
export const sessionOf = (inv: string) => db(`select provider_session_id from public.app_checkout_attempts where invitation_id='${inv}' and provider_session_id is not null order by created_at desc limit 1`);

export async function cancelAndApprove(browser: Browser, memberCtx: BrowserContext, seatId: string, refund: { partial?: string }) {
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
export async function sendRefund(ap: Page, obligation: string) {
  await ap.goto(`${appOrigin}/admin/refunds/${obligation}`);
  await expect(ap.getByRole("heading", { name: "Owed, not sent" })).toBeVisible();
  await ap.getByRole("button", { name: "Send refund" }).click();
  await ap.getByRole("button", { name: "Send refund", exact: true }).last().click();
  await expect(ap.getByRole("heading", { name: "Queued" })).toBeVisible();
}
export async function workerPass() {
  const r = await fetch(`${appOrigin}/api/internal/worker`, { method: "POST", headers: { authorization: `Bearer ${process.env.JOB_SECRET}` } });
  const body = await r.text(); console.log("W077 worker:", r.status, body.slice(0, 160)); return r.status;
}
export const obligationOf = (seat: string) => db(`select o.obligation_id from public.app_refund_obligations o join public.app_seats s on s.payment_id=o.payment_id where s.seat_id='${seat}' order by o.created_at desc limit 1`);
export function signedEvent(over: { sessionId: string; pi: string; amount?: number; livemode?: boolean; id?: string; type?: string; badSig?: boolean; status?: string; paymentStatus?: string }) {
  const livemode = over.livemode ?? false;
  const payload = JSON.stringify({ id: over.id ?? `evt_w077${randomUUID().replaceAll("-", "").slice(0, 20)}`, object: "event", type: over.type ?? "checkout.session.completed", created: Math.floor(Date.now() / 1000), livemode,
    data: { object: { id: over.sessionId, object: "checkout.session", livemode, status: over.status ?? "complete", payment_status: over.paymentStatus ?? "paid", amount_total: over.amount ?? 2500, currency: "usd", expires_at: Math.floor(Date.now() / 1000) + 3600, payment_intent: over.pi } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", over.badSig ? "whsec_wrong" : whsec).update(`${t}.${payload}`).digest("hex");
  return { payload, header: `t=${t},v1=${sig}` };
}
export const postEvent = (e: { payload: string; header: string }) => fetch(`${appOrigin}/api/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": e.header, "content-type": "application/json" }, body: e.payload });

