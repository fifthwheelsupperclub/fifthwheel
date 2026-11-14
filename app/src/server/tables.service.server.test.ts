import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { TablesRepository } from "./tables.contract.server.ts";
import { createTablesService } from "./tables.service.server.ts";

const actor = "11111111-1111-4111-8111-111111111111";
const table = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
const op = "44444444-4444-4444-8444-444444444444";
function principal(overrides: Partial<ServerVerifiedPrincipal> = {}): ServerVerifiedPrincipal {
  return { userId: actor, emailNormalized: "member@example.test", emailVerified: true, staffRoles: new Set(),
    admission: { state: "activated", authUserId: actor, emailNormalized: "member@example.test" },
    assignedTableIds: new Set(), assignedVenueIds: new Set(), ...overrides };
}
function repository(overrides: Partial<TablesRepository> = {}) {
  const calls: { method: string; actor?: string; data?: unknown }[] = [];
  const base: TablesRepository = {
    async listPublishedTables(userId, input) { calls.push({ method: "list", actor: userId, data: input }); return { items: [], nextCursor: null }; },
    async readPublishedPreview(id) { calls.push({ method: "preview", data: id }); return { tableId: id, title: "Preview Table", localDate: "2027-01-12", neighborhood: "Inman Park" }; },
    async readPublishedTable(userId, id) { calls.push({ method: "detail", actor: userId, data: id }); return { view: "member", table: { tableId: id, title: "Member Table", localDate: "2027-01-12", startLocalTime: "19:00", neighborhood: "Inman Park", seatPriceCents: 2500, currency: "USD", ownRequest: null, stops: [] } }; },
    async createRequest(userId, id, operationId) { calls.push({ method: "create", actor: userId, data: { id, operationId } }); return { requestId: request, tableId: id, state: "pending", declineReason: null, createdAt: "2026-11-13T12:00:00Z", updatedAt: "2026-11-13T12:00:00Z" }; },
    async listMemberRequests(userId, input) { calls.push({ method: "history", actor: userId, data: input }); return { items: [], nextCursor: null }; },
    async withdrawRequest(userId, id, operationId) { calls.push({ method: "withdraw", actor: userId, data: { id, operationId } }); return { requestId: id, tableId: table, state: "withdrawn", declineReason: null, createdAt: "2026-11-13T12:00:00Z", updatedAt: "2026-11-13T12:30:00Z" }; },
  };
  return { value: { ...base, ...overrides }, calls };
}

test("anonymous direct Table URL returns only a minimal shared preview", async () => {
  const repo = repository();
  const service = createTablesService({ resolvePrincipal: async () => null, repository: repo.value });
  const result = await service.readTable({ tableId: table });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { view: "preview", table: { tableId: table, title: "Preview Table", localDate: "2027-01-12", neighborhood: "Inman Park" } });
  assert.deepEqual(repo.calls.map((call) => call.method), ["preview"]);
});

test("unadmitted verified identity may see minimal preview but never full detail", async () => {
  const repo = repository();
  const unadmitted = principal({ admission: { state: "none", authUserId: null, emailNormalized: null } });
  const service = createTablesService({ resolvePrincipal: async () => unadmitted, repository: repo.value });
  const result = await service.readTable({ accessToken: "token", tableId: table });
  assert.equal(result.ok, true);
  assert.deepEqual(repo.calls.map((call) => call.method), ["preview"]);
});

test("browse denies anonymous callers and validates bounded, real date filters before repository access", async () => {
  const repo = repository();
  const service = createTablesService({ resolvePrincipal: async () => null, repository: repo.value });
  assert.deepEqual(await service.listTables({ limit: 25 }), { ok: false, error: { code: "unauthenticated", safeMessage: "Sign in to browse Tables." } });
  const invalidDate = await service.listTables({ accessToken: "token", dateFrom: "2027-02-31", limit: 25 });
  assert.equal(invalidDate.ok, false);
  if (!invalidDate.ok) assert.equal(invalidDate.error.code, "invalid_input");
  assert.deepEqual(repo.calls, []);
});

test("approved-member browse uses the verified actor and preserves the query contract", async () => {
  const repo = repository();
  const service = createTablesService({ resolvePrincipal: async () => principal(), repository: repo.value });
  const result = await service.listTables({ accessToken: "signed-token", dateFrom: "2027-01-01", dateTo: "2027-01-31",
    neighborhood: " Inman Park ", cursor: "2027-01-02|19:00:00|22222222-2222-4222-8222-222222222222", limit: 10 });
  assert.equal(result.ok, true);
  assert.deepEqual(repo.calls, [{ method: "list", actor, data: { dateFrom: "2027-01-01", dateTo: "2027-01-31",
    neighborhood: "Inman Park", cursor: "2027-01-02|19:00:00|22222222-2222-4222-8222-222222222222", limit: 10 } }]);
});

test("Seat request, history and withdrawal always use the cookie-derived actor", async () => {
  const repo = repository();
  const service = createTablesService({ resolvePrincipal: async () => principal(), repository: repo.value });
  assert.equal((await service.createRequest({ accessToken: "signed-token", tableId: table, request: { operationId: op } })).ok, true);
  assert.equal((await service.listRequests({ accessToken: "signed-token", limit: 25 })).ok, true);
  assert.equal((await service.withdrawRequest({ accessToken: "signed-token", requestId: request, request: { operationId: op } })).ok, true);
  assert.deepEqual(repo.calls.map((call) => call.actor), [actor, actor, actor]);
  assert.deepEqual(repo.calls.map((call) => call.method), ["create", "history", "withdraw"]);
});

test("request history remains available to an admitted member without approved profile UI state", async () => {
  const repo = repository();
  const admitted = principal();
  const service = createTablesService({ resolvePrincipal: async () => admitted, repository: repo.value });
  assert.equal((await service.listRequests({ accessToken: "signed-token", limit: 25 })).ok, true);
  assert.equal((await service.withdrawRequest({ accessToken: "signed-token", requestId: request, request: { operationId: op } })).ok, true);
});

test("invalid operation identifiers never reach request persistence", async () => {
  const repo = repository();
  const service = createTablesService({ resolvePrincipal: async () => principal(), repository: repo.value });
  const result = await service.createRequest({ accessToken: "signed-token", tableId: table, request: { operationId: "bad" } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid_input");
  assert.deepEqual(repo.calls, []);
});
