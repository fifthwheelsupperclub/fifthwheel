import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";
const screenshotDirectory = resolve("docs/implementation/screenshots");

async function localSession(browser: Browser, emailVariable: string): Promise<BrowserContext> {
  const email = process.env[emailVariable];
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
  if (!email || !publishableKey || !serviceRoleKey) throw new Error(`Missing local fixture environment for ${emailVariable}`);

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
  if (!generated.ok()) throw new Error(`Local fixture magic-link generation failed (${generated.status()})`);
  const generatedBody = await generated.json() as { hashed_token?: string; email?: string };
  if (generatedBody.email?.toLowerCase() !== email.toLowerCase() || typeof generatedBody.hashed_token !== "string") {
    throw new Error("Local fixture magic-link response did not match the named test identity");
  }
  const verified = await context.request.post(`${supabaseOrigin}/auth/v1/verify`, {
    headers: { apikey: publishableKey, "content-type": "application/json" },
    data: { token_hash: generatedBody.hashed_token, type: "magiclink" },
  });
  if (!verified.ok()) throw new Error(`Local fixture token verification failed (${verified.status()})`);
  const session = await verified.json() as { user?: { email?: string }; access_token?: string; refresh_token?: string };
  if (session.user?.email?.toLowerCase() !== email.toLowerCase() || !session.access_token || !session.refresh_token) {
    throw new Error("Local fixture session did not match the named test identity");
  }
  await context.addCookies([
    { name: "fw_access_token", value: session.access_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "fw_refresh_token", value: session.refresh_token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return context;
}

async function syntheticImage(red: number, green: number, blue: number) {
  return sharp({ create: { width: 512, height: 512, channels: 3, background: { r: red, g: green, b: blue } } })
    .png()
    .toBuffer();
}

test("W04 member profile submission and admin identity review work through the app", async ({ browser }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  const member = await localSession(browser, "W04_OWNER_EMAIL");
  try {
    const page = await member.newPage();
    page.on("response", async (response) => {
      if (!response.url().includes("/api/member/profile/files") || response.ok()) return;
      const body = await response.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
      const path = new URL(response.url()).pathname;
      const fields = body && typeof body === "object" && "fields" in body ? JSON.stringify(body.fields) : "{}";
      console.log(`[W04 profile upload] ${path} HTTP ${response.status()} ${String(body?.code ?? "unknown")}: ${String(body?.message ?? "no safe message")} ${fields}`);
    });
    await page.goto(`${appOrigin}/account/profile`);
    await expect(page.getByRole("heading", { name: /A good introduction/i })).toBeVisible();
    await expect(page.getByLabel("Women", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Men", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("Non-binary people", { exact: true })).toBeChecked();
    await expect(page.getByText("Matching ages can be set from 21 to 120.")).toBeVisible();

    await page.screenshot({ path: resolve(screenshotDirectory, "w04-profile-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: /A good introduction/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshotDirectory, "w04-profile-390px.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });

    const saveButton = page.getByRole("button", { name: "Save changes" });
    await page.getByLabel("Youngest").fill("120");
    await page.getByLabel("Oldest").fill("119");
    await saveButton.click();
    await expect(page.getByText("The oldest age must be at least the youngest age.")).toBeVisible();
    await page.getByLabel("Youngest").fill("21");
    await page.getByLabel("Oldest").fill("120");
    await expect(saveButton).toBeDisabled();
    await page.reload();

    for (const label of ["Women", "Men", "Non-binary people"]) await page.getByLabel(label, { exact: true }).setChecked(false);
    await saveButton.click();
    await expect(page.getByText("Choose at least one group you are open to meeting.")).toBeVisible();
    const preferenceSets = [
      ["Women"], ["Men"], ["Non-binary people"], ["Women", "Men"],
      ["Women", "Non-binary people"], ["Men", "Non-binary people"], ["Women", "Men", "Non-binary people"],
    ];
    for (const preferenceSet of preferenceSets) {
      const selected = new Set(preferenceSet);
      for (const label of ["Women", "Men", "Non-binary people"]) {
        await page.getByLabel(label, { exact: true }).setChecked(selected.has(label));
      }
      if (await saveButton.isEnabled()) {
        await saveButton.click();
        await expect(page.getByText("Saved.")).toBeVisible();
      }
      await page.reload();
      for (const label of ["Women", "Men", "Non-binary people"]) {
        if (selected.has(label)) await expect(page.getByLabel(label, { exact: true })).toBeChecked();
        else await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();
      }
    }

    await page.getByLabel("One-line introduction").fill("Synthetic W04 member profile, for local acceptance only.");
    await saveButton.click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("One-line introduction")).toHaveValue("Synthetic W04 member profile, for local acceptance only.");

    const photo = await syntheticImage(125, 89, 70);
    const selfie = await syntheticImage(92, 115, 87);
    const uploads = page.locator('input[type="file"]');
    await uploads.nth(0).setInputFiles({ name: "synthetic-profile.png", mimeType: "image/png", buffer: photo });
    await expect(page.locator(".evidence-card").nth(0).getByText("1 ready")).toBeVisible();
    await uploads.nth(1).setInputFiles({ name: "synthetic-selfie.png", mimeType: "image/png", buffer: selfie });
    await expect(page.locator(".evidence-card").nth(1).getByText("1 ready")).toBeVisible();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { name: "In review" })).toBeVisible();
    await expect(page.getByText("Your profile has been sent for review.")).toBeVisible();
    await page.screenshot({ path: resolve(screenshotDirectory, "w04-profile-submitted-desktop.png"), fullPage: true });
  } finally {
    await member.close();
  }

  const admin = await localSession(browser, "W04_ADMIN_EMAIL");
  try {
    const page = await admin.newPage();
    await page.goto(`${appOrigin}/admin/identity-review`);
    await expect(page.getByRole("heading", { name: "Profile review" })).toBeVisible();
    await expect(page.locator(".review-queue-item")).toHaveCount(1);
    await page.screenshot({ path: resolve(screenshotDirectory, "w04-admin-identity-queue-desktop.png"), fullPage: true });
    const detailPath = await page.locator(".review-queue-item").getAttribute("href");
    expect(detailPath).toMatch(/^\/admin\/identity-review\/[0-9a-f-]{36}$/i);
    const detailResponse = await page.goto(new URL(detailPath!, appOrigin).href);
    console.log(`[W04 admin detail navigation] HTTP ${detailResponse?.status()} ${page.url()}`);
    await expect(page.getByRole("heading", { name: "W04 Synthetic" })).toBeVisible();
    const evidenceImages = page.locator(".review-evidence-image img");
    await expect(evidenceImages).toHaveCount(2);
    await expect.poll(() => evidenceImages.evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    await page.screenshot({ path: resolve(screenshotDirectory, "w04-admin-review-detail-desktop.png"), fullPage: true });
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("button", { name: "Confirm approval" }).click();
    await expect(page.getByText("Decision saved")).toBeVisible();
  } finally {
    await admin.close();
  }

  const returningMember = await localSession(browser, "W04_OWNER_EMAIL");
  try {
    const page = await returningMember.newPage();
    await page.goto(`${appOrigin}/account/profile`);
    await expect(page.getByRole("heading", { name: "Approved" })).toBeVisible();
    await expect(page.getByLabel("One-line introduction")).toHaveValue("Synthetic W04 member profile, for local acceptance only.");
  } finally {
    await returningMember.close();
  }

  const resubmittingMember = await localSession(browser, "W04_OTHER_EMAIL");
  const memberPage = await resubmittingMember.newPage();
  try {
    await memberPage.goto(`${appOrigin}/account/profile`);
    await expect(memberPage.getByRole("heading", { name: /A good introduction/i })).toBeVisible();
    await expect(memberPage.getByLabel("Men", { exact: true })).toBeChecked();
    const profilePhoto = await syntheticImage(145, 98, 76);
    const privateSelfie = await syntheticImage(108, 127, 92);
    const uploads = memberPage.locator('input[type="file"]');
    await uploads.nth(0).setInputFiles({ name: "synthetic-correction-profile.png", mimeType: "image/png", buffer: profilePhoto });
    await expect(memberPage.locator(".evidence-card").nth(0).getByText("1 ready")).toBeVisible();
    await uploads.nth(1).setInputFiles({ name: "synthetic-correction-selfie.png", mimeType: "image/png", buffer: privateSelfie });
    await expect(memberPage.locator(".evidence-card").nth(1).getByText("1 ready")).toBeVisible();
    await memberPage.getByRole("button", { name: "Submit for review" }).click();
    await expect(memberPage.getByRole("heading", { name: "In review" })).toBeVisible();
  } catch (error) {
    await resubmittingMember.close();
    throw error;
  }

  const correctionAdmin = await localSession(browser, "W04_ADMIN_EMAIL");
  try {
    const page = await correctionAdmin.newPage();
    await page.goto(`${appOrigin}/admin/identity-review`);
    await expect(page.locator(".review-queue-item")).toHaveCount(1);
    const correctionPath = await page.locator(".review-queue-item").getAttribute("href");
    await page.goto(new URL(correctionPath!, appOrigin).href);
    await expect(page.getByRole("heading", { name: "W04 Synthetic" })).toBeVisible();
    await page.getByRole("button", { name: "Ask for changes" }).click();
    await page.getByLabel("What should they change?").fill("Please use a recent, well-lit profile photo.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Decision saved")).toBeVisible();
  } finally {
    await correctionAdmin.close();
  }

  await memberPage.reload();
  await expect(memberPage.getByRole("heading", { name: "Changes needed" })).toBeVisible();
  await expect(memberPage.getByText("Please use a recent, well-lit profile photo.")).toBeVisible();
  await memberPage.screenshot({ path: resolve(screenshotDirectory, "w04-profile-correction-requested-desktop.png"), fullPage: true });
  await memberPage.getByLabel("One-line introduction").fill("Updated after a synthetic correction request.");
  await memberPage.getByRole("button", { name: "Save changes" }).click();
  await expect(memberPage.getByText("Saved.")).toBeVisible();
  await memberPage.getByRole("button", { name: "Submit for review" }).click();
  await expect(memberPage.getByRole("heading", { name: "In review" })).toBeVisible();
  await expect(memberPage.getByText("Your profile has been sent for review.")).toBeVisible();

  const finalAdmin = await localSession(browser, "W04_ADMIN_EMAIL");
  try {
    const page = await finalAdmin.newPage();
    await page.goto(`${appOrigin}/admin/identity-review`);
    await expect(page.locator(".review-queue-item")).toHaveCount(1);
    const resubmittedPath = await page.locator(".review-queue-item").getAttribute("href");
    await page.goto(new URL(resubmittedPath!, appOrigin).href);
    await expect(page.getByText(/Review #2/)).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();

    // A critical member edit after review load must invalidate the stale admin view.
    await memberPage.getByLabel("Date of birth").fill("1990-04-15");
    await memberPage.getByRole("button", { name: "Save changes" }).click();
    await expect(memberPage.getByText("Saved.")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "Not submitted" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm approval" }).click();
    await expect(page.getByText("This profile changed after you opened it. Reload the latest review before deciding.")).toBeVisible();

    // Superseded evidence cannot be borrowed for the new critical identity version.
    const freshUploads = memberPage.locator('input[type="file"]');
    await freshUploads.nth(0).setInputFiles({ name: "synthetic-new-version-profile.png", mimeType: "image/png", buffer: await syntheticImage(134, 91, 75) });
    await expect(memberPage.locator(".evidence-card").nth(0).getByText("1 ready")).toBeVisible();
    await freshUploads.nth(1).setInputFiles({ name: "synthetic-new-version-selfie.png", mimeType: "image/png", buffer: await syntheticImage(98, 119, 85) });
    await expect(memberPage.locator(".evidence-card").nth(1).getByText("1 ready")).toBeVisible();
    await memberPage.getByRole("button", { name: "Submit for review" }).click();
    await expect(memberPage.getByRole("heading", { name: "In review" })).toBeVisible();

    await page.goto(`${appOrigin}/admin/identity-review`);
    await expect(page.locator(".review-queue-item")).toHaveCount(1);
    const currentPath = await page.locator(".review-queue-item").getAttribute("href");
    await page.goto(new URL(currentPath!, appOrigin).href);
    await expect(page.getByText(/Review #3/)).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("button", { name: "Confirm approval" }).click();
    await expect(page.getByText("Decision saved")).toBeVisible();

    await memberPage.reload();
    await expect(memberPage.getByRole("heading", { name: "Approved" })).toBeVisible();
    await expect(memberPage.getByLabel("One-line introduction")).toHaveValue("Updated after a synthetic correction request.");
  } finally {
    await finalAdmin.close();
    await resubmittingMember.close();
  }
});
