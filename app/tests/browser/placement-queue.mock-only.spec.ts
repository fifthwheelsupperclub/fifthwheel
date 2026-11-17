// Mock-only: every /api response is intercepted. Proves the placement queue's screens, warning acknowledgement and request shapes,
// not backend permissions or persistence (scripts/test-placement-db.mjs covers the RPC; w03-admission covers the real flow).
import { expect, test, type BrowserContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "http://127.0.0.1:8086";
const shots = resolve("docs/implementation/screenshots");
const signupId = "e0850000-0000-4000-8000-000000000101", tableId = "e0850000-0000-4000-8000-000000000041", fullTableId = "e0850000-0000-4000-8000-000000000042";
const person = { signupId, firstName: "Maya", lastName: "Chen", email: "maya@example.test", age: 34, identity: "Woman", openTo: ["Men", "Women"],
  matchAgeMin: 28, matchAgeMax: 45, neighborhood: "Inman Park", nights: ["Wednesday"], lookingFor: "Open", receivedAt: "2026-11-14T18:00:00Z" };
const tables = [
  { tableId, title: "Autumn Table", localDate: "2026-12-12", startLocalTime: "19:00", neighborhood: "Inman Park", invitedCount: 2 },
  { tableId: fullTableId, title: "Busy Table", localDate: "2026-12-13", startLocalTime: "19:00", neighborhood: "Midtown", invitedCount: 4 },
];
type Reply = { status?: number; json: unknown };
const ok = (data: unknown): Reply => ({ json: { ok: true, data, correlationId: "mock" } });
const conflict = (reason: string, issues?: string[]): Reply => ({ status: 409, json: { ok: false, error: { code: "conflict", reason, ...(issues ? { issues } : {}), safeMessage: "That action is not available right now.", retryable: false } } });

async function mock(context: BrowserContext, onPost: (body: Record<string, unknown>) => Reply, state: { placed: boolean; posts: Record<string, unknown>[] }) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/admin/placements" && route.request().method() === "GET") return route.fulfill(ok({ people: state.placed ? [] : [person], tables }));
    if (url.pathname === "/api/admin/placements" && route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      state.posts.push(body);
      const reply = onPost(body);
      return route.fulfill({ status: reply.status ?? 200, json: reply.json });
    }
    return route.fulfill({ status: 404, json: { ok: false, error: { code: "not_found", safeMessage: "Not mocked" } } });
  });
}

test("queue lists a person; a preference warning needs Add anyway, which re-posts with acknowledgeWarnings and succeeds", async ({ page, context }) => {
  await mkdir(shots, { recursive: true });
  const state = { placed: false, posts: [] as Record<string, unknown>[] };
  await mock(context, (body) => {
    if (body.acknowledgeWarnings !== true) return conflict("placement_warnings", ["missing_mutual_open_connection", "age_span_exceeded"]);
    state.placed = true;
    return ok({ invitationId: "e0850000-0000-4000-8000-000000000301", guestId: "g", tableId, rosterRevision: 3, warnings: ["missing_mutual_open_connection", "age_span_exceeded"] });
  }, state);
  await page.goto("/admin/waitlist");
  await expect(page.getByRole("heading", { name: "Waitlist", level: 1 })).toBeVisible();
  const card = page.locator("li.ops-card", { hasText: "Maya Chen" });
  await expect(card).toContainText("maya@example.test");
  await expect(card).toContainText("Open to Men, Women · ages 28–45");
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await page.screenshot({ path: `${shots}/placement-queue-desktop-mock-only.png`, fullPage: true });

  await card.getByRole("button", { name: "Add to Table…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Maya Chen to a Table" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add and send invitation" })).toBeDisabled();
  await expect(dialog.getByRole("option", { name: /Busy Table/ })).toBeEnabled();
  await dialog.getByLabel("Table", { exact: true }).selectOption(tableId);
  await dialog.getByRole("button", { name: "Add and send invitation" }).click();

  await expect(dialog.getByRole("alert")).toContainText("This group breaks a matching rule");
  await expect(dialog.getByText("Someone would have no mutual “open to” match")).toBeVisible();
  await expect(dialog.getByText("Ages would span more than 12 years")).toBeVisible();
  await expect(dialog.getByText("You can still add them.")).toBeVisible();
  await page.screenshot({ path: `${shots}/placement-warning-desktop-mock-only.png` });
  await dialog.getByRole("button", { name: "Add anyway" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Maya was added and their invitation email is on its way." })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Nobody is waiting" })).toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual({ signupId, tableId, operationId: expect.any(String), acknowledgeWarnings: false });
  expect(state.posts[1]).toEqual({ signupId, tableId, operationId: expect.any(String), acknowledgeWarnings: true });
  expect(state.posts[1].operationId).not.toBe(state.posts[0].operationId);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a full Table is refused with a plain message and nothing is placed", async ({ page, context }) => {
  const state = { placed: false, posts: [] as Record<string, unknown>[] };
  await mock(context, () => conflict("table_full"), state);
  await page.goto("/admin/waitlist");
  await page.locator("li.ops-card", { hasText: "Maya Chen" }).getByRole("button", { name: "Add to Table…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Maya Chen to a Table" });
  await dialog.getByLabel("Table", { exact: true }).selectOption(fullTableId);
  await dialog.getByRole("button", { name: "Add and send invitation" }).click();
  await expect(dialog.getByRole("alert")).toContainText("This Table already has 5 guests.");
  await expect(dialog.getByRole("button", { name: "Add anyway" })).toHaveCount(0);
  await expect(page.locator("li.ops-card", { hasText: "Maya Chen" })).toBeVisible();
  expect(state.posts).toEqual([{ signupId, tableId: fullTableId, operationId: expect.any(String), acknowledgeWarnings: false }]);
});

test("a non-admin is told they have no access", async ({ page, context }) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/admin/placements") return route.fulfill({ status: 403, json: { ok: false, error: { code: "forbidden", safeMessage: "You do not have access to this." } } });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.goto("/admin/waitlist");
  await expect(page.getByRole("heading", { name: "You don’t have access to this" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Table…" })).toHaveCount(0);
});
