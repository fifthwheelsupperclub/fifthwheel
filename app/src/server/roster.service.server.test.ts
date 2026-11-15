import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { RosterRepository } from "./roster.contract.server.ts";
import { createRosterService } from "./roster.service.server.ts";
import { RosterRepositoryError } from "./roster.repository.server.ts";

const tableId = "11111111-1111-4111-8111-111111111111";
const supplyRevisionId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const accessToken = "valid-shaped-test-token";
const now = "2026-11-13T12:00:00.000Z";
const tableSummary = { tableId, title: "June Table", localDate: "2027-06-12", startLocalTime: "18:30", neighborhood: "Inman Park",
  publishedRevisionId: supplyRevisionId, pendingRequestCount: 3, currentProposal: null };
const assignedTables = { items: [tableSummary], nextCursor: null };
const proposal = { proposalId: "55555555-5555-4555-8555-555555555555", revision: 1, state: "draft" as const,
  supplyRevisionId, selectedRequestIds: [requestId], selectedGuests: [{ guestId: "99999999-9999-4999-8999-999999999999", displayName: "Alex Guest" }],
  validation: { valid: false, issues: [{ code: "select_three_to_five" as const }] }, createdAt: now, updatedAt: now };

function principal(input: Partial<ServerVerifiedPrincipal> = {}): ServerVerifiedPrincipal {
  return {
    userId: "66666666-6666-4666-8666-666666666666", emailNormalized: "staff@example.test", emailVerified: true,
    staffRoles: new Set(), admission: { state: "none", authUserId: null, emailNormalized: null }, assignedTableIds: new Set(), assignedVenueIds: new Set(),
    ...input,
  };
}

function createFake(
  repositoryOverrides: Partial<RosterRepository> = {},
  actor: ServerVerifiedPrincipal | null = principal(),
  resolvePrincipal: (token: string | null | undefined) => Promise<ServerVerifiedPrincipal | null> = async () => actor,
) {
  const calls: Array<{ method: string; actorId: string; data?: unknown }> = [];
  const repository: RosterRepository = {
    async listAdminSeatRequests(actorId, input) { calls.push({ method: "admin-list", actorId, data: input }); return assignedTables; },
    async listAssignedCurationTables(actorId, input) { calls.push({ method: "assigned-list", actorId, data: input }); return assignedTables; },
    async readTableRoster(actorId, id, input) { calls.push({ method: "read", actorId, data: { id, input } }); return { table: { tableId, title: "June Table", localDate: "2027-06-12", startLocalTime: "18:30", neighborhood: "Inman Park", publishedRevisionId: supplyRevisionId, readOnlyReason: null }, applicants: { items: [], nextCursor: null }, currentProposal: null, permissions: { canEditProposal: true, canSubmit: false, canApprove: false } }; },
    async saveRosterProposal(actorId, id, input) { calls.push({ method: "save", actorId, data: { id, input } }); return proposal; },
    async submitRosterProposal(actorId, id, input) { calls.push({ method: "submit", actorId, data: { id, input } }); return { ...proposal, state: "submitted" }; },
    async approveRoster(actorId, id, input) { calls.push({ method: "approve", actorId, data: { id, input } }); return { proposal: { proposalId: proposal.proposalId, revision: 1, state: "approved" }, invitations: [1, 2, 3].map((n) => ({ invitationId: `${n}5555555-5555-4555-8555-555555555555`, guestId: `${n}6666666-6666-4666-8666-666666666666`, state: "active" as const, deliveryState: "queued" as const })) }; },
    ...repositoryOverrides,
  };
  const service = createRosterService({ resolvePrincipal, repository });
  return { service, calls };
}

test("admin and assigned host role gates are enforced before repository access", async () => {
  const adminId = "77777777-7777-4777-8777-777777777777";
  const admin = principal({ userId: adminId, staffRoles: new Set(["admin"]) });
  const adminHarness = createFake({}, admin);
  const listed = await adminHarness.service.listAdminSeatRequests({ accessToken, limit: 25 });
  assert.equal(listed.ok, true);
  assert.equal(adminHarness.calls[0]?.method, "admin-list");

  const hostId = "88888888-8888-4888-8888-888888888888";
  const assignedHost = principal({ userId: hostId, staffRoles: new Set(["host"]), assignedTableIds: new Set([tableId]) });
  const hostHarness = createFake({}, assignedHost);
  assert.equal((await hostHarness.service.readTableRoster({ accessToken, tableId, limit: 25 })).ok, true);
  assert.equal((await hostHarness.service.saveRosterProposal({ accessToken, tableId, request: { operationId, expectedProposalRevision: null, supplyRevisionId, selectedRequestIds: [requestId] } })).ok, true);
  assert.equal((await hostHarness.service.approveRoster({ accessToken, tableId, request: { operationId, expectedProposalRevision: 1 } })).ok, false);
  assert.deepEqual(hostHarness.calls.map((call) => call.method), ["read", "save"]);

  const unassigned = createFake({}, principal({ staffRoles: new Set(["host"]) }));
  const denied = await unassigned.service.readTableRoster({ accessToken, tableId, limit: 25 });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "forbidden");
  assert.equal(unassigned.calls.length, 0);
});

test("members and unauthenticated callers cannot enter curation APIs", async () => {
  const member = principal({ admission: { state: "activated", authUserId: "66666666-6666-4666-8666-666666666666", emailNormalized: "staff@example.test" } });
  const memberHarness = createFake({}, member);
  const memberResult = await memberHarness.service.listAssignedCurationTables({ accessToken, limit: 25 });
  assert.equal(memberResult.ok, false);
  if (!memberResult.ok) assert.equal(memberResult.error.code, "forbidden");
  assert.equal(memberHarness.calls.length, 0);

  const anonymousHarness = createFake({}, null);
  const anonymousResult = await anonymousHarness.service.listAssignedCurationTables({ limit: 25 });
  assert.equal(anonymousResult.ok, false);
  if (!anonymousResult.ok) assert.equal(anonymousResult.error.code, "unauthenticated");
  assert.equal(anonymousHarness.calls.length, 0);
});

test("principal resolver outages are unavailable while invalid sessions remain unauthenticated", async () => {
  const invalidSession = createFake({}, null);
  const invalidResult = await invalidSession.service.listAssignedCurationTables({ accessToken: "expired-token", limit: 25 });
  assert.equal(invalidResult.ok, false);
  if (!invalidResult.ok) assert.equal(invalidResult.error.code, "unauthenticated");

  const outage = createFake({}, null, async () => { throw new Error("trusted assignment database unavailable"); });
  const outageResult = await outage.service.listAssignedCurationTables({ accessToken: "valid-shaped-token", limit: 25 });
  assert.equal(outageResult.ok, false);
  if (!outageResult.ok) {
    assert.equal(outageResult.error.code, "temporarily_unavailable");
    assert.equal(outageResult.error.safeMessage.includes("trusted assignment"), false);
  }
  assert.equal(outage.calls.length, 0);
});

test("proposal inputs are bounded and revisions/operation IDs validated before persistence", async () => {
  const host = principal({ staffRoles: new Set(["host"]), assignedTableIds: new Set([tableId]) });
  const harness = createFake({}, host);
  const duplicate = await harness.service.saveRosterProposal({ tableId, request: { operationId, expectedProposalRevision: null,
    supplyRevisionId, selectedRequestIds: [requestId, requestId] } });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "invalid_input");
  const badRevision = await harness.service.approveRoster({ tableId, request: { operationId, expectedProposalRevision: 0 } });
  assert.equal(badRevision.ok, false);
  assert.equal(harness.calls.length, 0);
});

test("database validation issues become safe UI reasons without database text", async () => {
  const host = principal({ staffRoles: new Set(["host"]), assignedTableIds: new Set([tableId]) });
  const harness = createFake({ async submitRosterProposal() { throw new RosterRepositoryError("validation_failed", [{ code: "age_span_exceeded" }]); } }, host);
  const result = await harness.service.submitRosterProposal({ accessToken, tableId, request: { operationId, expectedProposalRevision: 1 } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "validation_failed");
    assert.deepEqual(result.error.issues, [{ code: "age_span_exceeded" }]);
    assert.equal(result.error.safeMessage.includes("SQL"), false);
  }
});
