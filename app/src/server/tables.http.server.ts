/** Cookie-authenticated read of a member's own Table placements and invitations. */

import { randomUUID } from "node:crypto";
import type { TableRequestErrorCode } from "../tables.contract.ts";
import type { TablesService, TableServiceResult } from "./tables.contract.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const historyCursorPattern = /^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i;
const noStore = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" };
type Factory = () => TablesService;

function statusFor(code: TableRequestErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "not_found": return 404;
    case "invalid_input": return 400;
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
export function createTablesHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  function unavailable(): Response { return error("temporarily_unavailable", "Tables are temporarily unavailable. Try again shortly."); }
  return Object.freeze({
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
  });
}
