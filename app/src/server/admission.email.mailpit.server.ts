/** Server-only local email adapter. This provider sends to Mailpit's HTTP API, never SMTP. */

import type {
  EmailSendResult,
  MagicLinkEmailProvider,
} from "./admission.contracts.server.ts";

export type MailpitAdmissionEmailConfig = Readonly<{
  baseUrl: string;
  fromEmail: string;
  fromName?: string;
  timeoutMs?: number;
}>;

export class MailpitAdmissionEmailError extends Error {
  readonly code = "configuration_invalid" as const;

  constructor() {
    super("configuration_invalid");
    this.name = "MailpitAdmissionEmailError";
  }
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const mailboxLocalPart = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const mailboxDomainLabel = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const emailPattern = new RegExp(`^${mailboxLocalPart}@${mailboxDomainLabel}(?:\\.${mailboxDomainLabel})+$`);
const safeMailpitMessageId = /^[A-Za-z0-9_-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireLocalUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MailpitAdmissionEmailError();
  }
  if (
    url.protocol !== "http:"
    || !loopbackHosts.has(url.hostname)
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new MailpitAdmissionEmailError();
  }
  return url;
}

function requireLoopbackActionLink(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MailpitAdmissionEmailError();
  }
  if (
    url.protocol !== "http:"
    || !loopbackHosts.has(url.hostname)
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
    || url.pathname !== "/auth/callback"
    || !/^[A-Za-z0-9_-]{16,512}$/.test(url.searchParams.get("token_hash") ?? "")
    || !["invite", "magiclink"].includes(url.searchParams.get("type") ?? "")
    || [...url.searchParams.keys()].some((key) => !["token_hash", "type", "safeReturnTo"].includes(key))
  ) {
    throw new MailpitAdmissionEmailError();
  }
  const returnTo = url.searchParams.get("safeReturnTo");
  if (returnTo !== null && (!returnTo.startsWith("/") || returnTo.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(returnTo))) throw new MailpitAdmissionEmailError();
  return url.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] as string);
}

/** Returning sign-in links have no admission-delivery row and use a separate, non-retryable mail path. */
export function createMailpitMagicLinkEmailProvider(
  config: MailpitAdmissionEmailConfig,
  fetcher: typeof fetch = globalThis.fetch,
): MagicLinkEmailProvider {
  const baseUrl = requireLocalUrl(config.baseUrl);
  if (!emailPattern.test(config.fromEmail) || config.fromEmail.includes("\r") || config.fromEmail.includes("\n")) throw new MailpitAdmissionEmailError();
  const timeoutMs = config.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new MailpitAdmissionEmailError();
  return Object.freeze({
    async sendSignInLink(input: Parameters<MagicLinkEmailProvider["sendSignInLink"]>[0]): Promise<EmailSendResult> {
      if (!emailPattern.test(input.recipientEmail) || !["invite", "magiclink"].includes(input.kind)) return { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false };
      let actionLink: string;
      try { actionLink = requireLoopbackActionLink(input.actionLink); }
      catch { return { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false }; }
      const messageId = `<fw-signin-${crypto.randomUUID()}@fifthwheel.local>`;
      const text = `Your secure Fifth Wheel sign-in link is ready.\n\n${actionLink}\n\nIf you did not request this link, you can ignore this email.`;
      const html = `<p>Your secure Fifth Wheel sign-in link is ready.</p><p><a href="${escapeHtml(actionLink)}">Continue to Fifth Wheel</a></p><p>If you did not request this link, you can ignore this email.</p>`;
      let response: Response;
      try {
        response = await fetcher(new URL("/api/v1/send", baseUrl), {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            From: { Email: config.fromEmail, ...(config.fromName ? { Name: config.fromName } : {}) },
            To: [{ Email: input.recipientEmail }],
            Subject: "Your Fifth Wheel sign-in link",
            Text: text,
            HTML: html,
            Headers: { "Message-ID": messageId },
          }),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch { return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" }; }
      if (response.status >= 500) return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      if (!response.ok) return { state: "failed", safeErrorCode: "mailpit_rejected", retryable: false };
      const body: unknown = await response.json().catch(() => null);
      if (!isRecord(body) || typeof body.ID !== "string" || !safeMailpitMessageId.test(body.ID)) return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      return { state: "accepted", providerMessageId: body.ID };
    },
  });
}
