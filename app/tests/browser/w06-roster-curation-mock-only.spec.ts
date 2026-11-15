import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const tableId = "7a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const revisionId = "8a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const proposalId = "9a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const members = [
  { requestId: "10000000-0000-4000-8000-000000000001", guestId: "20000000-0000-4000-8000-000000000001", displayName: "Maya Chen" },
  { requestId: "10000000-0000-4000-8000-000000000002", guestId: "20000000-0000-4000-8000-000000000002", displayName: "Noah James" },
  { requestId: "10000000-0000-4000-8000-000000000003", guestId: "20000000-0000-4000-8000-000000000003", displayName: "Oliver Park" },
  { requestId: "10000000-0000-4000-8000-000000000004", guestId: "20000000-0000-4000-8000-000000000004", displayName: "Riley Morgan" },
];
const screenshotDirectory = resolve("docs/implementation/screenshots");

function rosterResponse(role: "admin" | "host") {
  return {
    ok: true,
    correlationId: "mock-roster-correlation",
    data: {
      table: { tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", publishedRevisionId: revisionId, readOnlyReason: null },
      applicants: { items: members.map((member, index) => ({
        ...member, requestCreatedAt: `2026-11-0${index + 1}T15:00:00.000Z`, eligible: index < 3,
        reasonCodes: index === 3 ? ["profile_not_approved"] : [], recommendationRank: index < 3 ? index + 1 : null, selected: index < 3,
      })), nextCursor: null },
      currentProposal: {
        proposalId, revision: 2, state: "submitted", supplyRevisionId: revisionId,
        selectedRequestIds: members.slice(0, 3).map((member) => member.requestId),
        selectedGuests: members.slice(0, 3).map(({ guestId, displayName }) => ({ guestId, displayName })),
        validation: { valid: true, issues: [] }, createdAt: "2026-11-10T17:00:00.000Z", updatedAt: "2026-11-11T17:00:00.000Z",
      },
      // The host mock intentionally overstates canApprove to verify the UI also
      // applies its role check. This is a UI challenge case, not an API/auth test.
      permissions: { canEditProposal: role === "host", canSubmit: false, canApprove: true },
    },
  };
}

async function installMockApi(context: BrowserContext, role: "admin" | "host") {
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== appOrigin) return route.abort();
    if (new URL(route.request().url()).pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await context.route((url) => url.origin === appOrigin && url.pathname === "/api/admin/seat-requests", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-queue-correlation", data: {
      items: [{ tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park",
        publishedRevisionId: revisionId, pendingRequestCount: 4,
        currentProposal: { proposalId, revision: 2, state: "submitted", selectedCount: 3, valid: true } }], nextCursor: null,
    } }) });
  });
  await context.route((url) => url.origin === appOrigin && url.pathname === "/api/curation/assigned-tables", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "mock-host-queue-correlation", data: {
      items: [{ tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park",
        publishedRevisionId: revisionId, pendingRequestCount: 4,
        currentProposal: { proposalId, revision: 2, state: "submitted", selectedCount: 3, valid: true } }], nextCursor: null,
    } }) });
  });
  await context.route((url) => url.origin === appOrigin && url.pathname === `/api/curation/tables/${tableId}/roster`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rosterResponse(role)) });
  });
}

async function openIsolatedContext(page: Page, path: string) {
  await page.goto(`${appOrigin}${path}`);
}

test("W06.3–W06.4 roster queue/detail/approval UI uses intercepted contract fixtures only", async ({ browser }) => {
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockApi(adminContext, "admin");
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installMockApi(hostContext, "host");
  try {
    const adminPage = await adminContext.newPage();
    await openIsolatedContext(adminPage, "/admin/seat-requests");
    await expect(adminPage.getByRole("heading", { name: "Autumn Table" })).toBeVisible();
    await expect(adminPage.getByText(/4 requests/)).toBeVisible();
    await adminPage.getByRole("link", { name: "Open", exact: true }).click();
    await adminPage.waitForURL(`${appOrigin}/admin/seat-requests/${tableId}`);
    await expect(adminPage.getByRole("heading", { name: "People who asked to join" })).toBeVisible();
    await expect(adminPage.getByText("Riley Morgan")).toBeVisible();
    await expect(adminPage.getByText("A selected profile needs current administrator approval.")).toBeVisible();
    await expect(adminPage.getByText("Group works")).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Approve roster" })).toBeVisible();
    await adminPage.getByRole("button", { name: "Approve roster" }).click();
    const dialog = adminPage.getByRole("dialog", { name: "Approve this roster?" });
    await expect(dialog).toBeVisible();
    for (const name of ["Maya Chen", "Noah James", "Oliver Park"]) await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/They pay to confirm their seat/i)).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Approve and send invitations" })).toBeVisible();

    await mkdir(screenshotDirectory, { recursive: true });
    await adminPage.screenshot({ path: resolve(screenshotDirectory, "w06-roster-admin-approval-confirmation-desktop-mock-only.png") });
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await adminPage.screenshot({ path: resolve(screenshotDirectory, "w06-roster-admin-approval-confirmation-390px-mock-only.png") });

    const hostPage = await hostContext.newPage();
    await openIsolatedContext(hostPage, `/host/tables/${tableId}/roster`);
    await expect(hostPage.getByRole("heading", { name: "Autumn Table" })).toBeVisible();
    await expect(hostPage.getByRole("heading", { name: "People who asked to join" })).toBeVisible();
    await expect(hostPage.getByText("A selected profile needs current administrator approval.")).toBeVisible();
    await expect(hostPage.getByRole("button", { name: "Approve roster" })).toHaveCount(0);
    await expect(hostPage.getByRole("button", { name: "Approve and send invitations" })).toHaveCount(0);
    await expect(hostPage.getByRole("dialog")).toHaveCount(0);
  } finally {
    await Promise.all([adminContext.close(), hostContext.close()]);
  }
});
