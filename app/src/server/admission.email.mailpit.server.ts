/** Server-only local email adapter. This provider sends to Mailpit's HTTP API, never SMTP. */

import type {
  AdmissionEmailProvider,
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
const safeIdentifier = /^[A-Za-z0-9._-]{1,100}$/;
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

function messageIdFor(deliveryId: string, attemptId: string): string {
  return `<fw-admission-${deliveryId}-${attemptId}@fifthwheel.local>`;
}

function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().replace(/^<|>$/g, "").toLowerCase();
}

function hasExactRecipient(value: unknown, recipientEmail: string): boolean {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return false;
  return typeof value[0].Address === "string"
    && value[0].Address.trim().toLowerCase() === recipientEmail.trim().toLowerCase();
}

/**
 * Mailpit acceptance is only local capture, never proof of inbox delivery.
 * Its stable RFC Message-ID is keyed by the durable delivery/attempt pair.
 * Reconciliation checks the recipient from trusted admission state;
 * Mailpit can also prune/delete stored mail, so an absent record is always unknown.
 * The Send API does not enforce idempotency keys: the header below is for correlation only.
 * A caller must not automatically resend an unknown attempt; it needs operator resolution.
 */
export function createMailpitAdmissionEmailProvider(
  config: MailpitAdmissionEmailConfig,
  fetcher: typeof fetch = globalThis.fetch,
): AdmissionEmailProvider {
  const baseUrl = requireLocalUrl(config.baseUrl);
  if (
    !emailPattern.test(config.fromEmail)
    || config.fromEmail.includes("\r")
    || config.fromEmail.includes("\n")
    || (config.fromName !== undefined && /[\r\n]/.test(config.fromName))
    || (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30_000))
  ) {
    throw new MailpitAdmissionEmailError();
  }
  const timeoutMs = config.timeoutMs ?? 5_000;

  async function request(path: string, init: RequestInit): Promise<Response> {
    return fetcher(new URL(path, baseUrl), {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  function validInput(input: Readonly<{
    recipientEmail: string;
    actionLink: string;
    deliveryId: string;
    attemptId: string;
    idempotencyKey: string;
  }>): boolean {
    return emailPattern.test(input.recipientEmail)
      && [input.deliveryId, input.attemptId, input.idempotencyKey].every((value) => safeIdentifier.test(value));
  }

  async function findByMessageId(messageId: string): Promise<Readonly<{ ID: string; MessageID: string; To: unknown }> | null> {
    const query = `message-id:${messageId.replace(/^<|>$/g, "")}`;
    const url = new URL("/api/v1/search", baseUrl);
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "50");
    const response = await request(`${url.pathname}${url.search}`, { method: "GET", headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body) || !Array.isArray(body.messages)) return null;
    const expected = normalizeMessageId(messageId);
    const matches = body.messages.filter((item) =>
      isRecord(item)
      && typeof item.ID === "string"
      && normalizeMessageId(item.MessageID) === expected,
    ) as Array<{ ID: string; MessageID: string; To: unknown }>;
    return matches.length === 1 ? matches[0] : null;
  }

  const provider: AdmissionEmailProvider = {
    async sendAppInvitation(input): Promise<EmailSendResult> {
      if (!validInput(input)) return { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false };
      let actionLink: string;
      try {
        actionLink = requireLoopbackActionLink(input.actionLink);
      } catch {
        return { state: "failed", safeErrorCode: "mailpit_invalid_request", retryable: false };
      }

      const messageId = messageIdFor(input.deliveryId, input.attemptId);
      const escapedLink = escapeHtml(actionLink);
      const text = [
        "You’re off the waitlist. Sign in, finish your profile, and start requesting seats at tables.",
        "Sign in:",
        actionLink,
      ].join("\n\n");
      const html = `<p>You’re off the waitlist. Sign in, finish your profile, and start requesting seats at tables.</p><p><a href="${escapedLink}">Sign in</a></p>`;
      const payload = {
        From: { Email: config.fromEmail, ...(config.fromName ? { Name: config.fromName } : {}) },
        To: [{ Email: input.recipientEmail }],
        Subject: "You’re in: welcome to Fifth Wheel",
        Text: text,
        HTML: html,
        Headers: {
          "Message-ID": messageId,
          "X-FifthWheel-Delivery-ID": input.deliveryId,
          "X-FifthWheel-Attempt-ID": input.attemptId,
          "X-FifthWheel-Idempotency-Key": input.idempotencyKey,
        },
      };

      let response: Response;
      try {
        response = await request("/api/v1/send", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      }
      if (response.status >= 500) return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      if (!response.ok) return { state: "failed", safeErrorCode: "mailpit_rejected", retryable: false };

      const body: unknown = await response.json().catch(() => null);
      if (!isRecord(body) || typeof body.ID !== "string" || body.ID.length === 0) {
        return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      }
      if (!safeMailpitMessageId.test(body.ID)) {
        return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      }
      return { state: "accepted", providerMessageId: body.ID };
    },

    async reconcile(input) {
      if (
        !safeIdentifier.test(input.deliveryId)
        || !safeIdentifier.test(input.attemptId)
        || !emailPattern.test(input.recipientEmail)
      ) {
        return { state: "unknown" };
      }
      const expectedMessageId = messageIdFor(input.deliveryId, input.attemptId);
      try {
        if (input.providerMessageId && safeMailpitMessageId.test(input.providerMessageId)) {
          const path = `/api/v1/message/${encodeURIComponent(input.providerMessageId)}`;
          const response = await request(path, { method: "GET", headers: { accept: "application/json" } });
          if (!response.ok) return { state: "unknown" };
          const message: unknown = await response.json().catch(() => null);
          if (
            isRecord(message)
            && message.ID === input.providerMessageId
            && normalizeMessageId(message.MessageID) === normalizeMessageId(expectedMessageId)
            && hasExactRecipient(message.To, input.recipientEmail)
          ) {
            return { state: "accepted", providerMessageId: input.providerMessageId };
          }
          return { state: "unknown" };
        }
        if (input.providerMessageId) return { state: "unknown" };

        const match = await findByMessageId(expectedMessageId);
        if (!match || !hasExactRecipient(match.To, input.recipientEmail)) return { state: "unknown" };
        return { state: "accepted", providerMessageId: match.ID };
      } catch {
        return { state: "unknown" };
      }
    },
  };
  return Object.freeze(provider);
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
