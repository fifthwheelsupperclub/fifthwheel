/** Same-origin cookie-authenticated HTTP boundaries for guest Tables and Seat requests. */

import { randomUUID } from "node:crypto";
import type { TableRequestErrorCode } from "../tables.contract.ts";
import type { TablesService, TableServiceResult } from "./tables.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const tableCursorPattern = /^\d{4}-\d{2}-\d{2}\|(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\|[0-9a-f-]{36}$/i;
const historyCursorPattern = /^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i;
const noStore = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" };
type Factory = () => TablesService;

function statusFor(code: TableRequestErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "profile_incomplete": return 409;
    case "not_found":
    case "not_future": return 404;
    case "invalid_input": return 400;
    case "invalid_transition":
    case "operation_conflict": return 409;
    case "temporarily_unavailable": return 503;
  }
}

function response(body: unknown, status: number): Response { return Response.json(body, { status, headers: noStore }); }
function error(code: TableRequestErrorCode, safeMessage: string, correlationId = randomUUID()): Response {
  return response({ ok: false, error: { code, safeMessage, retryable: code === "temporarily_unavailable", correlationId } }, statusFor(code));
}
function serviceResponse<T>(result: TableServiceResult<T>, correlationId: string): Response {
  if (!result.ok) return response({ ok: false, error: { code: result.error.code, safeMessage: result.error.safeMessage,
    retryable: result.error.code === "temporarily_unavailable", correlationId } }, statusFor(result.error.code));
  return response({ ok: true, data: result.value, correlationId }, 200);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function validCalendarDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year!, month! - 1, day!);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return null;
  const lengthText = request.headers.get("content-length") ?? "0";
  if (lengthText && !/^\d+$/.test(lengthText) || Number(lengthText) > 16_384) return null;
  if (!request.body) return null;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 16_384) { await reader.cancel(); return null; } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return isRecord(parsed) ? parsed : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

export function createTablesHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  function originFailure(request: Request): Response | null {
    const check = assertExactOrigin(request, expectedOrigin);
    return check.allowed ? null : error("forbidden", "This request origin is not allowed.");
  }
  function unavailable(): Response { return error("temporarily_unavailable", "Tables are temporarily unavailable. Try again shortly."); }
  return Object.freeze({
    async listTables(request: Request): Promise<Response> {
      const correlationId = randomUUID(); const url = new URL(request.url); const values = new Map<string, string>();
      for (const [key, value] of url.searchParams) {
        if (!["dateFrom", "dateTo", "neighborhood", "cursor", "limit"].includes(key) || values.has(key)) return error("invalid_input", "Check the Table filters.", correlationId);
        values.set(key, value);
      }
      const dateFrom = values.get("dateFrom"); const dateTo = values.get("dateTo"); const neighborhood = values.get("neighborhood"); const cursor = values.get("cursor");
      const limitText = values.get("limit") ?? "25";
      if (dateFrom && !validCalendarDate(dateFrom) || dateTo && !validCalendarDate(dateTo)
        || dateFrom && dateTo && dateFrom > dateTo
        || neighborhood && (neighborhood.trim().length === 0 || neighborhood.length > 120 || /[\u0000-\u001f\u007f]/.test(neighborhood))
        || cursor && (!tableCursorPattern.test(cursor) || cursor.length > 150)
        || !/^(?:[1-9]\d?|50)$/.test(limitText)) return error("invalid_input", "Check the Table filters.", correlationId);
      try { return serviceResponse(await createService().listTables({ accessToken: getAccessTokenForPrincipal(request),
        ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}), ...(neighborhood ? { neighborhood } : {}),
        ...(cursor ? { cursor } : {}), limit: Number(limitText) }), correlationId); }
      catch { return unavailable(); }
    },
    async readTable(request: Request, tableId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuidPattern.test(tableId)) return error("invalid_input", "Use a valid Table link.", correlationId);
      try { return serviceResponse(await createService().readTable({ accessToken: getAccessTokenForPrincipal(request), tableId }), correlationId); }
      catch { return unavailable(); }
    },
    async createRequest(request: Request, tableId: string): Promise<Response> {
      const correlationId = randomUUID(); const denied = originFailure(request); if (denied) return denied;
      if (!uuidPattern.test(tableId)) return error("invalid_input", "Use a valid Table link.", correlationId);
      const body = await jsonBody(request);
      if (!body || !exactKeys(body, ["operationId"]) || typeof body.operationId !== "string" || !uuidPattern.test(body.operationId)) {
        return error("invalid_input", "Refresh the Table and try again.", correlationId);
      }
      try { return serviceResponse(await createService().createRequest({ accessToken: getAccessTokenForPrincipal(request), tableId,
        request: { operationId: body.operationId } }), correlationId); }
      catch { return unavailable(); }
    },
    async listRequests(request: Request): Promise<Response> {
      const correlationId = randomUUID(); const url = new URL(request.url); const values = new Map<string, string>();
      for (const [key, value] of url.searchParams) {
        if (!["cursor", "limit"].includes(key) || values.has(key)) return error("invalid_input", "Something went wrong. Reload and try again.", correlationId);
        values.set(key, value);
      }
      const cursor = values.get("cursor"); const limitText = values.get("limit") ?? "25";
      if (cursor && (!historyCursorPattern.test(cursor) || cursor.length > 150) || !/^(?:[1-9]\d?|50)$/.test(limitText)) {
        return error("invalid_input", "Something went wrong. Reload and try again.", correlationId);
      }
      try { return serviceResponse(await createService().listRequests({ accessToken: getAccessTokenForPrincipal(request), ...(cursor ? { cursor } : {}), limit: Number(limitText) }), correlationId); }
      catch { return unavailable(); }
    },
    async withdrawRequest(request: Request, requestId: string): Promise<Response> {
      const correlationId = randomUUID(); const denied = originFailure(request); if (denied) return denied;
      if (!uuidPattern.test(requestId)) return error("invalid_input", "Use a valid request link.", correlationId);
      const body = await jsonBody(request);
      if (!body || !exactKeys(body, ["operationId"]) || typeof body.operationId !== "string" || !uuidPattern.test(body.operationId)) {
        return error("invalid_input", "Refresh this request and try again.", correlationId);
      }
      try { return serviceResponse(await createService().withdrawRequest({ accessToken: getAccessTokenForPrincipal(request), requestId,
        request: { operationId: body.operationId } }), correlationId); }
      catch { return unavailable(); }
    },
  });
}
