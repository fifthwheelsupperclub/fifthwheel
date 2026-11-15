/** W07.5 admin refund operations and server-only worker orchestration. */

import { authorize } from "./authorization.server.ts";
import type {
  RefundDetailInput, RefundDispatchInput, RefundListInput, RefundOperationInput, RefundProvider, RefundRepository,
  RefundResult, RefundService, RefundServiceDependencies, RefundWorkResult,
} from "./refunds.contract.server.ts";
import { RefundRepositoryError } from "./refunds.repository.server.ts";
import type { RefundActionDTO, RefundDetailDTO, RefundErrorCode, RefundListDTO } from "../refunds.contract.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = <T>(code: RefundErrorCode, safeMessage: string, retryable = false): RefundResult<T> => ({ ok: false, error: { code, safeMessage, retryable } });
function repositoryFailure<T>(error: unknown): RefundResult<T> {
  const messages: Record<RefundRepositoryError["code"], readonly [RefundErrorCode, string, boolean]> = {
    request_failed: ["temporarily_unavailable", "Refund service is temporarily unavailable. Try again shortly.", true],
    response_invalid: ["temporarily_unavailable", "Refund service is temporarily unavailable. Try again shortly.", true],
    not_found: ["not_found", "This refund record could not be found.", false],
    forbidden: ["forbidden", "Admin access is required.", false],
    invalid_input: ["invalid_input", "Check the refund action and try again.", false],
    conflict: ["conflict", "This refund is already being processed or has changed.", false],
    operation_conflict: ["operation_conflict", "Something changed. Reload and try again.", false],
    balance_exhausted: ["balance_exhausted", "The remaining verified payment does not cover this refund.", false],
    not_retryable: ["not_retryable", "This refund operation cannot be retried safely.", false],
    not_reconcilable: ["not_reconcilable", "This refund operation does not have a provider result to reconcile.", false],
    already_settled: ["already_settled", "This refund is already settled.", false],
    provider_unavailable: ["temporarily_unavailable", "Refund processing is temporarily unavailable.", true],
  };
  if (error instanceof RefundRepositoryError) {
    const [code, safeMessage, retryable] = messages[error.code]; return fail(code, safeMessage, retryable);
  }
  return fail("temporarily_unavailable", "Refund service is temporarily unavailable. Try again shortly.", true);
}
function encodeCursor(value: Readonly<{ createdAt: string; obligationId: string }>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function decodeCursor(value: string | null | undefined): Readonly<{ createdAt: string; obligationId: string }> | null | false {
  if (value == null || value === "") return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const x = parsed as Record<string, unknown>;
    if (Object.keys(x).length !== 2 || typeof x.createdAt !== "string" || !Number.isFinite(Date.parse(x.createdAt))
      || typeof x.obligationId !== "string" || !uuid.test(x.obligationId)) return false;
    return Object.freeze({ createdAt: new Date(x.createdAt).toISOString(), obligationId: x.obligationId });
  } catch { return false; }
}
type Authorized<T> = Readonly<{ ok: true; userId: string }> | Readonly<{ ok: false; result: RefundResult<T> }>;
async function resolveAdmin<T>(token: string | null | undefined, resolve: RefundServiceDependencies["resolvePrincipal"]): Promise<Authorized<T>> {
  if (typeof token !== "string" || !token.trim()) return { ok: false, result: fail("unauthenticated", "Sign in to continue.") };
  let principal;
  try { principal = await resolve(token); }
  catch { return { ok: false, result: fail("temporarily_unavailable", "Refund service is temporarily unavailable. Try again shortly.", true) }; }
  if (!principal) return { ok: false, result: fail("unauthenticated", "Sign in to continue.") };
  if (!authorize(principal, { workspace: "admin", action: "waitlist:read" }).allowed) return { ok: false, result: fail("forbidden", "Admin access is required.") };
  return { ok: true, userId: principal.userId };
}
function validateProviderRefund(value: unknown, item: Readonly<{ id?: string; mode: string; paymentIntentId: string; amountCents: number }>): value is Awaited<ReturnType<RefundProvider["retrieveRefund"]>> {
  if (typeof value !== "object" || value === null) return false;
  const x = value as Record<string, unknown>;
  return typeof x.id === "string" && /^re_[A-Za-z0-9]+$/.test(x.id) && (item.id === undefined || item.id === x.id)
    && x.mode === item.mode && x.paymentIntentId === item.paymentIntentId && x.amountCents === item.amountCents
    && typeof x.currency === "string" && x.currency.toLowerCase() === "usd"
    && ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(String(x.status));
}
function outcome(status: string): RefundWorkResult["outcome"] {
  return status === "succeeded" ? "succeeded" : status === "failed" || status === "canceled" ? "failed" : "pending";
}

export function createRefundService(deps: RefundServiceDependencies): RefundService {
  const repository: RefundRepository = deps.repository;
  return Object.freeze({
    async listAdminRefunds(input: RefundListInput): Promise<RefundResult<RefundListDTO>> {
      const cursor = decodeCursor(input.cursor);
      if (cursor === false || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50))) {
        return fail<RefundListDTO>("invalid_input", "Check the refund queue page and try again.");
      }
      const auth = await resolveAdmin<RefundListDTO>(input.accessToken, deps.resolvePrincipal); if (!auth.ok) return auth.result;
      try {
        const page = await repository.listAdminRefunds(auth.userId, cursor, input.limit ?? 20, deps.providerAvailable);
        const last = page.items.at(-1);
        return { ok: true as const, value: Object.freeze({ ...page,
          nextCursor: page.nextCursor && last ? encodeCursor({ createdAt: last.createdAt, obligationId: last.obligationId }) : null }) };
      } catch (error) { return repositoryFailure(error); }
    },
    async readAdminRefund(input: RefundDetailInput): Promise<RefundResult<RefundDetailDTO>> {
      if (!uuid.test(input.obligationId)) return fail<RefundDetailDTO>("invalid_input", "Use a valid refund link.");
      const auth = await resolveAdmin<RefundDetailDTO>(input.accessToken, deps.resolvePrincipal); if (!auth.ok) return auth.result;
      try { return { ok: true as const, value: await repository.readAdminRefund(auth.userId, input.obligationId, deps.providerAvailable) }; }
      catch (error) { return repositoryFailure(error); }
    },
    async dispatchRefund(input: RefundDispatchInput): Promise<RefundResult<RefundActionDTO>> {
      if (!uuid.test(input.obligationId) || !uuid.test(input.request.operationId)) return fail<RefundActionDTO>("invalid_input", "Check the refund link and operation ID.");
      const auth = await resolveAdmin<RefundActionDTO>(input.accessToken, deps.resolvePrincipal); if (!auth.ok) return auth.result;
      try { return { ok: true as const, value: await repository.dispatchRefund(auth.userId, input.obligationId, input.request.operationId, deps.providerAvailable) }; }
      catch (error) { return repositoryFailure(error); }
    },
    async retryRefundOperation(input: RefundOperationInput): Promise<RefundResult<RefundActionDTO>> {
      if (!uuid.test(input.operationId) || !uuid.test(input.request.requestId)) return fail<RefundActionDTO>("invalid_input", "Check the refund operation and request ID.");
      const auth = await resolveAdmin<RefundActionDTO>(input.accessToken, deps.resolvePrincipal); if (!auth.ok) return auth.result;
      try { return { ok: true as const, value: await repository.retryRefundOperation(auth.userId, input.operationId, input.request.requestId, deps.providerAvailable) }; }
      catch (error) { return repositoryFailure(error); }
    },
    async reconcileRefundOperation(input: RefundOperationInput): Promise<RefundResult<RefundActionDTO>> {
      if (!uuid.test(input.operationId) || !uuid.test(input.request.requestId)) return fail<RefundActionDTO>("invalid_input", "Check the refund operation and request ID.");
      const auth = await resolveAdmin<RefundActionDTO>(input.accessToken, deps.resolvePrincipal); if (!auth.ok) return auth.result;
      try { return { ok: true as const, value: await repository.reconcileRefundOperation(auth.userId, input.operationId, input.request.requestId, deps.providerAvailable) }; }
      catch (error) { return repositoryFailure(error); }
    },
    async runWorkerOnce(input: Readonly<{ workerId: string; limit?: number }>) {
      if (!uuid.test(input.workerId) || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20))) {
        throw new Error("refund_worker_input_invalid");
      }
      if (!deps.providerAvailable) throw new Error("refund_provider_unavailable");
      const jobs = await repository.claimRefundWork(input.workerId, input.limit ?? 10);
      let completed = 0, unknown = 0;
      for (const job of jobs) {
        let result: RefundWorkResult;
        try {
          if (job.providerAccountId !== "") throw new RefundProviderSafeError("provider_unavailable", false);
          let refund;
          if (job.action === "reconcile" || job.providerRefundId !== null) {
            if (!job.providerRefundId) throw new RefundProviderSafeError("provider_unknown", false);
            refund = await deps.provider.retrieveRefund({ refundId: job.providerRefundId, mode: job.mode });
          } else {
            refund = await deps.provider.createRefund({ paymentIntentId: job.providerPaymentIntentId,
              amountCents: job.amountCents, currency: "usd", idempotencyKey: job.operationId, mode: job.mode });
          }
          if (!validateProviderRefund(refund, { id: job.providerRefundId ?? undefined, mode: job.mode,
            paymentIntentId: job.providerPaymentIntentId, amountCents: job.amountCents })) {
            result = { jobId: job.jobId, leaseToken: job.leaseToken, outcome: "unknown", safeCode: "payment_mismatch", providerRefund: null };
          } else {
            const mapped = outcome(refund.status);
            result = { jobId: job.jobId, leaseToken: job.leaseToken, outcome: mapped,
              safeCode: mapped === "pending" ? "provider_pending" : mapped === "failed" ? "provider_failed" : null,
              providerRefund: refund };
          }
        } catch (error) {
          const safeCode = error instanceof RefundProviderSafeError ? error.code : "provider_unknown";
          const isDefinitive = error instanceof RefundProviderSafeError && error.definitive;
          result = { jobId: job.jobId, leaseToken: job.leaseToken, outcome: isDefinitive ? "failed" : "unknown",
            safeCode, providerRefund: null };
        }
        try {
          await repository.finishRefundWork(result);
          if (result.outcome === "unknown") unknown++; else completed++;
        } catch {
          // Leave the durable lease for expiry/recovery. Never guess the provider outcome.
          unknown++;
        }
      }
      return Object.freeze({ claimed: jobs.length, completed, unknown });
    },
  });
}

export class RefundProviderSafeError extends Error {
  readonly code: "provider_rejected" | "provider_unavailable" | "provider_unknown";
  readonly definitive: boolean;
  constructor(code: "provider_rejected" | "provider_unavailable" | "provider_unknown", definitive: boolean) {
    super(code); this.name = "RefundProviderSafeError"; this.code = code; this.definitive = definitive;
  }
}
