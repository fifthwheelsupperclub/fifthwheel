import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import { createTableCancelHandler } from "./table-cancel.server.ts";

const origin = "https://app.example.test";
const tableId = "e0760000-0000-4000-8000-000000000041", operationId = "e0760000-0000-4000-8000-000000000141";
const result = { tableId, state: "cancelled", closedRequests: 1, closedInvitations: 1, releasedHolds: 0, cancelledSeats: 2, resolvedCancellationRequests: 0, refundObligations: 2, refundTotalCents: 5000 };
const admin: ServerVerifiedPrincipal = { userId: "a", emailNormalized: "a@x.test", emailVerified: true, staffRoles: new Set(["admin"]),
  admission: { state: "none", authUserId: null, emailNormalized: null }, assignedTableIds: new Set(), assignedVenueIds: new Set() };
const req = (body: unknown, init: { origin?: string; cookie?: string; type?: string } = {}) => new Request(`${origin}/api/admin/tables/${tableId}/cancel`, { method: "POST",
  headers: { origin: init.origin ?? origin, "content-type": init.type ?? "application/json", cookie: init.cookie ?? "fw_access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlc2lnbmF0dXJl" }, body: typeof body === "string" ? body : JSON.stringify(body) });
function handler(principal: ServerVerifiedPrincipal | null, cancel: (...a: unknown[]) => Promise<unknown> = async () => result) {
  const calls: unknown[][] = [];
  return { calls, run: createTableCancelHandler({ resolvePrincipal: async () => principal, cancel: async (...a: unknown[]) => { calls.push(a); return cancel(...a); } } as never, origin) };
}

test("rejects wrong origin, bad body and unauthenticated callers before the RPC", async () => {
  const h = handler(admin);
  assert.equal((await h.run(req({ operationId, reason: "x" }, { origin: "https://evil.test" }), tableId)).status, 403);
  assert.equal((await h.run(req("not json"), tableId)).status, 400);
  assert.equal((await h.run(req({ operationId, reason: "  " }), tableId)).status, 400);
  assert.equal((await h.run(req({ operationId, reason: "x", extra: 1 }), tableId)).status, 400);
  assert.equal((await h.run(req({ operationId: "nope", reason: "x" }), tableId)).status, 400);
  assert.equal((await h.run(req({ operationId, reason: "x" }, { cookie: "" }), tableId)).status, 401);
  assert.equal(h.calls.length, 0);
});

test("only admins can cancel; non-admin never reaches the RPC", async () => {
  const member: ServerVerifiedPrincipal = { ...admin, staffRoles: new Set(), admission: { state: "activated", authUserId: "a", emailNormalized: "a@x.test" } };
  const h = handler(member);
  assert.equal((await h.run(req({ operationId, reason: "x" }), tableId)).status, 403);
  assert.equal(h.calls.length, 0);
});

test("passes the trimmed reason and returns the validated summary; maps RPC errors", async () => {
  const ok = handler(admin);
  const res = await ok.run(req({ operationId, reason: "  Venue closed " }), tableId);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.refundTotalCents, 5000);
  assert.deepEqual(ok.calls[0], ["a", { tableId, operationId, reason: "Venue closed" }]);
  assert.equal((await handler(admin, async () => { throw new Error("table_not_cancellable"); }).run(req({ operationId, reason: "x" }), tableId)).status, 409);
  assert.equal((await handler(admin, async () => { throw new Error("boom"); }).run(req({ operationId, reason: "x" }), tableId)).status, 503);
  assert.equal((await handler(admin, async () => ({ bad: true })).run(req({ operationId, reason: "x" }), tableId)).status, 503);
});
