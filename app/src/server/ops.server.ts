/** W08 operations boundary: one table of role-gated RPC calls (decision queue, proceed, attendance, assignments, restaurant view, placement).
 *  The server only checks the staff role; the database re-checks assignment and is the authority. */

import { randomUUID } from "node:crypto";
import { env } from "node:process";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import { createSupabaseAuthLinkProvider, SupabaseAuthLinkError } from "./auth.link.supabase.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";
import { createSupabaseServerClient } from "./supabase.server.ts";
import { createSupplyTableAssignmentReader } from "./supply-table-assignment-reader.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && uuid.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length >= 1 && v.trim().length <= max;
type Body = Record<string, unknown>;
type Spec = Readonly<{
  method: "GET" | "POST"; roles: readonly ("admin" | "host" | "restaurant" | "member")[]; rpc: string;
  /** Returns the RPC arguments (without p_actor) or null when the input is invalid. */
  args: (params: Readonly<Record<string, string>>, body: Body, url: URL) => Record<string, unknown> | null;
  /** Placement only: create (or find) the guest's Auth user after the role check, before the RPC. */
  ensureGuestAuthUser?: true;
}>;

export const opsSpecs = {
  decisionQueue: { method: "GET", roles: ["admin"], rpc: "read_table_decision_queue", args: () => ({}) },
  proceed: { method: "POST", roles: ["admin"], rpc: "record_table_proceed",
    args: (p, b) => isUuid(p.tableId) && isUuid(b.operationId) && Object.keys(b).length === 1 ? { p_table_id: p.tableId, p_operation_id: b.operationId } : null },
  hostTables: { method: "GET", roles: ["admin", "host"], rpc: "list_host_tables", args: () => ({}) },
  attendance: { method: "GET", roles: ["admin", "host"], rpc: "read_table_attendance", args: (p) => isUuid(p.tableId) ? { p_table_id: p.tableId } : null },
  checkIn: { method: "POST", roles: ["admin", "host"], rpc: "check_in_guest",
    args: (p, b) => isUuid(p.tableId) && isUuid(b.seatId) && Object.keys(b).length === 1 ? { p_table_id: p.tableId, p_seat_id: b.seatId } : null },
  flagCancellation: { method: "POST", roles: ["admin", "host"], rpc: "flag_cancellation_request",
    args: (p, b) => isUuid(p.requestId) && Object.keys(b).length === 0 ? { p_request_id: p.requestId } : null },
  replacementSuggestion: { method: "GET", roles: ["admin"], rpc: "suggest_replacement", args: (p) => isUuid(p.invitationId) ? { p_invitation_id: p.invitationId } : null },
  removeAndReplace: { method: "POST", roles: ["admin"], rpc: "remove_and_replace",
    args: (p, b) => isUuid(p.invitationId) && isUuid(b.operationId) && Number.isSafeInteger(b.expectedRevision) && Number.isSafeInteger(b.refundCents) && Object.keys(b).length === 3
      ? { p_invitation_id: p.invitationId, p_operation_id: b.operationId, p_expected_revision: b.expectedRevision, p_refund_cents: b.refundCents, p_replace_request_id: null } : null },
  placementQueue: { method: "GET", roles: ["admin"], rpc: "list_placement_queue", args: () => ({}) },
  place: { method: "POST", roles: ["admin"], rpc: "place_guest_at_table", ensureGuestAuthUser: true,
    args: (_p, b) => isUuid(b.signupId) && isUuid(b.tableId) && isUuid(b.operationId) && typeof b.acknowledgeWarnings === "boolean" && Object.keys(b).length === 4
      ? { p_signup_id: b.signupId, p_table_id: b.tableId, p_operation_id: b.operationId, p_acknowledge_warnings: b.acknowledgeWarnings } : null },
  tonight: { method: "GET", roles: ["member"], rpc: "read_tonight", args: (p) => isUuid(p.tableId) ? { p_table_id: p.tableId } : null },
  ballot: { method: "POST", roles: ["member"], rpc: "submit_ballot",
    args: (p, b) => isUuid(p.tableId) && Object.keys(b).length === 1 && (b.choiceGuestId === null || isUuid(b.choiceGuestId)) ? { p_table_id: p.tableId, p_choice_guest_id: b.choiceGuestId } : null },
  reveal: { method: "GET", roles: ["member"], rpc: "read_my_reveal", args: (p) => isUuid(p.tableId) ? { p_table_id: p.tableId } : null },
  recap: { method: "GET", roles: ["member"], rpc: "read_my_recap", args: (p) => isUuid(p.tableId) ? { p_table_id: p.tableId } : null },
  rating: { method: "POST", roles: ["member"], rpc: "save_rating",
    args: (p, b) => isUuid(p.tableId) && Object.keys(b).length === 3 && Number.isSafeInteger(b.overall) && typeof b.venueScores === "object" && b.venueScores !== null && !Array.isArray(b.venueScores)
      && (b.note === null || (typeof b.note === "string" && b.note.length <= 2000))
      ? { p_table_id: p.tableId, p_overall: b.overall, p_venue_scores: b.venueScores, p_note: b.note } : null },
  conductReport: { method: "POST", roles: ["member"], rpc: "submit_conduct_report",
    args: (p, b) => isUuid(p.tableId) && Object.keys(b).length === 3 && isUuid(b.operationId) && (b.subjectGuestId === null || isUuid(b.subjectGuestId)) && text(b.body, 4000)
      ? { p_table_id: p.tableId, p_subject_guest_id: b.subjectGuestId, p_body: b.body.trim(), p_operation_id: b.operationId } : null },
  conductReports: { method: "GET", roles: ["admin"], rpc: "list_conduct_reports",
    args: (_p, _b, url) => { const v = url.searchParams.get("status"); return v === null ? { p_status: null } : ["new", "reviewing", "resolved"].includes(v) ? { p_status: v } : null; } },
  conductReportUpdate: { method: "POST", roles: ["admin"], rpc: "update_conduct_report",
    args: (p, b) => isUuid(p.reportId) && Object.keys(b).length === 2 && typeof b.status === "string" && ["new", "reviewing", "resolved"].includes(b.status) && typeof b.held === "boolean"
      ? { p_report_id: p.reportId, p_status: b.status, p_held: b.held } : null },
  ratingAggregates: { method: "GET", roles: ["admin"], rpc: "read_rating_aggregates", args: () => ({}) },
  adminOverview: { method: "GET", roles: ["admin"], rpc: "read_admin_overview", args: () => ({}) },
  deleteConductReport: { method: "POST", roles: ["admin"], rpc: "delete_conduct_report", args: (p, b) => isUuid(p.reportId) && Object.keys(b).length === 0 ? { p_report_id: p.reportId } : null },
  deleteMemberAccount: { method: "POST", roles: ["admin"], rpc: "delete_member_account",
    args: (_p, b) => isUuid(b.guestId) && b.confirm === "delete" && Object.keys(b).length === 2 ? { p_guest_id: b.guestId } : null },
  noticeProblems: { method: "GET", roles: ["admin"], rpc: "list_notice_problems", args: () => ({}) },
  resolveNotice: { method: "POST", roles: ["admin"], rpc: "resolve_notice",
    args: (p, b) => isUuid(p.noticeId) && Object.keys(b).length === 1 && (b.action === "retry" || b.action === "dismiss") ? { p_notice_id: p.noticeId, p_action: b.action } : null },
  staffAssignments: { method: "GET", roles: ["admin"], rpc: "read_staff_assignments", args: () => ({}) },
  hostAssignment: { method: "POST", roles: ["admin"], rpc: "set_host_assignment",
    args: (_p, b) => isUuid(b.tableId) && isUuid(b.userId) && typeof b.assigned === "boolean" && Object.keys(b).length === 3 ? { p_table_id: b.tableId, p_user_id: b.userId, p_assigned: b.assigned } : null },
  venueMembership: { method: "POST", roles: ["admin"], rpc: "set_venue_membership",
    args: (_p, b) => isUuid(b.venueId) && isUuid(b.userId) && typeof b.assigned === "boolean" && Object.keys(b).length === 3 ? { p_venue_id: b.venueId, p_user_id: b.userId, p_assigned: b.assigned } : null },
  staffContact: { method: "POST", roles: ["admin"], rpc: "set_staff_contact",
    args: (_p, b) => isUuid(b.userId) && text(b.displayName, 120) && text(b.businessContact, 200) && Object.keys(b).length === 3
      ? { p_user_id: b.userId, p_display_name: b.displayName.trim(), p_business_contact: b.businessContact.trim() } : null },
  restaurantWorkspace: { method: "GET", roles: ["restaurant"], rpc: "read_restaurant_workspace",
    args: (_p, _b, url) => { const v = url.searchParams.get("venueId"); return v === null ? { p_venue_id: null } : isUuid(v) ? { p_venue_id: v } : null; } },
} as const satisfies Record<string, Spec>;
export type OpsName = keyof typeof opsSpecs;

export type OpsDeps = Readonly<{
  resolvePrincipal: (token: string) => Promise<ServerVerifiedPrincipal | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Returns the Auth user id for a waitlist signup's email, creating an unconfirmed user when there is none. */
  ensureGuestAuthUser?: (signupId: string) => Promise<string>;
}>;
export class OpsRpcError extends Error {
  readonly details: string;
  constructor(message: string, details = "") { super(message); this.details = details; }
}

const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", vary: "Cookie, Origin" };
const conflicts = new Set(["table_not_proceeding", "table_not_proceedable", "decision_not_open", "group_invalid", "seat_not_checkin_eligible",
  "decision_finalized", "not_a_host", "not_a_restaurant_user", "operation_conflict", "revision_conflict", "invitation_not_removable", "table_not_active",
  "refund_amount_exceeds_balance", "voting_not_open", "voting_closed", "voting_unavailable", "ballot_conflict", "feedback_not_open", "profile_incomplete", "case_held", "review_not_due", "active_seat_exists", "staff_account", "notice_not_actionable",
  "already_invited", "age_under_21", "table_full", "auth_user_mismatch", "stale_table", "table_not_future", "placement_warnings"]);
const codes = { unauthenticated: 401, forbidden: 403, not_found: 404, invalid_input: 400, conflict: 409, temporarily_unavailable: 503 } as const;
const messages: Record<keyof typeof codes, string> = { unauthenticated: "Sign in to continue.", forbidden: "You do not have access to this.",
  not_found: "That could not be found.", invalid_input: "Check the details and try again.", conflict: "That action is not available right now.",
  temporarily_unavailable: "This is temporarily unavailable. Try again shortly." };
const fail = (code: keyof typeof codes, reason?: string, issues?: readonly string[]) => Response.json({ ok: false, error: { code, reason: reason ?? null, ...(issues ? { issues } : {}),
  safeMessage: messages[code], retryable: code === "temporarily_unavailable" } }, { status: codes[code], headers });
const warningIssues = (details: string): string[] => {
  try { const v = JSON.parse(details) as { issues?: unknown }; return Array.isArray(v.issues) ? v.issues.filter((x): x is string => typeof x === "string" && /^[a-z_]{1,60}$/.test(x)) : []; }
  catch { return []; }
};

export function createOpsHandler(deps: OpsDeps, expectedOrigin: string | undefined) {
  return async function handle(name: OpsName, request: Request, params: Readonly<Record<string, string>> = {}): Promise<Response> {
    const spec: Spec = opsSpecs[name];
    if (request.method !== spec.method) return fail("invalid_input");
    if (spec.method === "POST" && !assertExactOrigin(request, expectedOrigin).allowed) return fail("forbidden");
    let body: Body = {};
    if (spec.method === "POST") {
      const raw = await request.text();
      if (raw.length > 4_096) return fail("invalid_input");
      if (raw.length > 0) {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) return fail("invalid_input");
        try { const parsed: unknown = JSON.parse(raw); if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fail("invalid_input"); body = parsed as Body; }
        catch { return fail("invalid_input"); }
      }
    }
    const args = spec.args(params, body, new URL(request.url));
    if (!args) return fail("invalid_input");
    const token = getAccessTokenForPrincipal(request);
    if (!token) return fail("unauthenticated");
    try {
      const principal = await deps.resolvePrincipal(token);
      if (!principal) return fail("unauthenticated");
      if (!spec.roles.some((role) => role === "member" ? principal.admission.state === "activated" : principal.staffRoles.has(role))) return fail("forbidden");
      if (spec.ensureGuestAuthUser) {
        if (!deps.ensureGuestAuthUser) return fail("temporarily_unavailable");
        args.p_auth_user_id = await deps.ensureGuestAuthUser(String(args.p_signup_id));
      }
      const data = await deps.rpc(spec.rpc, { p_actor: principal.userId, ...args });
      return Response.json({ ok: true, data, correlationId: randomUUID() }, { headers });
    } catch (error) {
      const reason = error instanceof OpsRpcError ? error.message : "";
      if (reason === "forbidden" || reason === "member_not_admitted" || reason === "not_eligible" || reason.endsWith("_required")) return fail("forbidden");
      if (reason === "not_found") return fail("not_found");
      if (reason === "invalid_input" || reason === "invalid_choice") return fail("invalid_input");
      if (reason === "placement_warnings" && error instanceof OpsRpcError) return fail("conflict", reason, warningIssues(error.details));
      if (conflicts.has(reason)) return fail("conflict", reason);
      return fail("temporarily_unavailable");
    }
  };
}

type Environment = Readonly<Record<string, string | undefined>>;
function required(name: string, value: string | undefined): string { const v = value?.trim(); if (!v) throw new Error(`${name}_unavailable`); return v; }

export function createOpsHttpRuntime(environment: Environment = env) {
  const config = { url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY) };
  const resolvePrincipal = createVerifiedPrincipalResolver(createSupabaseServerClient(config), createSupplyTableAssignmentReader(config));
  const rpc: OpsDeps["rpc"] = async (name, args) => {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, config.url), { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(args) });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return body;
    const message = typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : "";
    const details = typeof body === "object" && body !== null && typeof (body as { details?: unknown }).details === "string" ? (body as { details: string }).details : "";
    throw new OpsRpcError(message, details);
  };
  const appOrigin = required("APP_ORIGIN", environment.APP_ORIGIN);
  const callback = new URL("/auth/callback", appOrigin).href;
  const authLinks = createSupabaseAuthLinkProvider({ ...config, siteUrl: appOrigin, allowedCallbackUrls: [callback] });
  const ensureGuestAuthUser = async (signupId: string): Promise<string> => {
    const url = new URL("/rest/v1/waitlist_signups", config.url);
    url.searchParams.set("select", "email_normalized"); url.searchParams.set("id", `eq.${signupId}`); url.searchParams.set("is_test", "eq.false");
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json" } });
    const rows: unknown = await response.json().catch(() => null);
    const email = Array.isArray(rows) && rows.length === 1 ? (rows[0] as { email_normalized?: unknown }).email_normalized : null;
    if (!response.ok || typeof email !== "string") throw new OpsRpcError("not_found");
    // Generating a link creates the Auth user without sending anything; the link itself is discarded. A confirmed user cannot take
    // an invite link, so a definitive rejection falls back to a magic link for the existing user.
    try { return (await authLinks.createMagicLink({ emailNormalized: email, redirectTo: callback, kind: "invite" })).authUserId; }
    catch (error) {
      if (!(error instanceof SupabaseAuthLinkError) || error.code !== "provider_rejected") throw error;
      return (await authLinks.createMagicLink({ emailNormalized: email, redirectTo: callback, kind: "magiclink" })).authUserId;
    }
  };
  return createOpsHandler({ resolvePrincipal, rpc, ensureGuestAuthUser }, appOrigin);
}

/** Shared by every ops route file: any setup failure is a safe 503. */
export async function runOps(name: OpsName, request: Request, params: Readonly<Record<string, string>> = {}): Promise<Response> {
  try { return await createOpsHttpRuntime()(name, request, params); }
  catch { return Response.json({ ok: false, error: { code: "temporarily_unavailable", safeMessage: messages.temporarily_unavailable, retryable: true } }, { status: 503, headers }); }
}
