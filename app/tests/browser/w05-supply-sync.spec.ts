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
  if (generatedBody.email?.toLowerCase() !== email.toLowerCase() || typeof generatedBody.hashed_token !== "string") {
    throw new Error("Local test link did not match its run-scoped identity");
  }
  const verified = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, {
    headers: { apikey: publishableKey, "content-type": "application/json" },
    data: { token_hash: generatedBody.hashed_token, type: "magiclink" },
  });
  if (!verified.ok()) throw new Error(`Local test session verification failed (${verified.status()})`);
  const session = await verified.json() as { user?: { email?: string }; access_token?: string; refresh_token?: string };
  if (session.user?.email?.toLowerCase() !== email.toLowerCase() || !session.access_token || !session.refresh_token) {
    throw new Error("Local test session identity did not match its fixture");
  }
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

test("W05 local fixture sync stages a durable candidate without moving last-good supply", async ({ browser, request }) => {
  expect(process.env.SUPPLY_PROVIDER_MODE).toBe("fixture");
  expect(process.env.SUPPLY_FIXTURE_RUN_ID).toMatch(/^[a-f0-9]{12}$/i);
  await mkdir(screenshotDirectory, { recursive: true });

  const anonymousGet = await request.get(`${appOrigin}/api/admin/supply/sync`);
  expect(anonymousGet.status()).toBe(401);
  const anonymousPost = await request.post(`${appOrigin}/api/admin/supply/sync`, {
    headers: { origin: appOrigin }, data: { operationId: "f1a7b25e-6826-4b0f-9be5-774a6202ad72" },
  });
  expect(anonymousPost.status()).toBe(401);

  const nonAdmin = await localSession(browser, "W05_NON_ADMIN_EMAIL");
  try {
    const deniedGet = await nonAdmin.request.get(`${appOrigin}/api/admin/supply/sync`);
    expect(deniedGet.status()).toBe(403);
    const deniedPost = await nonAdmin.request.post(`${appOrigin}/api/admin/supply/sync`, {
      headers: { origin: appOrigin }, data: { operationId: "f1a7b25e-6826-4b0f-9be5-774a6202ad73" },
    });
    expect(deniedPost.status()).toBe(403);
  } finally {
    await nonAdmin.close();
  }

  const admin = await localSession(browser, "W05_ADMIN_EMAIL");
  try {
    const baselineResponse = await admin.request.get(`${appOrigin}/api/admin/supply/sync`, { headers: { accept: "application/json" } });
    expect(baselineResponse.status()).toBe(200);
    const baselineEnvelope = await baselineResponse.json() as { ok?: boolean; data?: { providerState?: string; lastGoodPublished?: unknown } };
    expect(baselineEnvelope.ok).toBe(true);
    expect(baselineEnvelope.data?.providerState).toBe("fixture");
    const baselineLastGood = baselineEnvelope.data?.lastGoodPublished ?? null;
    const supplyListResponse = await admin.request.get(`${appOrigin}/api/supply/tables?limit=50`, { headers: { accept: "application/json" } });
    const supplyListBody = await supplyListResponse.text();
    expect(supplyListResponse.status(), `Safe supply-list response envelope: ${supplyListBody}`).toBe(200);

    const page = await admin.newPage();
    await page.goto(`${appOrigin}/admin/tables`);
    await expect(page.getByRole("heading", { name: "Manage Tables" })).toBeVisible();
    await expect(page.getByText("Local test data", { exact: true })).toBeVisible();
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/supply/sync") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Check Airtable" }).click();
    const syncResponse = await responsePromise;
    expect(syncResponse.status()).toBe(200);
    const syncEnvelope = await syncResponse.json() as { ok?: boolean; data?: { runId?: string; state?: string; counts?: { tables?: number; venues?: number }; candidateRevisionId?: string | null } };
    expect(syncEnvelope.ok).toBe(true);
    expect(syncEnvelope.data?.state).toBe("staged");
    expect(syncEnvelope.data?.candidateRevisionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(syncEnvelope.data?.counts).toMatchObject({ tables: 1, venues: 2 });

    await expect(page.getByRole("heading", { name: "Tables ready for review" })).toBeVisible();
    await expect(page.getByText(new RegExp(`Synthetic Thursday Table ${process.env.SUPPLY_FIXTURE_RUN_ID}`))).toBeVisible();
    const runId = syncEnvelope.data?.runId;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tables ready for review" })).toBeVisible();
    const afterReload = await admin.request.get(`${appOrigin}/api/admin/supply/sync`, { headers: { accept: "application/json" } });
    expect(afterReload.status()).toBe(200);
    const afterEnvelope = await afterReload.json() as { ok?: boolean; data?: { lastGoodPublished?: unknown; latestRun?: { runId?: string; state?: string } | null } };
    expect(afterEnvelope.ok).toBe(true);
    expect(afterEnvelope.data?.latestRun).toMatchObject({ runId, state: "staged" });
    expect(afterEnvelope.data?.lastGoodPublished ?? null).toEqual(baselineLastGood);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-supply-sync-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText("Local test data", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-supply-sync-390px.png"), fullPage: true });
    console.log("W05 fixture sync persisted staged state; last-good published pointer was unchanged.");
  } finally {
    await admin.close();
  }
});

test("W05.2 admin can create, revise, accept and publish a local synthetic Table", async ({ browser, request }) => {
  expect(process.env.SUPPLY_PROVIDER_MODE).toBe("fixture");
  const suffix = process.env.SUPPLY_FIXTURE_RUN_ID;
  expect(suffix).toMatch(/^[a-f0-9]{12}$/i);

  const anonymousList = await request.get(`${appOrigin}/api/supply/tables`);
  expect(anonymousList.status()).toBe(401);
  const viewer = await localSession(browser, "W05_NON_ADMIN_EMAIL");
  try {
    const denied = await viewer.request.get(`${appOrigin}/api/supply/tables`);
    expect(denied.status()).toBe(403);
  } finally { await viewer.close(); }

  const admin = await localSession(browser, "W05_ADMIN_EMAIL");
  try {
    const listResponse = await admin.request.get(`${appOrigin}/api/supply/tables?limit=50`);
    const listBody = await listResponse.text();
    expect(listResponse.status(), `Safe supply-list response envelope: ${listBody}`).toBe(200);
    const listEnvelope = JSON.parse(listBody) as { ok?: boolean; data?: { providerState?: string; canCreateDraft?: boolean; stagedCandidates?: Array<{ title: string; tableId: string; sourceRevisionId: string; canCreateDraft: boolean }> } };
    expect(listEnvelope.ok).toBe(true);
    expect(listEnvelope.data).toMatchObject({ providerState: "fixture", canCreateDraft: true });
    const candidateTitle = `Synthetic Thursday Table ${suffix}`;
    const candidate = listEnvelope.data?.stagedCandidates?.find((item) => item.title === candidateTitle);
    expect(candidate).toMatchObject({ title: candidateTitle, canCreateDraft: true });

    const page = await admin.newPage();
    await page.goto(`${appOrigin}/admin/tables`);
    await expect(page.getByRole("heading", { name: "Tables ready for review" })).toBeVisible();
    await expect(page.getByText(candidateTitle, { exact: true })).toBeVisible();
    let createBody = "";
    await page.route("**/api/supply/drafts", async (route) => {
      const response = await route.fetch();
      createBody = await response.text();
      await route.fulfill({ response, body: createBody });
    });
    const createResponse = page.waitForResponse((response) => response.url().endsWith("/api/supply/drafts") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Review Table details" }).click();
    const created = await createResponse;
    const postedSource = JSON.parse(created.request().postData() ?? "{}") as { source?: { tableId?: string; revisionId?: string } };
    console.log("W05 candidate create identifiers", JSON.stringify({ posted: postedSource.source, candidate: candidate && { tableId: candidate.tableId, sourceRevisionId: candidate.sourceRevisionId } }));
    expect(postedSource.source).toMatchObject({ tableId: candidate?.tableId, revisionId: candidate?.sourceRevisionId });
    expect(created.status(), `Safe draft-create response envelope: ${createBody}`).toBe(200);
    const createEnvelope = JSON.parse(createBody) as { ok?: boolean; data?: { tableId?: string; draft?: { state?: string; revisionId?: string; revision?: number } } };
    expect(createEnvelope.ok).toBe(true);
    expect(createEnvelope.data?.tableId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(createEnvelope.data?.draft).toMatchObject({ state: "draft", revision: 1 });
    await expect(page).toHaveURL(new RegExp(`/admin/tables/${createEnvelope.data?.tableId}$`));
    await expect(page.getByRole("heading", { name: candidateTitle })).toBeVisible();
    await expect(page.getByLabel("Public Table title")).toHaveValue(candidateTitle);
    await expect(page.getByLabel("Private host notes")).toBeVisible();
    await expect(page.getByLabel("Drinks venue")).toHaveValue(/.+/);

    await page.getByLabel("Public Table title").fill("No");
    const invalidSaveResponse = page.waitForResponse((response) => response.url().match(/\/api\/supply\/drafts\/[0-9a-f-]+$/i) && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Save draft" }).click();
    expect((await invalidSaveResponse).status()).toBe(422);
    await expect(page.getByText("Enter a Table title between 3 and 180 characters.", { exact: true })).toBeVisible();
    const unchangedResponse = await admin.request.get(`${appOrigin}/api/supply/tables/${encodeURIComponent(createEnvelope.data?.tableId ?? "")}`);
    expect(unchangedResponse.status()).toBe(200);
    const unchangedEnvelope = await unchangedResponse.json() as { ok?: boolean; data?: { draft?: { revision?: number; content?: { title?: string } } } };
    expect(unchangedEnvelope.data?.draft).toMatchObject({ revision: 1, content: { title: candidateTitle } });

    await page.getByLabel("Public Table title").fill(`${candidateTitle} · reviewed`);
    await page.getByLabel("Private host notes").fill(`Fixture-only host note ${suffix}`);
    await page.locator("#detail-drinks-public-notes").fill("Synthetic guest note; no real venue details.");
    const saveOperations: string[] = [];
    let abortFirstSave = true;
    const saveRoute = /\/api\/supply\/drafts\/[0-9a-f-]+$/i;
    await page.route(saveRoute, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const requestBody = JSON.parse(route.request().postData() ?? "{}") as { operationId?: string };
      saveOperations.push(String(requestBody.operationId ?? ""));
      if (abortFirstSave) {
        abortFirstSave = false;
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("We could not confirm the save. Retry will reuse the same operation ID.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-table-detail-save-uncertain-desktop.png"), fullPage: true });
    const beforeRetryResponse = await admin.request.get(`${appOrigin}/api/supply/tables/${encodeURIComponent(createEnvelope.data?.tableId ?? "")}`);
    expect(beforeRetryResponse.status()).toBe(200);
    const beforeRetryEnvelope = await beforeRetryResponse.json() as { ok?: boolean; data?: { draft?: { revision?: number; content?: { title?: string } } } };
    expect(beforeRetryEnvelope.data?.draft).toMatchObject({ revision: 1, content: { title: candidateTitle } });
    const saveResponse = page.waitForResponse((response) => response.url().match(/\/api\/supply\/drafts\/[0-9a-f-]+$/i) && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Retry save" }).click();
    expect((await saveResponse).status()).toBe(200);
    expect(saveOperations).toHaveLength(2);
    expect(saveOperations[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(saveOperations[1]).toBe(saveOperations[0]);
    await expect(page.getByText("Draft saved. It is still private and not accepted or published.")).toBeVisible();
    const afterRetryResponse = await admin.request.get(`${appOrigin}/api/supply/tables/${encodeURIComponent(createEnvelope.data?.tableId ?? "")}`);
    expect(afterRetryResponse.status()).toBe(200);
    const afterRetryEnvelope = await afterRetryResponse.json() as { ok?: boolean; data?: { draft?: { revision?: number; content?: { title?: string } } } };
    expect(afterRetryEnvelope.data?.draft).toMatchObject({ revision: 2, content: { title: `${candidateTitle} · reviewed` } });
    await page.reload();
    await expect(page.getByLabel("Private host notes")).toHaveValue(`Fixture-only host note ${suffix}`);
    await expect(page.locator("#detail-drinks-public-notes")).toHaveValue("Synthetic guest note; no real venue details.");

    const previewResponse = page.waitForResponse((response) => response.url().match(/\/api\/supply\/drafts\/[0-9a-f-]+\/preview$/i) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Preview revision" }).click();
    const preview = await previewResponse;
    expect(preview.status()).toBe(200);
    const previewEnvelope = await preview.json() as { ok?: boolean; data?: { valid?: boolean; canAccept?: boolean; canPublish?: boolean } };
    expect(previewEnvelope.data).toMatchObject({ valid: true, canAccept: true, canPublish: false });
    await expect(page.getByText("Ready for review", { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-table-detail-draft-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-table-detail-draft-390px.png"), fullPage: true });

    await page.getByRole("button", { name: "Accept revision" }).click();
    await expect(page.getByRole("heading", { name: "Accept this revision?" })).toBeVisible();
    const acceptResponse = page.waitForResponse((response) => response.url().match(/\/accept$/) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Confirm acceptance" }).click();
    expect((await acceptResponse).status()).toBe(200);
    await expect(page.getByText("accepted", { exact: true })).toBeVisible();

    const acceptedPreviewResponse = page.waitForResponse((response) => response.url().match(/\/preview$/) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Preview revision" }).click();
    const acceptedPreview = await acceptedPreviewResponse;
    const acceptedEnvelope = await acceptedPreview.json() as { ok?: boolean; data?: { valid?: boolean; canAccept?: boolean; canPublish?: boolean } };
    expect(acceptedEnvelope.data).toMatchObject({ valid: true, canAccept: true, canPublish: true });
    await page.getByRole("button", { name: "Publish revision" }).click();
    await expect(page.getByRole("heading", { name: "Publish this revision?" })).toBeVisible();
    const publishResponse = page.waitForResponse((response) => response.url().match(/\/publish$/) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Confirm publication" }).click();
    expect((await publishResponse).status()).toBe(200);
    await expect(page.getByText("Revision published. The accepted supply is now the current guest read model.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current guest-visible revision" })).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-table-detail-published-390px.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${appOrigin}/admin/tables`);
    await expect(page.getByRole("heading", { name: "Manage Tables" })).toBeVisible();
    await expect(page.getByText(`${candidateTitle} · reviewed`, { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-tables-list-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-tables-list-390px.png"), fullPage: true });

    // UI fault injection only: the real published Table row is retained while
    // syncState is changed in the browser response; this does not test scanning.
    const missingListPattern = /\/api\/supply\/tables(?:\?.*)?$/;
    let missingListInjected = false;
    await page.route(missingListPattern, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const actual = await route.fetch();
      const envelope = await actual.json() as { data?: { items?: Array<Record<string, unknown>> } };
      const items = envelope.data?.items;
      expect(Array.isArray(items)).toBe(true);
      const retained = items?.find((item) => item.tableId === createEnvelope.data?.tableId);
      expect(retained).toMatchObject({ lifecycle: "published", syncState: "current" });
      expect(typeof retained?.publishedRevisionId).toBe("string");
      missingListInjected = true;
      const data = envelope.data!;
      const faultInjected = { ...envelope, data: { ...data, items: items!.map((item) => item.tableId === createEnvelope.data?.tableId ? { ...item, syncState: "missing" } : item) } };
      await route.fulfill({ status: actual.status(), headers: { "content-type": "application/json", "cache-control": "private, no-store" }, body: JSON.stringify(faultInjected) });
    });
    console.info("W05 UI fault injection: missing Table syncState; not provider/backend evidence.");
    const missingListResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/supply/tables" && response.request().method() === "GET");
    await page.reload();
    expect((await missingListResponse).status()).toBe(200);
    expect(missingListInjected).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: "Source record missing in latest sync" })).toBeVisible();
    const missingSourceRow = page.getByRole("link").filter({ hasText: `${candidateTitle} · reviewed` });
    await expect(missingSourceRow.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByText(`${candidateTitle} · reviewed`, { exact: true })).toBeVisible();

    const missingDetailPattern = new RegExp(`/api/supply/tables/${createEnvelope.data?.tableId}$`);
    let missingDetailInjected = false;
    await page.route(missingDetailPattern, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const actual = await route.fetch();
      const envelope = await actual.json() as { data?: Record<string, unknown> };
      const data = envelope.data;
      expect(data?.tableId).toBe(createEnvelope.data?.tableId);
      expect(data?.syncState).toBe("current");
      expect(data?.published).not.toBeNull();
      missingDetailInjected = true;
      await route.fulfill({
        status: actual.status(), headers: { "content-type": "application/json", "cache-control": "private, no-store" },
        body: JSON.stringify({ ...envelope, data: { ...data, syncState: "missing", currentSyncState: "missing", canAccept: false, canPublish: false } }),
      });
    });
    const missingDetailResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/supply/tables/${createEnvelope.data?.tableId}` && response.request().method() === "GET");
    await page.goto(`${appOrigin}/admin/tables/${encodeURIComponent(createEnvelope.data?.tableId ?? "")}`);
    expect((await missingDetailResponse).status()).toBe(200);
    expect(missingDetailInjected).toBe(true);
    await expect(page.getByText("The latest complete sync no longer includes this source record. The current published snapshot remains visible to members and is not changed by this conflict.", { exact: true })).toBeVisible();
    const publishedSnapshot = page.getByRole("heading", { name: "Current guest-visible revision" }).locator("xpath=ancestor::section[1]");
    await expect(publishedSnapshot).toBeVisible();
    await expect(publishedSnapshot.getByText(`${candidateTitle} · reviewed`, { exact: true })).toBeVisible();
    const missingPreviewResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/preview") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Preview revision" }).click();
    expect((await missingPreviewResponse).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Accept revision" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Publish revision" })).toBeDisabled();
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-table-source-missing-ui-injection-390px.png"), fullPage: true });
    await page.unroute(missingDetailPattern);
    await page.unroute(missingListPattern);
    await page.goto(`${appOrigin}/admin/tables`);
    await expect(page.getByRole("heading", { name: "Manage Tables" })).toBeVisible();

    // Response fault injection only: preserve live test-project rows and simulate a
    // provider capability response; this is not evidence of provider integration.
    let responseFaultInjected = false;
    await page.route("**/api/supply/tables**", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const actual = await route.fetch();
      const actualEnvelope = await actual.json() as { data?: Record<string, unknown> };
      const actualData = actualEnvelope.data;
      expect(Array.isArray(actualData?.items)).toBe(true);
      expect((actualData?.items as Array<{ title?: string }>).some((item) => item.title === `${candidateTitle} · reviewed`)).toBe(true);
      responseFaultInjected = true;
      const injectedEnvelope = {
        ...actualEnvelope,
        data: { ...actualData, providerState: "disabled_unmapped", mutationsEnabled: false, canCreateDraft: false },
      };
      await route.fulfill({ status: actual.status(), headers: { "content-type": "application/json", "cache-control": "private, no-store" }, body: JSON.stringify(injectedEnvelope) });
    });
    console.info("W05 response fault injection: disabled_unmapped UI state; not provider integration evidence.");
    const faultInjectedListResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/supply/tables" && response.request().method() === "GET");
    await page.reload();
    expect((await faultInjectedListResponse).status()).toBe(200);
    expect(responseFaultInjected).toBe(true);
    await expect(page.getByText("Airtable fields need setup", { exact: true })).toBeVisible();
    await expect(page.getByText("We have not confirmed how Airtable fields match Table details. Creating, approving, and publishing are paused.", { exact: true })).toBeVisible();
    await expect(page.getByText(`${candidateTitle} · reviewed`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create draft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check Airtable" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review Table details" })).toHaveCount(0);
    await page.screenshot({ path: resolve(screenshotDirectory, "w05-admin-tables-disabled-unmapped-response-fault-injection-390px.png"), fullPage: true });
  } finally { await admin.close(); }
});
