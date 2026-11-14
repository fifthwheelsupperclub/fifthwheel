import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";
const mailpitOrigin = "http://127.0.0.1:57424";
const screenshotDirectory = resolve("docs/implementation/screenshots");
const tableId = process.env.W06_FUTURE_TABLE_ID!;
const otherTableId = process.env.W06_SECOND_TABLE_ID!;

async function localSession(browser: Browser, emailVariable: string): Promise<BrowserContext> {
  const email = process.env[emailVariable];
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!email || !publishableKey || !serviceRoleKey) throw new Error(`Missing local W06 fixture environment for ${emailVariable}`);

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", async (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === appOrigin || origin === supabaseOrigin) return route.continue();
    return route.abort();
  });
  const generated = await context.request.post(`${supabaseOrigin}/auth/v1/admin/generate_link`, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    data: { type: "magiclink", email, redirect_to: `${appOrigin}/auth/callback` },
  });
  if (!generated.ok()) throw new Error(`Local W06 fixture magic-link generation failed (${generated.status()})`);
  const generatedBody = await generated.json() as { hashed_token?: string; email?: string };
  if (generatedBody.email?.toLowerCase() !== email.toLowerCase() || typeof generatedBody.hashed_token !== "string") {
    throw new Error("Local W06 fixture magic-link identity did not match");
  }
  const verified = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, {
    headers: { apikey: publishableKey, "content-type": "application/json" },
    data: { token_hash: generatedBody.hashed_token, type: "magiclink" },
  });
  if (!verified.ok()) throw new Error(`Local W06 fixture token verification failed (${verified.status()})`);
  const session = await verified.json() as { user?: { email?: string }; access_token?: string; refresh_token?: string };
  if (session.user?.email?.toLowerCase() !== email.toLowerCase() || !session.access_token || !session.refresh_token) {
    throw new Error("Local W06 fixture session did not match the named test identity");
  }
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

async function apiJson(page: Page, path: string, init?: Parameters<Page["request"]["fetch"]>[1]) {
  const response = await page.request.fetch(`${appOrigin}${path}`, init);
  const body: unknown = await response.json().catch(() => null);
  return { response, body };
}

async function screenshotPair(page: Page, stem: string, visit: () => Promise<void>) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visit();
  await page.screenshot({ path: resolve(screenshotDirectory, `${stem}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshotDirectory, `${stem}-390px.png`), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

test("W06 member Tables, request history, access gates and shared preview use persisted local APIs", async ({ browser }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  const member = await localSession(browser, "W06_MEMBER_EMAIL");
  try {
    const page = await member.newPage();
    const list = await apiJson(page, "/api/tables?limit=20");
    expect(list.response.status()).toBe(200);
    expect(list.body).toMatchObject({ ok: true, data: { items: expect.any(Array), nextCursor: null } });
    const listBody = list.body as { data: { items: Record<string, unknown>[] } };
    expect(listBody.data.items).toHaveLength(2);
    expect(listBody.data.items.map((item) => item.title)).toEqual(["W06 Garden Table", "W06 Riverside Table"]);
    for (const item of listBody.data.items) {
      expect(item).toMatchObject({ seatPriceCents: 2500, currency: "USD" });
      expect(item).not.toHaveProperty("hostNotes");
      expect(item).not.toHaveProperty("sourceRecordId");
      expect(item).not.toHaveProperty("content");
    }

    await screenshotPair(page, "w06-tables", async () => {
      await page.goto(`${appOrigin}/tables`);
      await expect(page.getByRole("heading", { name: /An evening worth/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "W06 Riverside Table" })).toBeVisible();
      await expect(page.getByText("W06 Private staff notes", { exact: false })).toHaveCount(0);
    });
    await page.getByLabel("From").fill("2099-06-03");
    await page.getByLabel("To").fill("2099-06-03");
    await page.getByLabel("Neighborhood").fill("Inman Park");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "W06 Riverside Table" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "W06 Riverside Table" })).toBeVisible();
    await page.getByLabel("From").fill("2099-06-01");
    await page.getByLabel("To").fill("2099-06-02");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("heading", { name: "No upcoming Tables match yet" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "W06 Riverside Table" })).toBeVisible();

    await screenshotPair(page, "w06-table-detail", async () => {
      await page.goto(`${appOrigin}/tables/${tableId}`);
      await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your itinerary" })).toBeVisible();
      await expect(page.getByText("Public Bar")).toBeVisible();
      await expect(page.getByText("Internal W06 host note", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Request a Seat" })).toBeVisible();
    });

    const detail = await apiJson(page, `/api/tables/${tableId}`);
    expect(detail.response.status()).toBe(200);
    expect(detail.body).toMatchObject({ ok: true, data: { view: "member", table: { tableId, seatPriceCents: 2500, currency: "USD" } } });
    expect(JSON.stringify(detail.body)).not.toContain("hostNotes");
    expect(JSON.stringify(detail.body)).not.toContain("venueId");

    await page.goto(`${appOrigin}/tables/${tableId}`);
    await page.getByRole("button", { name: "Request a Seat" }).click();
    await expect(page.getByText(/Request received — awaiting review/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Request received — awaiting review/i)).toBeVisible();
    const historyAfterCreate = await apiJson(page, "/api/me/requests?limit=20");
    expect(historyAfterCreate.response.status()).toBe(200);
    expect(historyAfterCreate.body).toMatchObject({ ok: true, data: { items: [expect.objectContaining({
      table: expect.objectContaining({ title: "W06 Garden Table" }),
    })] } });

    await page.getByRole("button", { name: "Withdraw request" }).click();
    await expect(page.getByText(/Your earlier request was withdrawn/i)).toBeVisible();
    await expect.poll(async () => {
      const result = await apiJson(page, "/api/me/requests?limit=20");
      if (!result.body || typeof result.body !== "object" || !("data" in result.body)) return "missing";
      const data = (result.body as { data: { items?: { state?: string }[] } }).data;
      return data.items?.[0]?.state;
    }).toBe("withdrawn");
    await page.getByRole("button", { name: "Request again" }).click();
    await expect(page.getByText(/Request received — awaiting review/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Request received — awaiting review/i)).toBeVisible();

    await screenshotPair(page, "w06-requests", async () => {
      await page.goto(`${appOrigin}/requests`);
      await expect(page.getByRole("heading", { name: /Every request/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toHaveCount(2);
      await expect(page.getByText("PENDING", { exact: true })).toBeVisible();
      await expect(page.getByText("WITHDRAWN", { exact: true })).toBeVisible();
    });

    const other = await localSession(browser, "W06_OTHER_MEMBER_EMAIL");
    try {
      const otherPage = await other.newPage();
      const ownHistory = await apiJson(otherPage, "/api/me/requests?limit=20");
      expect(ownHistory.response.status()).toBe(200);
      expect(ownHistory.body).toMatchObject({ ok: true, data: { items: [] } });
      // Resolve the persisted request ID from the owner's history, then try it with another member's actual cookie session.
      const ownerHistory = await apiJson(page, "/api/me/requests?limit=20");
      const requestId = (ownerHistory.body as { data: { items: { requestId: string }[] } }).data.items[0]!.requestId;
      const denied = await apiJson(otherPage, `/api/me/requests/${requestId}/withdraw`, {
        method: "POST", headers: { origin: appOrigin }, data: { operationId: crypto.randomUUID() },
      });
      expect([403, 404]).toContain(denied.response.status());
      expect(denied.body).toMatchObject({ ok: false, error: { code: expect.any(String), safeMessage: expect.any(String) } });
    } finally { await other.close(); }

  } finally { await member.close(); }

  const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await anonymous.route("**/*", async (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === appOrigin || origin === supabaseOrigin) return route.continue();
    return route.abort();
  });
  try {
    const page = await anonymous.newPage();
    const preview = await apiJson(page, `/api/tables/${tableId}`);
    expect(preview.response.status()).toBe(200);
    expect(preview.body).toMatchObject({ ok: true, data: { view: "preview", table: { tableId, title: "W06 Garden Table", localDate: expect.any(String), neighborhood: "Inman Park" } } });
    expect(Object.keys((preview.body as { data: { table: object } }).data.table)).toEqual(["tableId", "title", "localDate", "neighborhood"]);
    await screenshotPair(page, "w06-table-shared-preview", async () => {
      await page.goto(`${appOrigin}/tables/${tableId}`);
      await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
      await expect(page.getByText(/Sharing this link does not invite anyone/i)).toBeVisible();
      await expect(page.getByRole("link", { name: /Sign in to continue/i })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Account" })).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Member navigation" })).toHaveCount(0);
      await expect(page.getByText("Public Bar")).toHaveCount(0);
    });
    const list = await apiJson(page, "/api/tables?limit=20");
    expect([401, 403]).toContain(list.response.status());
    expect(list.body).toMatchObject({ ok: false, error: { code: expect.any(String), safeMessage: expect.any(String) } });
    await page.goto(`${appOrigin}/tables`);
    await expect(page.getByRole("heading", { name: /Sign in to browse Tables/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Account" })).toHaveCount(0);

    await page.goto(`${appOrigin}/tables/${tableId}`);
    await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
    const continuationLink = page.getByRole("link", { name: /Sign in to continue/i });
    await expect(continuationLink).toHaveAttribute("href", `/sign-in?returnTo=${encodeURIComponent(`/tables/${tableId}`)}`);
    await continuationLink.click();
    await page.waitForURL(`${appOrigin}/sign-in?returnTo=${encodeURIComponent(`/tables/${tableId}`)}`);
    await expect(page.getByText(/After sign in, we’ll return you to the page you selected/i)).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    const linkResponse = await page.request.post(`${appOrigin}/api/auth/request-link`, {
      headers: { origin: appOrigin },
      data: { email: process.env.W06_MEMBER_EMAIL!, safeReturnTo: `/tables/${tableId}` },
    });
    expect(linkResponse.status()).toBe(200);
    expect(await linkResponse.json()).toEqual({ accepted: true });

    let interceptedLink = "";
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !interceptedLink) {
      const messagesResponse = await fetch(`${mailpitOrigin}/api/v1/messages?limit=100`, { cache: "no-store" });
      expect(messagesResponse.ok).toBe(true);
      const messagesBody: unknown = await messagesResponse.json();
      if (typeof messagesBody === "object" && messagesBody !== null && "messages" in messagesBody && Array.isArray(messagesBody.messages)) {
        const message = messagesBody.messages.find((item) => typeof item === "object" && item !== null
          && "Subject" in item && typeof item.Subject === "string" && item.Subject.includes("Your Fifth Wheel sign-in link")
          && "To" in item && Array.isArray(item.To) && item.To.some((recipient) => typeof recipient === "object" && recipient !== null
            && "Address" in recipient && typeof recipient.Address === "string" && recipient.Address.toLowerCase() === process.env.W06_MEMBER_EMAIL!.toLowerCase()));
        if (typeof message === "object" && message !== null && "ID" in message && typeof message.ID === "string") {
          const messageResponse = await fetch(`${mailpitOrigin}/api/v1/message/${encodeURIComponent(message.ID)}`, { cache: "no-store" });
          expect(messageResponse.ok).toBe(true);
          const mail = await messageResponse.json() as { HTML?: unknown };
          if (typeof mail.HTML === "string") {
            const href = mail.HTML.match(/href="(http:\/\/127\.0\.0\.1:8086\/auth\/callback\?[^\"]+)"/);
            interceptedLink = href?.[1]?.replaceAll("&amp;", "&") ?? "";
          }
        }
      }
      if (!interceptedLink) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(interceptedLink).toMatch(/^http:\/\/127\.0\.0\.1:8086\/auth\/callback\?token_hash=/);
    expect(new URL(interceptedLink).searchParams.get("safeReturnTo")).toBe(`/tables/${tableId}`);
    await page.goto(interceptedLink);
    await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();
    const verifyResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/verify-link") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
    const verifyResponse = await verifyResponsePromise;
    expect(verifyResponse.status()).toBe(200);
    await page.waitForURL(`${appOrigin}/tables/${tableId}`);
    await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
  } finally { await anonymous.close(); }

  const unadmitted = await localSession(browser, "W06_UNADMITTED_EMAIL");
  try {
    const page = await unadmitted.newPage();
    const list = await apiJson(page, "/api/tables?limit=20");
    expect([401, 403]).toContain(list.response.status());
    expect(list.body).toMatchObject({ ok: false, error: { code: expect.any(String), safeMessage: expect.any(String) } });
    await page.goto(`${appOrigin}/tables`);
    await expect(page.getByRole("heading", { name: "An app invitation is required" })).toBeVisible();
    await expect(page.getByText(/Joining the waitlist does not grant app access/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    const detail = await apiJson(page, `/api/tables/${tableId}`);
    expect(detail.response.status()).toBe(200);
    expect(detail.body).toMatchObject({ ok: true, data: { view: "preview", table: { tableId, title: "W06 Garden Table" } } });
    await page.goto(`${appOrigin}/tables/${tableId}`);
    await expect(page.getByRole("heading", { name: "W06 Garden Table" })).toBeVisible();
    await expect(page.getByText(/Sharing this link does not invite anyone/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Account" })).toHaveCount(0);
  } finally { await unadmitted.close(); }

  const incomplete = await localSession(browser, "W06_INCOMPLETE_MEMBER_EMAIL");
  try {
    const page = await incomplete.newPage();
    const list = await apiJson(page, "/api/tables?limit=20");
    expect(list.response.status()).toBe(409);
    expect(list.body).toMatchObject({ ok: false, error: { code: "profile_incomplete", safeMessage: expect.any(String) } });
    const detail = await apiJson(page, `/api/tables/${tableId}`);
    expect(detail.response.status()).toBe(409);
    expect(detail.body).toMatchObject({ ok: false, error: { code: "profile_incomplete", safeMessage: expect.any(String) } });
    const deniedRequest = await apiJson(page, `/api/tables/${tableId}/requests`, {
      method: "POST", headers: { origin: appOrigin }, data: { operationId: crypto.randomUUID() },
    });
    expect(deniedRequest.response.status()).toBe(409);
    expect(deniedRequest.body).toMatchObject({ ok: false, error: { code: "profile_incomplete", safeMessage: expect.any(String) } });
    await page.goto(`${appOrigin}/tables`);
    await expect(page.getByRole("heading", { name: /Finish your profile to browse/i })).toBeVisible();
    await page.goto(`${appOrigin}/tables/${tableId}`);
    await expect(page.getByRole("heading", { name: /Complete your profile first/i })).toBeVisible();
  } finally { await incomplete.close(); }
});
