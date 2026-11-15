import assert from "node:assert/strict";
import test from "node:test";
import { createInvitationDeliveryService } from "./invitation-delivery.service.server.ts";
import { SupabaseAuthLinkError } from "./auth.link.supabase.server.ts";

const ids = {
  admin: "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e",
  delivery: "946c81d0-f5c8-4c81-a7c0-a3e96b08df65",
  admission: "946c81d0-f5c8-4c81-a7c0-a3e96b08df63",
  signup: "946c81d0-f5c8-4c81-a7c0-a3e96b08df61",
  attempt: "946c81d0-f5c8-4c81-a7c0-a3e96b08df69",
  operation: "946c81d0-f5c8-4c81-a7c0-a3e96b08df6a",
};

function makeDependencies(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const dependencies = {
    calls,
    resolvePrincipal: async () => ({ userId: ids.admin, emailNormalized: "admin@example.test", emailVerified: true, staffRoles: new Set(["admin"]), admission: { state: "none", authUserId: null, emailNormalized: null }, assignedTableIds: new Set(), assignedVenueIds: new Set() }),
    getContext: async (deliveryId: string) => { calls.push(`context:${deliveryId}`); return { deliveryId, admissionId: ids.admission, signupId: ids.signup, recipientEmail: "member@example.test", admissionState: "invited" as const }; },
    beginAttempt: async (input: { deliveryId: string; operationId: string; startedByUserId: string }) => { calls.push(`begin:${input.deliveryId}:${input.operationId}:${input.startedByUserId}`); return { delivery: { id: ids.delivery, state: "sending" }, attempt: { id: ids.attempt }, created: true }; },
    finishAttempt: async (input: { attemptId: string; state: string }) => { calls.push(`finish:${input.attemptId}:${input.state}`); },
    getLatestAttempt: async () => ({ id: ids.attempt, state: "unknown", provider_message_id: null }),
    reconcileAttempt: async (input: { attemptId: string; state: string }) => { calls.push(`reconcile:${input.attemptId}:${input.state}`); },
    authProvider: {
      async createMagicLink(input: { kind: string }) { calls.push(`auth:${input.kind}`); return { actionLink: "http://127.0.0.1:8085/auth/callback?token_hash=abcdefghijklmnop&type=invite", authUserId: ids.admin }; },
    },
    emailProvider: {
      async sendAppInvitation(input: { recipientEmail: string; deliveryId: string; attemptId: string; idempotencyKey: string }) {
        calls.push(`email:${input.recipientEmail}:${input.deliveryId}:${input.attemptId}:${input.idempotencyKey}`);
        return { state: "accepted" as const, providerMessageId: "mailpit-1" };
      },
      async reconcile(input: { deliveryId: string; attemptId: string; recipientEmail: string }) {
        calls.push(`provider_reconcile:${input.deliveryId}:${input.attemptId}:${input.recipientEmail}`);
        return { state: "accepted" as const, providerMessageId: "mailpit-1" };
      },
    },
    appOrigin: "http://127.0.0.1:8085",
    now: () => new Date("2026-11-12T17:00:00.000Z"),
    createOperationId: () => ids.operation,
    ...overrides,
  };
  return dependencies;
}

test("admin send derives actor/recipient from trusted state and falls back only on definitive invite rejection", async () => {
  const dependencies = makeDependencies({
    authProvider: {
      async createMagicLink(input: { kind: string }) {
        dependencies.calls.push(`auth:${input.kind}`);
        if (input.kind === "invite") throw new SupabaseAuthLinkError("provider_rejected");
        return { actionLink: "http://127.0.0.1:8085/auth/callback?token_hash=abcdefghijklmnop&type=magiclink", authUserId: ids.admin };
      },
    },
  });
  const service = createInvitationDeliveryService(dependencies as never);
  const result = await service.send({ accessToken: "session-token", deliveryId: ids.delivery, operationId: ids.operation });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.state, "accepted");
    assert.match(result.value.safeMessage, /does not confirm inbox delivery/);
  }
  assert.deepEqual(dependencies.calls, [
    `context:${ids.delivery}`,
    `begin:${ids.delivery}:${ids.operation}:${ids.admin}`,
    "auth:invite",
    "auth:magiclink",
    `email:member@example.test:${ids.delivery}:${ids.attempt}:${ids.operation}`,
    `finish:${ids.attempt}:accepted`,
  ]);
});

test("authorization denial occurs before context and RPC reads", async () => {
  const dependencies = makeDependencies({ resolvePrincipal: async () => null });
  const result = await createInvitationDeliveryService(dependencies as never).send({ accessToken: null, deliveryId: ids.delivery });
  assert.deepEqual(result.ok, false);
  assert.deepEqual(dependencies.calls, []);
});

test("known Auth rejection records failed before any email send; uncertain Auth result stays unknown", async () => {
  const rejected = makeDependencies({ authProvider: {
    async createMagicLink() { throw new SupabaseAuthLinkError("provider_rejected"); },
  } });
  const result = await createInvitationDeliveryService(rejected as never).send({ accessToken: "session-token", deliveryId: ids.delivery, operationId: ids.operation });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.state, "failed");
  assert.ok(rejected.calls.includes(`finish:${ids.attempt}:failed`));
  assert.equal(rejected.calls.some((call) => call.startsWith("email:")), false);

  const uncertain = makeDependencies({ authProvider: {
    async createMagicLink() { throw new SupabaseAuthLinkError("provider_outcome_unknown"); },
  } });
  const uncertainResult = await createInvitationDeliveryService(uncertain as never).send({ accessToken: "session-token", deliveryId: ids.delivery, operationId: ids.operation });
  assert.equal(uncertainResult.ok, true);
  if (uncertainResult.ok) assert.equal(uncertainResult.value.state, "unknown");
  assert.ok(uncertain.calls.includes(`finish:${ids.attempt}:unknown`));
  assert.equal(uncertain.calls.some((call) => call.startsWith("email:")), false);
});

test("unknown provider result cannot be resent and reconciliation uses exact recipient without sending", async () => {
  const unknown = makeDependencies({ emailProvider: {
    async sendAppInvitation() { return { state: "unknown" as const, safeErrorCode: "mailpit_outcome_unknown" }; },
    async reconcile(input: { deliveryId: string; attemptId: string; recipientEmail: string }) {
      unknown.calls.push(`provider_reconcile:${input.deliveryId}:${input.attemptId}:${input.recipientEmail}`);
      return { state: "unknown" as const };
    },
  } });
  const service = createInvitationDeliveryService(unknown as never);
  const first = await service.send({ accessToken: "session-token", deliveryId: ids.delivery, operationId: ids.operation });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.value.state, "unknown");
  assert.ok(unknown.calls.includes(`finish:${ids.attempt}:unknown`));

  unknown.calls.length = 0;
  const reconciled = await service.reconcile({ accessToken: "session-token", deliveryId: ids.delivery });
  assert.equal(reconciled.ok, true);
  if (reconciled.ok) assert.equal(reconciled.value.state, "unknown");
  assert.deepEqual(unknown.calls, [
    `context:${ids.delivery}`,
    `provider_reconcile:${ids.delivery}:${ids.attempt}:member@example.test`,
  ]);
});
