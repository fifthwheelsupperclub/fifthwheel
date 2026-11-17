import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import { createOpsHandler, OpsRpcError } from "./ops.server.ts";

const origin = "https://app.example.test";
const id = (n: number) => `e0800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlc2lnbmF0dXJl";
const who = (...roles: ("admin" | "host" | "restaurant")[]): ServerVerifiedPrincipal => ({ userId: id(1), emailNormalized: "s@x.test", emailVerified: true,
  staffRoles: new Set(roles), admission: { state: "none", authUserId: null, emailNormalized: null }, assignedTableIds: new Set(), assignedVenueIds: new Set() });
function setup(principal: ServerVerifiedPrincipal | null, rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> = async () => ({ ok: 1 })) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const handle = createOpsHandler({ resolvePrincipal: async () => principal, rpc: async (n, a) => { calls.push([n, a]); return rpc(n, a); } }, origin);
  return { calls, handle };
}
const get = (path: string, cookie = `fw_access_token=${jwt}`) => new Request(`${origin}${path}`, { headers: { cookie } });
const post = (body: unknown, o = origin) => new Request(`${origin}/x`, { method: "POST", headers: { origin: o, "content-type": "application/json", cookie: `fw_access_token=${jwt}` }, body: JSON.stringify(body) });

test("role gate runs before the RPC: wrong role, no cookie and bad input never call the database", async () => {
  const s = setup(who("host"));
  assert.equal((await s.handle("decisionQueue", get("/q"))).status, 403);
  assert.equal((await s.handle("restaurantWorkspace", get("/r"))).status, 403);
  assert.equal((await s.handle("attendance", get("/a", ""), { tableId: id(2) })).status, 401);
  assert.equal((await s.handle("attendance", get("/a"), { tableId: "nope" })).status, 400);
  assert.equal((await s.handle("proceed", post({ operationId: id(3) }, "https://evil.test"), { tableId: id(2) })).status, 403);
  assert.equal((await s.handle("proceed", post({ operationId: id(3), extra: 1 }), { tableId: id(2) })).status, 400);
  assert.equal(s.calls.length, 0);
});

test("host and admin can check in; the actor and ids reach the RPC", async () => {
  for (const role of ["host", "admin"] as const) {
    const s = setup(who(role));
    const res = await s.handle("checkIn", post({ seatId: id(4) }), { tableId: id(2) });
    assert.equal(res.status, 200);
    assert.deepEqual(s.calls[0], ["check_in_guest", { p_actor: id(1), p_table_id: id(2), p_seat_id: id(4) }]);
  }
  const hostOnly = setup(who("host"));
  assert.equal((await hostOnly.handle("proceed", post({ operationId: id(3) }), { tableId: id(2) })).status, 403);
  assert.equal((await hostOnly.handle("hostAssignment", post({ tableId: id(2), userId: id(1), assigned: true }))).status, 403);
});

test("database refusals map to safe statuses", async () => {
  const run = async (message: string) => (await setup(who("admin"), async () => { throw new OpsRpcError(message); }).handle("proceed", post({ operationId: id(3) }), { tableId: id(2) }));
  assert.equal((await run("forbidden")).status, 403);
  assert.equal((await run("admin_required")).status, 403);
  assert.equal((await run("not_found")).status, 404);
  const group = await run("group_invalid");
  assert.equal(group.status, 409);
  assert.equal((await group.json()).error.reason, "group_invalid");
  assert.equal((await run("something_else")).status, 503);
});

test("restaurant workspace takes an optional venue id and rejects junk", async () => {
  const s = setup(who("restaurant"));
  assert.equal((await s.handle("restaurantWorkspace", get("/r"))).status, 200);
  assert.deepEqual(s.calls[0][1], { p_actor: id(1), p_venue_id: null });
  assert.equal((await s.handle("restaurantWorkspace", get(`/r?venueId=${id(9)}`))).status, 200);
  assert.equal((await s.handle("restaurantWorkspace", get("/r?venueId=junk"))).status, 400);
});

test("removal: admin only, exact body, never a replacement, conflicts surfaced", async () => {
  const body = { operationId: id(3), expectedRevision: 2, refundCents: 1500 };
  const admin = setup(who("admin"));
  assert.equal((await admin.handle("removeAndReplace", post(body), { invitationId: id(7) })).status, 200);
  assert.deepEqual(admin.calls[0], ["remove_and_replace", { p_actor: id(1), p_invitation_id: id(7), p_operation_id: id(3), p_expected_revision: 2, p_refund_cents: 1500, p_replace_request_id: null }]);
  assert.equal((await admin.handle("removeAndReplace", post({ ...body, replaceRequestId: id(5) }), { invitationId: id(7) })).status, 400);
  assert.equal((await admin.handle("removeAndReplace", post({ ...body, refundCents: "5" }), { invitationId: id(7) })).status, 400);
  assert.equal((await admin.handle("replacementSuggestion", get("/s"), { invitationId: id(7) })).status, 200);
  const host = setup(who("host"));
  assert.equal((await host.handle("removeAndReplace", post(body), { invitationId: id(7) })).status, 403);
  assert.equal((await host.handle("replacementSuggestion", get("/s"), { invitationId: id(7) })).status, 403);
  assert.equal(host.calls.length, 0);
  const conflict = await setup(who("admin"), async () => { throw new OpsRpcError("revision_conflict"); }).handle("removeAndReplace", post(body), { invitationId: id(7) });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.reason, "revision_conflict");
});

test("placement: admin only, the Auth user is created only after the role check, warnings come back as issues", async () => {
  const body = { signupId: id(4), tableId: id(5), operationId: id(6), acknowledgeWarnings: false };
  const created: string[] = [];
  const make = (principal: ServerVerifiedPrincipal, rpc?: (n: string, a: Record<string, unknown>) => Promise<unknown>) => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const handle = createOpsHandler({ resolvePrincipal: async () => principal, rpc: async (n, a) => { calls.push([n, a]); return rpc ? rpc(n, a) : { ok: 1 }; },
      ensureGuestAuthUser: async (signupId) => { created.push(signupId); return id(9); } }, origin);
    return { calls, handle };
  };
  const host = make(who("host"));
  assert.equal((await host.handle("place", post(body))).status, 403);
  assert.deepEqual(created, []);
  const admin = make(who("admin"));
  assert.equal((await admin.handle("place", post({ ...body, extra: 1 }))).status, 400);
  assert.equal((await admin.handle("place", post(body))).status, 200);
  assert.deepEqual(admin.calls[0], ["place_guest_at_table", { p_actor: id(1), p_signup_id: id(4), p_table_id: id(5), p_operation_id: id(6), p_acknowledge_warnings: false, p_auth_user_id: id(9) }]);
  assert.deepEqual(created, [id(4)]);
  const warned = await make(who("admin"), async () => { throw new OpsRpcError("placement_warnings", JSON.stringify({ issues: ["age_span_exceeded", "<bad>"] })); }).handle("place", post(body));
  assert.equal(warned.status, 409);
  assert.deepEqual((await warned.json()).error.issues, ["age_span_exceeded"]);
  const full = await make(who("admin"), async () => { throw new OpsRpcError("table_full"); }).handle("place", post(body));
  assert.equal((await full.json()).error.reason, "table_full");
  assert.equal((await admin.handle("placementQueue", get("/q"))).status, 200);
  assert.equal((await host.handle("placementQueue", get("/q"))).status, 403);
});

test("member routes need an activated admission, not a staff role; ballot body is exactly one key", async () => {
  const member: ServerVerifiedPrincipal = { ...who(), admission: { state: "activated", authUserId: id(1), emailNormalized: "m@x.test" } };
  const s = setup(member);
  assert.equal((await s.handle("ballot", post({ choiceGuestId: null }), { tableId: id(2) })).status, 200);
  assert.deepEqual(s.calls[0], ["submit_ballot", { p_actor: id(1), p_table_id: id(2), p_choice_guest_id: null }]);
  assert.equal((await s.handle("ballot", post({ choiceGuestId: id(5) }), { tableId: id(2) })).status, 200);
  assert.equal((await s.handle("ballot", post({}), { tableId: id(2) })).status, 400);
  assert.equal((await s.handle("ballot", post({ choiceGuestId: "x" }), { tableId: id(2) })).status, 400);
  assert.equal((await s.handle("ballot", post({ choiceGuestId: null, extra: 1 }), { tableId: id(2) })).status, 400);
  assert.equal((await s.handle("conductReports", get("/c"), {})).status, 403);
  const staffOnly = setup(who("admin", "host"));
  assert.equal((await staffOnly.handle("tonight", get("/t"), { tableId: id(2) })).status, 403);
  assert.equal(staffOnly.calls.length, 0);
  const denied = (message: string) => setup(member, async () => { throw new OpsRpcError(message); });
  assert.equal((await denied("not_eligible").handle("ballot", post({ choiceGuestId: null }), { tableId: id(2) })).status, 403);
  assert.equal((await denied("invalid_choice").handle("ballot", post({ choiceGuestId: null }), { tableId: id(2) })).status, 400);
  const closed = await denied("voting_closed").handle("ballot", post({ choiceGuestId: null }), { tableId: id(2) });
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).error.reason, "voting_closed");
  const report = await s.handle("conductReport", post({ operationId: id(3), subjectGuestId: null, body: "  text " }), { tableId: id(2) });
  assert.equal(report.status, 200);
  assert.deepEqual(s.calls.at(-1), ["submit_conduct_report", { p_actor: id(1), p_table_id: id(2), p_subject_guest_id: null, p_body: "text", p_operation_id: id(3) }]);
  assert.equal((await s.handle("rating", post({ overall: 4, venueScores: {}, note: null }), { tableId: id(2) })).status, 200);
  assert.equal((await s.handle("rating", post({ overall: 4, venueScores: [], note: null }), { tableId: id(2) })).status, 400);
});

test("overview, report deletion and account deletion are admin-only; account deletion needs an explicit confirmation", async () => {
  const admin = setup(who("admin"));
  assert.equal((await admin.handle("adminOverview", get("/o"))).status, 200);
  assert.equal((await admin.handle("deleteMemberAccount", post({ guestId: id(9), confirm: "delete" }))).status, 200);
  assert.deepEqual(admin.calls.at(-1), ["delete_member_account", { p_actor: id(1), p_guest_id: id(9) }]);
  assert.equal((await admin.handle("deleteMemberAccount", post({ guestId: id(9) }))).status, 400);
  assert.equal((await admin.handle("deleteMemberAccount", post({ guestId: id(9), confirm: "yes" }))).status, 400);
  assert.equal((await admin.handle("deleteConductReport", post({}), { reportId: id(8) })).status, 200);
  const host = setup(who("host"));
  for (const [name, request, params] of [["adminOverview", get("/o"), {}], ["deleteMemberAccount", post({ guestId: id(9), confirm: "delete" }), {}], ["deleteConductReport", post({}), { reportId: id(8) }]] as const) {
    assert.equal((await host.handle(name, request, params)).status, 403);
  }
  assert.equal(host.calls.length, 0);
  const held = await setup(who("admin"), async () => { throw new OpsRpcError("case_held"); }).handle("deleteConductReport", post({}), { reportId: id(8) });
  assert.equal(held.status, 409);
  assert.equal((await held.json()).error.reason, "case_held");
});

test("notice problems: admin only; resolve takes exactly retry or dismiss", async () => {
  const admin = setup(who("admin"));
  assert.equal((await admin.handle("noticeProblems", get("/n"))).status, 200);
  assert.equal((await admin.handle("resolveNotice", post({ action: "retry" }), { noticeId: id(4) })).status, 200);
  assert.deepEqual(admin.calls.at(-1), ["resolve_notice", { p_actor: id(1), p_notice_id: id(4), p_action: "retry" }]);
  assert.equal((await admin.handle("resolveNotice", post({ action: "delete" }), { noticeId: id(4) })).status, 400);
  assert.equal((await admin.handle("resolveNotice", post({ action: "retry", extra: 1 }), { noticeId: id(4) })).status, 400);
  const host = setup(who("host"));
  assert.equal((await host.handle("noticeProblems", get("/n"))).status, 403);
  assert.equal((await host.handle("resolveNotice", post({ action: "retry" }), { noticeId: id(4) })).status, 403);
  assert.equal(host.calls.length, 0);
});
