import assert from "node:assert/strict";
import test from "node:test";
import { createTableInvitationService } from "./table-invitations.service.server.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { TableInvitationRepository } from "./table-invitations.contract.server.ts";

const invitationId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
function principal(overrides: Partial<ServerVerifiedPrincipal> = {}): ServerVerifiedPrincipal {
  return { userId: "user-1", emailNormalized: "member@example.test", emailVerified: true, staffRoles: new Set(),
    admission: { state: "activated", authUserId: "user-1", emailNormalized: "member@example.test" },
    assignedTableIds: new Set(), assignedVenueIds: new Set(), ...overrides };
}
function repository(): TableInvitationRepository {
  return {
    async readMemberInvitation(_actor: string, id: string) { return { invitationId: id, state: "active", createdAt: "2026-11-13T12:00:00Z",
      delivery: { state: "queued", attemptCount: 0, lastAttemptAt: null },
      table: { tableId: "44444444-4444-4444-8444-444444444444", title: "Dinner", localDate: "2026-12-01", startLocalTime: "19:00",
        neighborhood: "Midtown", seatPriceCents: 2500, currency: "USD", stops: [], itineraryAvailable: false } }; },
    async listAdminInvitations(_actor: string, _input: Readonly<{ cursor?: string; limit: number }>) { return { items: [], nextCursor: null }; },
    async retryFailedDelivery(_actor: string, id: string, request: Readonly<{ operationId: string; expectedAttemptCount: number }>) { return { invitationId: id, deliveryState: "queued", attemptCount: request.expectedAttemptCount,
      queuedAt: "2026-11-13T12:00:00Z", nextAttemptAt: "2026-11-13T12:00:00Z" }; },
  } as unknown as TableInvitationRepository;
}

test("member detail requires admitted member access and derives actor from verified principal", async () => {
  let actor = "";
  const repo = repository();
  const service = createTableInvitationService({ resolvePrincipal: async () => principal(), repository: {
    ...repo, async readMemberInvitation(actorId: string, id: string) { actor = actorId; return repo.readMemberInvitation(actorId, id); },
  } });
  const result = await service.readMemberInvitation({ accessToken: "signed-cookie", invitationId });
  assert.equal(result.ok, true);
  assert.equal(actor, "user-1");
  const denied = createTableInvitationService({ resolvePrincipal: async () => principal({
    admission: { state: "none", authUserId: null, emailNormalized: null },
  }), repository: repo });
  assert.deepEqual(await denied.readMemberInvitation({ accessToken: "signed-cookie", invitationId }), {
    ok: false, error: { code: "forbidden", safeMessage: "Admitted app member access is required." },
  });
});

test("admin reads and retries are role-gated; host cannot retry", async () => {
  let actor = "";
  const repo = repository();
  const admin = createTableInvitationService({ resolvePrincipal: async () => principal({ staffRoles: new Set(["admin"]) }), repository: {
    ...repo, async retryFailedDelivery(actorId: string, id: string, request: Readonly<{ operationId: string; expectedAttemptCount: number }>) { actor = actorId; return repo.retryFailedDelivery(actorId, id, request); },
  } });
  const accepted = await admin.retryFailedDelivery({ accessToken: "signed-cookie", invitationId,
    request: { operationId, expectedAttemptCount: 2 } });
  assert.equal(accepted.ok, true);
  assert.equal(actor, "user-1");
  const host = createTableInvitationService({ resolvePrincipal: async () => principal({ staffRoles: new Set(["host"]) }), repository: repo });
  assert.equal((await host.listAdminInvitations({ accessToken: "signed-cookie", limit: 25 })).ok, false);
  assert.deepEqual(await host.retryFailedDelivery({ accessToken: "signed-cookie", invitationId,
    request: { operationId, expectedAttemptCount: 2 } }), {
    ok: false, error: { code: "forbidden", safeMessage: "Only an admin may retry invitation delivery." },
  });
});

test("missing session is unauthenticated while resolver outage is retryable unavailable", async () => {
  const repo = repository();
  const service = createTableInvitationService({ resolvePrincipal: async (token) => {
    if (token === "outage") throw new Error("provider details must not escape");
    return null;
  }, repository: repo });
  const missing = await service.listAdminInvitations({ limit: 25 });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "unauthenticated");
  const outage = await service.listAdminInvitations({ accessToken: "outage", limit: 25 });
  assert.equal(outage.ok, false);
  if (!outage.ok) assert.equal(outage.error.code, "temporarily_unavailable");
});

test("admin unknown reconciliation delegates only after role and expected-attempt validation", async () => {
  const observed: unknown[] = [];
  const service = createTableInvitationService({ resolvePrincipal: async () => principal({ staffRoles: new Set(["admin"]) }), repository: repository(),
    async reconcileUnknownDelivery(id, count) { observed.push({ id, count }); return { invitationId: id, deliveryState: "unknown", attemptCount: count }; },
  });
  const result = await service.reconcileUnknown({ accessToken: "signed-cookie", invitationId,
    request: { expectedAttemptCount: 3 } });
  assert.deepEqual(observed, [{ id: invitationId, count: 3 }]);
  assert.deepEqual(result, { ok: true, value: { invitationId, deliveryState: "unknown", attemptCount: 3 } });
});
