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
  const response = Response.json({ code: "P0001", message: "invalid_input", details: "private database detail", hint: "secret" }, { status: 400 });
  const repo = repository([response], seen);
  await assert.rejects(() => repo.listMemberRequests("actor-from-session", { limit: 25 }), (error: unknown) => {
    assert.ok(error instanceof TablesRepositoryError);
    assert.equal(error.code, "invalid_input");
    assert.equal(error.message.includes("private database detail"), false);
    return true;
  });
});
