/** Same-origin cookie-authenticated HTTP boundaries for W06.5 Table offers and recovery. */

import { randomUUID } from "node:crypto";
import type { TableInvitationErrorCode } from "../table-invitations.contract.ts";
import type { TableInvitationService, TableInvitationServiceResult } from "./table-invitations.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorPattern = /^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i;
const noStore = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" };
type Factory = () => TableInvitationService;
function statusFor(code: TableInvitationErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not_found": return 404;
    case "invalid_input": return 400;
    case "operation_conflict":
    case "attempt_not_retryable":
    case "attempt_reconciliation_required":
    case "attempt_busy": return 409;
    case "temporarily_unavailable": return 503;
  }
}
function response(body: unknown, status: number): Response { return Response.json(body, { status, headers: noStore }); }
function error(code: TableInvitationErrorCode, safeMessage: string, correlationId = randomUUID()): Response {
  return response({ ok: false, error: { code, safeMessage, retryable: code === "temporarily_unavailable", correlationId } }, statusFor(code));
}
function serviceResponse<T>(result: TableInvitationServiceResult<T>, correlationId: string): Response {
  if (!result.ok) return response({ ok: false, error: { code: result.error.code, safeMessage: result.error.safeMessage,
    retryable: result.error.code === "temporarily_unavailable", correlationId } }, statusFor(result.error.code));
  return response({ ok: true, data: result.value, correlationId }, 200);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "") || !request.body) return null;
  const lengthText = request.headers.get("content-length") ?? "0";
  if (lengthText && !/^\d+$/.test(lengthText) || Number(lengthText) > 4096) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 4096) { await reader.cancel(); return null; } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

export function createTableInvitationHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  function originFailure(request: Request): Response | null {
    const check = assertExactOrigin(request, expectedOrigin);
    return check.allowed ? null : error("forbidden", "This request origin is not allowed.");
  }
  return Object.freeze({
    async readMemberInvitation(request: Request, invitationId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuidPattern.test(invitationId)) return error("invalid_input", "Use a valid invitation link.", correlationId);
      try { return serviceResponse(await createService().readMemberInvitation({ accessToken: getAccessTokenForPrincipal(request), invitationId }), correlationId); }
      catch { return error("temporarily_unavailable", "Invitation details are temporarily unavailable.", correlationId); }
    },
    async listAdminInvitations(request: Request): Promise<Response> {
      const correlationId = randomUUID(); const values = new Map<string, string>();
      for (const [key, value] of new URL(request.url).searchParams) {
        if (!["cursor", "limit"].includes(key) || values.has(key)) return error("invalid_input", "Check the invitation history page.", correlationId);
        values.set(key, value);
      }
      const cursor = values.get("cursor"); const limitText = values.get("limit") ?? "25";
      if (cursor && (cursor.length > 150 || !cursorPattern.test(cursor)) || !/^(?:[1-9]\d?|50)$/.test(limitText)) {
        return error("invalid_input", "Check the invitation history page.", correlationId);
      }
      try { return serviceResponse(await createService().listAdminInvitations({ accessToken: getAccessTokenForPrincipal(request),
        ...(cursor ? { cursor } : {}), limit: Number(limitText) }), correlationId); }
      catch { return error("temporarily_unavailable", "Invitation delivery is temporarily unavailable.", correlationId); }
    },
    async retryFailedDelivery(request: Request, invitationId: string): Promise<Response> {
      const correlationId = randomUUID(); const check = originFailure(request); if (check) return check;
      if (!uuidPattern.test(invitationId)) return error("invalid_input", "Use a valid invitation link.", correlationId);
      const body = await jsonBody(request);
      if (!body || Object.keys(body).length !== 2 || !Object.hasOwn(body, "operationId") || !Object.hasOwn(body, "expectedAttemptCount")
        || typeof body.operationId !== "string" || !uuidPattern.test(body.operationId)
        || !Number.isSafeInteger(body.expectedAttemptCount) || Number(body.expectedAttemptCount) < 1) {
        return error("invalid_input", "Refresh delivery status before retrying.", correlationId);
      }
      try { return serviceResponse(await createService().retryFailedDelivery({ accessToken: getAccessTokenForPrincipal(request), invitationId,
        request: { operationId: body.operationId, expectedAttemptCount: Number(body.expectedAttemptCount) } }), correlationId); }
      catch { return error("temporarily_unavailable", "Invitation delivery is temporarily unavailable.", correlationId); }
    },
    async reconcileUnknown(request: Request, invitationId: string): Promise<Response> {
      const correlationId = randomUUID(); const check = originFailure(request); if (check) return check;
      if (!uuidPattern.test(invitationId)) return error("invalid_input", "Use a valid invitation link.", correlationId);
      const body = await jsonBody(request);
      if (!body || Object.keys(body).length !== 1 || !Object.hasOwn(body, "expectedAttemptCount")
        || !Number.isSafeInteger(body.expectedAttemptCount) || Number(body.expectedAttemptCount) < 1) {
        return error("invalid_input", "Refresh delivery status before checking it.", correlationId);
      }
      try { return serviceResponse(await createService().reconcileUnknown({ accessToken: getAccessTokenForPrincipal(request), invitationId,
        request: { expectedAttemptCount: Number(body.expectedAttemptCount) } }), correlationId); }
      catch { return error("temporarily_unavailable", "Invitation delivery is temporarily unavailable.", correlationId); }
    },
  });
}
