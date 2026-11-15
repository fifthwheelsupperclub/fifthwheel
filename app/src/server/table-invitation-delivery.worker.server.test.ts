import assert from "node:assert/strict";
import test from "node:test";
import { createTableInvitationDeliveryWorker } from "./table-invitation-delivery.worker.server.ts";
import type { TableInvitationDeliveryWorkerRepository } from "./table-invitations.contract.server.ts";

const invitationId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const context = { invitationId, recipientEmail: "member@example.test", table: {
  title: "Dinner", localDate: "2026-12-01", startLocalTime: "19:00", neighborhood: "Midtown",
} };

function workerRepository(overrides: Partial<TableInvitationDeliveryWorkerRepository> = {}) {
  const calls: Array<{ method: string; value?: unknown }> = [];
  const repository: TableInvitationDeliveryWorkerRepository = {
    async beginNextAttempt(operationId) { calls.push({ method: "begin", value: operationId }); return { outboxId: "44444444-4444-4444-8444-444444444444",
      invitationId, attemptId, attemptNumber: 1, created: true }; },
    async readDeliveryContext(id) { calls.push({ method: "context", value: id }); return context; },
    async readUnknownContext(id, count) { calls.push({ method: "unknownContext", value: [id, count] }); return { ...context, attemptId, attemptNumber: count, providerMessageId: null }; },
    async beginAttempt() { throw new Error("unused"); },
    async finishAttempt(input) { calls.push({ method: "finish", value: input }); return { deliveryState: input.state, attemptNumber: 1, changed: true }; },
    async markDelivered() { throw new Error("unused"); },
    async expireLeases() { return 0; },
    async reconcileUnknownAttempt(id, state, messageId) { calls.push({ method: "reconcile", value: [id, state, messageId] }); return { deliveryState: state, attemptNumber: 1, changed: true }; },
    async reconcileUnknown() { throw new Error("unused"); },
    ...overrides,
  };
  return { repository, calls };
}

test("worker sends only the trusted durable recipient and records accepted without claiming delivered", async () => {
  const { repository, calls } = workerRepository(); let mailInput: unknown;
  const worker = createTableInvitationDeliveryWorker({ repository, createOperationId: () => "55555555-5555-4555-8555-555555555555",
    emailProvider: { async sendInvitation(input) { mailInput = input; return { state: "accepted", providerMessageId: "mailpit-id" }; },
      async reconcile() { return { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" }; } } });
  const result = await worker.deliverNext();
  assert.deepEqual(result, { state: "accepted", invitationId, attemptNumber: 1 });
  assert.deepEqual(mailInput, { ...context, attemptId });
  assert.equal(calls.find((call) => call.method === "finish")?.value instanceof Object, true);
  assert.equal((calls.find((call) => call.method === "finish")?.value as { state: string }).state, "accepted");
});

test("unknown reconciliation checks trusted context and does not resend or mutate when provider is inconclusive", async () => {
  const { repository, calls } = workerRepository(); let sends = 0; let reconcileInput: unknown;
  const worker = createTableInvitationDeliveryWorker({ repository,
    emailProvider: { async sendInvitation() { sends++; return { state: "accepted", providerMessageId: "unused" }; },
      async reconcile(input) { reconcileInput = input; return { state: "unknown", safeErrorCode: "mailpit_reconcile_unknown" }; } } });
  const result = await worker.reconcileUnknown(invitationId, 4);
  assert.deepEqual(result, { state: "unknown", invitationId, attemptNumber: 4 });
  assert.deepEqual(reconcileInput, { invitationId, attemptId, recipientEmail: "member@example.test" });
  assert.equal(sends, 0);
  assert.equal(calls.some((call) => call.method === "reconcile"), false);
});
