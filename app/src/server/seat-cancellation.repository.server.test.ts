import assert from "node:assert/strict";
import test from "node:test";
import { createSeatCancellationRepository, CancellationRepositoryError } from "./seat-cancellation.repository.server.ts";

const actor = "11111111-1111-4111-8111-111111111111";
const seat = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
const op = "44444444-4444-4444-8444-444444444444";
const table = "55555555-5555-4555-8555-555555555555";
const pending = { requestId: request, seatId: seat, state: "pending", version: 1, requestedAt: "2026-11-12T10:00:00Z",
  decidedAt: null, memberReason: null, memberSafeReason: null, refundCents: null };
const adminItem = { request: pending, member: { guestId: actor, displayName: "Alex Guest" },
  table: { tableId: table, title: "Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00" },
  seat: { seatId: seat, state: "cancellation_requested", paidAt: "2026-11-11T10:00:00Z", amountCents: 2500, refundAvailableCents: 2500 } };
function ok(body: unknown): Response { return Response.json(body); }

test("repository uses exact owner RPC inputs and parses member availability", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const repository = createSeatCancellationRepository({ url: "http://127.0.0.1:57421", secretKey: "local-secret", fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push({ path: url.pathname, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return ok({ seatState: "completed", items: [pending], nextCursor: null, requestAvailability: { canRequest: false, reason: "request_pending" } });
  } });
  const result = await repository.listOwnCancellationRequests(actor, seat);
  assert.equal(result.items[0]?.state, "pending");
  assert.equal(result.seatState, "completed", "terminal Table state is returned even when request review is still pending");
  assert.deepEqual(result.requestAvailability, { canRequest: false, reason: "request_pending" });
  assert.deepEqual(calls[0], { path: "/rest/v1/rpc/read_my_seat_cancellation_requests", body: { p_actor: actor, p_seat_id: seat } });
});

test("repository sends idempotent member request and admin decision contracts", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const repository = createSeatCancellationRepository({ url: "http://127.0.0.1:57421", secretKey: "local-secret", fetch: async (input, init) => {
    const url = new URL(String(input)); const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path: url.pathname, body });
    if (url.pathname.endsWith("/request_seat_cancellation")) return ok({ ...pending, memberReason: "schedule conflict" });
    return ok({ ...adminItem, request: { ...pending, state: "approved", version: 2, decidedAt: "2026-11-12T11:00:00Z",
      memberSafeReason: "Thanks for letting us know.", refundCents: 500 },
      seat: { ...adminItem.seat, state: "cancelled", refundAvailableCents: 2000 },
      refundBalance: { paidCents: 2500, refundCommittedCents: 500, refundAvailableCents: 2000 } });
  } });
  const created = await repository.requestCancellation(actor, seat, { operationId: op, memberReason: "schedule conflict" });
  assert.equal(created.memberReason, "schedule conflict");
  const detail = await repository.decideCancellation(actor, request, { operationId: op, expectedVersion: 1, decision: "approve", refundCents: 500, memberSafeReason: "Thanks for letting us know." });
  assert.equal(detail.refundBalance.refundAvailableCents, 2000);
  assert.deepEqual(calls.map((call) => call.path), ["/rest/v1/rpc/request_seat_cancellation", "/rest/v1/rpc/decide_seat_cancellation"]);
  assert.equal(calls[0]?.body.p_member_reason, "schedule conflict");
  assert.equal(calls[1]?.body.p_refund_cents, 500);
});

test("cross-member IDs remain not-found and malformed DTOs fail closed", async () => {
  const notFound = createSeatCancellationRepository({ url: "http://127.0.0.1:57421", secretKey: "local-secret", fetch: async () =>
    new Response(JSON.stringify({ message: "not_found" }), { status: 404 }) });
  await assert.rejects(notFound.readAdminCancellation(actor, request), (error: unknown) => error instanceof CancellationRepositoryError && error.code === "not_found");
  const malformed = createSeatCancellationRepository({ url: "http://127.0.0.1:57421", secretKey: "local-secret", fetch: async () => ok({ ...adminItem, refundBalance: { paidCents: 2500, refundCommittedCents: 0, refundAvailableCents: 2400 } }) });
  await assert.rejects(malformed.readAdminCancellation(actor, request), (error: unknown) => error instanceof CancellationRepositoryError && error.code === "response_invalid");
});
