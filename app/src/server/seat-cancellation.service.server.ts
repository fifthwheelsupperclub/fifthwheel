/** W07.4 cancellation request/review use cases; refund settlement is out of scope. */

import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";
import type {
  AdminCancellationInput, AdminCancellationQueueInput, CancellationFailure, CancellationResult,
  DecideCancellationServiceInput, OwnCancellationHistoryInput, SeatCancellationService,
  SeatCancellationServiceDependencies, RequestCancellationServiceInput,
} from "./seat-cancellation.contract.server.ts";
import type {
  AdminCancellationDetailDTO, AdminCancellationQueueDTO, CancellationErrorCode, DecideCancellationInput,
  MemberCancellationHistoryDTO, MemberCancellationRequestDTO,
} from "../seat-cancellation.contract.ts";
import { CancellationRepositoryError } from "./seat-cancellation.repository.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = <T>(code: CancellationErrorCode, safeMessage: string, retryable = false): CancellationResult<T> =>
  ({ ok: false, error: { code, safeMessage, retryable } });
function repoFailure<T>(error: unknown): CancellationResult<T> {
  if (!(error instanceof CancellationRepositoryError)) return fail("temporarily_unavailable", "Cancellation service is temporarily unavailable.", true);
  const messages: Record<CancellationRepositoryError["code"], readonly [CancellationErrorCode, string, boolean]> = {
    request_failed: ["temporarily_unavailable", "Cancellation service is temporarily unavailable.", true],
    response_invalid: ["temporarily_unavailable", "Cancellation service is temporarily unavailable.", true],
    not_found: ["not_found", "This Seat or request could not be found.", false],
    forbidden: ["forbidden", "You do not have access to this cancellation request.", false],
    invalid_input: ["invalid_input", "Check the cancellation request and try again.", false],
    request_pending: ["request_pending", "A cancellation request is already awaiting review.", false],
    seat_not_cancellable: ["seat_not_cancellable", "This Seat is no longer available for cancellation.", false],
    stale_version: ["stale_version", "This request changed. Refresh it before deciding.", false],
    refund_amount_exceeds_balance: ["refund_amount_exceeds_balance", "The refund amount exceeds the remaining verified payment.", false],
    decision_finalized: ["decision_finalized", "This cancellation request already has a final decision.", false],
    operation_conflict: ["operation_conflict", "This operation ID was already used for different details.", false],
  };
  const [code, safeMessage, retryable] = messages[error.code];
  return fail(code, safeMessage, retryable);
}
function encodeCursor(value: Readonly<{ requestedAt: string; requestId: string }>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function decodeCursor(value: string | null | undefined): Readonly<{ requestedAt: string; requestId: string }> | null | false {
  if (value == null || value === "") return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const obj = parsed as Record<string, unknown>;
    if (Object.keys(obj).length !== 2 || typeof obj.requestedAt !== "string" || !Number.isFinite(Date.parse(obj.requestedAt))
      || typeof obj.requestId !== "string" || !uuid.test(obj.requestId)) return false;
    return Object.freeze({ requestedAt: new Date(obj.requestedAt).toISOString(), requestId: obj.requestId });
  } catch { return false; }
}
function normalizeMemberReason(value: unknown): string | null | false {
  if (value === undefined) return null;
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 2_000 ? normalized : false;
}
function normalizeDecision(value: unknown): DecideCancellationInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["operationId", "expectedVersion", "decision", "refundCents", "memberSafeReason"].includes(key))
    || typeof input.operationId !== "string" || !uuid.test(input.operationId)
    || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1
    || (input.decision !== "approve" && input.decision !== "deny")
    || !Number.isSafeInteger(input.refundCents) || Number(input.refundCents) < 0 || Number(input.refundCents) > 2500
    || typeof input.memberSafeReason !== "string") return null;
  const memberSafeReason = input.memberSafeReason.trim();
  if (memberSafeReason.length < 1 || memberSafeReason.length > 500) return null;
  if (input.decision === "deny" && input.refundCents !== 0) return null;
  return Object.freeze({ operationId: input.operationId, expectedVersion: Number(input.expectedVersion),
    decision: input.decision, refundCents: Number(input.refundCents), memberSafeReason });
}
type AuthResult<T> = Readonly<{ ok: true; principal: ServerVerifiedPrincipal }> | Readonly<{ ok: false; result: CancellationResult<T> }>;
async function resolveAuthorized<T>(token: string | null | undefined, resolve: SeatCancellationServiceDependencies["resolvePrincipal"], role: "member" | "admin"): Promise<AuthResult<T>> {
  if (typeof token !== "string" || token.trim() === "") return { ok: false, result: fail("unauthenticated", "Sign in to continue.") };
  let principal: ServerVerifiedPrincipal | null;
  try { principal = await resolve(token); } catch { return { ok: false, result: fail("temporarily_unavailable", "Cancellation service is temporarily unavailable.", true) }; }
  if (!principal) return { ok: false, result: fail("unauthenticated", "Sign in to continue.") };
  const allowed = role === "member"
    ? authorize(principal, { workspace: "member", action: "member:read-own" }).allowed
    : authorize(principal, { workspace: "admin", action: "waitlist:read" }).allowed;
  if (!allowed) return { ok: false, result: fail("forbidden", role === "admin" ? "Admin access is required." : "Member access is not active for this account.") };
  return { ok: true, principal };
}

export function createSeatCancellationService(deps: SeatCancellationServiceDependencies): SeatCancellationService {
  return Object.freeze({
    async listOwnCancellationRequests(input: OwnCancellationHistoryInput): Promise<CancellationResult<MemberCancellationHistoryDTO>> {
      if (!uuid.test(input.seatId)) return fail<MemberCancellationHistoryDTO>("invalid_input", "Check the Seat link and try again.");
      const auth = await resolveAuthorized<MemberCancellationHistoryDTO>(input.accessToken, deps.resolvePrincipal, "member");
      if (!auth.ok) return auth.result;
      try { return { ok: true as const, value: await deps.repository.listOwnCancellationRequests(auth.principal.userId, input.seatId) }; }
      catch (error) { return repoFailure(error); }
    },
    async requestCancellation(input: RequestCancellationServiceInput): Promise<CancellationResult<MemberCancellationRequestDTO>> {
      if (!uuid.test(input.seatId) || !uuid.test(input.request.operationId)) return fail<MemberCancellationRequestDTO>("invalid_input", "Check the cancellation request and try again.");
      const reason = normalizeMemberReason(input.request.memberReason);
      if (reason === false) return fail<MemberCancellationRequestDTO>("invalid_input", "The optional explanation must be between 1 and 2,000 characters.");
      const auth = await resolveAuthorized<MemberCancellationRequestDTO>(input.accessToken, deps.resolvePrincipal, "member");
      if (!auth.ok) return auth.result;
      try {
        return { ok: true as const, value: await deps.repository.requestCancellation(auth.principal.userId, input.seatId,
          { operationId: input.request.operationId, memberReason: reason }) };
      } catch (error) { return repoFailure(error); }
    },
    async listAdminCancellations(input: AdminCancellationQueueInput): Promise<CancellationResult<AdminCancellationQueueDTO>> {
      const cursor = decodeCursor(input.cursor);
      if (cursor === false || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50))) {
        return fail<AdminCancellationQueueDTO>("invalid_input", "Check the cancellation queue filters and try again.");
      }
      const auth = await resolveAuthorized<AdminCancellationQueueDTO>(input.accessToken, deps.resolvePrincipal, "admin");
      if (!auth.ok) return auth.result;
      try {
        const page = await deps.repository.listAdminCancellations(auth.principal.userId, cursor, input.limit ?? 20);
        const last = page.items.at(-1);
        return { ok: true as const, value: Object.freeze({ ...page,
          nextCursor: page.nextCursor && last ? encodeCursor({ requestedAt: last.request.requestedAt, requestId: last.request.requestId }) : null }) };
      } catch (error) { return repoFailure(error); }
    },
    async readAdminCancellation(input: AdminCancellationInput): Promise<CancellationResult<AdminCancellationDetailDTO>> {
      if (!uuid.test(input.requestId)) return fail<AdminCancellationDetailDTO>("invalid_input", "Check the cancellation request link and try again.");
      const auth = await resolveAuthorized<AdminCancellationDetailDTO>(input.accessToken, deps.resolvePrincipal, "admin");
      if (!auth.ok) return auth.result;
      try { return { ok: true as const, value: await deps.repository.readAdminCancellation(auth.principal.userId, input.requestId) }; }
      catch (error) { return repoFailure(error); }
    },
    async decideCancellation(input: DecideCancellationServiceInput): Promise<CancellationResult<AdminCancellationDetailDTO>> {
      if (!uuid.test(input.requestId)) return fail<AdminCancellationDetailDTO>("invalid_input", "Check the cancellation request link and try again.");
      const request = normalizeDecision(input.request);
      if (!request) return fail<AdminCancellationDetailDTO>("invalid_input", "Check the decision and member-visible explanation.");
      const auth = await resolveAuthorized<AdminCancellationDetailDTO>(input.accessToken, deps.resolvePrincipal, "admin");
      if (!auth.ok) return auth.result;
      try { return { ok: true as const, value: await deps.repository.decideCancellation(auth.principal.userId, input.requestId, request) }; }
      catch (error) { return repoFailure(error); }
    },
  });
}
