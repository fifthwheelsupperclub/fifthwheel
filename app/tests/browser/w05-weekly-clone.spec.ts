import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";
const screenshotDirectory = resolve("docs/implementation/screenshots");

async function localSession(browser: Browser, emailVariable: string): Promise<BrowserContext> {
  const email = process.env[emailVariable];
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!email || !publishableKey || !serviceRoleKey) throw new Error(`Missing local test identity for ${emailVariable}`);
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
  if (!generated.ok()) throw new Error(`Local test link generation failed (${generated.status()})`);
  const generatedBody = await generated.json() as { hashed_token?: string; email?: string };
  if (generatedBody.email?.toLowerCase() !== email.toLowerCase() || typeof generatedBody.hashed_token !== "string") throw new Error("Local test link identity mismatch");
  const verified = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, {
    headers: { apikey: publishableKey, "content-type": "application/json" },
    data: { token_hash: generatedBody.hashed_token, type: "magiclink" },
  });
  if (!verified.ok()) throw new Error(`Local test session verification failed (${verified.status()})`);
  const session = await verified.json() as { user?: { email?: string }; access_token?: string; refresh_token?: string };
  if (session.user?.email?.toLowerCase() !== email.toLowerCase() || !session.access_token || !session.refresh_token) throw new Error("Local test session did not match the fixture");
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

function mondayFor(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = new Date(`${date}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

test("W05.3 authorized admin previews, clones in one step, replays safely and undoes a weekly draft", async ({ browser, request }) => {
  const suffix = process.env.W05_RUN_SUFFIX;
  expect(suffix).toMatch(/^[a-f0-9]{12}$/i);
  await mkdir(screenshotDirectory, { recursive: true });
  expect((await request.get(`${appOrigin}/api/admin/supply/weekly-clone/operations?limit=5`)).status()).toBe(401);

  const viewer = await localSession(browser, "W05_NON_ADMIN_EMAIL");
  try {
    expect((await viewer.request.get(`${appOrigin}/api/admin/supply/weekly-clone/operations?limit=5`)).status()).toBe(403);
    expect((await viewer.request.post(`${appOrigin}/api/admin/supply/weekly-clone/preview`, {
      headers: { origin: appOrigin }, data: { sourceWeekStart: "2026-11-30", targetWeekStart: "2026-12-07" },
    })).status()).toBe(403);
    expect((await viewer.request.post(`${appOrigin}/api/admin/supply/weekly-clone`, {
      headers: { origin: appOrigin }, data: { operationId: crypto.randomUUID(), sourceWeekStart: "2026-11-30", targetWeekStart: "2026-12-07" },
    })).status()).toBe(403);
  } finally { await viewer.close(); }

  const admin = await localSession(browser, "W05_ADMIN_EMAIL");
  try {
    const supplyResponse = await admin.request.get(`${appOrigin}/api/supply/tables?limit=50`);
    expect(supplyResponse.status()).toBe(200);
    const supply = await supplyResponse.json() as { data?: { items?: Array<{ tableId: string; title: string }> } };
    const sourceTemplate = supply.data?.items?.find((row) => row.title === `W05 Curated Table ${suffix}`);
    expect(sourceTemplate, "the preceding W05 curation journey must leave its published Table").toBeTruthy();
    const detailResponse = await admin.request.get(`${appOrigin}/api/supply/tables/${encodeURIComponent(sourceTemplate!.tableId)}`);
    expect(detailResponse.status()).toBe(200);
    const detail = await detailResponse.json() as { data?: { published?: { content?: Record<string, unknown> } } };
    expect(detail.data?.published?.content).toBeTruthy();
    const content = { ...detail.data!.published!.content!, title: `Synthetic weekly clone source ${suffix}`, localDate: "2026-11-19" };
    const createdResponse = await admin.request.post(`${appOrigin}/api/supply/drafts`, {
      headers: { origin: appOrigin },
      data: { operationId: crypto.randomUUID(), source: { kind: "manual", content } },
    });
    expect(createdResponse.status()).toBe(200);

    const sourceWeek = mondayFor(String(content.localDate));
    const target = new Date(`${sourceWeek}T12:00:00Z`); target.setUTCDate(target.getUTCDate() + 7);
    const targetWeek = target.toISOString().slice(0, 10);
    const page = await admin.newPage();
    await page.goto(`${appOrigin}/admin/tables/weekly-clone`);
    await expect(page.getByRole("heading", { name: "Copy a week" })).toBeVisible();
    await expect(page.locator(".weekly-clone-page")).toHaveAttribute("data-client-ready", "true");
    await page.getByLabel("Copy from (week of)").fill(sourceWeek);
    await page.getByLabel("Copy to (week of)").fill(targetWeek);
    const previewResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/supply/weekly-clone/preview") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    expect((await previewResponse).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Drafts to review" })).toBeVisible();
    await expect(page.getByText(String(content.title), { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review copy" })).toBeEnabled();
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-weekly-clone-preview-desktop.png"), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-weekly-clone-preview-390px.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Review copy" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /^Copy \d+ drafts to the week of/ })).toBeVisible();
    // Commit the first request on the server but drop its browser response; the
    // retry must replay the same operation ID and return the committed result.
    const operationIds: string[] = [];
    let dropped = false;
    await page.route("**/api/admin/supply/weekly-clone", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      operationIds.push(String((JSON.parse(route.request().postData() ?? "{}") as { operationId?: string }).operationId));
      if (dropped) return route.continue();
      dropped = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await committed.body();
      await route.abort("failed");
    });
    await dialog.getByRole("button", { name: "Copy drafts" }).click();
    await expect(page.getByText("We couldn’t confirm the copy. Try again; it won’t copy twice.")).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Drafts copied", { exact: true }).first()).toBeVisible();
    expect(operationIds).toHaveLength(2);
    expect(operationIds[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(operationIds[1]).toBe(operationIds[0]);
    await expect(page.locator(".weekly-clone-operation code")).toHaveText(operationIds[0]!);
    const copiedLinks = page.getByRole("link", { name: "Open copied draft" });
    const copiedCount = await copiedLinks.count();
    expect(copiedCount).toBeGreaterThan(0);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-weekly-clone-complete-desktop.png"), fullPage: true });

    // History comes from the server, so a reload can reopen the copy and undo it.
    await page.unroute("**/api/admin/supply/weekly-clone");
    await page.reload();
    const recentOperation = page.getByRole("button", { name: `Open weekly operation ${operationIds[0]}` });
    await expect(recentOperation).toBeVisible();
    await recentOperation.click();
    await expect(page.locator(".weekly-clone-operation code")).toHaveText(operationIds[0]!);
    await expect(page.getByRole("link", { name: "Open copied draft" })).toHaveCount(copiedCount);
    await page.getByRole("button", { name: "Undo…" }).click();
    const undoResponse = page.waitForResponse((response) => /\/api\/admin\/supply\/weekly-clone\/operations\/[0-9a-f-]+\/undo$/i.test(response.url()) && response.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "Undo copy" }).click();
    expect((await undoResponse).status()).toBe(200);
    await expect(page.getByText("Copies removed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open copied draft" })).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-weekly-clone-undone-desktop.png"), fullPage: true });
    await page.close();
  } finally { await admin.close(); }
});
