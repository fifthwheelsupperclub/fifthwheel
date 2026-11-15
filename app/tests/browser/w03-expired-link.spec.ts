import { expect, test } from "@playwright/test";

const appOrigin = "http://127.0.0.1:8086";
const mailpitOrigin = "http://127.0.0.1:57424";

function fixtureValue(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing run-scoped fixture ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRecipient(value: unknown, email: string): boolean {
  return Array.isArray(value) && value.some((recipient) => isRecord(recipient)
    && typeof recipient.Address === "string"
    && recipient.Address.trim().toLowerCase() === email.toLowerCase());
}

async function waitForReturningLink(email: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitOrigin}/api/v1/messages?limit=100`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Mailpit list failed (${response.status})`);
    const list: unknown = await response.json();
    if (!isRecord(list) || !Array.isArray(list.messages)) throw new Error("Mailpit returned an invalid message list");
    const found = list.messages.find((message) => isRecord(message)
      && typeof message.ID === "string"
      && typeof message.Subject === "string"
      && message.Subject.includes("Your Fifth Wheel sign-in link")
      && hasRecipient(message.To, email));
    if (isRecord(found) && typeof found.ID === "string") {
      const messageResponse = await fetch(`${mailpitOrigin}/api/v1/message/${encodeURIComponent(found.ID)}`, { cache: "no-store" });
      if (!messageResponse.ok) throw new Error(`Mailpit message read failed (${messageResponse.status})`);
      const message: unknown = await messageResponse.json();
      if (isRecord(message) && hasRecipient(message.To, email) && typeof message.HTML === "string") return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("No intercepted returning-member link arrived in test Mailpit");
}

test("expired returning-member link is recoverable and creates no browser session", async ({ browser }) => {
  const email = fixtureValue("W03_EXPIRED_EMAIL");
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${appOrigin}/sign-in`);
    const signInForm = page.locator('form[data-client-ready="true"]');
    await expect(signInForm).toBeVisible();
    await expect(signInForm.getByRole("button", { name: "Send sign-in link" })).toBeEnabled();
    await page.getByLabel("Email address").fill(email);
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/request-link") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    await expect(page.getByText("Check your email.")).toBeVisible();

    const message = await waitForReturningLink(email);
    // Auth issues a two-second OTP in this run. Leave enough margin for the
    // Auth server's clock and then follow the actual locally intercepted link.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await page.setContent(message.HTML as string);
    const emailLink = page.getByRole("link", { name: "Continue to Fifth Wheel", exact: true });
    await expect(emailLink).toHaveCount(1);
    const href = await emailLink.getAttribute("href");
    expect(href).toMatch(/^http:\/\/127\.0\.0\.1:8086\/auth\/callback\?token_hash=[A-Za-z0-9_-]{16,512}&type=magiclink/);
    await emailLink.click();
    await page.waitForURL(`${appOrigin}/auth/callback**`);
    await expect(page.getByRole("heading", { name: "Ready when you are." })).toBeVisible();

    const verifyPromise = page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/auth/verify-link") && candidate.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Continue to Fifth Wheel" }).click();
    const verify = await verifyPromise;
    expect(verify.status()).toBe(400);
    await expect(page.getByRole("alert")).toContainText("This sign-in link could not be verified.");
    await expect(page.getByText("It may have expired or already been used. Request a fresh link.")).toBeVisible();
    expect(await context.cookies(appOrigin)).toEqual([]);
    await expect(page).toHaveURL(`${appOrigin}/auth/callback`);
  } finally {
    await context.close();
  }
});
