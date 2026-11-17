import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

// Driven by scripts/run-w05-browser.mjs against the isolated local test stack.
const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";

async function localSession(browser: Browser, emailVariable: string): Promise<BrowserContext> {
  const email = process.env[emailVariable];
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!email || !publishableKey || !serviceRoleKey) throw new Error(`Missing local test identity for ${emailVariable}`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", async (route) => {
    const origin = new URL(route.request().url()).origin;
    return origin === appOrigin || origin === supabaseOrigin ? route.continue() : route.abort();
  });
  const generated = await context.request.post(`${supabaseOrigin}/auth/v1/admin/generate_link`, {
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
    data: { type: "magiclink", email, redirect_to: `${appOrigin}/auth/callback` },
  });
  if (!generated.ok()) throw new Error(`Local test link generation failed (${generated.status()})`);
  const { hashed_token: tokenHash } = await generated.json() as { hashed_token?: string };
  const verified = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, {
    headers: { apikey: publishableKey, "content-type": "application/json" },
    data: { token_hash: tokenHash, type: "magiclink" },
  });
  if (!verified.ok()) throw new Error(`Local test session verification failed (${verified.status()})`);
  const session = await verified.json() as { user?: { email?: string }; access_token?: string; refresh_token?: string };
  if (session.user?.email?.toLowerCase() !== email.toLowerCase() || !session.access_token || !session.refresh_token) throw new Error("Local test session identity mismatch");
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

test("admin curates venues and publishes a Table entirely in the app", async ({ browser, request }) => {
  const suffix = process.env.W05_RUN_SUFFIX ?? "";
  expect(suffix).toMatch(/^[a-f0-9]{12}$/i);
  const probeVenue = `${appOrigin}/api/supply/venues/0b7c7c1e-3a59-4c8f-9f0e-${suffix}`;
  const venueBody = { name: "Probe", address: "1 Probe Way", neighborhood: "Inman Park", active: true };

  expect((await request.put(probeVenue, { headers: { origin: appOrigin }, data: venueBody })).status()).toBe(401);
  const viewer = await localSession(browser, "W05_NON_ADMIN_EMAIL");
  try {
    expect((await viewer.request.put(probeVenue, { headers: { origin: appOrigin }, data: venueBody })).status()).toBe(403);
    expect((await viewer.request.get(`${appOrigin}/api/supply/tables`)).status()).toBe(403);
  } finally { await viewer.close(); }

  const admin = await localSession(browser, "W05_ADMIN_EMAIL");
  try {
    const page = await admin.newPage();
    await page.goto(`${appOrigin}/admin/tables`);
    await expect(page.getByRole("heading", { name: "Manage Tables" })).toBeVisible();
    await expect(page.getByText(/airtable/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Venues", exact: true })).toBeVisible();

    // Add three venues. The first save's response is dropped; the retry reuses the same id, so there is still one venue.
    const venueNames = ["Drinks", "Dinner", "Dessert"].map((role) => `W05 ${role} ${suffix}`);
    const venuePuts: string[] = [];
    let dropFirst = true;
    await page.route(/\/api\/supply\/venues\/[0-9a-f-]+$/i, async (route) => {
      venuePuts.push(new URL(route.request().url()).pathname);
      if (dropFirst) { dropFirst = false; return route.abort("failed"); }
      return route.continue();
    });
    for (const [index, name] of venueNames.entries()) {
      await page.getByRole("button", { name: "Add venue" }).click();
      const dialog = page.getByRole("dialog", { name: "Add venue" });
      await dialog.getByLabel("Venue name").fill(name);
      await dialog.getByLabel("Street address").fill(`${index + 1} Test Way`);
      await dialog.getByLabel("Neighborhood").fill("Inman Park");
      await dialog.getByRole("button", { name: "Save venue" }).click();
      if (index === 0) {
        await expect(dialog.getByText("We’re not sure that saved. Try again; it won’t create a duplicate.")).toBeVisible();
        await dialog.getByRole("button", { name: "Save venue" }).click();
      }
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(name, { exact: true })).toHaveCount(1);
    }
    expect(venuePuts[0]).toBe(venuePuts[1]);
    await page.unroute(/\/api\/supply\/venues\/[0-9a-f-]+$/i);

    // A fourth venue, archived, must not be offered for new stops.
    const archivedName = `W05 Archived ${suffix}`;
    await page.getByRole("button", { name: "Add venue" }).click();
    let dialog = page.getByRole("dialog", { name: "Add venue" });
    await dialog.getByLabel("Venue name").fill(archivedName);
    await dialog.getByLabel("Street address").fill("9 Test Way");
    await dialog.getByLabel("Neighborhood").fill("Inman Park");
    await dialog.getByRole("button", { name: "Save venue" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: `Edit ${archivedName}` }).click();
    dialog = page.getByRole("dialog", { name: "Edit venue" });
    await dialog.getByLabel(/Active/).uncheck();
    await dialog.getByRole("button", { name: "Save venue" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".supply-venue-row", { hasText: archivedName }).getByText("Archived", { exact: true })).toBeVisible();

    // Create a Table from those venues.
    const title = `W05 Curated Table ${suffix}`;
    await page.getByRole("button", { name: "Create draft" }).click();
    const create = page.getByRole("dialog", { name: "New table draft" });
    await create.getByLabel("Public Table title").fill(title);
    await create.getByLabel("Neighborhood").fill("Inman Park");
    await create.getByLabel("Atlanta local date").fill("2026-12-10");
    await create.getByLabel("Atlanta local start time").fill("19:00");
    await expect(create.getByLabel("Drinks venue").locator("option", { hasText: archivedName })).toHaveCount(0);
    for (const [index, role] of ["Drinks", "Dinner", "Dessert"].entries()) {
      await create.getByLabel(`${role} venue`).selectOption({ label: `${venueNames[index]} · Inman Park` });
    }
    const created = page.waitForResponse((response) => response.url().endsWith("/api/supply/drafts") && response.request().method() === "POST");
    await create.getByRole("button", { name: "Create private draft" }).click();
    expect((await created).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/tables\/[0-9a-f-]{36}$/);
    const tableId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.getByRole("button", { name: "Preview revision" }).click();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve changes" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved. Not live yet.")).toBeVisible();
    await page.getByRole("button", { name: "Preview revision" }).click();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published. Guests can see it now.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current guest-visible revision" })).toBeVisible();

    const published = await admin.request.get(`${appOrigin}/api/supply/tables/${tableId}`);
    const publishedEnvelope = await published.json() as { data?: { lifecycle?: string; published?: { content?: { stops?: Array<{ venueName?: string }> } } } };
    expect(publishedEnvelope.data?.lifecycle).toBe("published");
    expect(publishedEnvelope.data?.published?.content?.stops?.map((stop) => stop.venueName)).toEqual(venueNames);

    // Duplicate prefills a new draft from this Table, without its date.
    await page.getByRole("link", { name: "Duplicate" }).click();
    const duplicate = page.getByRole("dialog", { name: "New table draft" });
    await expect(duplicate.getByLabel("Public Table title")).toHaveValue(title);
    await expect(duplicate.getByLabel("Atlanta local date")).toHaveValue("");
    await expect(duplicate.getByLabel("Dinner venue")).toHaveValue(/[0-9a-f-]{36}/);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await admin.close(); }
});
