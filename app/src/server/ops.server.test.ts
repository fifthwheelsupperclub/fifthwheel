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

test("removal and replacement: admin only, exact body, null replacement allowed, conflicts surfaced", async () => {
  const body = { operationId: id(3), expectedRevision: 2, refundCents: 1500, replaceRequestId: id(5) };
  const admin = setup(who("admin"));
  assert.equal((await admin.handle("removeAndReplace", post(body), { invitationId: id(7) })).status, 200);
  assert.deepEqual(admin.calls[0], ["remove_and_replace", { p_actor: id(1), p_invitation_id: id(7), p_operation_id: id(3), p_expected_revision: 2, p_refund_cents: 1500, p_replace_request_id: id(5) }]);
  assert.equal((await admin.handle("removeAndReplace", post({ ...body, replaceRequestId: null }), { invitationId: id(7) })).status, 200);
  assert.equal((await admin.handle("removeAndReplace", post({ operationId: id(3), expectedRevision: 2, refundCents: 0 }), { invitationId: id(7) })).status, 400);
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
