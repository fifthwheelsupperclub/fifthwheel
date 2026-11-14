import { expect, test } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";
const testGuestId = "20000000-0000-4000-8000-000000000099";
const testFileId = "30000000-0000-4000-8000-000000000099";

async function guardLoopback(context: import("@playwright/test").BrowserContext) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.continue();
    // Offline font/analytics or any other non-local request cannot leave the run.
    return route.abort();
  });
}

async function readBody(response: import("@playwright/test").APIResponse) {
  return await response.json() as Record<string, unknown>;
}

test("W04-PROFILE-01/REVIEW-02: anonymous profile, upload, and review routes deny before data access", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardLoopback(context);
  const request = context.request;
  try {
    const memberRead = await request.get(`${appOrigin}/api/member/profile`);
    expect(memberRead.status()).toBe(401);
    expect(await readBody(memberRead)).toMatchObject({ ok: false, code: "unauthenticated" });

    const adminQueue = await request.get(`${appOrigin}/api/admin/identity-reviews?status=submitted`);
    expect(adminQueue.status()).toBe(401);
    expect(await readBody(adminQueue)).toMatchObject({ ok: false, code: "unauthenticated" });

    const adminDetail = await request.get(`${appOrigin}/api/admin/identity-reviews/${testGuestId}`);
    expect(adminDetail.status()).toBe(401);
    expect(await readBody(adminDetail)).toMatchObject({ ok: false, code: "unauthenticated" });

    const headers = { origin: appOrigin, "content-type": "application/json", accept: "application/json" };
    const mutations = [
      request.put(`${appOrigin}/api/member/profile`, { headers, data: { operationId: "50000000-0000-4000-8000-000000000099", expectedProfileRevision: 1 } }),
      request.post(`${appOrigin}/api/member/profile/files`, { headers, data: { operationId: "50000000-0000-4000-8000-000000000099", expectedProfileRevision: 1, expectedCriticalIdentityVersion: 1, kind: "photo", contentType: "image/jpeg", byteSize: 1 } }),
      request.post(`${appOrigin}/api/member/profile/submit`, { headers, data: { operationId: "50000000-0000-4000-8000-000000000099", expectedProfileRevision: 1 } }),
      request.post(`${appOrigin}/api/admin/identity-reviews/${testGuestId}/decision`, { headers, data: { operationId: "50000000-0000-4000-8000-000000000099", expectedProfileRevision: 1, reviewId: "40000000-0000-4000-8000-000000000099", decision: "approved" } }),
    ];
    for (const mutation of await Promise.all(mutations)) {
      expect(mutation.status()).toBe(401);
      expect(await readBody(mutation)).toMatchObject({ ok: false, code: "unauthenticated" });
    }

    const upload = await request.put(`${appOrigin}/api/member/profile/files/${testFileId}/content`, {
      headers: { origin: appOrigin, "content-type": "image/jpeg", "x-fw-upload-token": "a".repeat(48) },
      data: Buffer.from([0xff, 0xd8, 0xff]),
    });
    expect(upload.status()).toBe(401);
    expect(await readBody(upload)).toMatchObject({ ok: false, code: "unauthenticated" });

    const page = await context.newPage();
    await page.goto(`${appOrigin}/account/profile`);
    await expect(page.getByRole("heading", { name: "Sign in to view your profile" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Sign in to view your profile" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto(`${appOrigin}/admin/identity-review`);
    await expect(page.getByRole("heading", { name: "Sign in to review profiles" })).toBeVisible();
    await page.goto(`${appOrigin}/admin/identity-review/${testGuestId}`);
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();
  } finally {
    await context.close();
  }
});
