import assert from "node:assert/strict";
import test from "node:test";
import type { SeatCancellationService } from "./seat-cancellation.contract.server.ts";
import { createSeatCancellationHttpHandlers } from "./seat-cancellation.http.server.ts";

const seatId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const calls: Array<{ method: string; input: unknown }> = [];
function fakeService(): SeatCancellationService {
  return {
    async listOwnCancellationRequests(input) { calls.push({ method: "member-read", input }); return { ok: true, value: { seatState: "confirmed", items: [], nextCursor: null, requestAvailability: { canRequest: true, reason: "available" } } }; },
    async requestCancellation(input) { calls.push({ method: "member-request", input }); return { ok: true, value: { requestId, seatId, state: "pending", version: 1, requestedAt: "2026-11-12T10:00:00Z", decidedAt: null, memberReason: null, memberSafeReason: null, refundCents: null } }; },
    async listAdminCancellations(input) { calls.push({ method: "admin-list", input }); return { ok: true, value: { items: [], nextCursor: null } }; },
    async readAdminCancellation(input) { calls.push({ method: "admin-read", input }); return { ok: false, error: { code: "not_found", safeMessage: "Not found.", retryable: false } }; },
    async decideCancellation(input) { calls.push({ method: "decision", input }); return { ok: true, value: {} as never }; },
  };
}
function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:8085${path}`, { method, headers: {
    ...(body === undefined ? {} : { "content-type": "application/json", "origin": "http://127.0.0.1:8085" }),
    cookie: "fw_session=access:test", ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(response: Response): Promise<Record<string, unknown>> { return await response.json() as Record<string, unknown>; }

test("member history and request use cookie principal, same-origin writes, private no-store DTO envelope", async () => {
  calls.length = 0; const handlers = createSeatCancellationHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const read = await handlers.readMemberHistory(request("GET", `/api/me/seats/${seatId}/cancellation-requests`), seatId);
  assert.equal(read.status, 200); assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal((await json(read)).ok, true);
  const created = await handlers.requestMemberCancellation(request("POST", "/", { operationId, memberReason: "timing" }), seatId);
  assert.equal(created.status, 200);
  assert.equal(calls[1]?.method, "member-request");
  assert.deepEqual((calls[1]?.input as { request: unknown }).request, { operationId, memberReason: "timing" });
});

test("writes reject wrong origin and unknown keys before service access", async () => {
  calls.length = 0; const handlers = createSeatCancellationHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const wrongOrigin = await handlers.requestMemberCancellation(request("POST", "/", { operationId }, { origin: "https://attacker.test" }), seatId);
  assert.equal(wrongOrigin.status, 403);
  const unknown = await handlers.decideAdminRequest(request("POST", "/", { operationId, expectedVersion: 1,
    decision: "deny", refundCents: 0, memberSafeReason: "Reviewed.", extra: true }), requestId);
  assert.equal(unknown.status, 400);
  assert.equal(calls.length, 0);
});

test("admin queue validates cursor/limit and translates safe not-found response", async () => {
  calls.length = 0; const handlers = createSeatCancellationHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const page = await handlers.listAdminQueue(request("GET", "/api/admin/cancellations?limit=10"));
  assert.equal(page.status, 200);
  assert.equal((calls[0]?.input as { limit: number }).limit, 10);
  const invalid = await handlers.listAdminQueue(request("GET", "/api/admin/cancellations?limit=100"));
  assert.equal(invalid.status, 400);
  const detail = await handlers.readAdminDetail(request("GET", "/"), requestId);
  assert.equal(detail.status, 404);
  const body = await json(detail);
  assert.equal((body.error as Record<string, unknown>).code, "not_found");
});
