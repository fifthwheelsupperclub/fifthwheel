/** Cookie-authenticated HTTP boundary for the admin W05.3 clone operations. */

import { randomUUID } from "node:crypto";
import type {
  WeeklyCloneErrorCode, WeeklyCloneResponse, WeeklyCloneStartRequest, WeeklyCloneUndoRequest,
} from "../supply.weekly-clone.contract.ts";
import type { WeeklyCloneResult, WeeklyCloneService } from "./supply.weekly-clone.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const noStore = { "cache-control": "private, no-store", vary: "Cookie, Origin" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const weekDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const hashPattern = /^[a-f0-9]{32}$/;
const maxBodyBytes = 4096;
type Factory = () => WeeklyCloneService;

function status(code: WeeklyCloneErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "invalid_input": return 400;
    case "not_found": return 404;
    case "revision_conflict":
    case "operation_conflict": return 409;
    case "provider_unavailable":
    case "temporarily_unavailable": return 503;
  }
}

function response(body: unknown, statusCode: number): Response {
  return Response.json(body, { status: statusCode, headers: noStore });
}

function error(code: WeeklyCloneErrorCode, message: string, retryable = false, correlationId: string = randomUUID()): Response {
  return response({ ok: false, error: { code, message, retryable, correlationId } }, status(code));
}

function serviceResponse<T>(result: WeeklyCloneResult<T>, correlationId: string): Response {
  if (!result.ok) {
    const retryable = result.error.code === "temporarily_unavailable" || result.error.code === "provider_unavailable";
    return response({ ok: false, error: { code: result.error.code, message: result.error.safeMessage, retryable, correlationId } }, status(result.error.code));
  }
  return response({ ok: true, data: result.value, correlationId } satisfies WeeklyCloneResponse<T>, 200);
}

function validObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

async function parseBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 }> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return { ok: false, status: 415 };
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxBodyBytes) return { ok: false, status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBodyBytes) { await reader.cancel(); return { ok: false, status: 413 }; }
      chunks.push(value);
    }
  } catch { return { ok: false, status: 400 }; }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return { ok: false, status: 400 }; }
  try { return { ok: true, value: JSON.parse(text) as unknown }; } catch { return { ok: false, status: 400 }; }
}

async function bodyFor(request: Request, correlationId: string): Promise<unknown | Response> {
  const parsed = await parseBody(request);
  if (parsed.ok) return parsed.value;
  if (parsed.status === 415) return error("invalid_input", "Submit this change as JSON.", false, correlationId);
  if (parsed.status === 413) return response({ ok: false, error: { code: "invalid_input", message: "The request is too large.", retryable: false, correlationId } }, 413);
  return error("invalid_input", "Submit a valid JSON request.", false, correlationId);
}

export function createWeeklyCloneHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  const token = (request: Request) => getAccessTokenForPrincipal(request);
  function requireOrigin(request: Request, correlationId: string): Response | null {
    const result = assertExactOrigin(request, expectedOrigin);
    return result.allowed ? null : error("forbidden", "This request origin is not allowed.", false, correlationId);
  }
  function serviceUnavailable(correlationId: string): Response {
    return error("temporarily_unavailable", "Weekly supply is temporarily unavailable.", true, correlationId);
  }

  return Object.freeze({
    async preview(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      const origin = requireOrigin(request, correlationId); if (origin) return origin;
      const body = await bodyFor(request, correlationId); if (body instanceof Response) return body;
      if (!validObject(body, ["sourceWeekStart", "targetWeekStart"])
        || typeof body.sourceWeekStart !== "string" || !weekDatePattern.test(body.sourceWeekStart)
        || typeof body.targetWeekStart !== "string" || !weekDatePattern.test(body.targetWeekStart)) {
        return error("invalid_input", "Choose source and target week-start dates.", false, correlationId);
      }
      try { return serviceResponse(await createService().preview({ accessToken: token(request), sourceWeekStart: body.sourceWeekStart, targetWeekStart: body.targetWeekStart }), correlationId); }
      catch { return serviceUnavailable(correlationId); }
    },
    async clone(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      const origin = requireOrigin(request, correlationId); if (origin) return origin;
      const body = await bodyFor(request, correlationId); if (body instanceof Response) return body;
      if (!validObject(body, ["operationId", "sourceWeekStart", "targetWeekStart", "expectedPlanHash"])
        || typeof body.operationId !== "string" || !uuidPattern.test(body.operationId)
        || typeof body.sourceWeekStart !== "string" || !weekDatePattern.test(body.sourceWeekStart)
        || typeof body.targetWeekStart !== "string" || !weekDatePattern.test(body.targetWeekStart)
        || typeof body.expectedPlanHash !== "string" || !hashPattern.test(body.expectedPlanHash)) {
        return error("invalid_input", "Check the operation ID, preview dates, and plan hash.", false, correlationId);
      }
      const requestBody: WeeklyCloneStartRequest = {
        operationId: body.operationId,
        sourceWeekStart: body.sourceWeekStart,
        targetWeekStart: body.targetWeekStart,
        expectedPlanHash: body.expectedPlanHash,
      };
      try { return serviceResponse(await createService().clone({ accessToken: token(request), request: requestBody }), correlationId); }
      catch { return serviceUnavailable(correlationId); }
    },
    async listOperations(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      try {
        const url = new URL(request.url);
        for (const key of url.searchParams.keys()) if (!["limit", "cursor"].includes(key) || url.searchParams.getAll(key).length !== 1) {
          return error("invalid_input", "Check the operation history page request.", false, correlationId);
        }
        const limitText = url.searchParams.get("limit") ?? "20";
        const cursor = url.searchParams.get("cursor");
        if (!/^(?:[1-9]\d?|50)$/.test(limitText) || (cursor !== null && cursor.length > 160)) return error("invalid_input", "Check the operation history page request.", false, correlationId);
        return serviceResponse(await createService().listOperations({ accessToken: token(request), cursor, limit: Number(limitText) }), correlationId);
      } catch { return serviceUnavailable(correlationId); }
    },
    async readOperation(request: Request, operationId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuidPattern.test(operationId)) return error("invalid_input", "Use a valid operation identifier.", false, correlationId);
      try { return serviceResponse(await createService().readOperation({ accessToken: token(request), operationId }), correlationId); }
      catch { return serviceUnavailable(correlationId); }
    },
    async reconcile(request: Request, operationId: string): Promise<Response> {
      const correlationId = randomUUID();
      const origin = requireOrigin(request, correlationId); if (origin) return origin;
      if (!uuidPattern.test(operationId)) return error("invalid_input", "Use a valid operation identifier.", false, correlationId);
      const body = await bodyFor(request, correlationId); if (body instanceof Response) return body;
      if (!validObject(body, [])) return error("invalid_input", "Reconciliation does not accept request fields.", false, correlationId);
      try { return serviceResponse(await createService().reconcile({ accessToken: token(request), operationId }), correlationId); }
      catch { return serviceUnavailable(correlationId); }
    },
    async undo(request: Request, operationId: string): Promise<Response> {
      const correlationId = randomUUID();
      const origin = requireOrigin(request, correlationId); if (origin) return origin;
      if (!uuidPattern.test(operationId)) return error("invalid_input", "Use a valid operation identifier.", false, correlationId);
      const body = await bodyFor(request, correlationId); if (body instanceof Response) return body;
      if (!validObject(body, ["undoOperationId", "expectedManifestRevision"])
        || typeof body.undoOperationId !== "string" || !uuidPattern.test(body.undoOperationId)
        || !Number.isSafeInteger(body.expectedManifestRevision) || Number(body.expectedManifestRevision) < 1) {
        return error("invalid_input", "Check the undo operation and manifest revision.", false, correlationId);
      }
      const requestBody: WeeklyCloneUndoRequest = { undoOperationId: body.undoOperationId, expectedManifestRevision: Number(body.expectedManifestRevision) };
      try { return serviceResponse(await createService().undo({ accessToken: token(request), operationId, request: requestBody }), correlationId); }
      catch { return serviceUnavailable(correlationId); }
    },
  });
}
