import assert from "node:assert/strict";
import test from "node:test";
import type { AdminCancellationDetailDTO, AdminCancellationQueueDTO, MemberCancellationHistoryDTO, MemberCancellationRequestDTO } from "../seat-cancellation.contract.ts";
import type { ServerVerifiedPrincipal, StaffRole } from "./authorization.server.ts";
import type { SeatCancellationRepository } from "./seat-cancellation.contract.server.ts";
import { CancellationRepositoryError } from "./seat-cancellation.repository.server.ts";
import { createSeatCancellationService } from "./seat-cancellation.service.server.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const seatId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const actor: ServerVerifiedPrincipal = Object.freeze({ userId, emailNormalized: "member@example.test", emailVerified: true,
  staffRoles: new Set<StaffRole>(), admission: { state: "activated" as const, authUserId: userId, emailNormalized: "member@example.test" },
  assignedTableIds: new Set<string>(), assignedVenueIds: new Set<string>() });
const history: MemberCancellationHistoryDTO = Object.freeze({ seatState: "cancellation_requested", items: [], nextCursor: null,
  requestAvailability: { canRequest: true, reason: "available" as const } });
const request: MemberCancellationRequestDTO = Object.freeze({ requestId, seatId, state: "pending", version: 1,
  requestedAt: "2026-11-12T10:00:00.000Z", decidedAt: null, memberReason: null, memberSafeReason: null, refundCents: null });
const adminDetail: AdminCancellationDetailDTO = Object.freeze({ request, member: { guestId: userId, displayName: "Alex Guest" },
  table: { tableId: seatId, title: "Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00" },
  seat: { seatId, state: "cancellation_requested", paidAt: "2026-11-11T10:00:00.000Z", amountCents: 2500, refundAvailableCents: 2500 },
  refundBalance: { paidCents: 2500, refundCommittedCents: 0, refundAvailableCents: 2500 } });

function principal(overrides: Partial<ServerVerifiedPrincipal> = {}): ServerVerifiedPrincipal { return { ...actor, ...overrides }; }
function setup(options: Readonly<{ repository?: Partial<SeatCancellationRepository>; actor?: ServerVerifiedPrincipal | null; resolverThrows?: boolean }> = {}) {
  const calls: string[] = [];
  const repository: SeatCancellationRepository = {
    async listOwnCancellationRequests(user, seat) { calls.push(`member-read:${user}:${seat}`); return history; },
    async requestCancellation(user, seat, body) { calls.push(`member-request:${user}:${seat}:${body.operationId}:${body.memberReason}`); return request; },
    async listAdminCancellations(user, cursor, limit) { calls.push(`admin-list:${user}:${cursor?.requestId ?? "none"}:${limit}`); return { items: [], nextCursor: null }; },
    async readAdminCancellation(user, id) { calls.push(`admin-read:${user}:${id}`); return adminDetail; },
    async decideCancellation(user, id, body) { calls.push(`decision:${user}:${id}:${body.decision}:${body.refundCents}`); return adminDetail; },
    ...options.repository,
  };
  const service = createSeatCancellationService({ repository, async resolvePrincipal(token) {
    calls.push(`resolve:${token ?? "none"}`); if (options.resolverThrows) throw new Error("db offline"); return options.actor === undefined ? actor : options.actor;
  } });
  return { service, calls };
}

test("member request requires admitted member, normalizes optional reason, and returns state", async () => {
  const { service, calls } = setup();
  const result = await service.requestCancellation({ accessToken: "cookie", seatId, request: { operationId, memberReason: "  schedule conflict  " } });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [`resolve:cookie`, `member-request:${userId}:${seatId}:${operationId}:schedule conflict`]);
});

test("member history preserves terminal Seat state while a cancellation request is pending", async () => {
  const completedHistory: MemberCancellationHistoryDTO = Object.freeze({ ...history, seatState: "completed",
    items: [request], requestAvailability: { canRequest: false, reason: "request_pending" as const } });
  const { service } = setup({ repository: { async listOwnCancellationRequests() { return completedHistory; } } });
  const result = await service.listOwnCancellationRequests({ accessToken: "cookie", seatId });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.items[0]?.state, "pending");
    assert.equal(result.value.seatState, "completed");
    assert.equal(result.value.requestAvailability.reason, "request_pending");
  }
});

test("request/history reject malformed input before auth; admin routes require admin", async () => {
  const { service, calls } = setup();
  assert.equal((await service.requestCancellation({ accessToken: "cookie", seatId: "no", request: { operationId } })).ok, false);
  assert.equal((await service.requestCancellation({ accessToken: "cookie", seatId, request: { operationId, memberReason: "   " } })).ok, false);
  assert.equal((await service.listAdminCancellations({ accessToken: "cookie", limit: 51 })).ok, false);
  const memberAsAdmin = setup();
  const result = await memberAsAdmin.service.listAdminCancellations({ accessToken: "cookie" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "forbidden");
  assert.deepEqual(calls, []);
});

test("request and decision service map repository conflicts to safe domain errors", async () => {
  const pending = setup({ repository: { async requestCancellation() { throw new CancellationRepositoryError("request_pending"); } } });
  const pendingResult = await pending.service.requestCancellation({ accessToken: "cookie", seatId, request: { operationId } });
  assert.equal(pendingResult.ok, false);
  if (!pendingResult.ok) assert.equal(pendingResult.error.code, "request_pending");
  const stale = setup({ actor: principal({ staffRoles: new Set(["admin"]) }), repository: { async decideCancellation() { throw new CancellationRepositoryError("stale_version"); } } });
  const staleResult = await stale.service.decideCancellation({ accessToken: "cookie", requestId, request: { operationId,
    expectedVersion: 1, decision: "deny", refundCents: 0, memberSafeReason: "We reviewed your request." } });
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error.code, "stale_version");
});

test("admin list pagination cursor is server-decoded and re-encoded from last item", async () => {
  const admin = principal({ staffRoles: new Set(["admin"]) });
  const first = { ...adminDetail, request: { ...request, requestedAt: "2026-11-12T10:00:00.000Z" } };
  const repo = { async listAdminCancellations(_actor: string, cursor: { requestedAt: string; requestId: string } | null, limit: number): Promise<AdminCancellationQueueDTO> {
    assert.equal(cursor, null); assert.equal(limit, 1); return { items: [first], nextCursor: "more" };
  } };
  const { service } = setup({ actor: admin, repository: repo });
  const result = await service.listAdminCancellations({ accessToken: "cookie", limit: 1 });
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.value.nextCursor ?? "", /^[A-Za-z0-9_-]+$/);
  assert.equal((await service.listAdminCancellations({ accessToken: "cookie", cursor: "%%%" })).ok, false);
});

test("resolver outage is retryable while invalid session stays unauthenticated", async () => {
  const outage = setup({ resolverThrows: true });
  const result = await outage.service.listOwnCancellationRequests({ accessToken: "cookie", seatId });
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.error.code, "temporarily_unavailable"); assert.equal(result.error.retryable, true); }
  const invalid = setup({ actor: null });
  const denied = await invalid.service.listOwnCancellationRequests({ accessToken: "cookie", seatId });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "unauthenticated");
  assert.equal(outage.calls.some((call) => call.startsWith("member-read:")), false);
});
