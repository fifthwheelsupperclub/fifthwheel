/** Chooses the notice mail path: Resend when RESEND_API_KEY is set, otherwise loopback Mailpit for local runs. */

import { env } from "node:process";
import { createResendEmail } from "./email.resend.server.ts";
import type { NoticeDeliveryDeps, NoticeSendResult } from "./notice-delivery.server.ts";

type Environment = Readonly<Record<string, string | undefined>>;
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const required = (name: string, value: string | undefined) => { const v = value?.trim(); if (!v) throw new Error(`${name}_unavailable`); return v; };

export function createNoticeSender(environment: Environment = env, fetcher: typeof fetch = globalThis.fetch): { send: NoticeDeliveryDeps["send"]; appOrigin: string } {
  const appOrigin = required("APP_ORIGIN", environment.APP_ORIGIN);
  const fromEmail = required("MAIL_FROM_EMAIL", environment.MAIL_FROM_EMAIL), fromName = environment.MAIL_FROM_NAME?.trim();
  if (environment.RESEND_API_KEY?.trim()) {
    const resend = createResendEmail({ apiKey: environment.RESEND_API_KEY.trim(), fromEmail, ...(fromName ? { fromName } : {}), appOrigin });
    return { send: (input) => resend.notice.send(input), appOrigin };
  }
  const base = new URL(required("MAILPIT_URL", environment.MAILPIT_URL));
  if (base.protocol !== "http:" || !loopback.has(base.hostname)) throw new Error("mailpit_url_not_loopback");
  return { appOrigin, send: async (input): Promise<NoticeSendResult> => {
    let response: Response;
    try {
      response = await fetcher(new URL("/api/v1/send", base), { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ From: { Email: fromEmail, ...(fromName ? { Name: fromName } : {}) }, To: [{ Email: input.to }], Subject: input.subject, Text: input.text, HTML: input.html,
          Headers: { "Message-ID": `<fw-notice-${input.noticeId}-${input.attempt}@fifthwheel.local>` } }) });
    } catch { return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" }; }
    if (response.status >= 500) return { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
    if (!response.ok) return { state: "failed", safeErrorCode: "mailpit_rejected", retryable: false };
    const body = await response.json().catch(() => null) as { ID?: unknown } | null;
    return typeof body?.ID === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.ID) ? { state: "accepted", providerMessageId: body.ID } : { state: "unknown", safeErrorCode: "mailpit_outcome_unknown" };
  } };
}
