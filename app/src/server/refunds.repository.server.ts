/** Service-role adapter for private W07.5 refund RPCs. */

import type { RefundActionDTO, RefundDetailDTO, RefundListDTO, RefundObligationSummaryDTO, RefundOperationDTO } from "../refunds.contract.ts";
import type { RefundCursor, RefundRepository, RefundWorkItem, RefundWorkResult } from "./refunds.contract.server.ts";

type Config = Readonly<{ url: string; secretKey: string; fetch?: typeof fetch }>;
type RecordValue = Record<string, unknown>;
export type RefundRepositoryErrorCode = "request_failed" | "response_invalid" | "not_found" | "forbidden" | "invalid_input"
  | "conflict" | "operation_conflict" | "balance_exhausted" | "not_retryable" | "not_reconcilable" | "already_settled" | "provider_unavailable";
export class RefundRepositoryError extends Error {
  readonly code: RefundRepositoryErrorCode;
  constructor(code: RefundRepositoryErrorCode) { super(code); this.name = "RefundRepositoryError"; this.code = code; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instant = (x: unknown): x is string => typeof x === "string" && Number.isFinite(Date.parse(x));
const record = (x: unknown): x is RecordValue => typeof x === "object" && x !== null && !Array.isArray(x);
function text(x: unknown, max = 180, allowEmpty = false): string {
  if (typeof x !== "string" || x.length > max || (!allowEmpty && !x.trim())) throw new RefundRepositoryError("response_invalid");
  return x;
}
function integer(x: unknown, max = 2500): number {
  if (!Number.isSafeInteger(x) || Number(x) < 0 || Number(x) > max) throw new RefundRepositoryError("response_invalid");
  return Number(x);
}
function parseSummary(x: unknown): RefundObligationSummaryDTO {
  const sources = ["late_checkout_ineligible", "cancellation"] as const;
  const states = ["open", "pending", "submitted", "unknown", "failed", "succeeded"] as const;
  const blocked = [null, "balance_reserved", "operation_in_progress", "manual_review", "settled", "provider_unavailable"] as const;
  if (!record(x) || !uuid.test(String(x.obligationId)) || !sources.includes(x.source as typeof sources[number])
    || !states.includes(x.state as typeof states[number]) || !instant(x.createdAt) || !instant(x.updatedAt)
    || x.currency !== "USD" || typeof x.canDispatch !== "boolean" || !blocked.includes(x.dispatchBlockedReason as typeof blocked[number])) {
    throw new RefundRepositoryError("response_invalid");
  }
  const amountCents = integer(x.amountCents), reservedCents = integer(x.reservedCents), availableCents = integer(x.availableCents);
  if (amountCents < 1 || typeof x.canDispatch !== "boolean" || x.canDispatch !== (x.dispatchBlockedReason === null)
    || !(x.latestSafeCode === null || typeof x.latestSafeCode === "string" && x.latestSafeCode.length <= 80)) throw new RefundRepositoryError("response_invalid");
  return Object.freeze({ obligationId: x.obligationId as string, source: x.source as RefundObligationSummaryDTO["source"],
    state: x.state as RefundObligationSummaryDTO["state"], amountCents, currency: "USD", createdAt: x.createdAt as string,
    updatedAt: x.updatedAt as string, memberName: text(x.memberName, 202), tableTitle: text(x.tableTitle, 180),
    reservedCents, availableCents, latestSafeCode: x.latestSafeCode as string | null,
    canDispatch: x.canDispatch, dispatchBlockedReason: x.dispatchBlockedReason as RefundObligationSummaryDTO["dispatchBlockedReason"] });
}
function parseOperation(x: unknown): RefundOperationDTO {
  const states = ["pending", "submitted", "unknown", "failed", "succeeded"] as const;
  if (!record(x) || !uuid.test(String(x.operationId)) || !states.includes(x.state as typeof states[number])
    || !instant(x.createdAt) || !instant(x.updatedAt) || typeof x.canRetry !== "boolean" || typeof x.canReconcile !== "boolean"
    || !(x.safeCode === null || typeof x.safeCode === "string" && x.safeCode.length <= 80)) throw new RefundRepositoryError("response_invalid");
  const amountCents = integer(x.amountCents);
  if (amountCents < 1 || (x.state === "succeeded" && x.canRetry) || (x.canRetry && x.canReconcile)) throw new RefundRepositoryError("response_invalid");
  return Object.freeze({ operationId: x.operationId as string, amountCents, state: x.state as RefundOperationDTO["state"],
    createdAt: x.createdAt as string, updatedAt: x.updatedAt as string, safeCode: x.safeCode as string | null,
    canRetry: x.canRetry, canReconcile: x.canReconcile });
}
function parseDetail(x: unknown): RefundDetailDTO {
  if (!record(x) || !Array.isArray(x.operations)) throw new RefundRepositoryError("response_invalid");
  const summary = parseSummary(x);
  const paymentAmountCents = integer(x.paymentAmountCents), refundedCents = integer(x.refundedCents);
  if (paymentAmountCents < 1 || refundedCents > paymentAmountCents || !Array.isArray(x.operations)) throw new RefundRepositoryError("response_invalid");
  const operations = Object.freeze(x.operations.map(parseOperation));
  if (operations.some((op) => op.amountCents > paymentAmountCents)) throw new RefundRepositoryError("response_invalid");
  return Object.freeze({ ...summary, paymentAmountCents, refundedCents, operations });
}
function parseAction(x: unknown): RefundActionDTO {
  if (!record(x)) throw new RefundRepositoryError("response_invalid");
  return Object.freeze({ operation: parseOperation(x.operation), obligation: parseSummary(x.obligation) });
}
function parseList(x: unknown): RefundListDTO {
  if (!record(x) || !Array.isArray(x.items) || !(x.nextCursor === null || typeof x.nextCursor === "string" && x.nextCursor.length <= 512)) {
    throw new RefundRepositoryError("response_invalid");
  }
  return Object.freeze({ items: Object.freeze(x.items.map(parseSummary)), nextCursor: x.nextCursor as string | null });
}
function parseWork(x: unknown): readonly RefundWorkItem[] {
  if (!Array.isArray(x)) throw new RefundRepositoryError("response_invalid");
  return Object.freeze(x.map((item) => {
    if (!record(item) || !uuid.test(String(item.jobId)) || !uuid.test(String(item.leaseToken)) || !uuid.test(String(item.operationId))
      || !["dispatch", "reconcile"].includes(String(item.action)) || !["test", "live"].includes(String(item.mode))
      || typeof item.providerAccountId !== "string" || item.providerAccountId.length > 255
      || typeof item.providerPaymentIntentId !== "string" || !/^pi_[A-Za-z0-9]+$/.test(item.providerPaymentIntentId)
      || !(item.providerRefundId === null || typeof item.providerRefundId === "string" && /^re_[A-Za-z0-9]+$/.test(item.providerRefundId))
      || item.currency !== "USD") throw new RefundRepositoryError("response_invalid");
    const amountCents = integer(item.amountCents);
    if (amountCents < 1) throw new RefundRepositoryError("response_invalid");
    return Object.freeze({ jobId: item.jobId as string, leaseToken: item.leaseToken as string, operationId: item.operationId as string,
      action: item.action as RefundWorkItem["action"], mode: item.mode as RefundWorkItem["mode"],
      providerAccountId: item.providerAccountId, providerPaymentIntentId: item.providerPaymentIntentId,
      providerRefundId: item.providerRefundId as string | null, amountCents, currency: "USD" as const });
  }));
}
function validate(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new RefundRepositoryError("request_failed"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !config.secretKey.trim()) throw new RefundRepositoryError("request_failed");
  return url;
}

export function createRefundRepository(config: Config): RefundRepository {
  const base = validate(config), fetcher = config.fetch ?? globalThis.fetch;
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), { method: "POST", headers: {
      apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
    }, body: JSON.stringify(args), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new RefundRepositoryError("request_failed"); }
    let body: unknown;
    try { body = await response.json() as unknown; } catch { if (response.ok) throw new RefundRepositoryError("response_invalid"); body = null; }
    if (!response.ok) {
      const message = record(body) && typeof body.message === "string" ? body.message : "";
      const map: Record<string, RefundRepositoryErrorCode> = {
        not_found: "not_found", admin_required: "forbidden", invalid_input: "invalid_input", conflict: "conflict",
        operation_conflict: "operation_conflict", balance_exhausted: "balance_exhausted", not_retryable: "not_retryable",
        not_reconcilable: "not_reconcilable", already_settled: "already_settled", provider_unavailable: "provider_unavailable",
      };
      if (map[message]) throw new RefundRepositoryError(map[message]!);
      if (response.status === 401 || response.status === 403) throw new RefundRepositoryError("forbidden");
      throw new RefundRepositoryError("request_failed");
    }
    return body;
  }
  return Object.freeze({
    async listAdminRefunds(actorUserId: string, cursor: RefundCursor | null, limit: number, providerAvailable: boolean) {
      return parseList(await rpc("list_admin_refunds", { p_actor: actorUserId, p_cursor_created_at: cursor?.createdAt ?? null,
        p_cursor_obligation_id: cursor?.obligationId ?? null, p_limit: limit, p_provider_available: providerAvailable }));
    },
    async readAdminRefund(actorUserId: string, obligationId: string, providerAvailable: boolean) {
      return parseDetail(await rpc("read_admin_refund", { p_actor: actorUserId, p_obligation_id: obligationId, p_provider_available: providerAvailable }));
    },
    async dispatchRefund(actorUserId: string, obligationId: string, operationId: string, providerAvailable: boolean) {
      return parseAction(await rpc("queue_refund_dispatch", { p_actor: actorUserId, p_obligation_id: obligationId,
        p_operation_id: operationId, p_provider_available: providerAvailable }));
    },
    async retryRefundOperation(actorUserId: string, operationId: string, requestId: string, providerAvailable: boolean) {
      return parseAction(await rpc("queue_refund_retry", { p_actor: actorUserId, p_operation_id: operationId,
        p_request_id: requestId, p_provider_available: providerAvailable }));
    },
    async reconcileRefundOperation(actorUserId: string, operationId: string, requestId: string, providerAvailable: boolean) {
      return parseAction(await rpc("queue_refund_reconcile", { p_actor: actorUserId, p_operation_id: operationId,
        p_request_id: requestId, p_provider_available: providerAvailable }));
    },
    async claimRefundWork(workerId: string, limit: number) {
      return parseWork(await rpc("claim_refund_work", { p_worker_id: workerId, p_limit: limit }));
    },
    async finishRefundWork(input: RefundWorkResult) {
      await rpc("finish_refund_work", { p_job_id: input.jobId, p_lease_token: input.leaseToken, p_outcome: input.outcome,
        p_safe_code: input.safeCode, p_refund_id: input.providerRefund?.id ?? null, p_mode: input.providerRefund?.mode ?? null,
        p_account_id: "", p_payment_intent_id: input.providerRefund?.paymentIntentId ?? null,
        p_amount_cents: input.providerRefund?.amountCents ?? null, p_currency: input.providerRefund?.currency ?? null,
        p_provider_status: input.providerRefund?.status ?? null });
    },
  });
}
