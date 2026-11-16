import assert from "node:assert/strict";
import { test } from "node:test";
import type { TableRequestHistoryInput, TablesService } from "./tables.contract.server.ts";
import { createTablesHttpHandlers } from "./tables.http.server.ts";

const calls: TableRequestHistoryInput[] = [];
const service: TablesService = { async listRequests(input) { calls.push(input); return { ok: true, value: { items: [], nextCursor: null } }; } };
const handlers = createTablesHttpHandlers(() => service, "https://app.example.test");

test("placement history rejects unknown or duplicate query keys and responds no-store", async () => {
  calls.length = 0;
  for (const query of ["?foo=1", "?limit=1&limit=2", "?limit=0", "?cursor=bad"]) {
    assert.equal((await handlers.listRequests(new Request(`https://app.example.test/api/me/requests${query}`))).status, 400);
  }
  assert.equal(calls.length, 0);
  const ok = await handlers.listRequests(new Request("https://app.example.test/api/me/requests?limit=20"));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.equal(calls[0]?.limit, 20);
});
