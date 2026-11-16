// W03 real-stack journey. Run only through `node scripts/run-w03-browser.mjs` (guards, run-scoped fixtures, cleanup).
// Marketing waitlist signup -> confirmation email -> admin sees them in the placement queue -> "Add to Table…" ->
// invitation email -> the guest signs in from the invitation link and lands on the invitation. No staff approval step.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";
const marketingOrigin = "http://127.0.0.1:4322";
const mailpitOrigin = "http://127.0.0.1:57424";
const supabaseOrigin = "http://127.0.0.1:57421";
const testDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const screenshotDirectory = "docs/implementation/screenshots";
const confirmationSubject = "You’re on the Fifth Wheel waitlist";
const signInSubject = "Your Fifth Wheel sign-in link";
// Valid-shaped placement body: the handler validates input before the role check, so denials must use this shape.
const probePlacement = { signupId: "a1d72117-e0b1-4423-a108-24e24582dc5a", tableId: "a1d72117-e0b1-4423-a108-24e24582dc5c", operationId: "a1d72117-e0b1-4423-a108-24e24582dc5b", acknowledgeWarnings: false };

async function guardPageRequests(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const isAllowedLocalOrigin = requestUrl.protocol === "http:"
      && requestUrl.hostname === "127.0.0.1"
      && ["8086", "4322"].includes(requestUrl.port);
    if (isAllowedLocalOrigin) await route.continue();
    else await route.abort("blockedbyclient");
  });
}

function fixtureValue(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing run-scoped browser fixture ${name}`);
  return value;
}

async function saveMilestoneScreenshot(page: Page, fileName: string) {
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}/${fileName}` });
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function queryTestDatabase(sql: string): unknown {
  // This helper refuses every target except the dedicated local W03 database.
  // The runner sets this value only after checking the test project/ports.
  if (fixtureValue("W03_TEST_DB_URL") !== testDatabaseUrl) {
    throw new Error("refusing non-test database in W03 browser query");
  }
  const output = execFileSync("psql", [testDatabaseUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: "postgres" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try { return JSON.parse(output); }
  catch { throw new Error("local W03 database query returned invalid JSON"); }
}

function requireRunEmail(email: string) {
  if (!/^[a-z0-9._+-]+@example\.test$/.test(email)) throw new Error("W03 DB helper requires a run-scoped synthetic email");
}

function readWaitlistSignup(email: string): Record<string, unknown> | null {
  requireRunEmail(email);
  const result = queryTestDatabase(`select coalesce((
    select to_jsonb(signup) from public.waitlist_signups as signup
    where signup.email_normalized = ${sqlLiteral(email)}
  ), 'null'::jsonb)::text`);
  if (result === null) return null;
  if (!isRecord(result)) throw new Error("local W03 database returned an invalid signup row");
  return result;
}

// Admission, confirmation email, placement and activation state for one run-scoped email.
function readPlacementSnapshot(email: string): Record<string, unknown> {
  requireRunEmail(email);
  const result = queryTestDatabase(`with target as (
    select admission.id, admission.state, admission.auth_user_id
    from public.app_admissions as admission
    where admission.email_normalized = ${sqlLiteral(email)}
  ), invitation as (
    select i.invitation_id, i.state, i.table_id from public.app_table_invitations i
    join public.app_member_profiles p on p.guest_id = i.guest_id
    join target on target.id = p.admission_id
  )
  select jsonb_build_object(
    'admission_count', (select count(*) from target),
    'admissions', coalesce((select jsonb_agg(jsonb_build_object('id', target.id, 'state', target.state) order by target.id) from target), '[]'::jsonb),
    'confirmation_count', (select count(*) from public.app_notice_outbox n where n.kind = 'waitlist_confirmed' and n.recipient_email = ${sqlLiteral(email)}),
    'profile_count', (select count(*) from public.app_member_profiles p join target on target.id = p.admission_id),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', invitation.invitation_id, 'state', invitation.state, 'table_id', invitation.table_id)) from invitation), '[]'::jsonb),
    'invitation_outbox_count', (select count(*) from public.app_table_invitation_outbox o join invitation on invitation.invitation_id = o.invitation_id),
    'activation_audit_count', (
      select count(*) from public.app_audit_events as audit
      join target on target.id = audit.subject_id
      where audit.action = 'app.admission.activated'
    )
  )::text`);
  if (!isRecord(result)) throw new Error("local W03 database returned an invalid placement snapshot");
  return result;
}

// Test setup standing in for the 5-minute per-recipient link cooldown elapsing between two sign-ins in one run.
function expireLinkCooldown(email: string) {
  requireRunEmail(email);
  queryTestDatabase(`with removed as (
    delete from public.app_member_link_cooldowns c using public.app_admissions a
    where a.id = c.admission_id and a.email_normalized = ${sqlLiteral(email)} returning 1
  ) select jsonb_build_object('removed', (select count(*) from removed))::text`);
}

// One authenticated pass of the app's scheduler endpoint: sends queued confirmation and invitation emails.
async function runWorkerPass() {
  const response = await fetch(`${appOrigin}/api/internal/worker`, { method: "POST", headers: { authorization: `Bearer ${fixtureValue("JOB_SECRET")}` }, cache: "no-store" });
  if (response.status === 401) throw new Error("the app worker refused the run-scoped JOB_SECRET");
}

async function listMailpitMessages(): Promise<unknown[]> {
  const response = await fetch(`${mailpitOrigin}/api/v1/messages?limit=100`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Mailpit message list failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("Mailpit returned an invalid message list");
  return body.messages;
}

async function waitForMailpitMessage(email: string, subjectPart: string, options: Readonly<{ runWorker?: boolean }> = {}) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    // Mailpit lists newest first, so this is the latest matching message.
    const match = (await listMailpitMessages()).find((item) =>
      isRecord(item)
      && typeof item.ID === "string"
      && typeof item.Subject === "string"
      && item.Subject.includes(subjectPart)
      && hasRecipient(item.To, email),
    );
    if (isRecord(match) && typeof match.ID === "string") {
      const messageResponse = await fetch(`${mailpitOrigin}/api/v1/message/${encodeURIComponent(match.ID)}`, { cache: "no-store" });
      if (!messageResponse.ok) throw new Error(`Mailpit message retrieval failed (${messageResponse.status})`);
      const message: unknown = await messageResponse.json();
      if (isRecord(message) && hasRecipient(message.To, email) && typeof message.HTML === "string") return message;
    }
    if (options.runWorker) await runWorkerPass();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No intercepted ${subjectPart} message arrived for the run-scoped recipient`);
}

async function countMailpitRecipientMessages(email: string, subjectPart?: string) {
  return (await listMailpitMessages()).filter((item) => isRecord(item)
    && hasRecipient(item.To, email)
    && (subjectPart === undefined || (typeof item.Subject === "string" && item.Subject.includes(subjectPart)))).length;
}

async function mailpitHasRecipientMessage(email: string, subjectPart?: string) {
  return (await countMailpitRecipientMessages(email, subjectPart)) > 0;
}

function hasRecipient(value: unknown, email: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((recipient) => isRecord(recipient)
    && typeof recipient.Address === "string"
    && recipient.Address.trim().toLowerCase() === email.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Renders the exact intercepted Mailpit HTML in `context` and clicks its real anchor; no session or token is injected.
async function openEmailLink(context: BrowserContext, message: Record<string, unknown>, label: string): Promise<{ page: Page; href: string }> {
  const page = await context.newPage();
  await page.setContent(message.HTML as string);
  const link = page.getByRole("link", { name: label, exact: true });
  await expect(link).toHaveCount(1);
  const href = await link.getAttribute("href");
  if (!href) throw new Error(`the ${label} link has no href`);
  await link.click();
  return { page, href };
}

type CallbackOptions = Readonly<{ extraVerifyFields?: Readonly<Record<string, unknown>> }>;

// Opens a one-time sign-in link and presses Continue on the callback page. Returns the verify-link response status.
async function redeemSignInLink(context: BrowserContext, message: Record<string, unknown>, options: CallbackOptions = {}) {
  if (options.extraVerifyFields) {
    await context.route(`${appOrigin}/api/auth/verify-link`, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      let body: unknown;
      try { body = route.request().postDataJSON(); }
      catch { return route.continue(); }
      if (!isRecord(body)) return route.continue();
      return route.continue({ postData: JSON.stringify({ ...body, ...options.extraVerifyFields }) });
    });
  }
  const { page, href } = await openEmailLink(context, message, "Continue to Fifth Wheel");
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:8086\/auth\/callback\?token_hash=[A-Za-z0-9_-]{16,512}&type=(invite|magiclink)/);
  await page.waitForURL(`${appOrigin}/auth/callback**`);
  await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  const verify = page.waitForResponse((response) => response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  return { page, href, status: (await verify).status() };
}

async function newGuardedContext(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardPageRequests(context);
  return context;
}

async function addLocalAuthFixtureSession(context: BrowserContext, emailEnv: string) {
  const email = fixtureValue(emailEnv);
  const publishableKey = fixtureValue("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = fixtureValue("SUPABASE_SECRET_KEY");
  const localCallback = `${appOrigin}/auth/callback`;
  const generated = await context.request.post(`${supabaseOrigin}/auth/v1/admin/generate_link`, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, "content-type": "application/json" },
    data: { type: "magiclink", email, redirect_to: localCallback },
  });
  if (!generated.ok()) throw new Error(`local Auth fixture link generation failed (HTTP ${generated.status()})`);
  const generatedBody: unknown = await generated.json();
  if (!isRecord(generatedBody)
    || typeof generatedBody.email !== "string"
    || generatedBody.email.trim().toLowerCase() !== email.toLowerCase()
    || typeof generatedBody.hashed_token !== "string"
    || generatedBody.hashed_token.length < 16
    || generatedBody.redirect_to !== localCallback) {
    throw new Error("local Auth fixture link generation returned an invalid response");
  }

  // Test-only session setup for authorization probes. The guest flow below redeems actual Mailpit links through the app callback.
  const verified = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, {
    headers: { apikey: publishableKey, "content-type": "application/json" },
    data: { token_hash: generatedBody.hashed_token, type: "magiclink" },
  });
  if (!verified.ok()) throw new Error(`local Auth fixture verification failed (HTTP ${verified.status()})`);
  const session: unknown = await verified.json();
  if (!isRecord(session) || !isRecord(session.user) || session.user.email !== email
    || typeof session.access_token !== "string" || typeof session.refresh_token !== "string") {
    throw new Error("local Auth fixture session response is invalid");
  }
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

async function expectPlacementApiStatus(context: BrowserContext, status: number) {
  expect((await context.request.get(`${appOrigin}/api/admin/placements`)).status()).toBe(status);
  const place = await context.request.post(`${appOrigin}/api/admin/placements`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: probePlacement,
  });
  expect(place.status()).toBe(status);
}

async function expectRoleDeniedFromAdminApi(browser: Browser, emailEnv: string) {
  const roleContext = await newGuardedContext(browser);
  try {
    await addLocalAuthFixtureSession(roleContext, emailEnv);
    await expectPlacementApiStatus(roleContext, 403);
  } finally {
    await roleContext.close();
  }
}

async function fillMarketingSignup(page: Page, email: string, firstName = "Jordan") {
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill("W03");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Month", { exact: true }).selectOption("05");
  await page.getByLabel("Day", { exact: true }).selectOption("14");
  await page.getByLabel("Year", { exact: true }).fill("1990");
  await selectNativeChoice(page, "radio", "A woman");
  await selectNativeChoice(page, "checkbox", "Women");
  await selectNativeChoice(page, "checkbox", "Men");
  await selectNativeChoice(page, "checkbox", "Non-binary people");
  await page.getByLabel("Youngest").fill("21");
  await page.getByLabel("Oldest").fill("120");
  await selectNativeChoice(page, "radio", "Open");
  await selectNativeChoice(page, "radio", "Yes, surprise me");
  await page.getByLabel("Where you'd walk to").selectOption("Inman Park");
  await page.getByLabel("How you heard about us").fill("Friend referral W03");
  await selectNativeChoice(page, "checkbox", "Wednesday");
}

async function waitForSignInReady(page: Page) {
  const form = page.locator('form[data-client-ready="true"]');
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Send sign-in link" })).toBeEnabled();
}

async function requestSignInLink(page: Page, email: string) {
  await waitForSignInReady(page);
  await page.getByLabel("Email address").fill(email);
  const request = page.waitForResponse((response) => response.url().endsWith("/api/auth/request-link") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  const response = await request;
  expect(response.status()).toBe(200);
  expectEmailAbsentFromUrl(page, email);
  await expect(page.getByText("Check your email.")).toBeVisible();
  return await response.json();
}

function expectEmailAbsentFromUrl(page: Page, email: string) {
  const currentUrl = new URL(page.url());
  expect(currentUrl.searchParams.has("email")).toBe(false);
  expect(decodeURIComponent(currentUrl.href)).not.toContain(email);
}

async function selectNativeChoice(page: Page, role: "radio" | "checkbox", name: string) {
  const control = page.getByRole(role, { name, exact: true });
  await control.focus();
  await control.press("Space");
  await expect(control).toBeChecked();
}

async function submitMarketingSignup(page: Page) {
  const requestPromise = page.waitForRequest((request) => {
    if (request.method() !== "POST") return false;
    try { return new URL(request.url()).pathname === "/api/waitlist"; }
    catch { return false; }
  }, { timeout: 15_000 });
  await page.locator("#submitBtn").click();
  const request = await requestPromise;
  // Fail before awaiting a response if the marketing form resolves its
  // endpoint to any hosted or otherwise non-test origin.
  expect(request.url()).toBe(`${appOrigin}/api/waitlist`);
  const response = await request.response();
  expect(response, "the local waitlist endpoint must return an HTTP response").not.toBeNull();
  const body: unknown = await response!.json();
  expect(response!.status()).toBe(200);
  expect(body).toEqual({ received: true });
  await expect(page.getByRole("heading", { name: "Thanks for reaching out." })).toBeVisible();
  return { status: response!.status(), body };
}

async function submitInvalidWaitlistApiFromMarketingPage(page: Page, payload: Record<string, unknown>) {
  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && request.url() === `${appOrigin}/api/waitlist`);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url() === `${appOrigin}/api/waitlist`);
  const resultPromise = page.evaluate(async (body) => {
    const response = await fetch("http://127.0.0.1:8086/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, payload);
  const request = await requestPromise;
  expect(request.url()).toBe(`${appOrigin}/api/waitlist`);
  const response = await responsePromise;
  const result = await resultPromise;
  expect(response.status()).toBe(400);
  expect(result.status).toBe(400);
  expect(isRecord(result.body) && isRecord(result.body.error) ? result.body.error.code : null).toBe("validation_failed");
  return result;
}

function validMarketingPayload(email: string): Record<string, unknown> {
  return {
    first_name: "Boundary",
    last_name: "W03",
    email,
    birthdate: "1990-05-14",
    identity: "Woman",
    open_to: "Women",
    match_age_min: 21,
    match_age_max: 120,
    neighborhood: "Inman Park",
    nights: "Not specified",
    referral: "synthetic W03 boundary case",
    source: "landing-page",
    submitted_at: "2001-01-01T00:00:00.000Z",
    _gotcha: "",
    looking_for: "Open",
    surprise_game: "Yes, surprise me",
  };
}

test("W03: marketing signup → confirmation email → admin places them at a Table → invitation email → sign-in lands on the invitation", async ({ browser, page, context }) => {
  const adminEmail = fixtureValue("W03_ADMIN_EMAIL");
  const memberEmail = fixtureValue("W03_MEMBER_EMAIL");
  const tableId = fixtureValue("W03_TABLE_ID");
  const tableTitle = fixtureValue("W03_TABLE_TITLE");
  await guardPageRequests(context);

  // Anonymous direct API calls are denied before they can read the queue or place anyone.
  await expectPlacementApiStatus(context, 401);

  // Exercise the existing marketing form and public POST, including the neutral
  // duplicate and honeypot success responses. Only the first insert may persist.
  await page.goto(`${marketingOrigin}/#waitlist`);
  await expect(page.locator("#waitlistForm")).toBeVisible();
  await fillMarketingSignup(page, memberEmail);
  const staleClientSubmissionTime = "2001-01-01T00:00:00.000Z";
  const staleSubmissionRoute = async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    let body: unknown;
    try { body = route.request().postDataJSON(); }
    catch { return route.continue(); }
    if (!isRecord(body) || body.email !== memberEmail) return route.continue();
    return route.continue({ postData: JSON.stringify({ ...body, submitted_at: staleClientSubmissionTime }) });
  };
  await page.route(`${appOrigin}/api/waitlist`, staleSubmissionRoute);
  const receivedAtWindowStart = Date.now();
  const freshResult = await submitMarketingSignup(page);
  const receivedAtWindowEnd = Date.now();
  await page.unroute(`${appOrigin}/api/waitlist`, staleSubmissionRoute);
  const persistedSignup = readWaitlistSignup(memberEmail);
  expect(persistedSignup).not.toBeNull();
  expect(persistedSignup).toMatchObject({
    email_normalized: memberEmail,
    first_name: "Jordan",
    last_name: "W03",
    birthdate: "1990-05-14",
    identity: "Woman",
    open_to: ["Women", "Men", "Non-binary people"],
    match_age_min: 21,
    match_age_max: 120,
    neighborhood: "Inman Park",
    nights: ["Wednesday"],
    referral: "Friend referral W03",
    looking_for: "Open",
    surprise_game: "Yes, surprise me",
    source: "landing-page",
  });
  expect(persistedSignup).not.toHaveProperty("submitted_at");
  const receivedAt = typeof persistedSignup?.received_at === "string" ? Date.parse(persistedSignup.received_at) : Number.NaN;
  expect(Number.isFinite(receivedAt)).toBe(true);
  expect(receivedAt).toBeGreaterThanOrEqual(receivedAtWindowStart - 5_000);
  expect(receivedAt).toBeLessThanOrEqual(receivedAtWindowEnd + 5_000);
  expect(persistedSignup?.received_at).not.toBe(staleClientSubmissionTime);
  // Joining queues exactly one confirmation email and creates no admission or account.
  expect(readPlacementSnapshot(memberEmail)).toMatchObject({ admission_count: 0, confirmation_count: 1, profile_count: 0, invitations: [] });

  await page.reload();
  await expect(page.locator("#waitlistForm")).toBeVisible();
  await fillMarketingSignup(page, memberEmail, "Changed");
  const duplicateResult = await submitMarketingSignup(page);
  expect(duplicateResult).toEqual(freshResult);
  expect(readWaitlistSignup(memberEmail)).toEqual(persistedSignup);
  expect(readPlacementSnapshot(memberEmail)).toMatchObject({ confirmation_count: 1 });

  const honeypotEmail = fixtureValue("W03_HONEYPOT_EMAIL");
  await page.reload();
  await expect(page.locator("#waitlistForm")).toBeVisible();
  await fillMarketingSignup(page, honeypotEmail, "Robot");
  await page.locator('#waitlistForm input[name="_gotcha"]').fill("bot-value");
  const honeypotResult = await submitMarketingSignup(page);
  expect(honeypotResult).toEqual(freshResult);
  expect(readWaitlistSignup(honeypotEmail)).toBeNull();
  expect(readPlacementSnapshot(honeypotEmail)).toMatchObject({ admission_count: 0, confirmation_count: 0 });

  // Exercise server-side rejection through the actual marketing-origin browser
  // context, bypassing only the marketing script's client-side validation.
  const underageEmail = fixtureValue("W03_UNDERAGE_EMAIL");
  const invalidAgeEmail = fixtureValue("W03_INVALID_AGE_EMAIL");
  await page.reload();
  await expect(page.locator("#waitlistForm")).toBeVisible();
  await submitInvalidWaitlistApiFromMarketingPage(page, { ...validMarketingPayload(underageEmail), birthdate: "2006-05-14" });
  await submitInvalidWaitlistApiFromMarketingPage(page, { ...validMarketingPayload(invalidAgeEmail), match_age_max: 121 });
  for (const rejectedEmail of [underageEmail, invalidAgeEmail]) {
    expect(readWaitlistSignup(rejectedEmail)).toBeNull();
    expect(readPlacementSnapshot(rejectedEmail)).toMatchObject({ admission_count: 0, confirmation_count: 0 });
  }

  // The worker sends the confirmation email to the new signup only.
  const confirmation = await waitForMailpitMessage(memberEmail, confirmationSubject, { runWorker: true });
  expect(confirmation.HTML as string).toContain("Jordan");
  expect(await countMailpitRecipientMessages(memberEmail, confirmationSubject)).toBe(1);
  for (const silentEmail of [honeypotEmail, underageEmail, invalidAgeEmail]) expect(await mailpitHasRecipientMessage(silentEmail)).toBe(false);

  // A waitlisted person and an unknown address get the same neutral public
  // response; neither receives a sign-in email or gains app access.
  const waitingLinkResponse = await context.request.post(`${appOrigin}/api/auth/request-link`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { email: memberEmail },
  });
  expect(waitingLinkResponse.status()).toBe(200);
  const waitingLinkBody = await waitingLinkResponse.json();
  const preAdmissionUnknown = await context.request.post(`${appOrigin}/api/auth/request-link`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { email: fixtureValue("W03_UNINVITED_EMAIL") },
  });
  expect(preAdmissionUnknown.status()).toBe(200);
  expect(await preAdmissionUnknown.json()).toEqual(waitingLinkBody);
  expect(await mailpitHasRecipientMessage(memberEmail, signInSubject)).toBe(false);
  expect(await mailpitHasRecipientMessage(fixtureValue("W03_UNINVITED_EMAIL"))).toBe(false);

  const deletedEmail = fixtureValue("W03_DELETED_EMAIL");
  expect(readPlacementSnapshot(deletedEmail)).toMatchObject({ admission_count: 1, admissions: [expect.objectContaining({ state: "deleted" })], invitations: [] });
  const deletedLinkResponse = await context.request.post(`${appOrigin}/api/auth/request-link`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { email: deletedEmail },
  });
  expect(deletedLinkResponse.status()).toBe(200);
  expect(await deletedLinkResponse.json()).toEqual(waitingLinkBody);
  expect(await countMailpitRecipientMessages(deletedEmail)).toBe(0);

  // Staff signs in through a real generated link intercepted by Mailpit.
  await page.goto(`${appOrigin}/sign-in`);
  await waitForSignInReady(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await saveMilestoneScreenshot(page, "w03-sign-in-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await saveMilestoneScreenshot(page, "w03-sign-in-390px.png");
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await requestSignInLink(page, adminEmail)).toEqual(waitingLinkBody);
  const adminContext = await newGuardedContext(browser);
  const adminSignIn = await redeemSignInLink(adminContext, await waitForMailpitMessage(adminEmail, signInSubject));
  expect(adminSignIn.status).toBe(200);
  const adminPage = adminSignIn.page;
  await expect(adminPage).toHaveURL(`${appOrigin}/member`);

  // The new signup waits in the placement queue with the original fields; the deleted and rejected people do not.
  await adminPage.goto(`${appOrigin}/admin/waitlist`);
  await expect(adminPage.getByRole("heading", { name: "Waitlist", level: 1 })).toBeVisible();
  const queueCard = adminPage.locator("li.ops-card", { hasText: memberEmail });
  await expect(queueCard).toContainText("Jordan W03");
  await expect(queueCard).not.toContainText("Changed W03");
  await expect(queueCard).toContainText("Open to Women, Men, Non-binary people");
  await saveMilestoneScreenshot(adminPage, "w03-admin-waitlist-desktop.png");
  const queueResponse = await adminContext.request.get(`${appOrigin}/api/admin/placements`);
  expect(queueResponse.status()).toBe(200);
  const queueBody: unknown = await queueResponse.json();
  const queueData = isRecord(queueBody) && isRecord(queueBody.data) ? queueBody.data : null;
  const people = queueData && Array.isArray(queueData.people) ? queueData.people.filter(isRecord) : [];
  const queued = people.find((p) => p.email === memberEmail);
  expect(queued).toMatchObject({ firstName: "Jordan", lastName: "W03", openTo: ["Women", "Men", "Non-binary people"] });
  for (const absentEmail of [deletedEmail, honeypotEmail, underageEmail, invalidAgeEmail]) expect(people.some((p) => p.email === absentEmail)).toBe(false);
  expect(queueData && Array.isArray(queueData.tables) ? queueData.tables.some((t) => isRecord(t) && t.tableId === tableId && t.invitedCount === 0) : false).toBe(true);
  const signupId = queued?.signupId;
  if (typeof signupId !== "string") throw new Error("the placement queue did not return the run-scoped signup id");

  // A body with extra authority fields is rejected before anything is created.
  const tampered = await adminContext.request.post(`${appOrigin}/api/admin/placements`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { signupId, tableId, operationId: randomUUID(), acknowledgeWarnings: false, authUserId: adminEmail, approvedBy: adminEmail, role: "admin" },
  });
  expect(tampered.status()).toBe(400);
  expect(readPlacementSnapshot(memberEmail)).toMatchObject({ admission_count: 0, profile_count: 0, invitations: [] });

  // The admin adds them to the run's Table from the queue.
  await queueCard.getByRole("button", { name: "Add to Table…" }).click();
  const dialog = adminPage.getByRole("dialog", { name: "Add Jordan W03 to a Table" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Table", { exact: true }).selectOption(tableId);
  await saveMilestoneScreenshot(adminPage, "w03-placement-dialog-desktop.png");
  const placementRequestPromise = adminPage.waitForRequest((request) => request.url() === `${appOrigin}/api/admin/placements` && request.method() === "POST");
  const placementResponsePromise = adminPage.waitForResponse((response) => response.url() === `${appOrigin}/api/admin/placements` && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Add and send invitation" }).click();
  const [placementRequest, placementResponse] = await Promise.all([placementRequestPromise, placementResponsePromise]);
  expect(placementResponse.status()).toBe(200);
  const placementInput: unknown = placementRequest.postDataJSON();
  expect(placementInput).toEqual({ signupId, tableId, operationId: expect.any(String), acknowledgeWarnings: false });
  const placementBody: unknown = await placementResponse.json();
  const placed = isRecord(placementBody) && isRecord(placementBody.data) ? placementBody.data : null;
  const invitationId = placed?.invitationId;
  if (typeof invitationId !== "string") throw new Error("placement did not return an invitation id");
  expect(placed).toMatchObject({ tableId, rosterRevision: 1, warnings: [] });
  await expect(adminPage.getByRole("status").filter({ hasText: "Jordan was added and their invitation email is on its way." })).toBeVisible();
  await expect(adminPage.locator("li.ops-card", { hasText: memberEmail })).toHaveCount(0);

  // Replaying the exact browser-submitted operation concurrently returns the same placement and creates nothing more.
  const replays = await Promise.all(Array.from({ length: 3 }, () => adminContext.request.post(`${appOrigin}/api/admin/placements`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: placementInput,
  })));
  for (const replay of replays) {
    expect(replay.status()).toBe(200);
    const replayBody: unknown = await replay.json();
    expect(isRecord(replayBody) && isRecord(replayBody.data) ? replayBody.data.invitationId : null).toBe(invitationId);
  }
  // A new operation for the same person and Table is refused.
  const duplicate = await adminContext.request.post(`${appOrigin}/api/admin/placements`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { signupId, tableId, operationId: randomUUID(), acknowledgeWarnings: false },
  });
  expect(duplicate.status()).toBe(409);
  const duplicateBody: unknown = await duplicate.json();
  expect(isRecord(duplicateBody) && isRecord(duplicateBody.error) ? duplicateBody.error.reason : null).toBe("already_invited");
  expect(readPlacementSnapshot(memberEmail)).toMatchObject({
    admission_count: 1,
    admissions: [expect.objectContaining({ state: "invited" })],
    profile_count: 1,
    invitations: [{ id: invitationId, state: "active", table_id: tableId }],
    invitation_outbox_count: 1,
    activation_audit_count: 0,
  });

  // The worker sends the invitation email; its link opens sign-in with the invitation as the return path.
  const invitationMessage = await waitForMailpitMessage(memberEmail, `You’re invited: ${tableTitle}`, { runWorker: true });
  const invitePath = `/invitations/${invitationId}`;
  const memberContext = await newGuardedContext(browser);
  const invitationLink = await openEmailLink(memberContext, invitationMessage, "View invitation");
  expect(invitationLink.href).toBe(`${appOrigin}/sign-in?returnTo=${encodeURIComponent(invitePath)}`);
  const memberPage = invitationLink.page;
  await memberPage.waitForURL(`${appOrigin}/sign-in**`);
  await expect(memberPage.getByText("We’ll bring you back to this page after you sign in.")).toBeVisible();
  expect(await requestSignInLink(memberPage, memberEmail)).toEqual(waitingLinkBody);
  const memberSignInMessage = await waitForMailpitMessage(memberEmail, signInSubject);
  expect(await countMailpitRecipientMessages(memberEmail, signInSubject)).toBe(1);

  // The real sign-in link opened while another verified account is signed in must not replace that account
  // or activate the wrong owner. The recipient can then use the same one-time link from their own context.
  const wrongRecipientContext = await newGuardedContext(browser);
  const adminCookies = await adminContext.cookies(appOrigin);
  const adminAccessCookie = adminCookies.find((cookie) => cookie.name === "fw_access_token");
  expect(adminAccessCookie, "admin fixture must already have an authenticated session").toBeDefined();
  await wrongRecipientContext.addCookies(adminCookies);
  const wrongOwner = await redeemSignInLink(wrongRecipientContext, memberSignInMessage);
  expect(wrongOwner.status, "a forwarded link opened under another account should be rejected before replacing its session").toBe(409);
  await expect(wrongOwner.page.getByRole("heading", { name: "You’re already signed in." })).toBeVisible();
  await expect(wrongOwner.page.getByRole("alert")).toContainText("To use this link with a different account, sign out first.");
  const preservedCookies = await wrongRecipientContext.cookies(appOrigin);
  expect(preservedCookies.find((cookie) => cookie.name === "fw_access_token")?.value).toBe(adminAccessCookie!.value);
  const wrongOwnerMemberRead = await wrongRecipientContext.request.get(`${appOrigin}/api/member/home`);
  expect(wrongOwnerMemberRead.status()).toBe(200);
  const existingMemberBody: unknown = await wrongOwnerMemberRead.json();
  expect(isRecord(existingMemberBody) && isRecord(existingMemberBody.member) ? existingMemberBody.member.email : null).toBe(adminEmail);
  expect(readPlacementSnapshot(memberEmail)).toMatchObject({ admissions: [expect.objectContaining({ state: "invited" })], activation_audit_count: 0 });
  await wrongOwner.page.getByRole("button", { name: "Sign out and continue" }).click();
  await expect(wrongOwner.page.getByRole("heading", { name: "Continue with your link." })).toBeVisible();
  expect((await wrongRecipientContext.cookies(appOrigin)).some((cookie) => cookie.name.startsWith("fw_"))).toBe(false);
  await wrongRecipientContext.close();

  // The guest redeems the link and lands on their invitation; the admission activates exactly once.
  const memberSignIn = await redeemSignInLink(memberContext, memberSignInMessage);
  expect(memberSignIn.href).toBe(wrongOwner.href);
  expect(new URL(memberSignIn.href).searchParams.get("safeReturnTo")).toBe(invitePath);
  expect(memberSignIn.status).toBe(200);
  const invitationPage = memberSignIn.page;
  await expect(invitationPage).toHaveURL(`${appOrigin}${invitePath}`);
  await expect(invitationPage.getByRole("heading", { name: `You’re invited to ${tableTitle}`, level: 1 })).toBeVisible();
  await invitationPage.setViewportSize({ width: 1440, height: 900 });
  await saveMilestoneScreenshot(invitationPage, "w03-invitation-desktop.png");
  await invitationPage.setViewportSize({ width: 390, height: 844 });
  await saveMilestoneScreenshot(invitationPage, "w03-invitation-390px.png");
  await invitationPage.setViewportSize({ width: 1440, height: 900 });
  expect(readPlacementSnapshot(memberEmail)).toMatchObject({ admissions: [expect.objectContaining({ state: "activated" })], activation_audit_count: 1 });
  await invitationPage.goto(`${appOrigin}/member`);
  await expect(invitationPage.getByRole("heading", { name: `You’re invited to ${tableTitle}` })).toBeVisible();
  await expect(invitationPage.getByRole("link", { name: /Review invitation/ })).toHaveAttribute("href", invitePath);
  await invitationPage.reload();
  await expect(invitationPage.getByRole("heading", { name: /^Welcome back/ })).toBeVisible();

  // The guest has no staff role.
  const deniedAdminPage = await memberContext.newPage();
  await deniedAdminPage.goto(`${appOrigin}/admin/waitlist`);
  await expect(deniedAdminPage.getByRole("heading", { name: "You don’t have access to this" })).toBeVisible();
  await deniedAdminPage.close();
  await expectPlacementApiStatus(memberContext, 403);

  // An uninvited but verified Auth identity has a real local Auth session and must
  // still fail both member and admin direct APIs. The test-only session is fixture
  // setup, not evidence for the actual email-link journey above.
  const uninvitedContext = await newGuardedContext(browser);
  await addLocalAuthFixtureSession(uninvitedContext, "W03_UNINVITED_EMAIL");
  expect((await uninvitedContext.request.get(`${appOrigin}/api/member/home`)).status()).toBe(403);
  await expectPlacementApiStatus(uninvitedContext, 403);
  await uninvitedContext.close();

  await expectRoleDeniedFromAdminApi(browser, "W03_HOST_EMAIL");
  await expectRoleDeniedFromAdminApi(browser, "W03_RESTAURANT_EMAIL");

  // Sign-out and returning-member recovery use another actual intercepted link with a member continuation.
  await invitationPage.getByRole("button", { name: "Sign out" }).click();
  await expect(invitationPage).toHaveURL(`${appOrigin}/sign-in`);
  expireLinkCooldown(memberEmail);
  const returningPath = "/my-seats";
  await invitationPage.goto(`${appOrigin}/sign-in?returnTo=${encodeURIComponent(returningPath)}`);
  const returningBody = await requestSignInLink(invitationPage, memberEmail);
  expect(returningBody).toEqual(waitingLinkBody);
  await expect.poll(() => countMailpitRecipientMessages(memberEmail, signInSubject)).toBe(2);
  const immediateReturningRetry = await memberContext.request.post(`${appOrigin}/api/auth/request-link`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { email: memberEmail },
  });
  expect(immediateReturningRetry.status()).toBe(200);
  expect(await immediateReturningRetry.json()).toEqual(returningBody);
  expect(await countMailpitRecipientMessages(memberEmail, signInSubject)).toBe(2);

  // An uninvited address gets the same public response, without an email or admission side effect.
  const unknownLink = await memberContext.request.post(`${appOrigin}/api/auth/request-link`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { email: fixtureValue("W03_UNINVITED_EMAIL") },
  });
  expect(unknownLink.status()).toBe(200);
  expect(await unknownLink.json()).toEqual(returningBody);
  expect(await mailpitHasRecipientMessage(fixtureValue("W03_UNINVITED_EMAIL"))).toBe(false);
  await memberContext.close();

  // Client-supplied identity fields on verify are ignored: the link's own recipient is signed in.
  const returningContext = await newGuardedContext(browser);
  const returning = await redeemSignInLink(returningContext, await waitForMailpitMessage(memberEmail, signInSubject), {
    extraVerifyFields: {
      email: adminEmail,
      recipientEmail: adminEmail,
      recipientId: "00000000-0000-4000-8000-000000000001",
      authUserId: "00000000-0000-4000-8000-000000000001",
      identity: "Man",
    },
  });
  expect(returning.href).not.toBe(memberSignIn.href);
  expect(new URL(returning.href).searchParams.get("safeReturnTo")).toBe(returningPath);
  expect(returning.status).toBe(200);
  await expect(returning.page).toHaveURL(`${appOrigin}${returningPath}`);
  const returningMemberRead = await returningContext.request.get(`${appOrigin}/api/member/home`);
  expect(returningMemberRead.status()).toBe(200);
  const returningMemberBody: unknown = await returningMemberRead.json();
  expect(isRecord(returningMemberBody) && isRecord(returningMemberBody.member) ? returningMemberBody.member.email : null).toBe(memberEmail);
  await returningContext.close();

  // Replaying the consumed invitation sign-in link in a fresh context creates no session and offers recovery.
  const replayContext = await newGuardedContext(browser);
  const replay = await redeemSignInLink(replayContext, memberSignInMessage);
  expect(replay.status).toBe(400);
  await expect(replay.page.getByRole("alert")).toContainText("This link has expired or was already used.");
  expect(new URL(replay.page.url()).origin).toBe(appOrigin);
  expect(await replayContext.cookies(appOrigin)).toEqual([]);
  await replayContext.close();
  expect(readPlacementSnapshot(memberEmail)).toMatchObject({ admission_count: 1, activation_audit_count: 1, invitations: [{ id: invitationId, state: "active", table_id: tableId }] });

  // Malformed links show the recovery action. A syntactically valid fake token
  // with an external return URL is scrubbed and cannot navigate off-origin.
  const recoveryContext = await newGuardedContext(browser);
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.goto(`${appOrigin}/auth/callback?token_hash=short&type=magiclink&safeReturnTo=${encodeURIComponent("https://evil.example/landing")}`);
  await expect(recoveryPage.getByRole("heading", { name: "This link doesn’t work." })).toBeVisible();
  await expect(recoveryPage.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/sign-in");
  const redirectVariants = [
    "https://evil.example/landing",
    "//evil.example/landing",
    "\\\\evil.example\\landing",
    "/%2f%2fevil.example/landing",
    "/%5c%5cevil.example/landing",
    "javascript:alert(1)",
  ];
  for (const [index, redirectTarget] of redirectVariants.entries()) {
    await recoveryPage.goto(`${appOrigin}/auth/callback?token_hash=${"b".repeat(16 + index)}&type=magiclink&safeReturnTo=${encodeURIComponent(redirectTarget)}`);
    await expect(recoveryPage.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
    const rejectedTarget = recoveryPage.waitForResponse((response) => response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST");
    await recoveryPage.getByRole("button", { name: "Continue", exact: true }).click();
    expect((await rejectedTarget).status()).toBe(400);
    await expect(recoveryPage.getByRole("alert")).toBeVisible();
    expect(new URL(recoveryPage.url()).origin).toBe(appOrigin);
  }
  await recoveryContext.close();

  // (The admin session was ended above by "Sign out and continue" in the forwarded-link context, so it is not reused here.)
  await adminContext.close();
});
