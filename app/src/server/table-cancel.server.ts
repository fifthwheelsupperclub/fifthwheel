/** W07.6: admin-only full Table cancellation. One RPC does all state changes and refund bookkeeping under lock. */

import { randomUUID } from "node:crypto";
import { env } from "node:process";
import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";
import { createSupabaseServerClient } from "./supabase.server.ts";
import { createSupplyTableAssignmentReader } from "./supply-table-assignment-reader.server.ts";

export type TableCancelResult = Readonly<{
  tableId: string; state: "cancelled"; closedRequests: number; closedInvitations: number; releasedHolds: number;
  cancelledSeats: number; resolvedCancellationRequests: number; refundObligations: number; refundTotalCents: number;
}>;
export type TableCancelErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "table_not_cancellable" | "operation_conflict" | "temporarily_unavailable";
export type TableCancelDeps = Readonly<{
  resolvePrincipal: (token: string) => Promise<ServerVerifiedPrincipal | null>;
  cancel: (actor: string, input: Readonly<{ tableId: string; operationId: string; reason: string }>) => Promise<unknown>;
}>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" };
const statuses: Record<TableCancelErrorCode, number> = { unauthenticated: 401, forbidden: 403, not_found: 404, invalid_input: 400,
  table_not_cancellable: 409, operation_conflict: 409, temporarily_unavailable: 503 };
const messages: Record<TableCancelErrorCode, string> = { unauthenticated: "Sign in to continue.", forbidden: "Admin access is required.",
  not_found: "This Table could not be found.", invalid_input: "Add a reason of 1–500 characters and try again.",
  table_not_cancellable: "This Table is already cancelled or completed.", operation_conflict: "This operation ID was already used for different details.",
  temporarily_unavailable: "Table cancellation is temporarily unavailable. Try again shortly." };
const fail = (code: TableCancelErrorCode) => Response.json({ ok: false, error: { code, safeMessage: messages[code], retryable: code === "temporarily_unavailable" } }, { status: statuses[code], headers });

function parseResult(x: unknown): TableCancelResult {
  const r = x as Record<string, unknown>;
  const ints = ["closedRequests", "closedInvitations", "releasedHolds", "cancelledSeats", "resolvedCancellationRequests", "refundObligations", "refundTotalCents"] as const;
  if (typeof r !== "object" || r === null || r.state !== "cancelled" || typeof r.tableId !== "string" || !uuid.test(r.tableId)
    || ints.some((k) => !Number.isSafeInteger(r[k]) || Number(r[k]) < 0)) throw new Error("response_invalid");
  return Object.freeze(r as unknown as TableCancelResult);
}

export function createTableCancelHandler(deps: TableCancelDeps, expectedOrigin: string | undefined) {
  return async function cancelTable(request: Request, tableId: string): Promise<Response> {
    if (!assertExactOrigin(request, expectedOrigin).allowed) return fail("forbidden");
    if (!uuid.test(tableId)) return fail("invalid_input");
    let body: Record<string, unknown>;
    try {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return fail("invalid_input");
      const raw = await request.text();
      if (raw.length > 4_096) return fail("invalid_input");
      body = JSON.parse(raw);
    } catch { return fail("invalid_input"); }
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).some((k) => !["operationId", "reason"].includes(k))
      || typeof body.operationId !== "string" || !uuid.test(body.operationId) || typeof body.reason !== "string"
      || body.reason.trim().length < 1 || body.reason.trim().length > 500) return fail("invalid_input");
    const token = getAccessTokenForPrincipal(request);
    if (!token) return fail("unauthenticated");
    try {
      const principal = await deps.resolvePrincipal(token);
      if (!principal) return fail("unauthenticated");
      if (!authorize(principal, { workspace: "admin", action: "roster:approve" }).allowed) return fail("forbidden");
      const value = parseResult(await deps.cancel(principal.userId, { tableId, operationId: body.operationId, reason: body.reason.trim() }));
      return Response.json({ ok: true, data: value, correlationId: randomUUID() }, { headers });
    } catch (error) {
      const code = error instanceof Error && error.message in statuses ? error.message as TableCancelErrorCode : "temporarily_unavailable";
      return fail(code);
    }
  };
}

type Environment = Readonly<Record<string, string | undefined>>;
function required(name: string, value: string | undefined): string {
  const normalized = value?.trim(); if (!normalized) throw new Error(`${name}_unavailable`); return normalized;
}

/** Production composition: service-role RPC after the principal is verified server-side. */
export function createTableCancelHttpRuntime(environment: Environment = env) {
  const config = {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
  const resolvePrincipal = createVerifiedPrincipalResolver(createSupabaseServerClient(config), createSupplyTableAssignmentReader(config));
  const cancel: TableCancelDeps["cancel"] = async (actor, input) => {
    const response = await fetch(new URL("/rest/v1/rpc/cancel_table", config.url), { method: "POST", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15_000), headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ p_actor: actor, p_table_id: input.tableId, p_operation_id: input.operationId, p_reason: input.reason }) });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return body;
    const message = typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : "";
    const map: Record<string, TableCancelErrorCode> = { admin_required: "forbidden", not_found: "not_found", invalid_input: "invalid_input",
      table_not_cancellable: "table_not_cancellable", operation_conflict: "operation_conflict" };
    throw new Error(map[message] ?? "temporarily_unavailable");
  };
  return createTableCancelHandler({ resolvePrincipal, cancel }, required("APP_ORIGIN", environment.APP_ORIGIN));
}
