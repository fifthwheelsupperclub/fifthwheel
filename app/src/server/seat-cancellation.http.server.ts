/** Same-origin cookie-authenticated boundaries for W07.4 cancellation history and review. */

import { randomUUID } from "node:crypto";
import type { CancellationErrorCode, CancellationResponse, DecideCancellationInput, RequestCancellationInput } from "../seat-cancellation.contract.ts";
import type { SeatCancellationService, CancellationResult } from "./seat-cancellation.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" };
type Factory = () => SeatCancellationService;
const statuses: Record<CancellationErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, invalid_input: 400,
  request_pending: 409, seat_not_cancellable: 409, stale_version: 409, refund_amount_exceeds_balance: 409,
  decision_finalized: 409, operation_conflict: 409, temporarily_unavailable: 503,
};
function response<T>(result: CancellationResult<T>, correlationId: string): Response {
  const body: CancellationResponse<T> = result.ok
    ? { ok: true, data: result.value, correlationId }
    : { ok: false, correlationId, error: { ...result.error, correlationId } };
  return Response.json(body, { status: result.ok ? 200 : statuses[result.error.code], headers: noStore });
}
function error(code: CancellationErrorCode, safeMessage: string, correlationId = randomUUID()): Response {
  const body: CancellationResponse<never> = { ok: false, correlationId,
    error: { code, safeMessage, retryable: code === "temporarily_unavailable", correlationId } };
  return Response.json(body, { status: statuses[code], headers: noStore });
}
function record(x: unknown): x is Record<string, unknown> { return typeof x === "object" && x !== null && !Array.isArray(x); }
function exactKeys(x: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(x).every((key) => allowed.includes(key)); }
async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return null;
  const length = request.headers.get("content-length") ?? "0";
  if (!/^\d+$/.test(length) || Number(length) > 16_384 || !request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 16_384) { await reader.cancel(); return null; } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return record(parsed) ? parsed : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

export function createSeatCancellationHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  function originFailure(request: Request): Response | null {
    const check = assertExactOrigin(request, expectedOrigin);
    return check.allowed ? null : error("forbidden", "This request origin is not allowed.");
  }
  function unavailable(): Response { return error("temporarily_unavailable", "Cancellation service is temporarily unavailable. Try again shortly."); }
  return Object.freeze({
    async readMemberHistory(request: Request, seatId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuid.test(seatId)) return error("invalid_input", "Use a valid Seat link.", correlationId);
      try { return response(await createService().listOwnCancellationRequests({ accessToken: getAccessTokenForPrincipal(request), seatId }), correlationId); }
      catch { return unavailable(); }
    },
    async requestMemberCancellation(request: Request, seatId: string): Promise<Response> {
      const correlationId = randomUUID(); const denied = originFailure(request); if (denied) return denied;
      if (!uuid.test(seatId)) return error("invalid_input", "Use a valid Seat link.", correlationId);
      const body = await jsonBody(request);
      if (!body || !exactKeys(body, ["operationId", "memberReason"]) || typeof body.operationId !== "string" || !uuid.test(body.operationId)
        || (body.memberReason !== undefined && typeof body.memberReason !== "string")) {
        return error("invalid_input", "Check the cancellation request and try again.", correlationId);
      }
      const input: RequestCancellationInput = { operationId: body.operationId,
        ...(typeof body.memberReason === "string" ? { memberReason: body.memberReason } : {}) };
      try { return response(await createService().requestCancellation({ accessToken: getAccessTokenForPrincipal(request), seatId, request: input }), correlationId); }
      catch { return unavailable(); }
    },
    async listAdminQueue(request: Request): Promise<Response> {
      const correlationId = randomUUID(); const url = new URL(request.url); const values = new Map<string, string>();
      for (const [key, value] of url.searchParams) {
        if (!["cursor", "limit"].includes(key) || values.has(key)) return error("invalid_input", "Check the cancellation queue page.", correlationId);
        values.set(key, value);
      }
      const cursor = values.get("cursor"); const limit = values.get("limit") ?? "20";
      if (cursor && (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) || !/^(?:[1-9]\d?|50)$/.test(limit)) {
        return error("invalid_input", "Check the cancellation queue page.", correlationId);
      }
      try { return response(await createService().listAdminCancellations({ accessToken: getAccessTokenForPrincipal(request), cursor: cursor ?? null, limit: Number(limit) }), correlationId); }
      catch { return unavailable(); }
    },
    async readAdminDetail(request: Request, requestId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuid.test(requestId)) return error("invalid_input", "Use a valid cancellation request link.", correlationId);
      try { return response(await createService().readAdminCancellation({ accessToken: getAccessTokenForPrincipal(request), requestId }), correlationId); }
      catch { return unavailable(); }
    },
    async decideAdminRequest(request: Request, requestId: string): Promise<Response> {
      const correlationId = randomUUID(); const denied = originFailure(request); if (denied) return denied;
      if (!uuid.test(requestId)) return error("invalid_input", "Use a valid cancellation request link.", correlationId);
      const body = await jsonBody(request);
      if (!body || !exactKeys(body, ["operationId", "expectedVersion", "decision", "refundCents", "memberSafeReason"])
        || typeof body.operationId !== "string" || !uuid.test(body.operationId) || !Number.isSafeInteger(body.expectedVersion)
        || typeof body.decision !== "string" || !Number.isSafeInteger(body.refundCents) || typeof body.memberSafeReason !== "string") {
        return error("invalid_input", "Check the decision and member-visible explanation.", correlationId);
      }
      const input: DecideCancellationInput = { operationId: body.operationId, expectedVersion: Number(body.expectedVersion),
        decision: body.decision as DecideCancellationInput["decision"], refundCents: Number(body.refundCents), memberSafeReason: body.memberSafeReason };
      try { return response(await createService().decideCancellation({ accessToken: getAccessTokenForPrincipal(request), requestId, request: input }), correlationId); }
      catch { return unavailable(); }
    },
  });
}
