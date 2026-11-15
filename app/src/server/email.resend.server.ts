/** Server-only production email adapters over Resend's REST API (fetch, no SDK). */

import type { AdmissionEmailProvider, EmailSendResult, MagicLinkEmailProvider } from "./admission.contracts.server.ts";
import { whenLabel } from "./notice-templates.server.ts";
import type { TableInvitationMailInput, TableInvitationMailResult } from "./table-invitation.email.mailpit.server.ts";

export type ResendConfig = Readonly<{
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  appOrigin: string;
  timeoutMs?: number;
}>;

export class ResendConfigError extends Error {
  constructor() { super("resend_configuration_invalid"); this.name = "ResendConfigError"; }
}

const emailPattern = /^[^\s@<>",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const idPattern = /^[A-Za-z0-9._-]{1,100}$/;
const resendIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const API = "https://api.resend.com";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Only same-origin https /auth/callback links with a token hash may ever be emailed. */
function requireActionLink(value: string, appOrigin: URL): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const returnTo = url.searchParams.get("safeReturnTo");
  if (url.origin !== appOrigin.origin || url.pathname !== "/auth/callback" || url.username || url.password || url.hash
    || !/^[A-Za-z0-9_-]{16,512}$/.test(url.searchParams.get("token_hash") ?? "")
    || !["invite", "magiclink"].includes(url.searchParams.get("type") ?? "")
    || [...url.searchParams.keys()].some((k) => !["token_hash", "type", "safeReturnTo"].includes(k))
    || (returnTo !== null && (!returnTo.startsWith("/") || returnTo.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(returnTo)))) return null;
  return url.toString();
}

export function createResendEmail(config: ResendConfig, fetcher: typeof fetch = globalThis.fetch) {
  let appOrigin: URL;
  try { appOrigin = new URL(config.appOrigin); } catch { throw new ResendConfigError(); }
  const timeoutMs = config.timeoutMs ?? 10_000;
  if (!/^re_[A-Za-z0-9_]{8,}$/.test(config.apiKey) || !emailPattern.test(config.fromEmail) || /[\r\n<>"]/.test(config.fromName ?? "")
    || appOrigin.protocol !== "https:" || appOrigin.pathname !== "/" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new ResendConfigError();
  }
  const from = config.fromName ? `${config.fromName} <${config.fromEmail}>` : config.fromEmail;

  async function call(path: string, init: RequestInit): Promise<Response> {
    return fetcher(`${API}${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", authorization: `Bearer ${config.apiKey}`, ...init.headers } });
  }

  /** A 5xx, timeout or unreadable reply is "unknown": never auto-resend without the idempotency key. */
  async function send(to: string, subject: string, text: string, html: string, idempotencyKey: string, tags: Record<string, string> = {}): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await call("/emails", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ from, to: [to], subject, text, html, headers: Object.fromEntries(Object.entries(tags).map(([k, v]) => [`X-FifthWheel-${k}`, v])) }) });
    } catch { return { state: "unknown", safeErrorCode: "resend_outcome_unknown" }; }
    if (response.status >= 500) return { state: "unknown", safeErrorCode: "resend_outcome_unknown" };
    if (!response.ok) return { state: "failed", safeErrorCode: response.status === 429 ? "resend_rate_limited" : "resend_rejected", retryable: response.status === 429 };
    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body) || typeof body.id !== "string" || !resendIdPattern.test(body.id)) return { state: "unknown", safeErrorCode: "resend_outcome_unknown" };
    return { state: "accepted", providerMessageId: body.id };
  }

  async function lookup(id: string, recipient: string): Promise<"accepted" | "delivered" | "failed" | "unknown"> {
    if (!resendIdPattern.test(id) || !emailPattern.test(recipient)) return "unknown";
    try {
      const response = await call(`/emails/${encodeURIComponent(id)}`, { method: "GET" });
      if (!response.ok) return "unknown";
      const m: unknown = await response.json().catch(() => null);
      if (!isRecord(m) || m.id !== id || !Array.isArray(m.to) || m.to.length !== 1
        || String(m.to[0]).trim().toLowerCase() !== recipient.trim().toLowerCase()) return "unknown";
      if (m.last_event === "delivered") return "delivered";
      if (["bounced", "failed", "complained", "suppressed"].includes(String(m.last_event))) return "failed";
      return "accepted";
    } catch { return "unknown"; }
  }

  const admission: AdmissionEmailProvider = {
    async sendAppInvitation(input) {
      const link = requireActionLink(input.actionLink, appOrigin);
      if (!link || !emailPattern.test(input.recipientEmail) || ![input.deliveryId, input.attemptId, input.idempotencyKey].every((v) => idPattern.test(v))) {
        return { state: "failed", safeErrorCode: "resend_invalid_request", retryable: false } as const;
      }
      return send(input.recipientEmail, "You’re in: welcome to Fifth Wheel",
        `You’re off the waitlist. Sign in, finish your profile, and start requesting seats at tables.\n\nSign in:\n${link}`,
        `<p>You’re off the waitlist. Sign in, finish your profile, and start requesting seats at tables.</p><p><a href="${escapeHtml(link)}">Sign in</a></p>`,
        `admission-${input.idempotencyKey}`, { "Delivery-ID": input.deliveryId, "Attempt-ID": input.attemptId });
    },
    async reconcile(input) {
      if (!input.providerMessageId) return { state: "unknown" } as const;
      const state = await lookup(input.providerMessageId, input.recipientEmail);
      return state === "unknown" ? { state } as const : { state, providerMessageId: input.providerMessageId } as const;
    },
  };

  const magicLink: MagicLinkEmailProvider = {
    async sendSignInLink(input) {
      const link = requireActionLink(input.actionLink, appOrigin);
      if (!link || !emailPattern.test(input.recipientEmail) || !["invite", "magiclink"].includes(input.kind)) {
        return { state: "failed", safeErrorCode: "resend_invalid_request", retryable: false } as const;
      }
      return send(input.recipientEmail, "Your Fifth Wheel sign-in link",
        `Your secure Fifth Wheel sign-in link is ready.\n\n${link}\n\nIf you did not request this link, you can ignore this email.`,
        `<p>Your secure Fifth Wheel sign-in link is ready.</p><p><a href="${escapeHtml(link)}">Continue to Fifth Wheel</a></p><p>If you did not request this link, you can ignore this email.</p>`,
        `signin-${crypto.randomUUID()}`);
    },
  };

  const tableInvitation = Object.freeze({
    async sendInvitation(input: TableInvitationMailInput): Promise<TableInvitationMailResult> {
      const t = input.table;
      if (!emailPattern.test(input.recipientEmail) || ![input.invitationId, input.attemptId].every((v) => idPattern.test(v))
        || !t.title || t.title.length > 180 || t.neighborhood.length > 120 || /[\u0000-\u001f\u007f]/.test(t.title + t.neighborhood)
        || !/^\d{4}-\d{2}-\d{2}$/.test(t.localDate) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t.startLocalTime)) {
        return { state: "failed", safeErrorCode: "table_mail_invalid_request" };
      }
      const link = new URL(`/sign-in?returnTo=${encodeURIComponent(`/invitations/${input.invitationId}`)}`, appOrigin).toString();
      const when = whenLabel(t.localDate, t.startLocalTime);
      const detail = `${when ? ` on ${when}` : ""} in ${t.neighborhood}`;
      const result = await send(input.recipientEmail, `You’re invited: ${t.title}`,
        `You’re invited to ${t.title}${detail}.\n\nPay to confirm your seat.\n\nView invitation: ${link}`,
        `<p>You’re invited to <strong>${escapeHtml(t.title)}</strong>${escapeHtml(detail)}.</p><p>Pay to confirm your seat.</p><p><a href="${escapeHtml(link)}">View invitation</a></p>`,
        `table-${input.invitationId}-${input.attemptId}`, { "Invitation-ID": input.invitationId, "Attempt-ID": input.attemptId });
      return result.state === "accepted" ? { state: "accepted", providerMessageId: result.providerMessageId as string }
        : { state: result.state, safeErrorCode: result.safeErrorCode } as TableInvitationMailResult;
    },
    async reconcile(input: Readonly<{ invitationId: string; attemptId: string; recipientEmail: string; providerMessageId?: string }>): Promise<TableInvitationMailResult> {
      const state = input.providerMessageId ? await lookup(input.providerMessageId, input.recipientEmail) : "unknown";
      return state === "accepted" || state === "delivered" ? { state: "accepted", providerMessageId: input.providerMessageId as string }
        : { state: "unknown", safeErrorCode: "resend_reconcile_unknown" };
    },
  });

  /** Guest notices (Seat, cancellation, removal, reminder). The key includes the attempt so an operator retry is a new send, while a replay of one attempt is deduplicated. */
  const notice = Object.freeze({
    async send(input: Readonly<{ noticeId: string; attempt: number; to: string; subject: string; text: string; html: string }>): Promise<EmailSendResult> {
      if (!emailPattern.test(input.to) || !idPattern.test(input.noticeId)) return { state: "failed", safeErrorCode: "resend_invalid_request", retryable: false };
      return send(input.to, input.subject, input.text, input.html, `notice-${input.noticeId}-${input.attempt}`, { "Notice-ID": input.noticeId });
    },
  });
  return Object.freeze({ admission: Object.freeze(admission), magicLink: Object.freeze(magicLink), tableInvitation, notice });
}
