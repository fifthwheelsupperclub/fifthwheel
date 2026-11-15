import assert from "node:assert/strict";
import { test } from "node:test";
import { createTablesRepository, TablesRepositoryError } from "./tables.repository.server.ts";

const tableId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const date = "2099-06-03";
function repository(responses: unknown[], seen: { url: string; body: unknown; headers: Headers }[]) {
  return createTablesRepository({ url: "http://127.0.0.1:57421", publishableKey: "publishable-key", secretKey: "server-secret-key", fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: new URL(String(input)).pathname, body: JSON.parse(String(init?.body ?? "null")), headers });
    const value = responses.shift();
    if (value instanceof Response) return value;
    return Response.json(value);
  } });
}

test("published Table repository strips provider/private fields and preserves safe public contract", async () => {
  const seen: { url: string; body: unknown; headers: Headers }[] = [];
  const repo = repository([{ items: [{ tableId, title: "June Table", localDate: date, startLocalTime: "19:00", neighborhood: "Inman Park",
    seatPriceCents: 2500, currency: "USD", ownRequest: null, sourceRecordId: "private-source", hostNotes: "private" }], nextCursor: null }], seen);
  const result = await repo.listPublishedTables("actor-from-session", { limit: 25 });
  assert.deepEqual(result, { items: [{ tableId, title: "June Table", localDate: date, startLocalTime: "19:00", neighborhood: "Inman Park",
    seatPriceCents: 2500, currency: "USD", ownRequest: null }], nextCursor: null });
  assert.equal(seen[0]?.url, "/rest/v1/rpc/list_published_tables");
  assert.deepEqual(seen[0]?.body, { p_auth_user_id: "actor-from-session", p_date_from: null, p_date_to: null,
    p_neighborhood: null, p_cursor: null, p_limit: 25 });
  assert.equal(seen[0]?.headers.get("authorization"), "Bearer server-secret-key");
});

test("full detail removes internal venue IDs and host notes; minimal preview remains minimal", async () => {
  const seen: { url: string; body: unknown; headers: Headers }[] = [];
  const detail = { view: "member", table: { tableId, title: "June Table", localDate: date, startLocalTime: "19:00", neighborhood: "Inman Park",
    seatPriceCents: 2500, currency: "USD", ownRequest: null, hostNotes: "staff-only", sourceRecordId: "private-source", stops: [
      { role: "drinks", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", venueName: "Bar", venueAddress: "1 Test Way", minutesFromStart: 0, publicNotes: "Public" },
      { role: "dinner", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", venueName: "Kitchen", venueAddress: "2 Test Way", minutesFromStart: 60, publicNotes: "Public" },
      { role: "dessert", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", venueName: "Cafe", venueAddress: "3 Test Way", minutesFromStart: 120, publicNotes: "Public" },
    ] } };
  const preview = { view: "preview", table: { tableId, title: "June Table", localDate: date, neighborhood: "Inman Park", leakedStops: [] } };
  const repo = repository([detail, preview], seen);
  const member = await repo.readPublishedTable("actor-from-session", tableId);
  assert.equal(member.view, "member");
  if (member.view === "member") {
    assert.equal(member.table.seatPriceCents, 2500);
    assert.equal(member.table.currency, "USD");
    assert.equal("hostNotes" in member.table, false);
    assert.equal("venueId" in member.table.stops[0]!, false);
  }
  const publicPreview = await repo.readPublishedPreview(tableId);
  assert.deepEqual(publicPreview, { tableId, title: "June Table", localDate: date, neighborhood: "Inman Park" });
  assert.deepEqual(seen.map((call) => call.url), ["/rest/v1/rpc/read_published_table_detail", "/rest/v1/rpc/read_published_table_preview"]);
});

test("request history keeps captured Table summary and explicit availability state", async () => {
  const seen: { url: string; body: unknown; headers: Headers }[] = [];
  const repo = repository([{ items: [{ requestId, tableId, state: "declined", declineReason: "Group is full", createdAt: "2026-11-13T12:00:00Z",
    updatedAt: "2026-11-13T12:00:00Z", table: { tableId, title: "Captured title", localDate: date, startLocalTime: "19:00", neighborhood: "Inman Park", isCurrentlyPublished: false }, tableInvitation: null }], nextCursor: null }], seen);
  const history = await repo.listMemberRequests("actor-from-session", { limit: 25 });
  assert.equal(history.items[0]?.table.title, "Captured title");
  assert.equal(history.items[0]?.table.isCurrentlyPublished, false);
  assert.deepEqual(history.items[0]?.declineReason, "Group is full");
  assert.equal(seen[0]?.body && (seen[0]?.body as Record<string, unknown>).p_auth_user_id, "actor-from-session");
});

test("database domain errors map to safe repository codes without exposing server text", async () => {
  const seen: { url: string; body: unknown; headers: Headers }[] = [];
  const response = Response.json({ code: "P0001", message: "profile_incomplete", details: "private database detail", hint: "secret" }, { status: 400 });
  const repo = repository([response], seen);
  await assert.rejects(() => repo.createRequest("actor-from-session", tableId, requestId), (error: unknown) => {
    assert.ok(error instanceof TablesRepositoryError);
    assert.equal(error.code, "profile_incomplete");
    assert.equal(error.message.includes("private database detail"), false);
    return true;
  });
});
