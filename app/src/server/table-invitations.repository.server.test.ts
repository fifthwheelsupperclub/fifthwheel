import assert from "node:assert/strict";
import test from "node:test";
import { createTableInvitationDeliveryWorkerRepository, createTableInvitationRepository, TableInvitationRepositoryError } from "./table-invitations.repository.server.ts";

const actorId = "11111111-1111-4111-8111-111111111111";
const invitationId = "22222222-2222-4222-8222-222222222222";
const outboxId = "33333333-3333-4333-8333-333333333333";
const tableId = "44444444-4444-4444-8444-444444444444";
function repo(result: unknown, status = 200) {
  const calls: Array<{ url: URL; body: unknown }> = [];
  const repository = createTableInvitationRepository({ url: "http://127.0.0.1:56421", publishableKey: "publishable", secretKey: "secret",
    fetch: async (input, init) => {
      calls.push({ url: new URL(String(input)), body: JSON.parse(String(init?.body)) as unknown });
      return new Response(JSON.stringify(result), { status, headers: { "content-type": "application/json" } });
    } });
  return { repository, calls };
}

test("member invitation parser accepts safe fallback with no invented itinerary", async () => {
  const { repository, calls } = repo({ invitationId, state: "active", createdAt: "2026-11-13T12:00:00Z",
    delivery: { state: "failed", attemptCount: 1, lastAttemptAt: "2026-11-13T12:01:00Z", providerMessageId: "private" },
    table: { tableId, title: "Dinner", localDate: "2026-12-01", startLocalTime: "19:00", neighborhood: "Midtown",
      seatPriceCents: 2500, currency: "USD", stops: [], itineraryAvailable: false, ownerEmail: "private" } });
  const value = await repository.readMemberInvitation(actorId, invitationId);
  assert.equal(value.table.itineraryAvailable, false);
  assert.deepEqual(value.table.stops, []);
  assert.equal("ownerEmail" in value.table, false);
  assert.equal("providerMessageId" in value.delivery, false);
  assert.deepEqual(calls[0], { url: new URL("http://127.0.0.1:56421/rest/v1/rpc/read_member_table_invitation"),
    body: { p_auth_user_id: actorId, p_invitation_id: invitationId } });
});

test("admin list parser limits and sanitizes delivery attempts", async () => {
  const { repository } = repo({ items: [{ invitationId, invitationState: "active", createdAt: "2026-11-13T12:00:00Z",
    guest: { guestId: actorId, displayName: "Member", email: "private@example.test" },
    table: { tableId, title: "Dinner", localDate: "2026-12-01", startLocalTime: "19:00", neighborhood: "Midtown" },
    delivery: { outboxId, state: "unknown", attemptCount: 1, queuedAt: "2026-11-13T12:00:00Z", nextAttemptAt: "2026-11-13T12:01:00Z",
      lastAttemptAt: "2026-11-13T12:01:00Z", safeErrorCode: "provider_timeout", providerMessageId: "private" },
    attempts: [{ attemptNumber: 1, state: "unknown", startedAt: "2026-11-13T12:00:00Z", finishedAt: "2026-11-13T12:01:00Z",
      safeErrorCode: "provider_timeout", providerMessageId: "private" }] }], nextCursor: null });
  const value = await repository.listAdminInvitations(actorId, { limit: 10 });
  assert.equal(value.items[0]?.delivery.state, "unknown");
  assert.equal("email" in value.items[0]!.guest, false);
  assert.equal("providerMessageId" in value.items[0]!.delivery, false);
  assert.equal("providerMessageId" in value.items[0]!.attempts[0]!, false);
});

test("retry maps safe state conflicts without exposing Postgres text", async () => {
  const { repository } = repo({ message: "attempt_reconciliation_required", details: "provider payload" }, 409);
  await assert.rejects(repository.retryFailedDelivery(actorId, invitationId, { operationId: actorId, expectedAttemptCount: 1 }),
    (error: unknown) => error instanceof TableInvitationRepositoryError && error.code === "attempt_reconciliation_required");
});

test("worker persistence adapter uses only the service RPCs and preserves unknown reconciliation", async () => {
  const { calls } = repo({ created: false, outbox: { state: "unknown" }, attempt: {
    attempt_id: outboxId, attempt_number: 1, state: "unknown",
  } });
  const worker = createTableInvitationDeliveryWorkerRepository({ url: "http://127.0.0.1:56421", publishableKey: "publishable", secretKey: "secret",
    fetch: async (input, init) => {
      calls.push({ url: new URL(String(input)), body: JSON.parse(String(init?.body)) as unknown });
      const path = new URL(String(input)).pathname;
      const result = path.endsWith("begin_table_invitation_delivery_attempt")
        ? { created: false, outbox: { state: "unknown" }, attempt: { attempt_id: outboxId, attempt_number: 1, state: "unknown" } }
        : path.endsWith("mark_table_invitation_delivery_delivered")
          ? { outbox: { state: "delivered" }, attempt: { attempt_number: 1 }, changed: true }
          : { outbox: { state: "failed" }, attempt: { attempt_number: 1 }, changed: true };
      return new Response(JSON.stringify(result), { status: 200 });
    } });
  const begun = await worker.beginAttempt(outboxId, actorId);
  assert.deepEqual(begun, { attemptId: outboxId, attemptNumber: 1, created: false });
  const resolved = await worker.reconcileUnknown({ attemptId: outboxId, state: "failed" });
  assert.deepEqual(resolved, { deliveryState: "failed", attemptNumber: 1, changed: true });
  const delivered = await worker.markDelivered(outboxId, "provider-message-1");
  assert.deepEqual(delivered, { deliveryState: "delivered", attemptNumber: 1, changed: true });
  assert.equal(calls[0]?.url.pathname, "/rest/v1/rpc/begin_table_invitation_delivery_attempt");
  assert.equal(calls[1]?.url.pathname, "/rest/v1/rpc/reconcile_unknown_table_invitation_attempt");
  assert.equal(calls[2]?.url.pathname, "/rest/v1/rpc/mark_table_invitation_delivery_delivered");
});
