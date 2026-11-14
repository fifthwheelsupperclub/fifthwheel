/** Loopback-only Table-invitation email adapter for local Mailpit acceptance tests. */

export type MailpitTableInvitationConfig = Readonly<{ baseUrl: string; appOrigin: string; fromEmail: string; fromName?: string; timeoutMs?: number }>;
export type TableInvitationMailInput = Readonly<{
  invitationId: string; attemptId: string; recipientEmail: string;
  table: Readonly<{ title: string; localDate: string; startLocalTime: string; neighborhood: string }>;
}>;
export type TableInvitationMailResult =
  | Readonly<{ state: "accepted"; providerMessageId: string }>
  | Readonly<{ state: "failed"; safeErrorCode: string }>
  | Readonly<{ state: "unknown"; safeErrorCode: string }>;

export class MailpitTableInvitationError extends Error {
  constructor() { super("mailpit_configuration_invalid"); this.name = "MailpitTableInvitationError"; }
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const mailboxLocalPart = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*";
const mailboxDomainLabel = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const emailPattern = new RegExp(`^${mailboxLocalPart}@${mailboxDomainLabel}(?:\\.${mailboxDomainLabel})+$`);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeMessageId = /^[A-Za-z0-9_-]{1,128}$/;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requireLoopbackHttp(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new MailpitTableInvitationError(); }
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new MailpitTableInvitationError();
  }
  return url;
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string); }
function expectedMessageId(invitationId: string, attemptId: string): string { return `<fw-table-${invitationId}-${attemptId}@fifthwheel.local>`; }
function normalizeMessageId(value: unknown): string | null { return typeof value === "string" ? value.trim().replace(/^<|>$/g, "").toLowerCase() : null; }
function hasExactRecipient(value: unknown, recipient: string): boolean {
  return Array.isArray(value) && value.length === 1 && isRecord(value[0]) && typeof value[0].Address === "string"
    && value[0].Address.trim().toLowerCase() === recipient.trim().toLowerCase();
}

export function createMailpitTableInvitationEmailProvider(config: MailpitTableInvitationConfig, fetcher: typeof fetch = fetch) {
  const baseUrl = requireLoopbackHttp(config.baseUrl); const appOrigin = requireLoopbackHttp(config.appOrigin);
  if (!emailPattern.test(config.fromEmail) || /[\r\n]/.test(config.fromEmail) || config.fromName !== undefined && /[\r\n]/.test(config.fromName)
    || config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30_000)) {
    throw new MailpitTableInvitationError();
  }
  const timeout = config.timeoutMs ?? 5_000;
  async function request(path: string, init: RequestInit): Promise<Response> {
    return fetcher(new URL(path, baseUrl), { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout) });
  }
  function valid(input: TableInvitationMailInput): boolean {
    return uuidPattern.test(input.invitationId) && uuidPattern.test(input.attemptId) && emailPattern.test(input.recipientEmail)
      && typeof input.table.title === "string" && input.table.title.length > 0 && input.table.title.length <= 180
      && /^\d{4}-\d{2}-\d{2}$/.test(input.table.localDate) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.table.startLocalTime)
      && typeof input.table.neighborhood === "string" && input.table.neighborhood.length <= 120
      && !/[\u0000-\u001f\u007f]/.test(input.table.title + input.table.neighborhood);
  }
  return Object.freeze({
    async sendInvitation(input: TableInvitationMailInput): Promise<TableInvitationMailResult> {
      if (!valid(input)) return { state: "failed", safeErrorCode: "table_mail_invalid_request" };
      const messageId = expectedMessageId(input.invitationId, input.attemptId);
      const returnTo = `/invitations/${input.invitationId}`;
      const link = new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, appOrigin).toString();
      const title = escapeHtml(input.table.title); const neighborhood = escapeHtml(input.table.neighborhood);
      const text = `You have a Table invitation for ${input.table.title}.\n\n${input.table.localDate} at ${input.table.startLocalTime} · ${input.table.neighborhood}.\n\nView your Table invitation: ${link}\n\nThis is a separate Table offer; your app admission and sign-in link are unchanged.`;
      const html = `<p>You have a Table invitation for <strong>${title}</strong>.</p><p>${escapeHtml(input.table.localDate)} at ${escapeHtml(input.table.startLocalTime)} · ${neighborhood}.</p><p><a href="${escapeHtml(link)}">View your Table invitation</a></p><p>This is a separate Table offer; your app admission and sign-in link are unchanged.</p>`;
      let response: Response;
      try { response = await request("/api/v1/send", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ From: { Email: config.fromEmail, ...(config.fromName ? { Name: config.fromName } : {}) },
          To: [{ Email: input.recipientEmail }], Subject: `Your Fifth Wheel Table invitation: ${input.table.title}`,
          Text: text, HTML: html, Headers: { "Message-ID": messageId, "X-FifthWheel-Invitation-ID": input.invitationId,
            "X-FifthWheel-Attempt-ID": input.attemptId } }) }); }
      catch { return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" }; }
      if (response.status >= 500) return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      if (!response.ok) return { state: "failed", safeErrorCode: "mailpit_rejected" };
      const body: unknown = await response.json().catch(() => null);
      if (!isRecord(body) || typeof body.ID !== "string" || !safeMessageId.test(body.ID)) return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
      return { state: "accepted", providerMessageId: body.ID };
    },
    async reconcile(input: Readonly<{ invitationId: string; attemptId: string; recipientEmail: string; providerMessageId?: string }>): Promise<TableInvitationMailResult> {
      if (![input.invitationId, input.attemptId].every((value) => uuidPattern.test(value)) || !emailPattern.test(input.recipientEmail)) {
        return { state: "unknown", safeErrorCode: "mailpit_reconcile_invalid_request" };
      }
      const expected = normalizeMessageId(expectedMessageId(input.invitationId, input.attemptId));
      try {
        let message: unknown = null;
        if (input.providerMessageId) {
          if (!safeMessageId.test(input.providerMessageId)) return { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" };
          const response = await request(`/api/v1/message/${encodeURIComponent(input.providerMessageId)}`, { method: "GET", headers: { accept: "application/json" } });
          if (!response.ok) return { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" };
          message = await response.json().catch(() => null);
        } else {
          const url = new URL("/api/v1/search", baseUrl); url.searchParams.set("query", `message-id:${expectedMessageId(input.invitationId, input.attemptId).replace(/[<>]/g, "")}`); url.searchParams.set("limit", "50");
          const response = await request(`${url.pathname}${url.search}`, { method: "GET", headers: { accept: "application/json" } });
          const body: unknown = response.ok ? await response.json().catch(() => null) : null;
          const rows = isRecord(body) && Array.isArray(body.messages) ? body.messages.filter((row) => isRecord(row)
            && normalizeMessageId(row.MessageID) === expected && hasExactRecipient(row.To, input.recipientEmail)) : [];
          if (rows.length !== 1) return { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" };
          message = rows[0];
        }
        if (isRecord(message) && (!input.providerMessageId || message.ID === input.providerMessageId)
          && normalizeMessageId(message.MessageID) === expected && hasExactRecipient(message.To, input.recipientEmail)
          && typeof message.ID === "string" && safeMessageId.test(message.ID)) {
          return { state: "accepted", providerMessageId: message.ID };
        }
      } catch { /* absence or Mailpit uncertainty never proves failure */ }
      return { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" };
    },
  });
}
