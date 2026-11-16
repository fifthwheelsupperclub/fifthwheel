// W12 real-stack journey. Run only through `node scripts/run-w12-journey-browser.mjs` (guards, fixtures, Stripe TEST listener, cleanup).
// Stages run in order and share state; each stage asserts the database, the UI and (where relevant) Mailpit or Stripe.
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";
type Member = { key: string; first: string; last: string; email: string; guest: string; invitation: string; table: number };
const fx = JSON.parse(process.env.W12_FIXTURE!) as { db: string; mailpit: string; suffix: string; tag: string; adminEmail: string; hostEmail: string; hostId: string;
  members: Member[]; tables: { id: string; title: string; date: string; revision: string; venues: string[] }[] };
const M = Object.fromEntries(fx.members.map((m) => [m.key, m])) as Record<string, Member>;
const [T1, T2, T3, T4] = fx.tables;
const stripeHost = (h: string) => /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(h);

test.describe.configure({ mode: "serial" });

// ---- helpers (adapted from tests/browser/w077-helpers.ts, which binds to the W07.7 fixture at import) -----------------
function db(sql: string): string {
  const r = spawnSync("psql", [fx.db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.slice(0, 400)}`);
  return r.stdout.trim();
}
async function stripe(path: string) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  return await r.json() as Record<string, any>;
}
const contexts: BrowserContext[] = [];
async function signedIn(browser: Browser, email: string, withStripe = false): Promise<BrowserContext> {
  const pub = process.env.SUPABASE_PUBLISHABLE_KEY!, svc = process.env.SUPABASE_SECRET_KEY!;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  contexts.push(context);
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
const sessions = new Map<string, BrowserContext>();
async function as(browser: Browser, email: string, withStripe = false) {
  const key = `${email}:${withStripe}`;
  if (!sessions.has(key)) sessions.set(key, await signedIn(browser, email, withStripe));
  return sessions.get(key)!;
}
const post = (ctx: BrowserContext, path: string, data: unknown) => ctx.request.post(`${appOrigin}${path}`, { headers: { origin: appOrigin }, data });
async function body(r: APIResponse) { return await r.json().catch(() => null) as any; }

async function fillAndPay(page: Page, email: string) {
  await expect.poll(() => page.frames().some((f) => f.url().includes("embedded-checkout-inner")), { timeout: 60_000 }).toBe(true);
  const frame = page.frames().find((f) => f.url().includes("embedded-checkout-inner"))!;
  await frame.locator("#email").fill(email);
  await frame.getByTestId("card-accordion-item-button").dispatchEvent("click");
  await expect.poll(() => frame.getByPlaceholder("1234 1234 1234 1234").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await frame.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await frame.getByPlaceholder("MM / YY").fill("1234");
  await frame.getByPlaceholder("CVC").fill("123");
  const name = frame.getByPlaceholder("Full name on card"); if (await name.count()) await name.fill("W12 Member");
  const zip = frame.getByPlaceholder("ZIP"); if (await zip.count()) await zip.fill("30307");
  const save = frame.getByLabel(/Save my information with Link/);
  for (let i = 0; i < 3 && await save.count() && await save.isChecked(); i++) { await save.dispatchEvent("click"); await page.waitForTimeout(500); }
  await page.waitForTimeout(2_000);
  await frame.getByTestId("hosted-payment-submit-button").click();
}
async function pay(browser: Browser, m: Member, invitation = m.invitation) {
  const ctx = await as(browser, m.email, true); const page = await ctx.newPage();
  await page.goto(`${appOrigin}/invitations/${invitation}`);
  await page.getByRole("checkbox", { name: /I acknowledge this disclosure/ }).check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await fillAndPay(page, m.email);
  await expect.poll(() => seatOf(invitation), { timeout: 90_000 }).not.toBe("");
  await page.close();
  return seatOf(invitation);
}
const seatOf = (inv: string) => db(`select coalesce(max(seat_id::text),'') from public.app_seats where invitation_id='${inv}' and state<>'cancelled'`);
const invitationOf = (tableId: string, guest: string) => db(`select coalesce(max(invitation_id::text),'') from public.app_table_invitations where table_id='${tableId}' and guest_id='${guest}' and state='active'`);

async function workerPass() {
  const r = await fetch(`${appOrigin}/api/internal/worker`, { method: "POST", headers: { authorization: `Bearer ${process.env.JOB_SECRET}` } });
  const text = await r.text(); console.log("W12 worker:", r.status, text.slice(0, 300));
  return { status: r.status, summary: JSON.parse(text) as Record<string, any> };
}
type Mail = { ID: string; Subject: string; To: { Address: string }[] };
async function mailsTo(email: string): Promise<Mail[]> {
  const r = await fetch(`${fx.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`);
  return ((await r.json()) as { messages?: Mail[] }).messages ?? [];
}
async function expectMail(email: string, subject: RegExp) {
  await expect.poll(async () => {
    const found = (await mailsTo(email)).some((m) => subject.test(m.Subject));
    if (!found) await workerPass();
    return found;
  }, { timeout: 90_000, intervals: [1_000, 3_000, 5_000] }).toBe(true);
}
// Moves a Table's start (and every timestamp the vote derives from it) by whole minutes, as if the clock had moved forward.
function shiftTable(tableId: string, minutes: number) {
  db(`begin;
    update public.app_supply_table_revisions r set content=jsonb_set(jsonb_set(r.content,'{localDate}',to_jsonb(to_char(x.s,'YYYY-MM-DD'))),'{startLocalTime}',to_jsonb(to_char(x.s,'HH24:MI')))
      from (select (((r2.content->>'localDate')::date+(r2.content->>'startLocalTime')::time) - interval '${minutes} minutes') s from public.app_supply_table_heads h
        join public.app_supply_table_revisions r2 on r2.revision_id=h.published_revision_id where h.table_id='${tableId}') x
      where r.revision_id=(select published_revision_id from public.app_supply_table_heads where table_id='${tableId}');
    update public.app_table_attendance set checked_in_at=checked_in_at-interval '${minutes} minutes' where table_id='${tableId}';
    update public.app_vote_periods set opens_at=opens_at-interval '${minutes} minutes',closes_at=closes_at-interval '${minutes} minutes' where table_id='${tableId}';
    update public.app_ballots set submitted_at=submitted_at-interval '${minutes} minutes' where table_id='${tableId}';
    commit;`);
}
// Sets a Table's start to a minute-aligned instant `minutesFromNow` ahead (Atlanta wall time).
function setStart(tableId: string, minutesFromNow: number) {
  const s = db(`select to_char(date_trunc('minute',timezone('America/New_York',now()))+interval '${minutesFromNow} minutes','YYYY-MM-DD HH24:MI')`);
  const current = db(`select to_char((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time,'YYYY-MM-DD HH24:MI') from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id='${tableId}'`);
  shiftTable(tableId, Math.round((Date.parse(`${current}:00Z`) - Date.parse(`${s}:00Z`)) / 60_000));
}

const state: Record<string, string> = {};

test.afterAll(async () => { await Promise.all(contexts.map((c) => c.close().catch(() => undefined))); });

// Adds a waitlisted member to a Table through the admin placement queue; returns the exact POST body and the answer.
async function placeFromQueue(ap: Page, m: Member, table: { id: string; title: string }) {
  await ap.goto(`${appOrigin}/admin/waitlist`);
  await ap.locator("li.ops-card", { hasText: `${m.first} ${m.last}` }).getByRole("button", { name: "Add to Table…" }).click();
  const dialog = ap.getByRole("dialog", { name: `Add ${m.first} ${m.last} to a Table` });
  await dialog.getByLabel("Table").selectOption(table.id);
  const response = ap.waitForResponse((r) => r.url().endsWith("/api/admin/placements") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Add and send invitation" }).click();
  const answer = await response;
  expect(answer.status()).toBe(200);
  await expect(ap.getByText(`${m.first} was added and their invitation email is on its way.`)).toBeVisible();
  await expect(ap.locator("li.ops-card", { hasText: `${m.first} ${m.last}` })).toHaveCount(0); // placed people leave the queue
  return { sent: answer.request().postDataJSON() as Record<string, unknown>, data: ((await answer.json()) as { data: unknown }).data as { invitationId: string } };
}

// ---- Stage 1: placement from the waitlist queue ----------------------------------------------------------------------
test("stage 1: admin places four waitlisted members at a Table; replay creates no duplicates; a second placement is refused", async ({ browser }) => {
  const admin = await as(browser, fx.adminEmail);
  const ap = await admin.newPage();
  await ap.goto(`${appOrigin}/admin/staff-assignments`);
  const hostCard = ap.locator("li.ops-card", { hasText: fx.hostEmail });
  await hostCard.getByRole("checkbox", { name: new RegExp(T1.title) }).click(); // controlled: checked after the server confirms
  await expect(hostCard.getByRole("checkbox", { name: new RegExp(T1.title) })).toBeChecked();
  await expect.poll(() => db(`select count(*) from public.app_supply_table_assignments where table_id='${T1.id}' and user_id='${fx.hostId}'`)).toBe("1");

  const placements = [];
  for (const k of ["A", "B", "C", "D"]) placements.push(await placeFromQueue(ap, M[k], T1));
  expect(db(`select count(*) from public.app_table_invitations where table_id='${T1.id}' and state='active'`)).toBe("4");
  expect(db(`select count(*) from public.app_table_invitation_outbox o join public.app_table_invitations i using(invitation_id) where i.table_id='${T1.id}'`)).toBe("4");

  // Replay of the exact placement: same answer, no duplicate invitations or outbox rows.
  const replay = await post(admin, "/api/admin/placements", placements[0].sent);
  expect(replay.status()).toBe(200);
  expect((await body(replay))?.data?.invitationId).toBe(placements[0].data.invitationId);
  expect(db(`select count(*) from public.app_table_invitations where table_id='${T1.id}'`)).toBe("4");
  expect(db(`select count(*) from public.app_table_invitation_outbox o join public.app_table_invitations i using(invitation_id) where i.table_id='${T1.id}'`)).toBe("4");
  // A fresh operation for someone already at the Table is refused.
  const again = await post(admin, "/api/admin/placements", { ...placements[0].sent, operationId: randomUUID() });
  expect(again.status()).toBe(409);
  expect((await body(again))?.error?.reason).toBe("already_invited");
  for (const k of ["A", "B", "C", "D"]) state[`inv${k}`] = invitationOf(T1.id, M[k].guest);

  // The assigned host sees the Table and its invited count on their landing page.
  const hp = await (await as(browser, fx.hostEmail)).newPage();
  await hp.goto(`${appOrigin}/host/assigned-tables`);
  const hostTable = hp.locator("li.ops-card", { hasText: T1.title });
  await expect(hostTable.getByText("4 invited")).toBeVisible();
  await expect(hostTable.getByRole("link", { name: "Attendance" })).toHaveAttribute("href", `/host/attendance/${T1.id}`);
  await ap.close(); await hp.close();
});

// ---- Stage 2: four guests pay; Seat confirmed; email ------------------------------------------------------------------
test("stage 2: four guests pay in Stripe test mode; Seats confirmed; Seat-confirmed email arrives", async ({ browser }) => {
  await workerPass(); // delivers the four Table-invitation emails
  for (const k of ["A", "B", "C", "D"]) await expectMail(M[k].email, new RegExp(`${T1.title}`));
  for (const k of ["A", "B", "C", "D"]) {
    state[`seat${k}`] = await pay(browser, M[k], state[`inv${k}`]);
    expect(db(`select s.state||':'||p.amount_cents||':'||p.state from public.app_seats s join public.app_payments p using(payment_id) where s.seat_id='${state[`seat${k}`]}'`)).toBe("confirmed:2500:verified_paid");
  }
  for (const k of ["A", "B", "C", "D"]) await expectMail(M[k].email, new RegExp(`Your Seat is confirmed: ${T1.title}`));
  const ctx = await as(browser, M.A.email); const page = await ctx.newPage();
  await page.goto(`${appOrigin}/my-seats`);
  await expect(page.getByText(T1.title).first()).toBeVisible();
  await page.close();
});

// ---- Stage 3: T-24 proceed, host check-in, concurrent check-ins ------------------------------------------------------
test("stage 3: admin proceeds at T-24; host checks guests in; two simultaneous check-ins give one row", async ({ browser }) => {
  setStart(T1.id, 120);
  const admin = await as(browser, fx.adminEmail); const ap = await admin.newPage();
  await ap.goto(`${appOrigin}/admin/table-decisions`);
  const card = ap.locator("li.ops-card", { hasText: T1.title });
  await expect(card.getByText("4 paid guests")).toBeVisible();
  await card.getByRole("button", { name: "Confirm table" }).click();
  await card.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(card.getByText("Confirmed", { exact: true })).toBeVisible();
  expect(db(`select state from public.app_table_runtime where table_id='${T1.id}'`)).toBe("proceeding");

  const host = await as(browser, fx.hostEmail); const hp = await host.newPage();
  await hp.goto(`${appOrigin}/host/attendance/${T1.id}`);
  await expect(hp.getByText("0 of 4")).toBeVisible();
  for (const k of ["A", "B"]) {
    await hp.locator("li.ops-card", { hasText: M[k].first }).getByRole("button", { name: "Check in" }).click();
    await expect(hp.locator("li.ops-card", { hasText: M[k].first }).getByText(/Checked in/)).toBeVisible();
  }
  // Two simultaneous check-ins for the same Seat (host and admin): both succeed, one attendance row.
  const [h, a] = await Promise.all([post(host, `/api/host/tables/${T1.id}/check-in`, { seatId: state.seatC }), post(admin, `/api/host/tables/${T1.id}/check-in`, { seatId: state.seatC })]);
  expect([h.status(), a.status()]).toEqual([200, 200]);
  expect(db(`select count(*) from public.app_table_attendance where seat_id='${state.seatC}'`)).toBe("1");
  expect(db(`select count(*) from public.app_audit_events where action='table.attendance.checked_in' and subject_id='${state.seatC}'`)).toBe("1");
  await hp.reload();
  await hp.locator("li.ops-card", { hasText: M.D.first }).getByRole("button", { name: "Check in" }).click();
  await expect(hp.getByText("4 of 4")).toBeVisible();
  // Members see their own check-in on Tonight.
  const mp = await (await as(browser, M.A.email)).newPage();
  await mp.goto(`${appOrigin}/tonight/${T1.id}`);
  await expect(mp.getByText(/Voting opens at .* and closes at/)).toBeVisible();
  await mp.close(); await ap.close(); await hp.close();
});

// ---- Stage 4: vote, ballot race, reveal -----------------------------------------------------------------------------
async function vote(browser: Browser, m: Member, choice: string) {
  const page = await (await as(browser, m.email)).newPage();
  await page.goto(`${appOrigin}/tonight/${T1.id}`);
  await page.getByLabel(choice, { exact: true }).check();
  await page.getByRole("button", { name: "Review choice" }).click();
  await page.getByRole("button", { name: "Yes, submit" }).click();
  await expect(page.getByText(/Your choice was recorded/)).toBeVisible();
  await page.close();
}
test("stage 4: vote window; mutual pair, Nobody, ballot race; reveal after close", async ({ browser }) => {
  setStart(T1.id, -91); // vote window [start+90, start+120) is now open
  await vote(browser, M.A, M.B.first);
  await vote(browser, M.B, M.A.first);
  await vote(browser, M.C, "Nobody");
  // Two simultaneous DIFFERENT ballots from one guest: exactly one is stored, the other conflicts.
  const d = await as(browser, M.D.email);
  const results = await Promise.all([post(d, `/api/me/tables/${T1.id}/ballot`, { choiceGuestId: M.A.guest }), post(d, `/api/me/tables/${T1.id}/ballot`, { choiceGuestId: M.B.guest })]);
  expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  expect(db(`select count(*) from public.app_ballots b join public.app_member_profiles p on p.guest_id=b.voter_guest_id where b.table_id='${T1.id}' and p.guest_id='${M.D.guest}'`)).toBe("1");
  expect(db(`select count(*) from public.app_ballots where table_id='${T1.id}'`)).toBe("4");
  // Before close nothing is revealed.
  expect((await body(await d.request.get(`${appOrigin}/api/me/tables/${T1.id}/reveal`)))?.data?.state).toBe("pending");

  shiftTable(T1.id, 30); // the window has closed
  for (const [k, other] of [["A", "B"], ["B", "A"]]) {
    const page = await (await as(browser, M[k].email)).newPage();
    await page.goto(`${appOrigin}/tonight/${T1.id}`);
    await expect(page.getByText(`You and ${M[other].first} chose each other.`)).toBeVisible();
    await page.close();
  }
  const reveals: unknown[] = [];
  for (const k of ["C", "D"]) {
    const ctx = await as(browser, M[k].email); const page = await ctx.newPage();
    await page.goto(`${appOrigin}/tonight/${T1.id}`);
    await expect(page.getByText("No mutual match this time.")).toBeVisible();
    await expect(page.getByText(/chose each other/)).toHaveCount(0);
    reveals.push((await body(await ctx.request.get(`${appOrigin}/api/me/tables/${T1.id}/reveal`)))?.data);
    await page.close();
  }
  expect(reveals[0]).toEqual({ state: "revealed", match: null });
  expect(reveals[1]).toEqual(reveals[0]); // Nobody and one-way are indistinguishable
});

// ---- Stage 5: ratings, conduct report, admin triage ------------------------------------------------------------------
test("stage 5: rating and private conduct report saved; admin triages the report", async ({ browser }) => {
  const page = await (await as(browser, M.A.email)).newPage();
  await page.goto(`${appOrigin}/tonight/${T1.id}`);
  await page.getByLabel("4", { exact: true }).check();
  await page.getByLabel(new RegExp(`W12 drinks ${fx.tag}`)).selectOption("5");
  await page.getByLabel(/Anything you’d like to add/).fill("Lovely evening");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByText(/Saved\. You can change it any time/)).toBeVisible();
  expect(db(`select overall||':'||(venue_scores->>'${T1.venues[0]}')||':'||note from public.app_ratings where table_id='${T1.id}' and guest_id='${M.A.guest}'`)).toBe("4:5:Lovely evening");
  const reportText = `W12 private concern ${fx.tag}`;
  await page.getByLabel("About someone (optional)").selectOption(M.D.guest);
  await page.getByLabel("What happened?").fill(reportText);
  await page.getByRole("button", { name: "Send private report" }).click();
  await expect(page.getByText(/Report sent/)).toBeVisible();
  const reportId = db(`select report_id from public.app_conduct_reports where table_id='${T1.id}' and author_guest_id='${M.A.guest}' and subject_guest_id='${M.D.guest}'`);
  expect(reportId).toMatch(/^[0-9a-f-]{36}$/);
  await page.close();

  const ap = await (await as(browser, fx.adminEmail)).newPage();
  await ap.goto(`${appOrigin}/admin/conduct-reports`);
  const item = ap.locator("li.ops-card", { hasText: reportText });
  await expect(item).toBeVisible();
  await item.getByLabel("Status").selectOption("reviewing");
  await expect.poll(() => db(`select status from public.app_conduct_reports where report_id='${reportId}'`)).toBe("reviewing");
  await ap.reload();
  await expect(ap.locator("li.ops-card", { hasText: reportText }).getByLabel("Status")).toHaveValue("reviewing");
  await ap.close();
});

// ---- Stage 6: partial refund, then Table cancellation refunds only the remainder -------------------------------------
async function sendRefund(ap: Page, obligation: string) {
  await ap.goto(`${appOrigin}/admin/refunds/${obligation}`);
  try { await expect(ap.getByRole("heading", { name: "Owed, not sent" })).toBeVisible(); }
  catch (error) { // diagnostics for the record: the API answer and the ledger rows behind it
    const r = await ap.context().request.get(`${appOrigin}/api/admin/refunds/${obligation}`);
    console.log("W12 refund detail:", r.status(), (await r.text()).slice(0, 1500));
    console.log("W12 obligations:", db(`select json_agg(o) from public.app_refund_obligations o where payment_id=(select payment_id from public.app_refund_obligations where obligation_id='${obligation}')`));
    throw error;
  }
  await ap.getByRole("button", { name: "Send refund" }).click();
  await ap.getByRole("button", { name: "Send refund", exact: true }).last().click();
  await expect(ap.getByRole("heading", { name: "Queued" })).toBeVisible();
}
const obligations = (seat: string) => db(`select string_agg(o.source||':'||o.amount_cents||':'||o.state, ',' order by o.created_at) from public.app_refund_obligations o join public.app_seats s on s.payment_id=o.payment_id where s.seat_id='${seat}'`);
async function stripeRefunded(seat: string) {
  const pi = db(`select p.provider_payment_id from public.app_payments p join public.app_seats s on s.payment_id=p.payment_id where s.seat_id='${seat}'`);
  return (await stripe(`/payment_intents/${pi}?expand[]=latest_charge`)).latest_charge?.amount_refunded as number;
}
test("stage 6: partial refund, then admin cancels the Table; only the remainder is refunded; Table-cancelled email", async ({ browser }) => {
  state.seatE = await pay(browser, M.E);
  state.seatF = await pay(browser, M.F);
  const e = await as(browser, M.E.email);
  const req = await post(e, `/api/me/seats/${state.seatE}/cancellation-requests`, { operationId: randomUUID(), memberReason: "W12 partial" });
  expect(req.status()).toBe(200);
  const requestId = db(`select cancellation_request_id from public.app_seat_cancellation_requests where seat_id='${state.seatE}'`);
  const ap = await (await as(browser, fx.adminEmail)).newPage();
  await ap.goto(`${appOrigin}/admin/cancellations/${requestId}`);
  await expect(ap.getByRole("heading", { name: "Cancel this seat?" })).toBeVisible();
  await ap.getByLabel("Message to the guest").fill("Approved with a partial refund.");
  await ap.getByLabel("Partial refund").check();
  await ap.getByLabel(/Refund amount in dollars/).fill("10");
  await ap.getByRole("button", { name: "Approve cancellation" }).click();
  await ap.getByRole("button", { name: /^(Approve|Decline)$/ }).last().click();
  await expect(ap.getByRole("heading", { name: "Approved" })).toBeVisible();
  expect(obligations(state.seatE)).toBe("cancellation:1000:open");
  await sendRefund(ap, db(`select o.obligation_id from public.app_refund_obligations o join public.app_seats s on s.payment_id=o.payment_id where s.seat_id='${state.seatE}'`));
  await expect.poll(async () => { await workerPass(); return obligations(state.seatE); }, { timeout: 60_000 }).toBe("cancellation:1000:succeeded");
  expect(await stripeRefunded(state.seatE)).toBe(1000);

  await ap.goto(`${appOrigin}/admin/tables/${T2.id}`);
  await expect(ap.getByRole("heading", { name: T2.title, level: 1 })).toBeVisible(); // client data loaded, so the page is hydrated
  await ap.getByRole("button", { name: "Cancel table…" }).click();
  const dialog = ap.getByRole("dialog", { name: "Cancel this table?" });
  await dialog.getByLabel("Reason (only staff see this)").fill("W12 journey cancellation");
  await dialog.getByRole("button", { name: "Cancel table", exact: true }).click();
  await expect(ap.getByRole("heading", { name: "Table cancelled" })).toBeVisible();
  await expect(ap.getByText("1 seat cancelled, $40.00 in refunds to send.")).toBeVisible();
  expect(obligations(state.seatE)).toBe("cancellation:1000:succeeded,table_cancellation:1500:open");
  expect(obligations(state.seatF)).toBe("table_cancellation:2500:open");
  for (const seat of [state.seatE, state.seatF]) {
    await sendRefund(ap, db(`select o.obligation_id from public.app_refund_obligations o join public.app_seats s on s.payment_id=o.payment_id where s.seat_id='${seat}' and o.source='table_cancellation'`));
  }
  await expect.poll(async () => { await workerPass(); return [obligations(state.seatE), obligations(state.seatF)].join("|"); }, { timeout: 60_000 })
    .toBe("cancellation:1000:succeeded,table_cancellation:1500:succeeded|table_cancellation:2500:succeeded");
  expect(await stripeRefunded(state.seatE)).toBe(2500); // 1000 + 1500, never more than was paid
  expect(await stripeRefunded(state.seatF)).toBe(2500);
  for (const k of ["F", "G"]) await expectMail(M[k].email, new RegExp(`${T2.title} has been cancelled`));
  await ap.close();
});

// ---- Stage 7: removal, then the seat is filled from the waitlist queue -----------------------------------------------
async function openRemoval(ap: Page, m: Member) {
  await ap.goto(`${appOrigin}/admin/table-invitations`);
  const card = ap.locator("article.admin-invitation-card", { hasText: `${m.first} ${m.last}` }).filter({ hasText: "OPEN" });
  for (let i = 0; i < 20 && !(await card.count()); i++) {
    const more = ap.getByRole("button", { name: /Load more/ });
    if (!(await more.count())) break;
    await more.click(); await ap.waitForTimeout(500);
  }
  await card.getByRole("button", { name: "Remove from Table…" }).click();
  return ap.getByRole("dialog");
}
test("stage 7: removal sends no replacement; the admin fills the seat from the waitlist queue", async ({ browser }) => {
  const ap = await (await as(browser, fx.adminEmail)).newPage();
  const dialog = await openRemoval(ap, M.I);
  await expect(dialog.getByRole("heading", { name: `Remove ${M.I.first} ${M.I.last} from this table?` })).toBeVisible();
  await expect(dialog.getByLabel("Refund ($0–$25)")).toHaveValue("0");
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: `${M.I.first} ${M.I.last} was removed` })).toBeVisible();
  await expect(dialog.getByText(/To fill the seat, add someone from the/)).toBeVisible();
  await expect(dialog.getByRole("link", { name: "waitlist queue" })).toHaveAttribute("href", "/admin/waitlist");
  expect(db(`select state from public.app_table_invitations where invitation_id='${M.I.invitation}'`)).not.toBe("active");
  expect(db(`select count(*) from public.app_table_invitations where table_id='${T3.id}' and state='active'`)).toBe("3");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expectMail(M.I.email, new RegExp(`Your place at ${T3.title}`));

  await placeFromQueue(ap, M.M, T3);
  expect(invitationOf(T3.id, M.M.guest)).toMatch(/^[0-9a-f-]{36}$/);
  expect(db(`select count(*) from public.app_table_invitations where table_id='${T3.id}' and state='active'`)).toBe("4");
  await expectMail(M.M.email, new RegExp(`You’re invited: ${T3.title}`));
  await ap.close();
});

// ---- Stage 8: T-48 reminder ------------------------------------------------------------------------------------------
test("stage 8: T-48 reminder reaches an unpaid invitation holder through Mailpit", async () => {
  setStart(T3.id, 36 * 60);
  await expectMail(M.K.email, new RegExp(`Reminder: your Table invitation for ${T3.title}`));
  expect(db(`select count(*) from public.app_notice_outbox where kind='t48_reminder' and dedupe_key='t48:${M.K.invitation}'`)).toBe("1");
  await workerPass(); // replays are harmless: still one reminder
  expect((await mailsTo(M.K.email)).filter((m) => /Reminder:/.test(m.Subject))).toHaveLength(1);
});

// ---- Stage 9: browser edge cases --------------------------------------------------------------------------------------
test("stage 9a (W05.4): a schedule edit on a published Table with invitations is refused", async ({ browser }) => {
  const before = db(`select r.content::text from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id='${T4.id}'`);
  const ap = await (await as(browser, fx.adminEmail)).newPage();
  await ap.goto(`${appOrigin}/admin/tables/${T4.id}`);
  await expect(ap.getByRole("heading", { name: T4.title, level: 1 })).toBeVisible();
  await ap.getByLabel("Atlanta local start time").fill("20:30");
  await ap.getByRole("button", { name: /^Save/ }).click();
  await expect(ap.getByText(/schedule and venue changes require cancellation and a new Table/)).toBeVisible();
  expect(db(`select r.content::text from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id='${T4.id}'`)).toBe(before);
  // The same edit on the Table filled by placement in the browser (stage 1) is refused by the API too.
  const admin = await as(browser, fx.adminEmail);
  const draft = db(`select r.revision_id||'|'||r.revision||'|'||r.content::text from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id where h.table_id='${T1.id}'`);
  const [draftId, revision, content] = [draft.split("|")[0], Number(draft.split("|")[1]), JSON.parse(draft.split("|").slice(2).join("|"))];
  const venueSwap = { ...content, stops: content.stops.map((s: Record<string, unknown>, i: number) => i === 0 ? { ...s, venueId: T1.venues[1] } : s) };
  const r = await admin.request.put(`${appOrigin}/api/supply/drafts/${draftId}`, { headers: { origin: appOrigin }, data: { operationId: randomUUID(), expectedDraftRevision: revision, content: venueSwap } });
  expect(r.status()).toBe(409);
  expect((await body(r))?.error?.code).toBe("protected_change");
  await ap.close();
});

test("stage 9b: My Seats refresh/back keeps a safe state; calendar export refused for cancelled and past Seats", async ({ browser }) => {
  const e = await as(browser, M.E.email); const page = await e.newPage();
  await page.goto(`${appOrigin}/my-seats`);
  await expect(page.getByRole("heading", { name: "My Seats" })).toBeVisible();
  await page.goto(`${appOrigin}/my-seats/${state.seatE}`);
  await expect(page.getByRole("heading", { name: T2.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "My Seats" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: T2.title })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: T2.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveCount(0);
  expect((await e.request.get(`${appOrigin}/api/me/seats/${state.seatE}/calendar.ics`)).status()).toBe(409); // cancelled
  const a = await as(browser, M.A.email);
  expect((await a.request.get(`${appOrigin}/api/me/seats/${state.seatA}/calendar.ics`)).status()).toBe(409); // past
  // Another member cannot read someone else's Seat or its calendar.
  expect((await a.request.get(`${appOrigin}/api/me/seats/${state.seatE}`)).status()).toBe(404);
  await page.close();
});
