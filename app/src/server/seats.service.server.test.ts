import assert from "node:assert/strict";
import test from "node:test";
import type { MemberSeatDetailDTO, MemberSeatListDTO } from "../seats.contract.ts";
import type { SeatRepository, SeatServiceDependencies } from "./seats.contract.server.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import { SeatRepositoryError } from "./seats.repository.server.ts";
import { createSeatService } from "./seats.service.server.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const seatId = "22222222-2222-4222-8222-222222222222";
const invitationId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const principal = Object.freeze({ userId, emailNormalized: "member@example.test", emailVerified: true,
  staffRoles: new Set<"admin" | "host" | "restaurant">(),
  admission: { state: "activated" as const, authUserId: userId, emailNormalized: "member@example.test" },
  assignedTableIds: new Set<string>(), assignedVenueIds: new Set<string>() });
const seat = Object.freeze<MemberSeatDetailDTO>({
  seatId, state: "confirmed", participationState: "current", createdAt: "2026-11-01T10:00:00.000Z",
  table: { tableId: invitationId, title: "Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00",
    timeZone: "America/New_York", startsAt: "2026-11-20T00:00:00.000Z", neighborhood: "Inman Park",
    itinerary: [
      { role: "drinks", venueName: "Juniper", venueAddress: "1 Main St", minutesFromStart: 0, publicNotes: "Meet inside." },
      { role: "dinner", venueName: "Olive", venueAddress: "2 Main St", minutesFromStart: 45, publicNotes: "" },
      { role: "dessert", venueName: "Fig", venueAddress: "3 Main St", minutesFromStart: 120, publicNotes: "" },
    ] },
  payment: { state: "paid", amountCents: 2500, currency: "USD", paidAt: "2026-11-01T10:00:00.000Z",
    receipt: { state: "unavailable", url: null } },
  refund: null, calendar: { available: true, href: `/api/me/seats/${seatId}/calendar.ics` },
  cancellation: { status: "none", history: [] },
});
const list = Object.freeze<MemberSeatListDTO>({ items: [seat], pendingCheckouts: [{ attemptId, invitationId,
  state: "unknown", nextAction: "check_status", createdAt: "2026-11-02T10:00:00.000Z", holdUntil: "2026-11-02T10:30:00.000Z",
  price: { amountCents: 2500, currency: "USD" },
  payment: { state: "unknown", amountCents: 2500, currency: "USD", paidAt: null }, refund: null,
  table: { tableId: invitationId, title: "Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00",
    timeZone: "America/New_York", startsAt: "2026-11-20T00:00:00.000Z", neighborhood: "Inman Park" } }], nextCursor: null });

function setup(options: Readonly<{ repository?: Partial<SeatRepository>; resolverFailure?: boolean; principal?: ServerVerifiedPrincipal | null; now?: number }> = {}) {
  const calls: string[] = [];
  const repository: SeatRepository = {
    async listMySeats(actor, cursor, limit) { calls.push(`list:${actor}:${cursor?.seatId ?? "first"}:${limit}`); return list; },
    async readMySeat(actor, id) { calls.push(`read:${actor}:${id}`); return seat; },
    async readInvitationSeatStatus(id) { calls.push(`status:${id}`); return { status: "confirmed_seat" }; },
    ...options.repository,
  };
  const deps: SeatServiceDependencies = { repository, now: () => options.now ?? Date.parse("2026-11-10T00:00:00.000Z"),
    async resolvePrincipal(token) { calls.push(`resolve:${token}`); if (options.resolverFailure) throw new Error("offline"); return options.principal === undefined ? principal : options.principal; } };
  return { service: createSeatService(deps), calls };
}

test("lists only for an admitted member and preserves pending checkout as unresolved", async () => {
  const { service, calls } = setup();
  const result = await service.list({ accessToken: "cookie-token", limit: 10 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.items[0]?.payment.state, "paid");
  assert.equal(result.value.pendingCheckouts[0]?.state, "unknown");
  assert.equal(result.value.pendingCheckouts[0]?.nextAction, "check_status");
  assert.deepEqual(calls, [`resolve:cookie-token`, `list:${userId}:first:10`]);
});

test("late paid checkout remains a distinct refund-pending item with support action, never retry", async () => {
  const refundList = Object.freeze<MemberSeatListDTO>({ items: [], pendingCheckouts: [{ attemptId, invitationId,
    state: "refund_pending", nextAction: "contact_support", createdAt: "2026-11-02T10:00:00.000Z", holdUntil: "2026-11-02T10:30:00.000Z",
    price: { amountCents: 2500, currency: "USD" }, payment: { state: "refund_pending", amountCents: 2500, currency: "USD", paidAt: "2026-11-02T10:31:00.000Z" },
    refund: { state: "open", amountCents: 2500, currency: "USD" },
    table: { tableId: invitationId, title: "Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00",
      timeZone: "America/New_York", startsAt: "2026-11-20T00:00:00.000Z", neighborhood: "Inman Park" } }], nextCursor: null });
  const { service } = setup({ repository: { async listMySeats() { return refundList; } } });
  const result = await service.list({ accessToken: "cookie" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.pendingCheckouts[0]?.state, "refund_pending");
  assert.equal(result.value.pendingCheckouts[0]?.nextAction, "contact_support");
  assert.equal(result.value.pendingCheckouts[0]?.payment.paidAt, "2026-11-02T10:31:00.000Z");
  assert.equal(result.value.pendingCheckouts[0]?.refund?.state, "open");
});

test("rejects malformed cursors and limits before repository access", async () => {
  const { service, calls } = setup();
  assert.equal((await service.list({ accessToken: "cookie", cursor: "../../etc/passwd" })).ok, false);
  assert.equal((await service.list({ accessToken: "cookie", limit: 51 })).ok, false);
  assert.deepEqual(calls, []);
});

test("cross-member detail is repository owner-scoped and returns not-found without leaking", async () => {
  const { service, calls } = setup({ repository: { async readMySeat(actor, id) { calls.push(`read:${actor}:${id}`); throw new SeatRepositoryError("not_found"); } } });
  const result = await service.read({ accessToken: "cookie", seatId });
  assert.deepEqual(result, { ok: false, error: { code: "not_found", safeMessage: "This Seat could not be found.", retryable: false } });
  assert.deepEqual(calls, [`resolve:cookie`, `read:${userId}:${seatId}`]);
});

test("creates a safe calendar with the owner Seat and public itinerary only", async () => {
  const { service } = setup();
  const result = await service.calendar({ accessToken: "cookie", seatId });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.value, /BEGIN:VCALENDAR/);
  assert.match(result.value, /DTSTART:20261120T000000Z/);
  assert.match(result.value, /Juniper/);
  assert.doesNotMatch(result.value, /hostNotes|paymentIntent|provider_payment/i);
});

test("cancelled Seats have no calendar export", async () => {
  const cancelled = Object.freeze<MemberSeatDetailDTO>({ ...seat, state: "cancelled", participationState: "past",
    calendar: { available: false, href: null } });
  const { service } = setup({ repository: { async readMySeat() { return cancelled; } } });
  assert.deepEqual(await service.calendar({ accessToken: "cookie", seatId }), { ok: false, error: {
    code: "conflict", safeMessage: "You can add upcoming seats to your calendar.", retryable: false } });
});

test("unauthenticated, unadmitted and resolver outage fail before Seat reads", async () => {
  const noSession = setup();
  assert.equal((await noSession.service.list({})).ok, false);
  const noAdmission = setup({ principal: { ...principal, admission: { state: "invited", authUserId: userId, emailNormalized: principal.emailNormalized } } });
  const denied = await noAdmission.service.read({ accessToken: "cookie", seatId });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "forbidden");
  const outage = setup({ resolverFailure: true });
  const unavailable = await outage.service.list({ accessToken: "cookie" });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) assert.equal(unavailable.error.retryable, true);
  assert.equal(noAdmission.calls.some((call) => call.startsWith("read:")), false);
  assert.equal(outage.calls.some((call) => call.startsWith("list:")), false);
});

test("SeatStatusReader returns unknown on malformed ID or repository outage, never no-seat", async () => {
  const { service } = setup({ repository: { async readInvitationSeatStatus() { throw new Error("db down"); } } });
  assert.deepEqual(await service.readInvitationSeatStatus({ invitationId: "bad" }), { status: "unknown" });
  assert.deepEqual(await service.readInvitationSeatStatus({ invitationId }), { status: "unknown" });
  const ready = setup();
  assert.deepEqual(await ready.service.readInvitationSeatStatus({ invitationId }), { status: "confirmed_seat" });
});
