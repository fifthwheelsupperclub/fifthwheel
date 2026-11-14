/** Same-origin HTTP boundary for W06.3-W06.4 curation APIs. */

import { randomUUID } from "node:crypto";
import type {
  RosterErrorCode, RosterResponse, RosterProposalMutationRequest, SaveRosterProposalRequest,
} from "../roster.contract.ts";
import type { RosterService, RosterServiceResult } from "./roster.contract.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxBodyBytes = 16 * 1024;
const noStore = { "cache-control": "private, no-store", vary: "Cookie, Origin" };
type Factory = () => RosterService;

function statusFor(code: RosterErrorCode): number {
  switch (code) {
    case "unauthenticated": return 401;
    case "forbidden": return 403;
    case "invalid_input": return 400;
    case "not_found":
    case "request_not_found": return 404;
    case "validation_failed": return 422;
    case "revision_conflict":
    case "stale_table":
    case "stale_profile":
    case "request_not_pending":
    case "proposal_not_submitted":
    case "proposal_not_editable":
    case "profile_not_approved":
    case "member_not_admitted":
    case "roster_already_active":
    case "capacity_conflict":
    case "operation_conflict": return 409;
    case "temporarily_unavailable": return 503;
  }
}

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: noStore });
}

function error(code: RosterErrorCode, message: string, retryable = false, correlationId = randomUUID()): Response {
  return response({ ok: false, error: { code, message, retryable, correlationId } }, statusFor(code));
}

function serviceResponse<T>(result: RosterServiceResult<T>, correlationId: string): Response {
  if (!result.ok) {
    const body: RosterResponse<T> = { ok: false, error: { code: result.error.code, message: result.error.safeMessage,
      retryable: result.error.code === "temporarily_unavailable", correlationId,
      ...(result.error.issues ? { details: { issues: result.error.issues } } : {}) } };
    return response(body, statusFor(result.error.code));
  }
  const body: RosterResponse<T> = { ok: true, data: result.value, correlationId };
  return response(body, 200);
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

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

function parseLimit(url: URL): number | null {
  for (const key of url.searchParams.keys()) if (!["cursor", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1) return null;
  const text = url.searchParams.get("limit") ?? "25";
  return /^(?:[1-9]\d?|50)$/.test(text) ? Number(text) : null;
}

function parseSelectedRequest(body: unknown): SaveRosterProposalRequest | null {
  if (!exactObject(body, ["operationId", "expectedProposalRevision", "supplyRevisionId", "selectedRequestIds"])
    || typeof body.operationId !== "string" || !uuidPattern.test(body.operationId)
    || !(body.expectedProposalRevision === null || Number.isSafeInteger(body.expectedProposalRevision) && Number(body.expectedProposalRevision) > 0)
    || typeof body.supplyRevisionId !== "string" || !uuidPattern.test(body.supplyRevisionId)
    || !Array.isArray(body.selectedRequestIds) || body.selectedRequestIds.length > 6
    || body.selectedRequestIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))) return null;
  return body as unknown as SaveRosterProposalRequest;
}

function parseProposalMutation(body: unknown): RosterProposalMutationRequest | null {
  if (!exactObject(body, ["operationId", "expectedProposalRevision"]) || typeof body.operationId !== "string"
    || !uuidPattern.test(body.operationId) || !Number.isSafeInteger(body.expectedProposalRevision)
    || Number(body.expectedProposalRevision) < 1) return null;
  return body as unknown as RosterProposalMutationRequest;
}

export function createRosterHttpHandlers(createService: Factory, expectedOrigin: string | undefined) {
  const getToken = (request: Request) => getAccessTokenForPrincipal(request);
  function requirePostOrigin(request: Request): Response | null {
    const decision = assertExactOrigin(request, expectedOrigin);
    return decision.allowed ? null : error("forbidden", "This request origin is not allowed.");
  }
  function unavailable(): Response { return error("temporarily_unavailable", "Roster curation is temporarily unavailable.", true); }
  async function body(request: Request): Promise<unknown | Response> {
    const parsed = await parseBody(request);
    if (parsed.ok) return parsed.value;
    if (parsed.status === 415) return error("invalid_input", "Submit the roster change as JSON.");
    if (parsed.status === 413) return response({ ok: false, error: { code: "invalid_input", message: "The roster request is too large.", retryable: false, correlationId: randomUUID() } }, 413);
    return error("invalid_input", "Submit a valid JSON roster change.");
  }
  return Object.freeze({
    async listAdminSeatRequests(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      try {
        const url = new URL(request.url); const limit = parseLimit(url); const cursor = url.searchParams.get("cursor") ?? undefined;
        if (limit === null || cursor && (cursor.length > 160 || !/^\d{4}-\d{2}-\d{2}\|(?:[01]\d|2[0-3]):[0-5]\d\|[0-9a-f-]{36}$/i.test(cursor))) return error("invalid_input", "Check the Table request queue page.", false, correlationId);
        return serviceResponse(await createService().listAdminSeatRequests({ accessToken: getToken(request), cursor, limit }), correlationId);
      } catch { return unavailable(); }
    },
    async listAssignedCurationTables(request: Request): Promise<Response> {
      const correlationId = randomUUID();
      try {
        const url = new URL(request.url); const limit = parseLimit(url); const cursor = url.searchParams.get("cursor") ?? undefined;
        if (limit === null || cursor && (cursor.length > 160 || !/^\d{4}-\d{2}-\d{2}\|(?:[01]\d|2[0-3]):[0-5]\d\|[0-9a-f-]{36}$/i.test(cursor))) return error("invalid_input", "Check the assigned Tables page.", false, correlationId);
        return serviceResponse(await createService().listAssignedCurationTables({ accessToken: getToken(request), cursor, limit }), correlationId);
      } catch { return unavailable(); }
    },
    async readTableRoster(request: Request, tableId: string): Promise<Response> {
      const correlationId = randomUUID();
      if (!uuidPattern.test(tableId)) return error("invalid_input", "Use a valid Table identifier.", false, correlationId);
      try {
        const url = new URL(request.url); const limit = parseLimit(url); const cursor = url.searchParams.get("cursor") ?? undefined;
        if (limit === null || cursor && (cursor.length > 180 || !/^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-f-]{36}$/i.test(cursor))) return error("invalid_input", "Check the roster candidate page.", false, correlationId);
        return serviceResponse(await createService().readTableRoster({ accessToken: getToken(request), tableId, cursor, limit }), correlationId);
      } catch { return unavailable(); }
    },
    async saveRosterProposal(request: Request, tableId: string): Promise<Response> {
      const correlationId = randomUUID(); const originError = requirePostOrigin(request); if (originError) return originError;
      if (!uuidPattern.test(tableId)) return error("invalid_input", "Use a valid Table identifier.", false, correlationId);
      const parsed = await body(request); if (parsed instanceof Response) return parsed;
      const proposal = parseSelectedRequest(parsed);
      if (!proposal || new Set(proposal.selectedRequestIds).size !== proposal.selectedRequestIds.length) return error("invalid_input", "Check the selected Seat requests and roster revision.", false, correlationId);
      try { return serviceResponse(await createService().saveRosterProposal({ accessToken: getToken(request), tableId, request: proposal }), correlationId); }
      catch { return unavailable(); }
    },
    async submitRosterProposal(request: Request, tableId: string): Promise<Response> {
      return this.proposalAction(request, tableId, "submit");
    },
    async approveRoster(request: Request, tableId: string): Promise<Response> {
      return this.proposalAction(request, tableId, "approve");
    },
    async proposalAction(request: Request, tableId: string, action: "submit" | "approve"): Promise<Response> {
      const correlationId = randomUUID(); const originError = requirePostOrigin(request); if (originError) return originError;
      if (!uuidPattern.test(tableId)) return error("invalid_input", "Use a valid Table identifier.", false, correlationId);
      const parsed = await body(request); if (parsed instanceof Response) return parsed;
      const mutation = parseProposalMutation(parsed);
      if (!mutation) return error("invalid_input", "Check the proposal revision and operation identifier.", false, correlationId);
      try {
        const service = createService();
        return action === "submit"
          ? serviceResponse(await service.submitRosterProposal({ accessToken: getToken(request), tableId, request: mutation }), correlationId)
          : serviceResponse(await service.approveRoster({ accessToken: getToken(request), tableId, request: mutation }), correlationId);
      } catch { return unavailable(); }
    },
  });
}
