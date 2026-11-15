import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CreateTableRequestInput, TableDetailInput, TableListInput, TableRequestHistoryInput,
  TablesService, WithdrawTableRequestInput,
} from "./tables.contract.server.ts";
import { createTablesHttpHandlers } from "./tables.http.server.ts";

const tableId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature";
const calls: { method: string; data: unknown }[] = [];
function fakeService(): TablesService {
  return {
    async listTables(input: TableListInput) { calls.push({ method: "list", data: input }); return { ok: true, value: { items: [], nextCursor: null } }; },
    async readTable(input: TableDetailInput) { calls.push({ method: "read", data: input }); return { ok: true, value: { view: "preview", table: { tableId, title: "Preview", localDate: "2027-01-12", neighborhood: "Inman Park" } } }; },
    async createRequest(input: CreateTableRequestInput) { calls.push({ method: "create", data: input }); return { ok: true, value: { requestId, tableId, state: "pending", declineReason: null, createdAt: "2026-11-13T12:00:00Z", updatedAt: "2026-11-13T12:00:00Z" } }; },
    async listRequests(input: TableRequestHistoryInput) { calls.push({ method: "history", data: input }); return { ok: true, value: { items: [], nextCursor: null } }; },
    async withdrawRequest(input: WithdrawTableRequestInput) { calls.push({ method: "withdraw", data: input }); return { ok: true, value: { requestId, tableId, state: "withdrawn", declineReason: null, createdAt: "2026-11-13T12:00:00Z", updatedAt: "2026-11-13T12:30:00Z" } }; },
  } as unknown as TablesService;
}
function responseBody(response: Response) { return response.json() as Promise<Record<string, any>>; }

test("Table list validates duplicate/unknown filters and responds no-store", async () => {
  calls.length = 0;
  const handlers = createTablesHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const invalid = await handlers.listTables(new Request("http://127.0.0.1:8085/api/tables?limit=10&limit=20"));
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
  const result = await handlers.listTables(new Request("http://127.0.0.1:8085/api/tables?dateFrom=2027-01-01&limit=10", { headers: { cookie: `fw_access_token=${token}` } }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal((await responseBody(result)).ok, true);
  assert.deepEqual(calls[0]?.data, { accessToken: token, dateFrom: "2027-01-01", limit: 10 });
});

test("request mutations fail closed on wrong origin or extra body fields", async () => {
  calls.length = 0;
  const handlers = createTablesHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const wrongOrigin = await handlers.createRequest(new Request(`http://127.0.0.1:8085/api/tables/${tableId}/requests`, {
    method: "POST", headers: { origin: "http://localhost:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` }, body: JSON.stringify({ operationId }),
  }), tableId);
  assert.equal(wrongOrigin.status, 403);
  const extraField = await handlers.withdrawRequest(new Request(`http://127.0.0.1:8085/api/me/requests/${requestId}/withdraw`, {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId, authUserId: "caller-selected" }),
  }), requestId);
  assert.equal(extraField.status, 400);
  assert.equal(calls.length, 0);
});

test("request mutation derives access token from HttpOnly cookie and accepts only operationId", async () => {
  calls.length = 0;
  const handlers = createTablesHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const result = await handlers.createRequest(new Request(`http://127.0.0.1:8085/api/tables/${tableId}/requests`, {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId }),
  }), tableId);
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0], { method: "create", data: { accessToken: token, tableId, request: { operationId } } });
  const body = await responseBody(result);
  assert.equal(body.ok, true);
  assert.equal(body.data.state, "pending");
});

test("withdraw route is owner-scoped in the service input and uses anti-CSRF origin", async () => {
  calls.length = 0;
  const handlers = createTablesHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const result = await handlers.withdrawRequest(new Request(`http://127.0.0.1:8085/api/me/requests/${requestId}/withdraw`, {
    method: "POST", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId }),
  }), requestId);
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0], { method: "withdraw", data: { accessToken: token, requestId, request: { operationId } } });
});
