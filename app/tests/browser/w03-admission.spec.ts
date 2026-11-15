import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";
const marketingOrigin = "http://127.0.0.1:4322";
const mailpitOrigin = "http://127.0.0.1:57424";
const supabaseOrigin = "http://127.0.0.1:57421";
const mailpitProxyOrigin = "http://127.0.0.1:57428";
const testDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const screenshotDirectory = "docs/implementation/screenshots";

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

function readWaitlistSignup(email: string): Record<string, unknown> | null {
  if (!/^[a-z0-9._+-]+@example\.test$/.test(email)) throw new Error("W03 DB helper requires a run-scoped synthetic email");
  const result = queryTestDatabase(`select coalesce((
    select to_jsonb(signup) from public.waitlist_signups as signup
    where signup.email_normalized = ${sqlLiteral(email)}
  ), 'null'::jsonb)::text`);
  if (result === null) return null;
  if (!isRecord(result)) throw new Error("local W03 database returned an invalid signup row");
  return result;
}

function readAdmissionSnapshot(email: string): Record<string, unknown> {
  if (!/^[a-z0-9._+-]+@example\.test$/.test(email)) throw new Error("W03 DB helper requires a run-scoped synthetic email");
  const result = queryTestDatabase(`with target as (
    select admission.id, admission.state
    from public.app_admissions as admission
    where admission.email_normalized = ${sqlLiteral(email)}
  )
  select jsonb_build_object(
    'admission_count', (select count(*) from target),
    'admissions', coalesce((
      select jsonb_agg(jsonb_build_object('id', target.id, 'state', target.state) order by target.id)
      from target
    ), '[]'::jsonb),
    'deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', delivery.id,
        'operation_id', delivery.operation_id,
        'state', delivery.state,
        'attempt_count', delivery.attempt_count
      ) order by delivery.created_at)
      from public.app_invitation_deliveries as delivery
      join target on target.id = delivery.admission_id
    ), '[]'::jsonb),
    'attempt_count', (
      select count(*) from public.app_invitation_delivery_attempts as attempt
      join public.app_invitation_deliveries as delivery on delivery.id = attempt.delivery_id
      join target on target.id = delivery.admission_id
    ),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attempt_number', attempt.attempt_number,
        'state', attempt.state,
        'error_code', attempt.error_code,
        'provider_message_id', attempt.provider_message_id
      ) order by attempt.attempt_number)
      from public.app_invitation_delivery_attempts as attempt
      join public.app_invitation_deliveries as delivery on delivery.id = attempt.delivery_id
      join target on target.id = delivery.admission_id
    ), '[]'::jsonb),
    'activation_audit_count', (
      select count(*) from public.app_audit_events as audit
      join target on target.id = audit.subject_id
      where audit.action = 'app.admission.activated'
    )
  )::text`);
  if (!isRecord(result)) throw new Error("local W03 database returned an invalid admission snapshot");
  return result;
}

function readW03DomainTableAvailability(): Record<string, unknown> {
  // These W04–W07 domain objects are intentionally absent from the current W03
  // schema, so activation/replay cannot create profile, Table, Seat or payment
  // side effects. Once those migrations land, this query must become row-aware.
  const result = queryTestDatabase(`select jsonb_build_object(
    'profiles', to_regclass('public.app_member_profiles') is not null or to_regclass('public.member_profiles') is not null,
    'profile_reviews', to_regclass('public.app_profile_reviews') is not null or to_regclass('public.profile_reviews') is not null,
    'tables', to_regclass('public.app_tables') is not null or to_regclass('public.tables') is not null,
    'requests', to_regclass('public.app_table_requests') is not null or to_regclass('public.table_requests') is not null or to_regclass('public.seat_requests') is not null,
    'seats', to_regclass('public.app_seats') is not null or to_regclass('public.seats') is not null,
    'payments', to_regclass('public.app_payments') is not null or to_regclass('public.seat_payments') is not null or to_regclass('public.payments') is not null
  )::text`);
  if (!isRecord(result)) throw new Error("local W03 database returned an invalid domain table inventory");
  return result;
}

async function waitForMailpitMessage(email: string, subjectPart: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const listResponse = await fetch(`${mailpitOrigin}/api/v1/messages?limit=100`, { cache: "no-store" });
    if (!listResponse.ok) throw new Error(`Mailpit message list failed (${listResponse.status})`);
    const list: unknown = await listResponse.json();
    if (!isRecord(list) || !Array.isArray(list.messages)) throw new Error("Mailpit returned an invalid message list");
    const match = list.messages.find((item) =>
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
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`No intercepted ${subjectPart} message arrived for the run-scoped recipient`);
}

async function countMailpitRecipientMessages(email: string, subjectPart?: string) {
  const response = await fetch(`${mailpitOrigin}/api/v1/messages?limit=100`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Mailpit message list failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("Mailpit returned an invalid message list");
  return body.messages.filter((item) => isRecord(item)
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

type ActualLinkOptions = Readonly<{ extraVerifyFields?: Readonly<Record<string, unknown>> }>;

async function clickActualEmailLink(
  browser: Browser,
  email: string,
  subjectPart: string,
  label: string,
  options: ActualLinkOptions = {},
): Promise<{ page: Page; context: Awaited<ReturnType<Browser["newContext"]>>; linkHref: string }> {
  const message = await waitForMailpitMessage(email, subjectPart);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardPageRequests(context);
  const page = await context.newPage();
  // Render the exact intercepted Mailpit HTML and click its real anchor. This
  // follows the one-time recipient link in a clean browser context; no session
  // or access token is injected into Playwright.
  await page.setContent(message.HTML as string);
  const link = page.getByRole("link", { name: label, exact: true });
  await expect(link).toHaveCount(1);
  const originalHref = await link.getAttribute("href");
  let href = originalHref;
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:8086\/auth\/callback\?token_hash=[A-Za-z0-9_-]{16,512}&type=(invite|magiclink)/);
  if (options.extraVerifyFields) {
    await context.route(`${appOrigin}/api/auth/verify-link`, (route) => {
      if (route.request().method() !== "POST") return route.continue();
      let body: unknown;
      try { body = route.request().postDataJSON(); }
      catch { return route.continue(); }
      if (!isRecord(body)) return route.continue();
      return route.continue({
        postData: JSON.stringify({ ...body, ...options.extraVerifyFields }),
      });
    });
  }
  await link.click();
  await page.waitForURL(`${appOrigin}/auth/callback**`);
  await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  const verifyResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const verifyResponse = await verifyResponsePromise;
  if (!verifyResponse.ok()) {
    throw new Error(`local callback verification rejected with HTTP ${verifyResponse.status()}`);
  }
  return { page, context, linkHref: href! };
}

async function addLocalAuthFixtureSession(context: BrowserContext, emailEnv: string, _passwordEnv: string) {
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

  // This is test-only session setup for authorization probes. The member A28
  // flow continues to redeem the actual Mailpit link through the app callback.
  const verified = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, {
    headers: { apikey: publishableKey, "content-type": "application/json" },
    data: { token_hash: generatedBody.hashed_token, type: "magiclink" },
  });
  if (!verified.ok()) throw new Error(`local Auth fixture verification failed (HTTP ${verified.status()})`);
  const session: unknown = await verified.json();
  expect(isRecord(session) && isRecord(session.user) ? session.user.email : null).toBe(email);
  expect(isRecord(session) && typeof session.access_token === "string").toBe(true);
  expect(isRecord(session) && typeof session.refresh_token === "string").toBe(true);
  if (!isRecord(session) || typeof session.access_token !== "string" || typeof session.refresh_token !== "string") {
    throw new Error("local Auth fixture session response is invalid");
  }
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

async function expectRoleDeniedFromAdminApi(browser: Browser, emailEnv: string, passwordEnv: string) {
  const roleContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardPageRequests(roleContext);
  try {
    await addLocalAuthFixtureSession(roleContext, emailEnv, passwordEnv);
    const list = await roleContext.request.get(`${appOrigin}/api/admin/waitlist?limit=10`);
    expect(list.status()).toBe(403);
    const invite = await roleContext.request.post(`${appOrigin}/api/admin/waitlist`, {
      headers: { origin: appOrigin, "content-type": "application/json" },
      data: { signupId: "a1d72117-e0b1-4423-a108-24e24582dc5a", operationId: "a1d72117-e0b1-4423-a108-24e24582dc5b" },
    });
    expect(invite.status()).toBe(403);
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

test("W03: marketing signup → admin admission → actual Mailpit link → member home and returning link", async ({ browser, page, context }) => {
  const adminEmail = fixtureValue("W03_ADMIN_EMAIL");
  const memberEmail = fixtureValue("W03_MEMBER_EMAIL");
  await guardPageRequests(context);

  // Anonymous direct API calls are denied before they can search or admit.
  const anonymousList = await context.request.get(`${appOrigin}/api/admin/waitlist?limit=10`);
  expect(anonymousList.status()).toBe(401);
  const anonymousInvite = await context.request.post(`${appOrigin}/api/admin/waitlist`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { signupId: "a1d72117-e0b1-4423-a108-24e24582dc5a", operationId: "a1d72117-e0b1-4423-a108-24e24582dc5b" },
  });
  expect(anonymousInvite.status()).toBe(401);

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

  await page.reload();
  await expect(page.locator("#waitlistForm")).toBeVisible();
  await fillMarketingSignup(page, memberEmail, "Changed");
  const duplicateResult = await submitMarketingSignup(page);
  expect(duplicateResult).toEqual(freshResult);
  expect(readWaitlistSignup(memberEmail)).toEqual(persistedSignup);

  const honeypotEmail = fixtureValue("W03_HONEYPOT_EMAIL");
  await page.reload();
  await expect(page.locator("#waitlistForm")).toBeVisible();
  await fillMarketingSignup(page, honeypotEmail, "Robot");
  await page.locator('#waitlistForm input[name="_gotcha"]').fill("bot-value");
  const honeypotResult = await submitMarketingSignup(page);
  expect(honeypotResult).toEqual(freshResult);
  expect(readWaitlistSignup(honeypotEmail)).toBeNull();
  expect(readAdmissionSnapshot(honeypotEmail)).toMatchObject({ admission_count: 0, deliveries: [], attempt_count: 0 });

  // Exercise server-side rejection through the actual marketing-origin browser
  // context, bypassing only the marketing script's client-side validation.
  const underageEmail = fixtureValue("W03_UNDERAGE_EMAIL");
  const invalidAgeEmail = fixtureValue("W03_INVALID_AGE_EMAIL");
  await page.reload();
  await expect(page.locator("#waitlistForm")).toBeVisible();
  const underagePayload = { ...validMarketingPayload(underageEmail), birthdate: "2006-05-14" };
  await submitInvalidWaitlistApiFromMarketingPage(page, underagePayload);
  const invalidAgePayload = { ...validMarketingPayload(invalidAgeEmail), match_age_max: 121 };
  await submitInvalidWaitlistApiFromMarketingPage(page, invalidAgePayload);
  for (const rejectedEmail of [underageEmail, invalidAgeEmail]) {
    expect(readWaitlistSignup(rejectedEmail)).toBeNull();
    expect(readAdmissionSnapshot(rejectedEmail)).toMatchObject({ admission_count: 0, deliveries: [], attempt_count: 0 });
  }

  // A waiting-list member and an unknown address get the same neutral public
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
  expect(await mailpitHasRecipientMessage(memberEmail, "Your Fifth Wheel sign-in link")).toBe(false);
  expect(await mailpitHasRecipientMessage(fixtureValue("W03_UNINVITED_EMAIL"))).toBe(false);

  const deletedEmail = fixtureValue("W03_DELETED_EMAIL");
  expect(readAdmissionSnapshot(deletedEmail)).toMatchObject({
    admission_count: 1,
    admissions: [expect.objectContaining({ state: "deleted" })],
    deliveries: [],
    attempt_count: 0,
  });
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
  await page.getByLabel("Email address").fill(adminEmail);
  const adminRequest = page.waitForResponse((response) => response.url().endsWith("/api/auth/request-link") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  expect((await adminRequest).status()).toBe(200);
  expectEmailAbsentFromUrl(page, adminEmail);
  await expect(page.getByText("Check your email.")).toBeVisible();

  const adminJourney = await clickActualEmailLink(browser, adminEmail, "Your Fifth Wheel sign-in link", "Continue to Fifth Wheel");
  await expect(adminJourney.page).toHaveURL(`${appOrigin}/member`);
  await adminJourney.page.goto(`${appOrigin}/admin/waitlist`);
  await expect(adminJourney.page.getByRole("heading", { name: "Waitlist", exact: true })).toBeVisible();
  const adminContext = adminJourney.context;

  // The new marketing record is visible without changing the original fields.
  const search = adminJourney.page.getByRole("searchbox", { name: "Search waitlist" });
  await search.fill(memberEmail);
  await search.press("Enter");
  const signupRow = adminJourney.page.getByRole("row").filter({ hasText: memberEmail });
  await expect(signupRow).toContainText("Jordan W03");
  await expect(signupRow).not.toContainText("Changed W03");
  await adminJourney.page.setViewportSize({ width: 1440, height: 900 });
  await saveMilestoneScreenshot(adminJourney.page, "w03-admin-waitlist-desktop.png");
  const listResponse = await adminContext.request.get(`${appOrigin}/api/admin/waitlist?query=${encodeURIComponent(memberEmail)}`);
  expect(listResponse.status()).toBe(200);
  const listBody: unknown = await listResponse.json();
  expect(isRecord(listBody) && Array.isArray(listBody.items) ? listBody.items[0]?.openTo : null)
    .toEqual(["Women", "Men", "Non-binary people"]);
  for (const rejectedEmail of [underageEmail, invalidAgeEmail]) {
    const rejectedSignup = await adminContext.request.get(`${appOrigin}/api/admin/waitlist?query=${encodeURIComponent(rejectedEmail)}`);
    expect(rejectedSignup.status()).toBe(200);
    const rejectedBody: unknown = await rejectedSignup.json();
    expect(isRecord(rejectedBody) && Array.isArray(rejectedBody.items) ? rejectedBody.items : null).toEqual([]);
    expect(await mailpitHasRecipientMessage(rejectedEmail)).toBe(false);
  }

  const signupId = isRecord(listBody) && Array.isArray(listBody.items) && isRecord(listBody.items[0])
    ? listBody.items[0].id
    : null;
  expect(typeof signupId).toBe("string");
  const tamperedAdmission = await adminContext.request.post(`${appOrigin}/api/admin/waitlist`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: {
      signupId,
      operationId: randomUUID(),
      recipientEmail: adminEmail,
      authUserId: adminEmail,
      approvedBy: adminEmail,
      role: "admin",
    },
  });
  expect(tamperedAdmission.status()).toBe(400);
  expect(readAdmissionSnapshot(memberEmail)).toMatchObject({ admission_count: 0, deliveries: [], attempt_count: 0 });

  // Member identity is authenticated but lacks admin role; direct API access
  // must remain denied after the invited link activates the admission.
  await signupRow.getByRole("button", { name: "Approve…" }).click();
  const dialog = adminJourney.page.getByRole("dialog", { name: /^Approve / });
  await expect(dialog).toContainText("Table invitation and Seat are separate");
  await saveMilestoneScreenshot(adminJourney.page, "w03-invitation-confirmation-desktop.png");
  const initialAdmissionRequestPromise = adminJourney.page.waitForRequest((request) =>
    request.url() === `${appOrigin}/api/admin/waitlist` && request.method() === "POST",
  );
  const initialAdmissionResponsePromise = adminJourney.page.waitForResponse((response) =>
    response.url() === `${appOrigin}/api/admin/waitlist` && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Approve and send link" }).click();
  const [initialAdmissionRequest, initialAdmissionResponse] = await Promise.all([
    initialAdmissionRequestPromise,
    initialAdmissionResponsePromise,
  ]);
  expect(initialAdmissionResponse.status()).toBe(202);
  const initialAdmissionInput: unknown = initialAdmissionRequest.postDataJSON();
  const initialAdmissionBody: unknown = await initialAdmissionResponse.json();
  expect(isRecord(initialAdmissionInput) && initialAdmissionInput.signupId).toBe(signupId);
  expect(isRecord(initialAdmissionInput) && typeof initialAdmissionInput.operationId === "string").toBe(true);
  expect(isRecord(initialAdmissionBody) && isRecord(initialAdmissionBody.value)
    ? initialAdmissionBody.value.operationId
    : null).toBe(isRecord(initialAdmissionInput) ? initialAdmissionInput.operationId : null);
  await expect(dialog.getByRole("alert")).toContainText("Email delivery failed");
  expect(await mailpitHasRecipientMessage(memberEmail, "You’re in: welcome to Fifth Wheel")).toBe(false);

  // Replay the exact browser-submitted operation concurrently through the
  // protected route. It must reuse one admission and logical delivery and must
  // not call the mail provider again.
  if (!isRecord(initialAdmissionInput)
    || typeof initialAdmissionInput.signupId !== "string"
    || typeof initialAdmissionInput.operationId !== "string") {
    throw new Error("admin UI submitted an invalid admission operation fixture");
  }
  const repeatedAdmissions = await Promise.all(Array.from({ length: 3 }, () => adminContext.request.post(`${appOrigin}/api/admin/waitlist`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: initialAdmissionInput,
  })));
  const repeatedBodies: unknown[] = [];
  for (const response of repeatedAdmissions) {
    expect(response.status()).toBe(202);
    repeatedBodies.push(await response.json());
  }
  const initialValue = isRecord(initialAdmissionBody) && isRecord(initialAdmissionBody.value) ? initialAdmissionBody.value : null;
  expect(initialValue).not.toBeNull();
  for (const body of repeatedBodies) {
    const value = isRecord(body) && isRecord(body.value) ? body.value : null;
    expect(value).toMatchObject({
      signupId,
      operationId: initialAdmissionInput.operationId,
      admissionId: initialValue?.admissionId,
      deliveryId: initialValue?.deliveryId,
    });
  }
  const afterDuplicateOperations = readAdmissionSnapshot(memberEmail);
  expect(afterDuplicateOperations.admission_count).toBe(1);
  expect(afterDuplicateOperations.deliveries).toEqual([expect.objectContaining({
    operation_id: initialAdmissionInput.operationId,
    attempt_count: 1,
  })]);
  expect(afterDuplicateOperations.attempt_count).toBe(1);
  expect(afterDuplicateOperations.attempts).toEqual([expect.objectContaining({ attempt_number: 1, state: "failed" })]);
  const proxyBeforeRetryResponse = await fetch(`${mailpitProxyOrigin}/__health`, { cache: "no-store" });
  expect(proxyBeforeRetryResponse.ok).toBe(true);
  const proxyBeforeRetry: unknown = await proxyBeforeRetryResponse.json();
  expect(proxyBeforeRetry).toMatchObject({ targetedInvitationAttempts: 1, syntheticFailedAttempts: 1, forwardedInvitationCount: 0 });
  expect(await mailpitHasRecipientMessage(memberEmail, "You’re in: welcome to Fifth Wheel")).toBe(false);

  await dialog.getByRole("button", { name: "Send again" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Email status unclear");
  await expect(dialog.getByRole("alert")).toContainText("Do not resend until delivery status is reconciled");
  await dialog.getByRole("button", { name: "Check status" }).click();
  await expect(dialog.getByRole("status")).toContainText("Email service accepted the message");
  const proxyHealthResponse = await fetch(`${mailpitProxyOrigin}/__health`, { cache: "no-store" });
  expect(proxyHealthResponse.ok).toBe(true);
  const proxyHealth: unknown = await proxyHealthResponse.json();
  expect(isRecord(proxyHealth) ? proxyHealth.forwardedInvitationCount : null).toBe(1);
  expect(isRecord(proxyHealth) ? proxyHealth.droppedInvitationResponses : null).toBe(1);
  expect(isRecord(proxyHealth) ? proxyHealth.forwardedSearchCount : null).toBe(1);
  expect(isRecord(proxyHealth) ? proxyHealth.targetedInvitationAttempts : null).toBe(2);
  expect(isRecord(proxyHealth) ? proxyHealth.syntheticFailedAttempts : null).toBe(1);

  // A real recipient link opened while another verified account is signed in
  // must not replace that account or activate the wrong owner. The recipient
  // can then use the same one-time link from their own signed-out context.
  const memberInvitationMessage = await waitForMailpitMessage(memberEmail, "You’re in: welcome to Fifth Wheel");
  const wrongRecipientContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardPageRequests(wrongRecipientContext);
  const adminCookies = await adminContext.cookies(appOrigin);
  const adminAccessCookie = adminCookies.find((cookie) => cookie.name === "fw_access_token");
  expect(adminAccessCookie, "admin fixture must already have an authenticated session").toBeDefined();
  await wrongRecipientContext.addCookies(adminCookies);
  const wrongRecipientPage = await wrongRecipientContext.newPage();
  await wrongRecipientPage.setContent(memberInvitationMessage.HTML as string);
  const forwardedLink = wrongRecipientPage.getByRole("link", { name: "Sign in to Fifth Wheel", exact: true });
  await expect(forwardedLink).toHaveCount(1);
  const originalInvitationHref = await forwardedLink.getAttribute("href");
  expect(originalInvitationHref).toMatch(/^http:\/\/127\.0\.0\.1:8086\/auth\/callback\?/);
  await forwardedLink.click();
  await wrongRecipientPage.waitForURL(`${appOrigin}/auth/callback**`);
  await expect(wrongRecipientPage.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  await expect.poll(() => new URL(wrongRecipientPage.url()).search).toBe("");
  const wrongOwnerVerify = wrongRecipientPage.waitForResponse((response) => response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST");
  await wrongRecipientPage.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
  const wrongOwnerResponse = await wrongOwnerVerify;
  expect(wrongOwnerResponse.status(), "a forwarded invite opened under another account should be rejected before replacing its session").toBe(409);
  await expect(wrongRecipientPage.getByRole("alert")).toContainText("You are already signed in.");
  await expect(wrongRecipientPage.getByRole("alert")).toContainText("Sign out before using this link. Your current sign-in is still active, and you can continue with this same link.");
  const preservedCookies = await wrongRecipientContext.cookies(appOrigin);
  expect(preservedCookies.find((cookie) => cookie.name === "fw_access_token")?.value)
    .toBe(adminAccessCookie!.value);
  const wrongOwnerMemberRead = await wrongRecipientContext.request.get(`${appOrigin}/api/member/home`);
  expect(wrongOwnerMemberRead.status()).toBe(200);
  const existingMemberBody: unknown = await wrongOwnerMemberRead.json();
  expect(isRecord(existingMemberBody) && isRecord(existingMemberBody.member) ? existingMemberBody.member.email : null)
    .toBe(adminEmail);
  await wrongRecipientPage.getByRole("button", { name: "Sign out and continue" }).click();
  await expect(wrongRecipientPage.getByRole("heading", { name: "Continue with your link." })).toBeVisible();
  expect((await wrongRecipientContext.cookies(appOrigin)).some((cookie) => cookie.name.startsWith("fw_"))).toBe(false);
  await wrongRecipientContext.close();

  const memberJourney = await clickActualEmailLink(browser, memberEmail, "You’re in: welcome to Fifth Wheel", "Sign in");
  expect(memberJourney.linkHref).toBe(originalInvitationHref);
  await expect(memberJourney.page).toHaveURL(`${appOrigin}/member`);
  await expect(memberJourney.page.getByRole("heading", { name: /^Welcome back/ })).toBeVisible();
  await expect(memberJourney.page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
  await expect(memberJourney.page.getByText(/Table invitations and Seats are separate/)).toBeVisible();
  await memberJourney.page.setViewportSize({ width: 1440, height: 900 });
  await saveMilestoneScreenshot(memberJourney.page, "w03-member-home-desktop.png");
  await memberJourney.page.setViewportSize({ width: 390, height: 844 });
  await saveMilestoneScreenshot(memberJourney.page, "w03-member-home-390px.png");
  await memberJourney.page.setViewportSize({ width: 1440, height: 900 });
  await memberJourney.page.reload();
  await expect(memberJourney.page.getByRole("heading", { name: /^Welcome back/ })).toBeVisible();

  const deniedAdminPage = await memberJourney.context.newPage();
  await deniedAdminPage.goto(`${appOrigin}/admin/waitlist`);
  await expect(deniedAdminPage.getByRole("heading", { name: "Admin access required" })).toBeVisible();
  const deniedApi = await memberJourney.context.request.get(`${appOrigin}/api/admin/waitlist?limit=10`);
  expect(deniedApi.status()).toBe(403);
  const memberInviteDenied = await memberJourney.context.request.post(`${appOrigin}/api/admin/waitlist`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { signupId: "a1d72117-e0b1-4423-a108-24e24582dc5a", operationId: "a1d72117-e0b1-4423-a108-24e24582dc5b" },
  });
  expect(memberInviteDenied.status()).toBe(403);

  // Uninvited but verified Auth identity has a real local Auth session and must
  // still fail both member and admin direct APIs. The test-only password session
  // is fixture setup, not evidence for the actual magic-link journey above.
  const uninvitedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardPageRequests(uninvitedContext);
  await addLocalAuthFixtureSession(uninvitedContext, "W03_UNINVITED_EMAIL", "W03_UNINVITED_PASSWORD");
  const uninvitedMember = await uninvitedContext.request.get(`${appOrigin}/api/member/home`);
  expect(uninvitedMember.status()).toBe(403);
  const uninvitedAdmin = await uninvitedContext.request.get(`${appOrigin}/api/admin/waitlist?limit=10`);
  expect(uninvitedAdmin.status()).toBe(403);
  const uninvitedInvite = await uninvitedContext.request.post(`${appOrigin}/api/admin/waitlist`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { signupId: "a1d72117-e0b1-4423-a108-24e24582dc5a", operationId: "a1d72117-e0b1-4423-a108-24e24582dc5b" },
  });
  expect(uninvitedInvite.status()).toBe(403);
  await uninvitedContext.close();

  await expectRoleDeniedFromAdminApi(browser, "W03_HOST_EMAIL", "W03_HOST_PASSWORD");
  await expectRoleDeniedFromAdminApi(browser, "W03_RESTAURANT_EMAIL", "W03_RESTAURANT_PASSWORD");

  // Sign-out and returning-member recovery use a second actual intercepted link.
  await memberJourney.page.getByRole("button", { name: "Sign out" }).click();
  await expect(memberJourney.page).toHaveURL(`${appOrigin}/sign-in`);
  await waitForSignInReady(memberJourney.page);
  const sharedTableContinuation = "/tables/2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0?source=shared";
  const injectSharedContinuation = async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    let requestBody: unknown;
    try { requestBody = route.request().postDataJSON(); }
    catch { return route.continue(); }
    if (!isRecord(requestBody) || requestBody.email !== memberEmail) return route.continue();
    return route.continue({ postData: JSON.stringify({ ...requestBody, safeReturnTo: sharedTableContinuation }) });
  };
  // Test hook supplies the internal continuation that W06's shared-Table sign-in
  // entry will provide. The Table page itself is not part of W03.
  await memberJourney.context.route(`${appOrigin}/api/auth/request-link`, injectSharedContinuation);
  await memberJourney.page.getByLabel("Email address").fill(memberEmail);
  const returningRequest = memberJourney.page.waitForResponse((response) => response.url().endsWith("/api/auth/request-link") && response.request().method() === "POST");
  await memberJourney.page.getByRole("button", { name: "Send sign-in link" }).click();
  const returningResponse = await returningRequest;
  expect(returningResponse.status()).toBe(200);
  const returningBody = await returningResponse.json();
  expect(returningBody).toEqual(waitingLinkBody);
  expectEmailAbsentFromUrl(memberJourney.page, memberEmail);
  await expect(memberJourney.page.getByText("Check your email.")).toBeVisible();
  await memberJourney.context.unroute(`${appOrigin}/api/auth/request-link`, injectSharedContinuation);
  const immediateReturningRetry = await memberJourney.context.request.post(`${appOrigin}/api/auth/request-link`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { email: memberEmail },
  });
  expect(immediateReturningRetry.status()).toBe(200);
  expect(await immediateReturningRetry.json()).toEqual(returningBody);
  expect(await countMailpitRecipientMessages(memberEmail, "Your Fifth Wheel sign-in link")).toBe(1);

  // An uninvited address gets the same public response, without an email or
  // admission side effect. This checks the app request path, not an Auth login.
  const unknownLink = await memberJourney.context.request.post(`${appOrigin}/api/auth/request-link`, {
    headers: { origin: appOrigin, "content-type": "application/json" },
    data: { email: fixtureValue("W03_UNINVITED_EMAIL") },
  });
  expect(unknownLink.status()).toBe(200);
  expect(await unknownLink.json()).toEqual(returningBody);
  const mailpitListResponse = await fetch(`${mailpitOrigin}/api/v1/messages?limit=100`, { cache: "no-store" });
  expect(mailpitListResponse.ok).toBe(true);
  const mailpitList: unknown = await mailpitListResponse.json();
  expect(isRecord(mailpitList) && Array.isArray(mailpitList.messages)
    ? mailpitList.messages.some((item) => isRecord(item) && hasRecipient(item.To, fixtureValue("W03_UNINVITED_EMAIL")))
    : true).toBe(false);
  await memberJourney.context.close();

  const returningJourney = await clickActualEmailLink(browser, memberEmail, "Your Fifth Wheel sign-in link", "Continue to Fifth Wheel", {
    extraVerifyFields: {
      email: adminEmail,
      recipientEmail: adminEmail,
      recipientId: "00000000-0000-4000-8000-000000000001",
      authUserId: "00000000-0000-4000-8000-000000000001",
      identity: "Man",
    },
  });
  const returningHref = new URL(returningJourney.linkHref);
  expect(returningHref.searchParams.get("safeReturnTo")).toBe(sharedTableContinuation);
  await expect(returningJourney.page).toHaveURL(`${appOrigin}${sharedTableContinuation}`);
  const returningMemberRead = await returningJourney.context.request.get(`${appOrigin}/api/member/home`);
  expect(returningMemberRead.status()).toBe(200);
  const returningMemberBody: unknown = await returningMemberRead.json();
  expect(isRecord(returningMemberBody) && isRecord(returningMemberBody.member) ? returningMemberBody.member.email : null)
    .toBe(memberEmail);

  // Replay the exact one-time link from the intercepted member invitation in a
  // fresh context. It must not create a second session and should offer recovery.
  const replayContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardPageRequests(replayContext);
  const replayPage = await replayContext.newPage();
  await replayPage.goto(memberJourney.linkHref);
  await expect(replayPage.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  await expect.poll(() => new URL(replayPage.url()).search).toBe("");
  const replayVerify = replayPage.waitForResponse((response) => response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST");
  await replayPage.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
  expect((await replayVerify).status()).toBe(400);
  await expect(replayPage.getByRole("alert")).toContainText("already been used");
  expect(new URL(replayPage.url()).origin).toBe(appOrigin);
  expect(await replayContext.cookies(appOrigin)).toEqual([]);
  await replayContext.close();

  const afterReplaySnapshot = readAdmissionSnapshot(memberEmail);
  expect(afterReplaySnapshot.admission_count).toBe(1);
  expect(afterReplaySnapshot.deliveries).toEqual([expect.objectContaining({
    operation_id: isRecord(initialAdmissionInput) ? initialAdmissionInput.operationId : null,
    state: "accepted",
    attempt_count: 2,
  })]);
  expect(afterReplaySnapshot.attempt_count).toBe(2);
  expect(afterReplaySnapshot.attempts).toEqual([
    expect.objectContaining({ attempt_number: 1, state: "failed" }),
    expect.objectContaining({ attempt_number: 2, state: "accepted" }),
  ]);
  expect(afterReplaySnapshot.activation_audit_count).toBe(1);
  // W03 originally asserted that no downstream tables existed yet. Later slices created them, so this now records the current schema:
  expect(readW03DomainTableAvailability()).toEqual({
    profiles: true,
    profile_reviews: false,
    tables: false,
    requests: true,
    payments: true,
    seats: true,
  });

  // Malformed links show the recovery action. A syntactically valid fake token
  // with an external return URL is scrubbed and cannot navigate off-origin.
  const recoveryContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardPageRequests(recoveryContext);
  const recoveryPage = await recoveryContext.newPage();
  await recoveryPage.goto(`${appOrigin}/auth/callback?token_hash=short&type=magiclink&safeReturnTo=${encodeURIComponent("https://evil.example/landing")}`);
  await expect(recoveryPage.getByRole("heading", { name: "This link can’t be used." })).toBeVisible();
  await expect(recoveryPage.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/sign-in");
  await recoveryPage.goto(`${appOrigin}/auth/callback?token_hash=aaaaaaaaaaaaaaaa&type=magiclink&safeReturnTo=${encodeURIComponent("https://evil.example/landing")}`);
  await expect(recoveryPage.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
  const unsafeVerify = recoveryPage.waitForResponse((response) => response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST");
  await recoveryPage.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
  expect((await unsafeVerify).status()).toBe(400);
  await expect(recoveryPage.getByRole("alert")).toBeVisible();
  expect(new URL(recoveryPage.url()).origin).toBe(appOrigin);
  const redirectVariants = [
    "//evil.example/landing",
    "https://evil.example/landing",
    "\\\\evil.example\\landing",
    "/%2f%2fevil.example/landing",
    "/%5c%5cevil.example/landing",
    "javascript:alert(1)",
  ];
  for (const [index, redirectTarget] of redirectVariants.entries()) {
    await recoveryPage.goto(`${appOrigin}/auth/callback?token_hash=${"b".repeat(16 + index)}&type=magiclink&safeReturnTo=${encodeURIComponent(redirectTarget)}`);
    await expect(recoveryPage.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
    const rejectedTarget = recoveryPage.waitForResponse((response) => response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST");
    await recoveryPage.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
    expect((await rejectedTarget).status()).toBe(400);
    await expect(recoveryPage.getByRole("alert")).toBeVisible();
    expect(new URL(recoveryPage.url()).origin).toBe(appOrigin);
  }
  await recoveryContext.close();

  // The app admission confers no staff role; the actual admin session continues
  // to work after member activation and refresh.
  await adminJourney.page.reload();
  await adminJourney.page.goto(`${appOrigin}/admin/waitlist`);
  await expect(adminJourney.page.getByRole("heading", { name: "Waitlist", exact: true })).toBeVisible();

  await returningJourney.context.close();
  await adminContext.close();
});
