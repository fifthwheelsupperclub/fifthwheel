import assert from "node:assert/strict";
import test from "node:test";
import { createSeatRepository, SeatRepositoryError } from "./seats.repository.server.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const seatId = "22222222-2222-4222-8222-222222222222";
const tableId = "33333333-3333-4333-8333-333333333333";
const instant = "2026-11-19T23:00:00.000Z";
function summary() {
  return { seatId, state: "confirmed", participationState: "current", createdAt: instant,
    table: { tableId, title: "Table", localDate: "2026-11-19", startLocalTime: "18:00", timeZone: "America/New_York", startsAt: instant, neighborhood: "Inman Park" },
    payment: { state: "paid", amountCents: 2500, currency: "USD", paidAt: instant }, refund: null,
    calendar: { available: true, href: `/api/me/seats/${seatId}/calendar.ics` } };
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function setup(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const repository = createSeatRepository({ url: "http://127.0.0.1:57421", secretKey: "local-secret", fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init: init ?? {} }); return handler(url, init ?? {});
  } });
  return { repository, calls };
}

test("Seat list calls only the owner-scoped RPC with stable cursor and bounded limit", async () => {
  const { repository, calls } = setup(async () => response({ items: [summary()], pendingCheckouts: [], nextCursor: null }));
  const result = await repository.listMySeats(userId, { createdAt: instant, seatId }, 17);
  assert.equal(result.items[0]?.payment.state, "paid");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url.pathname, "/rest/v1/rpc/read_my_seats");
  const args = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  assert.equal(args.p_actor, userId);
  assert.equal(args.p_cursor_created_at, instant);
  assert.equal(args.p_cursor_seat_id, seatId);
  assert.equal(args.p_limit, 17);
});

test("pending checkout stays unknown with an explicit status action, never a repayment claim", async () => {
  const pending = { attemptId: "44444444-4444-4444-8444-444444444444", invitationId: tableId, state: "unknown", nextAction: "check_status",
    createdAt: instant, holdUntil: instant, price: { amountCents: 2500, currency: "USD" },
    payment: { state: "unknown", amountCents: 2500, currency: "USD", paidAt: null }, refund: null, table: summary().table };
  const { repository } = setup(async () => response({ items: [], pendingCheckouts: [pending], nextCursor: null }));
  const result = await repository.listMySeats(userId, null, 20);
  assert.equal(result.pendingCheckouts[0]?.state, "unknown");
  assert.equal(result.pendingCheckouts[0]?.nextAction, "check_status");
});

test("late verified charge with open refund obligation stays visibly refund-pending with no retry", async () => {
  const pending = { attemptId: "44444444-4444-4444-8444-444444444444", invitationId: tableId, state: "refund_pending", nextAction: "contact_support",
    createdAt: instant, holdUntil: instant, price: { amountCents: 2500, currency: "USD" },
    payment: { state: "refund_pending", amountCents: 2500, currency: "USD", paidAt: instant },
    refund: { state: "open", amountCents: 2500, currency: "USD" }, table: summary().table };
  const { repository } = setup(async () => response({ items: [], pendingCheckouts: [pending], nextCursor: null }));
  const item = (await repository.listMySeats(userId, null, 20)).pendingCheckouts[0];
  assert.equal(item?.state, "refund_pending");
  assert.equal(item?.payment.state, "refund_pending");
  assert.equal(item?.nextAction, "contact_support");
  assert.equal(item?.refund?.amountCents, 2500);
});

test("detail enforces safe cancellation history and receipt URL allowlist", async () => {
  const detail = { ...summary(), table: { ...summary().table, itinerary: [
    { role: "drinks", venueName: "A", venueAddress: "1 Main", minutesFromStart: 0, publicNotes: "" },
    { role: "dinner", venueName: "B", venueAddress: "2 Main", minutesFromStart: 45, publicNotes: "" },
    { role: "dessert", venueName: "C", venueAddress: "3 Main", minutesFromStart: 120, publicNotes: "" },
  ] }, payment: { ...summary().payment, receipt: { state: "available", url: "https://pay.stripe.com/receipts/test" } },
    cancellation: { status: "denied", history: [{ requestId: "55555555-5555-4555-8555-555555555555", status: "denied",
      requestedAt: instant, decidedAt: instant, safeReason: "Your Seat remains active." }] } };
  const { repository } = setup(async () => response(detail));
  const result = await repository.readMySeat(userId, seatId);
  assert.equal(result.cancellation.status, "denied");
  assert.equal(result.payment.receipt.state, "available");
  const invalid = setup(async () => response({ ...detail, payment: { ...detail.payment, receipt: { state: "available", url: "https://evil.test/receipt" } } }));
  await assert.rejects(invalid.repository.readMySeat(userId, seatId), (error: unknown) => error instanceof SeatRepositoryError && error.code === "response_invalid");
});

test("cross-member seat IDs map to the same not-found error and SeatStatusReader preserves unknown", async () => {
  const { repository } = setup(async (url) => {
    if (url.pathname.endsWith("/read_my_seat")) return response({ message: "not_found" }, 404);
    return response({ status: "unknown" });
  });
  await assert.rejects(repository.readMySeat(userId, seatId), (error: unknown) => error instanceof SeatRepositoryError && error.code === "not_found");
  assert.deepEqual(await repository.readInvitationSeatStatus(tableId), { status: "unknown" });
});

test("provider/network details never escape as response DTOs", async () => {
  const { repository } = setup(async () => { throw new Error("secret role key should not escape"); });
  await assert.rejects(repository.readMySeat(userId, seatId), (error: unknown) => error instanceof SeatRepositoryError && error.code === "request_failed");
});
