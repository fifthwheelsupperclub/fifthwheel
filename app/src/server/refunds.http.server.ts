/** Same-origin admin boundaries for W07.5; worker execution is intentionally absent from HTTP. */

import { randomUUID } from "node:crypto";
import type { RefundErrorCode, RefundResponse } from "../refunds.contract.ts";
import type { RefundService, RefundResult } from "./refunds.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" };
type Factory = () => RefundService;
const statuses: Record<RefundErrorCode, number> = {
  unauthenticated: 401, forbidden: 403, not_found: 404, invalid_input: 400, conflict: 409,
  operation_conflict: 409, balance_exhausted: 409, not_retryable: 409, not_reconcilable: 409,
  already_settled: 409, temporarily_unavailable: 503,
};
function record(x: unknown): x is Record<string, unknown> { return typeof x === "object" && x !== null && !Array.isArray(x); }
function bodyResponse<T>(result: RefundResult<T>, correlationId: string): Response {
  const body: RefundResponse<T> = result.ok ? { ok: true, data: result.value, correlationId }
    : { ok: false, correlationId, error: { ...result.error, correlationId } };
  return Response.json(body, { status: result.ok ? 200 : statuses[result.error.code], headers: noStore });
}
function error(code: RefundErrorCode, safeMessage: string, correlationId = randomUUID()): Response {
  const body: RefundResponse<never> = { ok: false, correlationId,
    error: { code, safeMessage, retryable: code === "temporarily_unavailable", correlationId } };
  return Response.json(body, { status: statuses[code], headers: noStore });
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)); }
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || !request.body) return null;
  const length = request.headers.get("content-length") ?? "0";
  if (!/^\d+$/.test(length) || Number(length) > 8_192) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 8_192) { await reader.cancel(); return null; } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); return record(parsed) ? parsed : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

export function createRefundHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  function originDenied(request: Request): Response | null {
    const origin = assertExactOrigin(request, expectedOrigin); return origin.allowed ? null : error("forbidden", "This request origin is not allowed.");
  }
  function unavailable(): Response { return error("temporarily_unavailable", "Refund service is temporarily unavailable. Try again shortly."); }
  return Object.freeze({
    async listAdminRefunds(request: Request): Promise<Response> {
      const correlationId = randomUUID(), url = new URL(request.url), query = new Map<string, string>();
      for (const [key, value] of url.searchParams) { if (!["cursor", "limit"].includes(key) || query.has(key)) return error("invalid_input", "Check the refund queue page.", correlationId); query.set(key, value); }
      const cursor = query.get("cursor"), limit = query.get("limit") ?? "20";
      if ((cursor && (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor))) || !/^(?:[1-9]\d?|50)$/.test(limit)) return error("invalid_input", "Check the refund queue page.", correlationId);
      try { return bodyResponse(await createService().listAdminRefunds({ accessToken: getAccessTokenForPrincipal(request), cursor: cursor ?? null, limit: Number(limit) }), correlationId); }
      catch { return unavailable(); }
    },
    async readAdminRefund(request: Request, obligationId: string): Promise<Response> {
      const correlationId = randomUUID(); if (!uuid.test(obligationId)) return error("invalid_input", "Use a valid refund link.", correlationId);
      try { return bodyResponse(await createService().readAdminRefund({ accessToken: getAccessTokenForPrincipal(request), obligationId }), correlationId); }
      catch { return unavailable(); }
    },
    async dispatchRefund(request: Request, obligationId: string): Promise<Response> {
      const correlationId = randomUUID(), denied = originDenied(request); if (denied) return denied;
      if (!uuid.test(obligationId)) return error("invalid_input", "Use a valid refund link.", correlationId);
      const body = await readBody(request);
      if (!body || !exactKeys(body, ["operationId"]) || typeof body.operationId !== "string" || !uuid.test(body.operationId)) return error("invalid_input", "Check the refund action.", correlationId);
      try { return bodyResponse(await createService().dispatchRefund({ accessToken: getAccessTokenForPrincipal(request), obligationId,
        request: { operationId: body.operationId } }), correlationId); }
      catch { return unavailable(); }
    },
    async retryRefundOperation(request: Request, operationId: string): Promise<Response> {
      const correlationId = randomUUID(), denied = originDenied(request); if (denied) return denied;
      if (!uuid.test(operationId)) return error("invalid_input", "Use a valid refund operation link.", correlationId);
      const body = await readBody(request);
      if (!body || !exactKeys(body, ["requestId"]) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) return error("invalid_input", "Check the refund retry action.", correlationId);
      try { return bodyResponse(await createService().retryRefundOperation({ accessToken: getAccessTokenForPrincipal(request), operationId,
        request: { requestId: body.requestId } }), correlationId); }
      catch { return unavailable(); }
    },
    async reconcileRefundOperation(request: Request, operationId: string): Promise<Response> {
      const correlationId = randomUUID(), denied = originDenied(request); if (denied) return denied;
      if (!uuid.test(operationId)) return error("invalid_input", "Use a valid refund operation link.", correlationId);
      const body = await readBody(request);
      if (!body || !exactKeys(body, ["requestId"]) || typeof body.requestId !== "string" || !uuid.test(body.requestId)) return error("invalid_input", "Check the refund reconciliation action.", correlationId);
      try { return bodyResponse(await createService().reconcileRefundOperation({ accessToken: getAccessTokenForPrincipal(request), operationId,
        request: { requestId: body.requestId } }), correlationId); }
      catch { return unavailable(); }
    },
  });
}
