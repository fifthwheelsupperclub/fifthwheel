/** Cookie-authenticated HTTP boundary for the role-aware W05.2 supply routes. */

import { randomUUID } from "node:crypto";
import type {
  SupplyCreateDraftRequest, SupplyManagementErrorCode, SupplyRevisionActionRequest,
  SupplyUpdateDraftRequest,
} from "../supply.management.contract.ts";
import type { SupplyManagementResult, SupplyManagementService } from "./supply.management.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxBodyBytes = 64 * 1024;
const noStore = { "cache-control": "private, no-store", vary: "Cookie, Origin" };
type Factory = () => SupplyManagementService;

function statusFor(code: SupplyManagementErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "invalid_input": return 400;
    case "not_found": return 404;
    case "validation_failed": return 422;
    case "revision_conflict":
    case "operation_conflict":
    case "protected_change": return 409;
    case "provider_unavailable":
    case "temporarily_unavailable": return 503;
  }
}

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: noStore });
}

function error(code: SupplyManagementErrorCode, message: string, retryable = false, correlationId = randomUUID()): Response {
  return response({ ok: false, error: { code, message, retryable, correlationId } }, statusFor(code));
}

function serviceResponse<T>(result: SupplyManagementResult<T>, correlationId: string): Response {
  if (!result.ok) return response({ ok: false, error: { code: result.error.code, message: result.error.safeMessage, retryable: result.error.code === "temporarily_unavailable" || result.error.code === "provider_unavailable", correlationId, ...(result.error.fields ? { fields: result.error.fields } : {}) } }, statusFor(result.error.code));
  return response({ ok: true, data: result.value, correlationId }, 200);
}

async function parseBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 }> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return { ok: false, status: 415 };
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) return { ok: false, status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400 };
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBodyBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
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

function validObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

async function bodyFor(request: Request): Promise<unknown | Response> {
  const parsed = await parseBody(request);
  if (parsed.ok) return parsed.value;
  if (parsed.status === 415) return error("invalid_input", "Submit the change as JSON.");
  if (parsed.status === 413) return response({ ok: false, error: { code: "invalid_input", message: "The draft is too large.", retryable: false, correlationId: randomUUID() } }, 413);
  return error("invalid_input", "Submit a valid JSON request.");
}

export function createSupplyManagementHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  const getToken = (request: Request) => getAccessTokenForPrincipal(request);
  function requirePostOrigin(request: Request): Response | null {
    const decision = assertExactOrigin(request, expectedOrigin);
    return decision.allowed ? null : error("forbidden", "This request origin is not allowed.");
  }
  function serviceUnavailable(): Response { return error("temporarily_unavailable", "Supply management is temporarily unavailable.", true); }

  return Object.freeze({
    async listTables(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      try {
        const url = new URL(request.url);
        for (const key of url.searchParams.keys()) if (!["state", "cursor", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1) return error("invalid_input", "Check the supply list filters.", false, correlationId);
        const state = url.searchParams.get("state") ?? undefined;
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const limitText = url.searchParams.get("limit") ?? "25";
        if ((state && !["draft", "accepted", "published", "review_required", "upstream_missing"].includes(state))
          || (cursor && (cursor.length > 250 || !/^[0-9T:.+Z-]+\|[0-9a-f-]+$/i.test(cursor)))
          || !/^(?:[1-9]\d?|100)$/.test(limitText)) return error("invalid_input", "Check the supply list filters.", false, correlationId);
        return serviceResponse(await createService().listTables({ accessToken: getToken(request), state, cursor, limit: Number(limitText) }), correlationId);
      } catch { return serviceUnavailable(); }
    },
    async readTable(request: Request, tableId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuidPattern.test(tableId)) return error("invalid_input", "Use a valid Table identifier.", false, correlationId);
      try { return serviceResponse(await createService().readTable({ accessToken: getToken(request), tableId }), correlationId); }
      catch { return serviceUnavailable(); }
    },
    async listVenues(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      try {
        const url = new URL(request.url);
        if ([...url.searchParams.keys()].some((key) => key !== "query") || url.searchParams.getAll("query").length > 1) return error("invalid_input", "Check the venue search.", false, correlationId);
        const query = url.searchParams.get("query") ?? undefined;
        if (query && (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query))) return error("invalid_input", "Check the venue search.", false, correlationId);
        return serviceResponse(await createService().listVenues({ accessToken: getToken(request), query }), correlationId);
      } catch { return serviceUnavailable(); }
    },
    async createDraft(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      const originError = requirePostOrigin(request); if (originError) return originError;
      const body = await bodyFor(request); if (body instanceof Response) return body;
      if (!validObject(body, ["operationId", "source"]) || !uuidPattern.test(String(body.operationId)) || typeof body.source !== "object" || body.source === null || Array.isArray(body.source)) return error("invalid_input", "Check the draft request.", false, correlationId);
      const source = body.source as Record<string, unknown>;
      if (source.kind === "candidate") {
        if (!validObject(source, ["kind", "revisionId", "tableId"]) || !uuidPattern.test(String(source.revisionId)) || !uuidPattern.test(String(source.tableId))) return error("invalid_input", "Select a valid staged candidate.", false, correlationId);
      } else if (source.kind === "manual") {
        if (!validObject(source, ["kind", "content"])) return error("invalid_input", "Check the new draft fields.", false, correlationId);
      } else return error("invalid_input", "Select a valid draft source.", false, correlationId);
      try { return serviceResponse(await createService().createDraft({ accessToken: getToken(request), request: body as unknown as SupplyCreateDraftRequest }), correlationId); }
      catch { return serviceUnavailable(); }
    },
    async updateDraft(request: Request, draftId: string): Promise<Response> {
      const correlationId = randomUUID();
      const originError = requirePostOrigin(request); if (originError) return originError;
      if (!uuidPattern.test(draftId)) return error("invalid_input", "Use a valid draft identifier.", false, correlationId);
      const body = await bodyFor(request); if (body instanceof Response) return body;
      if (!validObject(body, ["operationId", "expectedDraftRevision", "content"]) || !uuidPattern.test(String(body.operationId)) || !Number.isInteger(body.expectedDraftRevision)) return error("invalid_input", "Check the draft request.", false, correlationId);
      try { return serviceResponse(await createService().updateDraft({ accessToken: getToken(request), draftId, request: body as unknown as SupplyUpdateDraftRequest }), correlationId); }
      catch { return serviceUnavailable(); }
    },
    async previewDraft(request: Request, draftId: string): Promise<Response> {
      const correlationId = randomUUID();
      const originError = requirePostOrigin(request); if (originError) return originError;
      if (!uuidPattern.test(draftId)) return error("invalid_input", "Use a valid draft identifier.", false, correlationId);
      const body = await bodyFor(request); if (body instanceof Response) return body;
      if (!validObject(body, ["expectedDraftRevision"]) || !Number.isInteger(body.expectedDraftRevision)) return error("invalid_input", "Check the draft revision.", false, correlationId);
      try { return serviceResponse(await createService().previewDraft({ accessToken: getToken(request), draftId, expectedDraftRevision: Number(body.expectedDraftRevision) }), correlationId); }
      catch { return serviceUnavailable(); }
    },
    async acceptDraft(request: Request, draftId: string): Promise<Response> {
      return this.revisionAction(request, draftId, "accept");
    },
    async publishDraft(request: Request, draftId: string): Promise<Response> {
      return this.revisionAction(request, draftId, "publish");
    },
    async revisionAction(request: Request, draftId: string, action: "accept" | "publish"): Promise<Response> {
      const correlationId = randomUUID();
      const originError = requirePostOrigin(request); if (originError) return originError;
      if (!uuidPattern.test(draftId)) return error("invalid_input", "Use a valid draft identifier.", false, correlationId);
      const body = await bodyFor(request); if (body instanceof Response) return body;
      if (!validObject(body, ["operationId", "expectedDraftRevision"]) || !uuidPattern.test(String(body.operationId)) || !Number.isInteger(body.expectedDraftRevision)) return error("invalid_input", "Check the revision request.", false, correlationId);
      const requestBody = body as unknown as SupplyRevisionActionRequest;
      try {
        const service = createService();
        if (action === "accept") {
          return serviceResponse(await service.acceptDraft({ accessToken: getToken(request), draftId, request: requestBody }), correlationId);
        }
        return serviceResponse(await service.publishDraft({ accessToken: getToken(request), draftId, request: requestBody }), correlationId);
      } catch { return serviceUnavailable(); }
    },
  });
}
