import assert from "node:assert/strict";
import test from "node:test";
import type { AdminInvitationInput, MemberInvitationInput, ReconcileInvitationInput, RetryInvitationInput, TableInvitationService } from "./table-invitations.contract.server.ts";
import { createTableInvitationHttpHandlers } from "./table-invitations.http.server.ts";

const invitationId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature";
const calls: Array<{ method: string; value: unknown }> = [];
function service(): TableInvitationService {
  return {
    async readMemberInvitation(input: MemberInvitationInput) { calls.push({ method: "read", value: input }); return { ok: false, error: { code: "not_found", safeMessage: "No invitation." } }; },
    async listAdminInvitations(input: AdminInvitationInput) { calls.push({ method: "list", value: input }); return { ok: true, value: { items: [], nextCursor: null } }; },
    async retryFailedDelivery(input: RetryInvitationInput) { calls.push({ method: "retry", value: input }); return { ok: true, value: { invitationId: input.invitationId,
      deliveryState: "queued", attemptCount: input.request.expectedAttemptCount, queuedAt: "2026-11-13T12:00:00Z", nextAttemptAt: "2026-11-13T12:00:00Z" } }; },
    async reconcileUnknown(input: ReconcileInvitationInput) { calls.push({ method: "reconcile", value: input }); return { ok: true, value: { invitationId: input.invitationId,
      deliveryState: "unknown", attemptCount: input.request.expectedAttemptCount } }; },
  } as unknown as TableInvitationService;
}

test("member detail is cookie-derived and no-store; service owner denial stays a safe 404", async () => {
  calls.length = 0;
  const handlers = createTableInvitationHttpHandlers(service, "http://127.0.0.1:8085");
  const response = await handlers.readMemberInvitation(new Request(`http://127.0.0.1:8085/api/me/table-invitations/${invitationId}`, {
    headers: { cookie: `fw_access_token=${token}` },
  }), invitationId);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls[0], { method: "read", value: { accessToken: token, invitationId } });
});

test("admin list accepts only bounded cursor and limit parameters", async () => {
  calls.length = 0;
  const handlers = createTableInvitationHttpHandlers(service, "http://127.0.0.1:8085");
  const invalid = await handlers.listAdminInvitations(new Request("http://127.0.0.1:8085/api/admin/table-invitations?limit=10&secret=x"));
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
  const response = await handlers.listAdminInvitations(new Request(`http://127.0.0.1:8085/api/admin/table-invitations?limit=10`, {
    headers: { cookie: `fw_access_token=${token}` },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { method: "list", value: { accessToken: token, limit: 10 } });
});

test("retry is exact-body, same-origin and queues through the service", async () => {
  calls.length = 0;
  const handlers = createTableInvitationHttpHandlers(service, "http://127.0.0.1:8085");
  const badOrigin = await handlers.retryFailedDelivery(new Request(`http://127.0.0.1:8085/api/admin/table-invitations/${invitationId}/retry`, {
    method: "POST", headers: { origin: "http://localhost:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId, expectedAttemptCount: 1 }),
  }), invitationId);
  assert.equal(badOrigin.status, 403);
  const good = await handlers.retryFailedDelivery(new Request(`http://127.0.0.1:8085/api/admin/table-invitations/${invitationId}/retry`, {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId, expectedAttemptCount: 2 }),
  }), invitationId);
  assert.equal(good.status, 200);
  assert.deepEqual(calls[0], { method: "retry", value: { accessToken: token, invitationId,
    request: { operationId, expectedAttemptCount: 2 } } });
});

test("unknown reconciliation is same-origin, exact-body and never carries recipient data", async () => {
  calls.length = 0;
  const handlers = createTableInvitationHttpHandlers(service, "http://127.0.0.1:8085");
  const response = await handlers.reconcileUnknown(new Request(`http://127.0.0.1:8085/api/admin/table-invitations/${invitationId}/reconcile`, {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ expectedAttemptCount: 3 }),
  }), invitationId);
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], { method: "reconcile", value: { accessToken: token, invitationId,
    request: { expectedAttemptCount: 3 } } });
});
