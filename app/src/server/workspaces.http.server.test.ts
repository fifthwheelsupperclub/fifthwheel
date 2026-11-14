import assert from "node:assert/strict";
import test from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import { createWorkspacesGetHandler } from "./workspaces.http.server.ts";

const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_value-123";
const refreshToken = "opaque-refresh-token_1234567890";

function principal(overrides: Partial<ServerVerifiedPrincipal> = {}): ServerVerifiedPrincipal {
  return {
    userId: "12000000-0000-4000-8000-000000000001",
    emailNormalized: "member@example.test",
    emailVerified: true,
    staffRoles: new Set(),
    admission: { state: "activated", authUserId: "12000000-0000-4000-8000-000000000001", emailNormalized: "member@example.test" },
    assignedTableIds: new Set(),
    assignedVenueIds: new Set(),
    ...overrides,
  };
}

test("returns only server-authorized workspaces and preserves member/admin multi-role access", async () => {
  const handler = createWorkspacesGetHandler(async () => principal({ staffRoles: new Set(["admin"]) }));
  const response = await handler(new Request("http://127.0.0.1:8085/api/workspaces", {
    headers: { cookie: `fw_access_token=${accessToken}; fw_refresh_token=${refreshToken}` },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { workspaces: [{ key: "member", available: true }, { key: "admin", available: true }] });
});

test("does not invent workspace access from a role without trusted resource assignment", async () => {
  const host = createWorkspacesGetHandler(async () => principal({
    staffRoles: new Set(["host"]),
    admission: { state: "none", authUserId: null, emailNormalized: null },
  }));
  const response = await host(new Request("http://127.0.0.1:8085/api/workspaces", {
    headers: { cookie: `fw_access_token=${accessToken}; fw_refresh_token=${refreshToken}` },
  }));
  assert.equal(response.status, 403);
});

test("exposes the host workspace as available only with a current trusted Table assignment", async () => {
  const tableId = "12000000-0000-4000-8000-000000000099";
  const host = createWorkspacesGetHandler(async () => principal({
    staffRoles: new Set(["host"]), assignedTableIds: new Set([tableId]),
    admission: { state: "none", authUserId: null, emailNormalized: null },
  }));
  const response = await host(new Request("http://127.0.0.1:8085/api/workspaces", {
    headers: { cookie: `fw_access_token=${accessToken}` },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { workspaces: [{ key: "host", available: true }] });
});

test("requires a cookie session and fails safely when principal resolution fails", async () => {
  const handler = createWorkspacesGetHandler(async () => { throw new Error("private detail"); });
  const missing = await handler(new Request("http://127.0.0.1:8085/api/workspaces"));
  assert.equal(missing.status, 401);
  const failure = await handler(new Request("http://127.0.0.1:8085/api/workspaces", {
    headers: { cookie: `fw_access_token=${accessToken}; fw_refresh_token=${refreshToken}` },
  }));
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /private detail/);
});
