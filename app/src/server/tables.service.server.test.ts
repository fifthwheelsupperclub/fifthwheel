import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { TablesRepository } from "./tables.contract.server.ts";
import { createTablesService } from "./tables.service.server.ts";

const actor = "11111111-1111-4111-8111-111111111111";
function principal(overrides: Partial<ServerVerifiedPrincipal> = {}): ServerVerifiedPrincipal {
  return { userId: actor, emailNormalized: "member@example.test", emailVerified: true, staffRoles: new Set(),
    admission: { state: "activated", authUserId: actor, emailNormalized: "member@example.test" },
    assignedTableIds: new Set(), assignedVenueIds: new Set(), ...overrides };
}
function repository() {
  const calls: { actor: string; data: unknown }[] = [];
  const value: TablesRepository = { async listMemberRequests(userId, input) { calls.push({ actor: userId, data: input }); return { items: [], nextCursor: null }; } };
  return { value, calls };
}

test("placement history always uses the cookie-derived actor", async () => {
  const repo = repository();
  const service = createTablesService({ resolvePrincipal: async () => principal(), repository: repo.value });
  assert.equal((await service.listRequests({ accessToken: "signed-token", limit: 25 })).ok, true);
  assert.deepEqual(repo.calls, [{ actor, data: { cursor: undefined, limit: 25 } }]);
});

test("anonymous callers and bad page sizes never reach the repository", async () => {
  const repo = repository();
  const anonymous = createTablesService({ resolvePrincipal: async () => null, repository: repo.value });
  const denied = await anonymous.listRequests({ accessToken: null, limit: 25 });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.error.code, "unauthenticated");
  const service = createTablesService({ resolvePrincipal: async () => principal(), repository: repo.value });
  assert.equal((await service.listRequests({ accessToken: "signed-token", limit: 0 })).ok, false);
  assert.deepEqual(repo.calls, []);
});
