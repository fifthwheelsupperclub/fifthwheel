/** Sends queued guest notices. Never repeats a business action; an unconfirmed outcome stays `unknown` for an operator. */

import { renderNotice, type NoticeContext, type NoticeKind } from "./notice-templates.server.ts";

export type ClaimedNotice = Readonly<{ noticeId: string; leaseToken: string; kind: NoticeKind; attempt: number; to: string; gone: boolean; context: NoticeContext }>;
export type NoticeSendResult =
  | Readonly<{ state: "accepted"; providerMessageId?: string }>
  | Readonly<{ state: "failed"; safeErrorCode: string; retryable: boolean }>
  | Readonly<{ state: "unknown"; safeErrorCode: string }>;
export type NoticeDeliveryDeps = Readonly<{
  rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  send: (input: Readonly<{ noticeId: string; attempt: number; to: string; subject: string; text: string; html: string }>) => Promise<NoticeSendResult>;
  appOrigin: string;
  limit?: number;
}>;

const kinds = new Set<string>(["seat_confirmed", "cancellation_decision", "table_cancelled", "member_removed", "t48_reminder", "waitlist_confirmed"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseClaims(value: unknown): ClaimedNotice[] {
  if (!Array.isArray(value)) throw new Error("claims_invalid");
  return value.map((item) => {
    const i = item as Record<string, unknown>;
    if (typeof i !== "object" || i === null || !uuid.test(String(i.noticeId)) || !uuid.test(String(i.leaseToken)) || !kinds.has(String(i.kind)) || typeof i.to !== "string"
      || !Number.isSafeInteger(i.attempt) || typeof i.gone !== "boolean" || typeof i.context !== "object" || i.context === null) throw new Error("claims_invalid");
    return i as unknown as ClaimedNotice;
  });
}

/** One pass: queue due reminders, claim a bounded batch, send each, report each outcome. A failure on one notice never blocks the rest. */
export async function deliverNotices(deps: NoticeDeliveryDeps) {
  const tally = { queued: 0, accepted: 0, retry: 0, failed: 0, unknown: 0, gone: 0 };
  const due = await deps.rpc("enqueue_due_notices") as { t48Queued?: number } | null;
  tally.queued = Number(due?.t48Queued ?? 0);
  const claims = parseClaims(await deps.rpc("claim_notices", { p_limit: deps.limit ?? 10 }));
  for (const claim of claims) {
    const finish = (outcome: "accepted" | "failed" | "unknown", retryable: boolean, messageId: string | null, error: string | null) =>
      deps.rpc("finish_notice", { p_notice_id: claim.noticeId, p_lease_token: claim.leaseToken, p_outcome: outcome, p_retryable: retryable, p_message_id: messageId, p_error: error });
    if (claim.gone) { await finish("failed", false, null, "recipient_gone"); tally.gone += 1; continue; }
    let result: NoticeSendResult;
    try {
      const rendered = renderNotice(claim.kind, claim.context, deps.appOrigin);
      result = await deps.send({ noticeId: claim.noticeId, attempt: claim.attempt, to: claim.to, ...rendered });
    } catch { result = { state: "unknown", safeErrorCode: "send_outcome_unknown" }; }
    if (result.state === "accepted") { await finish("accepted", false, result.providerMessageId ?? null, null); tally.accepted += 1; }
    else if (result.state === "unknown") { await finish("unknown", false, null, result.safeErrorCode.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64)); tally.unknown += 1; }
    else { await finish("failed", result.retryable, null, result.safeErrorCode.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64)); if (result.retryable) tally.retry += 1; else tally.failed += 1; }
  }
  return tally;
}
