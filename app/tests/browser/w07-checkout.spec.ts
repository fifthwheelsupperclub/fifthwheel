import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";
const shots = resolve("docs/implementation/screenshots");
const invitationId = process.env.W07_INVITATION_ID!;
const dbUrl = process.env.W07_DB_URL!;
const stripeHost = (h: string) => /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(h);

function db(sql: string): string {
  const r = spawnSync("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } });
  if (r.status !== 0) throw new Error("psql failed");
  return r.stdout.trim();
}

async function signedIn(browser: import("@playwright/test").Browser, email: string) {
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY!, svc = process.env.SUPABASE_SECRET_KEY!;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.origin === appOrigin || u.origin === supabaseOrigin ? route.continue() : route.abort();
  });
  const gen = await context.request.post(`${supabaseOrigin}/auth/v1/admin/generate_link`, {
    headers: { apikey: svc, authorization: `Bearer ${svc}`, "content-type": "application/json" },
    data: { type: "magiclink", email, redirect_to: `${appOrigin}/auth/callback` } });
  const hashed = ((await gen.json()) as { hashed_token?: string }).hashed_token;
  const ver = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, { headers: { apikey: pub, "content-type": "application/json" }, data: { token_hash: hashed, type: "magiclink" } });
  const session = (await ver.json()) as { access_token: string; refresh_token: string };
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

test("W07 member pays $25 (Stripe test mode), cancels, admin approves full refund, Stripe refunds", async ({ browser }) => {
  const email = process.env.W07_MEMBER_EMAIL!, pub = process.env.SUPABASE_PUBLISHABLE_KEY!, svc = process.env.SUPABASE_SECRET_KEY!;
  await mkdir(shots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 2400 } });
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.origin === appOrigin || u.origin === supabaseOrigin || stripeHost(u.hostname) ? route.continue() : route.abort();
  });
  const gen = await context.request.post(`${supabaseOrigin}/auth/v1/admin/generate_link`, {
    headers: { apikey: svc, authorization: `Bearer ${svc}`, "content-type": "application/json" },
    data: { type: "magiclink", email, redirect_to: `${appOrigin}/auth/callback` } });
  const hashed = ((await gen.json()) as { hashed_token?: string }).hashed_token;
  const ver = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, { headers: { apikey: pub, "content-type": "application/json" }, data: { token_hash: hashed, type: "magiclink" } });
  const session = (await ver.json()) as { access_token: string; refresh_token: string; user: { email: string } };
  expect(session.user.email.toLowerCase()).toBe(email.toLowerCase());
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);

  const page = await context.newPage();
  page.on("response", async (r) => { if (r.url().includes("/checkout") || r.url().includes("/api/me/seats") || r.url().includes("stripe.com/v1/payment_pages")) console.log("W07 net", r.request().method(), r.status(), r.url().slice(0, 110), (r.status() >= 400 || r.url().includes("/api/me/seats")) ? (await r.text().catch(() => "")).slice(0, 1800) : ""); });
  page.on("console", (m) => { if (m.type() === "error") console.log("W07 console:", m.text().slice(0, 300)); });
  await page.goto(`${appOrigin}/invitations/${invitationId}`);
  await page.getByRole("checkbox", { name: /I acknowledge this disclosure/ }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect.poll(() => page.frames().some((f) => f.url().includes("embedded-checkout-inner")), { timeout: 60_000 }).toBe(true);
  const frame = page.frames().find((f) => f.url().includes("embedded-checkout-inner"))!;
  await frame.locator("#email").fill(email);
  await frame.getByTestId("card-accordion-item-button").dispatchEvent("click");
  await expect.poll(() => frame.getByPlaceholder("1234 1234 1234 1234").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await frame.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await frame.getByPlaceholder("MM / YY").fill("1234");
  await frame.getByPlaceholder("CVC").fill("123");
  const name = frame.getByPlaceholder("Full name on card");
  if (await name.count()) await name.fill("W07 Test Member");
  const zip = frame.getByPlaceholder("ZIP");
  if (await zip.count()) await zip.fill("30307");
  const saveLink = frame.getByLabel(/Save my information with Link/);
  if (await saveLink.count()) await saveLink.uncheck();
  await page.waitForTimeout(2_000); // let Stripe finish validating the card fields
  await frame.getByTestId("hosted-payment-submit-button").click();

  await expect(page.getByText("Seat confirmed", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: resolve(shots, "w07-real-checkout-seat-confirmed-desktop.png"), fullPage: true });

  // Money/ledger truth from the database, not the UI.
  const seat = db(`select p.amount_cents||'|'||p.currency||'|'||s.state from public.app_seats s join public.app_payments p on p.payment_id=s.payment_id where s.invitation_id='${invitationId}'`);
  expect(seat).toMatch(/^2500\|usd\|/i);
  expect(db(`select count(*) from public.app_seats where invitation_id='${invitationId}'`)).toBe("1");
  // The signed webhook path must have been exercised and processed.
  await expect.poll(() => db(`select string_agg(distinct e.state,',') from public.app_stripe_checkout_events e join public.app_checkout_attempts a on a.provider_session_id=e.session_id where a.invitation_id='${invitationId}'`), { timeout: 30_000 }).not.toBe("");
  console.log("W07 webhook event states:", db(`select string_agg(e.event_type||':'||e.state||':'||coalesce(e.result_code,''),', ') from public.app_stripe_checkout_events e join public.app_checkout_attempts a on a.provider_session_id=e.session_id where a.invitation_id='${invitationId}'`));

  await page.goto(`${appOrigin}/my-seats`);
  await expect(page.getByText("W07 Checkout Dinner").first()).toBeVisible();
  await page.screenshot({ path: resolve(shots, "w07-real-my-seats-desktop.png"), fullPage: true });

  // ---- Cancellation → admin approval (full refund) → Stripe refund → member sees it ----
  const seatId = db(`select seat_id from public.app_seats where invitation_id='${invitationId}'`);
  await page.goto(`${appOrigin}/my-seats/${seatId}/cancellation`);
  await expect(page.getByRole("heading", { name: "Ask to cancel this seat" })).toBeVisible();
  await page.getByLabel("Anything we should know? (optional)").fill("W07 journey: plans changed.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect.poll(() => db(`select state from public.app_seat_cancellation_requests where seat_id='${seatId}'`), { timeout: 20_000 }).toMatch(/pending|requested/);
  expect(db(`select state from public.app_seats where seat_id='${seatId}'`)).toBe("cancellation_requested"); // request alone never cancels the Seat

  const admin = await signedIn(browser, process.env.W07_ADMIN_EMAIL!);
  const ap = await admin.newPage();
  ap.on("response", async (r) => { if (r.url().includes("/api/admin/") && r.request().method() !== "GET") console.log("W07 admin", r.request().method(), r.status(), r.url().replace(appOrigin, ""), r.status() >= 400 ? (await r.text().catch(() => "")).slice(0, 300) : ""); });
  await ap.goto(`${appOrigin}/admin/cancellations`);
  await ap.getByRole("link", { name: "Review request" }).first().click();
  await expect(ap.getByRole("heading", { name: "Cancel this seat?" })).toBeVisible();
  await ap.getByLabel("Message to the guest").fill("Approved: full refund.");
  await ap.getByLabel(/Full refund/).check();
  await ap.getByRole("button", { name: "Approve cancellation" }).click();
  await expect(ap.getByRole("alertdialog")).toContainText("$25.00 refund");
  await ap.getByRole("button", { name: /^(Approve|Decline)$/ }).last().click();
  await expect(ap.getByRole("heading", { name: "Approved" })).toBeVisible();
  expect(db(`select state from public.app_seats where seat_id='${seatId}'`)).not.toBe("confirmed");
  const obligation = db(`select o.obligation_id from public.app_refund_obligations o join public.app_seats s on s.payment_id=o.payment_id where s.seat_id='${seatId}'`);
  expect(obligation).toMatch(/^[0-9a-f-]{36}$/);

  await ap.goto(`${appOrigin}/admin/refunds/${obligation}`);
  await expect(ap.getByRole("heading", { name: "Owed, not sent" })).toBeVisible();
  await ap.getByRole("button", { name: "Send refund" }).click();
  await ap.getByRole("button", { name: "Send refund", exact: true }).last().click();
  await expect(ap.getByRole("heading", { name: "Queued" })).toBeVisible();
  await ap.screenshot({ path: resolve(shots, "w07-real-refund-queued-desktop.png"), fullPage: true });

  // Drain the refund queue the way the scheduler does: authenticated worker pass.
  const pass = await fetch(`${appOrigin}/api/internal/worker`, { method: "POST", headers: { authorization: `Bearer ${process.env.JOB_SECRET}` } });
  console.log("W07 worker pass:", pass.status, (await pass.text()).slice(0, 400));
  console.log("W07 refund ops:", db(`select string_agg(x.state||':'||coalesce(x.safe_code,'')||':'||coalesce(x.provider_refund_id,''),', ') from public.app_refund_operations x join public.app_payments p on p.payment_id=x.payment_id join public.app_seats s on s.payment_id=p.payment_id where s.seat_id='${seatId}'`));
  // Ledger truth: obligation settles; Stripe holds the refund. Poll the DB (worker/dispatch), not the UI.
  await expect.poll(() => db(`select state from public.app_refund_obligations where obligation_id='${obligation}'`), { timeout: 60_000, intervals: [2_000] }).toBe("succeeded");
  console.log("W07 refund final state:", db(`select o.state||'|'||o.amount_cents||'|'||coalesce((select string_agg(x.state||':'||coalesce(x.provider_refund_id,''),',') from public.app_refund_operations x where x.obligation_id=o.obligation_id),'') from public.app_refund_obligations o where o.obligation_id='${obligation}'`));
  await page.goto(`${appOrigin}/my-seats/${seatId}`);
  await page.screenshot({ path: resolve(shots, "w07-real-seat-cancelled-refund-desktop.png"), fullPage: true });
  await admin.close();
  await context.close();
});
