import assert from "node:assert/strict";
import test from "node:test";
import { createSeatHttpHandlers } from "./seats.http.server.ts";
import type { SeatService } from "./seats.contract.server.ts";

const seatId = "11111111-1111-4111-8111-111111111111";
const service = (overrides: Partial<SeatService> = {}): SeatService => ({
  list: async () => ({ ok: true, value: { items: [], nextCursor: null } as never }),
  read: async () => ({ ok: false, error: { code: "not_found", safeMessage: "This Seat could not be found.", retryable: false } }),
  calendar: async () => ({ ok: true, value: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" }),
  readInvitationSeatStatus: async () => { throw new Error("unused"); },
  ...overrides,
});
const req = (path: string) => new Request(`http://127.0.0.1:8086${path}`, { headers: { cookie: "fw_access_token=t" } });

test("list returns an ok envelope and rejects unknown/duplicate query keys", async () => {
  const h = createSeatHttpHandlers(() => service());
  const ok = await h.list(req("/api/me/seats?limit=20"));
  assert.equal(ok.status, 200); assert.equal((await ok.json()).ok, true);
  assert.equal((await h.list(req("/api/me/seats?foo=1"))).status, 400);
  assert.equal((await h.list(req("/api/me/seats?limit=0"))).status, 400);
});
test("detail maps not_found to 404 and rejects malformed ids", async () => {
  const h = createSeatHttpHandlers(() => service());
  assert.equal((await h.read(req("/x"), seatId)).status, 404);
  assert.equal((await h.read(req("/x"), "nope")).status, 400);
});
test("calendar serves text/calendar as an attachment and never throws to the client", async () => {
  const h = createSeatHttpHandlers(() => service());
  const ok = await h.calendar(req("/x"), seatId);
  assert.match(ok.headers.get("content-type") ?? "", /text\/calendar/);
  const boom = createSeatHttpHandlers(() => service({ calendar: async () => { throw new Error("db"); } }));
  assert.equal((await boom.calendar(req("/x"), seatId)).status, 503);
});
