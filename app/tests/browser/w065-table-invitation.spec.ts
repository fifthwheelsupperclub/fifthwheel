import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const appOrigin = "http://127.0.0.1:8086";
const supabaseOrigin = "http://127.0.0.1:57421";
const mailpitOrigin = "http://127.0.0.1:57424";
const screenshotDirectory = resolve("docs/implementation/screenshots");
const invitationId = process.env.W065_INVITATION_ID!;
const outboxId = process.env.W065_OUTBOX_ID!;
const tableId = process.env.W065_TABLE_ID!;
const tableTitle = process.env.W065_TABLE_TITLE!;
const dbUrl = process.env.W065_DB_URL!;

type MailpitMessage = Readonly<{ ID: string; To: readonly { Address?: string }[]; Subject?: string; Text?: string; HTML?: string; MessageID?: string }>;

async function localContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", async (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === appOrigin || origin === supabaseOrigin) return route.continue();
    return route.abort();
  });
  return context;
}

async function messagesFor(email: string): Promise<MailpitMessage[]> {
  const query = new URLSearchParams({ query: `to:${email}`, limit: "50" });
  const response = await fetch(`${mailpitOrigin}/api/v1/search?${query.toString()}`, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("Local Mailpit search failed");
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.messages)) throw new Error("Local Mailpit returned an invalid search response");
  return body.messages.filter(isRecord).map((row) => row as unknown as MailpitMessage);
}

async function messageDetail(id: string): Promise<MailpitMessage> {
  const response = await fetch(`${mailpitOrigin}/api/v1/message/${encodeURIComponent(id)}`, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("Local Mailpit message detail was unavailable");
  const body: unknown = await response.json();
  if (!isRecord(body) || body.ID !== id) throw new Error("Local Mailpit message identity did not match");
  return body as unknown as MailpitMessage;
}

async function waitForMail(email: string, predicate: (message: MailpitMessage) => boolean): Promise<MailpitMessage> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    for (const summary of await messagesFor(email)) {
      const full = await messageDetail(summary.ID);
      const addresses = full.To.map((row) => row.Address?.toLowerCase() ?? "");
      if (addresses.length === 1 && addresses[0] === email.toLowerCase() && predicate(full)) return full;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error(`Expected local Mailpit message did not arrive for ${email}`);
}

function allMessageText(message: MailpitMessage): string { return `${message.Text ?? ""}\n${message.HTML ?? ""}`; }
function urlsIn(message: MailpitMessage): URL[] {
  const source = allMessageText(message).replaceAll("&amp;", "&");
  const found = source.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  return found.map((raw) => {
    const candidate = raw.replace(/[),.;]+$/, "");
    try { return new URL(candidate); } catch { return null; }
  }).filter((value): value is URL => value !== null);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

async function requestMagicLink(page: Page, email: string): Promise<void> {
  await expect(page.locator('form[data-client-ready="true"]')).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  const linkRequest = page.waitForResponse((response) => response.url().includes("/api/auth/request-link") && response.request().method() === "POST");
  await page.getByRole("button", { name: /Send sign-in link/i }).click();
  const response = await linkRequest;
  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok() || !isRecord(responseBody) || responseBody.accepted !== true) {
    const errorCode = isRecord(responseBody) && isRecord(responseBody.error) && typeof responseBody.error.code === "string" ? responseBody.error.code : "unrecognized_response";
    throw new Error(`Local sign-in link request failed with HTTP ${response.status()} (${errorCode})`);
  }
  await expect(page.getByText("Check your email.", { exact: true })).toBeVisible();
}

async function signInViaActualMail(page: Page, email: string, returnTo: string): Promise<void> {
  await page.goto(`${appOrigin}/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await requestMagicLink(page, email);
  const signInMail = await waitForMail(email, (message) => message.Subject === "Your Fifth Wheel sign-in link");
  const actionLink = urlsIn(signInMail).find((url) => url.origin === appOrigin && url.pathname === "/auth/callback");
  if (!actionLink || actionLink.searchParams.get("type") !== "magiclink" || actionLink.searchParams.get("safeReturnTo") !== returnTo) {
    throw new Error("The intercepted sign-in email did not preserve the requested local return path");
  }
  await page.goto(actionLink.href);
  await page.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
  await page.waitForURL(`${appOrigin}${returnTo}`, { timeout: 20_000 });
}

async function screenshotPair(page: Page, stem: string, visit: () => Promise<void>): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visit();
  await page.screenshot({ path: resolve(screenshotDirectory, `${stem}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshotDirectory, `${stem}-390px.png`), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

function psql(query: string): string {
  const result = spawnSync("psql", [dbUrl,"-X","-At","-v","ON_ERROR_STOP=1","-c",query], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error("Local DB acceptance query failed");
  return result.stdout.trim();
}

function runOneShotWorker(): Readonly<{ state: string; invitationId?: string; attemptNumber?: number }> {
  const result = spawnSync(process.execPath, ["scripts/run-table-invitation-worker.mjs"], { encoding: "utf8", env: process.env });
  if (result.error || result.status !== 0) throw new Error("Guarded local Table invitation worker failed");
  let output: unknown;
  try { output = JSON.parse(result.stdout.trim()); } catch { throw new Error("Local Table invitation worker returned invalid output"); }
  if (!isRecord(output) || typeof output.state !== "string") throw new Error("Local Table invitation worker returned an invalid state");
  return output as Readonly<{ state: string; invitationId?: string; attemptNumber?: number }>;
}

test("W06.5 delivers a separate Table offer through Mailpit and returns a real magic-link session", async ({ browser }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  const adminEmail = process.env.W065_ADMIN_EMAIL!;
  const memberEmail = process.env.W065_MEMBER_EMAIL!;
  const otherEmail = process.env.W065_OTHER_EMAIL!;
  const invitePath = `/invitations/${invitationId}`;
  const invitationUrl = `${appOrigin}${invitePath}`;
  if (![adminEmail,memberEmail,otherEmail,invitationId,outboxId,tableId,tableTitle,dbUrl].every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Missing run-scoped W06.5 browser fixture environment");
  }

  const adminContext = await localContext(browser);
  try {
    const admin = await adminContext.newPage();
    await signInViaActualMail(admin, adminEmail, "/member");
    await admin.goto(`${appOrigin}/admin/table-invitations`);
    await expect(admin.getByRole("heading", { name: "Invitation emails" })).toBeVisible();
    const card = admin.locator(".admin-invitation-card").filter({ hasText: tableTitle });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("Email delivery failed", { exact: true })).toBeVisible();
    await card.locator("details.admin-invitation-attempts summary").click();
    await expect(card.getByText("Attempt 1 · failed", { exact: true })).toBeVisible();
    await screenshotPair(admin, "w065-admin-failed-delivery", async () => {
      await admin.goto(`${appOrigin}/admin/table-invitations`);
      const screenshotCard = admin.locator(".admin-invitation-card").filter({ hasText: tableTitle });
      await expect(screenshotCard.getByText("Email delivery failed", { exact: true })).toBeVisible();
      await screenshotCard.locator("details.admin-invitation-attempts summary").click();
      await expect(screenshotCard.getByText("Attempt 1 · failed", { exact: true })).toBeVisible();
    });

    await card.getByRole("button", { name: "Send again" }).click();
    await expect(admin.getByText(/A new email attempt is queued/i)).toBeVisible();
    await expect(card.getByText("Waiting to send", { exact: true })).toBeVisible();

    // The one-shot poller can only run when the synthetic outbox is the sole eligible row.
    const eligible = psql(`select count(*)::text || '|' || coalesce(string_agg(o.outbox_id::text,',' order by o.outbox_id), '')
      from public.app_table_invitation_outbox o join public.app_table_invitations i on i.invitation_id=o.invitation_id
      where o.message_kind='invitation' and o.state in ('queued','failed') and o.next_attempt_at<=clock_timestamp()
        and (o.attempt_count<8 or o.manual_retry_requested) and i.state='active'`);
    expect(eligible).toBe(`1|${outboxId}`);
    const worker = runOneShotWorker();
    if (worker.state === "unknown") throw new Error(`Local delivery outcome is unknown for ${invitationId}; preserve for reconciliation and do not resend`);
    expect(worker).toMatchObject({ state: "accepted", invitationId, attemptNumber: 2 });

    const invitationMail = await waitForMail(memberEmail, (message) => message.Subject === `You’re invited: ${tableTitle}`);
    const tableLink = urlsIn(invitationMail).find((url) => url.origin === appOrigin && url.pathname === "/sign-in");
    if (!tableLink || tableLink.searchParams.get("returnTo") !== invitePath || /token_hash|auth\/callback/i.test(allMessageText(invitationMail))) {
      throw new Error("Table invitation email did not contain the expected separate sign-in continuation");
    }
    expect(allMessageText(invitationMail)).toContain("separate Table offer");

    await admin.reload();
    const acceptedCard = admin.locator(".admin-invitation-card").filter({ hasText: tableTitle });
    await expect(acceptedCard.getByText("Email service accepted", { exact: true })).toBeVisible();
    await acceptedCard.locator("details.admin-invitation-attempts summary").click();
    await expect(acceptedCard.getByText("Attempt 2 · accepted", { exact: true })).toBeVisible();
    await expect(acceptedCard.getByRole("button", { name: "Send again" })).toHaveCount(0);
    const adminApi = await admin.request.get(`${appOrigin}/api/admin/table-invitations?limit=25`);
    expect(adminApi.status()).toBe(200);
    const adminJson: unknown = await adminApi.json();
    expect(JSON.stringify(adminJson)).not.toContain(memberEmail);
    expect(JSON.stringify(adminJson)).not.toContain("providerMessageId");
    expect(JSON.stringify(adminJson)).not.toContain("PRIVATE W06.5");
    const providerMessageId = psql(`select coalesce(provider_message_id,'') from public.app_table_invitation_outbox where outbox_id='${outboxId}'`);
    expect(providerMessageId.length).toBeGreaterThan(0);
    expect(JSON.stringify(adminJson)).not.toContain(providerMessageId);
    await screenshotPair(admin, "w065-admin-accepted-delivery", async () => {
      await admin.goto(`${appOrigin}/admin/table-invitations`);
      await expect(admin.locator(".admin-invitation-card").filter({ hasText: tableTitle }).getByText("Email service accepted", { exact: true })).toBeVisible();
    });

    const memberContext = await localContext(browser);
    try {
      const member = await memberContext.newPage();
      await member.goto(tableLink.href);
      await expect.poll(() => new URL(member.url()).searchParams.get("returnTo")).toBe(invitePath);
      await requestMagicLink(member, memberEmail);
      const actualLink = await waitForMail(memberEmail, (message) => message.Subject === "Your Fifth Wheel sign-in link");
      const magicLink = urlsIn(actualLink).find((url) => url.origin === appOrigin && url.pathname === "/auth/callback");
      if (!magicLink || magicLink.searchParams.get("type") !== "magiclink" || magicLink.searchParams.get("safeReturnTo") !== invitePath) {
        throw new Error("The member sign-in email did not preserve the Table invitation continuation");
      }
      await member.goto(magicLink.href);
      await member.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
      await member.waitForURL(invitationUrl, { timeout: 20_000 });
      await expect(member.getByRole("heading", { name: tableTitle })).toBeVisible();
      await expect(member.getByText("Email service accepted", { exact: true })).toHaveCount(2);
      await expect(member.getByText("Email service accepted", { exact: true }).first()).toBeVisible();
      await expect(member.getByRole("heading", { name: "Evening itinerary" })).toBeVisible();
      await expect(member.getByText("Test Bar")).toBeVisible();
      await expect(member.getByText(/PRIVATE W06\.5/)).toHaveCount(0);
      await expect(member.getByText(providerMessageId, { exact: false })).toHaveCount(0);
      const detailResponse = await member.request.get(`${appOrigin}/api/me/table-invitations/${invitationId}`);
      expect(detailResponse.status()).toBe(200);
      const detailJson = await detailResponse.json();
      expect(JSON.stringify(detailJson)).not.toContain(memberEmail);
      expect(JSON.stringify(detailJson)).not.toContain(providerMessageId);
      expect(JSON.stringify(detailJson)).not.toContain("venueId");
      expect(JSON.stringify(detailJson)).not.toContain("hostNotes");
      await screenshotPair(member, "w065-member-invitation-detail", async () => {
        await member.goto(invitationUrl);
        await expect(member.getByRole("heading", { name: tableTitle })).toBeVisible();
        await expect(member.getByRole("heading", { name: "Evening itinerary" })).toBeVisible();
      });

      await member.goto(`${appOrigin}/requests`);
      const requestCard = member.locator(".request-history-card").filter({ hasText: tableTitle });
      await expect(requestCard).toHaveCount(1);
      await expect(requestCard.getByText("Requested", { exact: true })).toBeVisible();
      await expect(requestCard.getByText("Your invitation is open", { exact: true })).toBeVisible();
      await expect(requestCard.getByText("This is a separate offer.", { exact: false })).toHaveCount(0);
      await expect(requestCard.getByText("Email provider accepted", { exact: false })).toHaveCount(0);
      await expect(requestCard.getByText("Request withdrawal is unavailable while this invitation is active.", { exact: false })).toBeVisible();
      await expect(requestCard.getByRole("button", { name: "Withdraw request" })).toHaveCount(0);
      await expect(requestCard.getByRole("link", { name: "Review Table invitation" })).toHaveAttribute("href", invitePath);
      const historyResponse = await member.request.get(`${appOrigin}/api/me/requests?limit=20`);
      expect(historyResponse.status()).toBe(200);
      const historyJson = await historyResponse.json();
      expect(historyJson).toMatchObject({ ok: true, data: { items: [expect.objectContaining({ state: "pending", tableInvitation: expect.objectContaining({ state: "active", deliveryState: "accepted" }) })] } });
      await screenshotPair(member, "w065-member-request-offer-overlay", async () => {
        await member.goto(`${appOrigin}/requests`);
        await expect(member.locator(".request-history-card").filter({ hasText: tableTitle }).getByText("Your invitation is open", { exact: true })).toBeVisible();
      });
    } finally { await memberContext.close(); }

    const otherContext = await localContext(browser);
    try {
      const other = await otherContext.newPage();
      await signInViaActualMail(other, otherEmail, "/member");
      const denied = await other.request.get(`${appOrigin}/api/me/table-invitations/${invitationId}`);
      expect(denied.status()).toBe(404);
      await other.goto(invitationUrl);
      await expect(other.getByRole("heading", { name: "Invitation not found" })).toBeVisible();
    } finally { await otherContext.close(); }
  } finally { await adminContext.close(); }
});
