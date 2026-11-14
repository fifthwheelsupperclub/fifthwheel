import assert from "node:assert/strict";
import test from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";
import { createMemberHomeGetHandler } from "./member.home.http.server.ts";

const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXIifQ.signature_value-123";
const cookie = `fw_access_token=${accessToken}; fw_refresh_token=opaque-refresh-token_1234567890`;
const authUserId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e";

function memberPrincipal(): ServerVerifiedPrincipal {
  return {
    userId: authUserId,
    emailNormalized: "member@example.test",
    emailVerified: true,
    staffRoles: new Set(),
    admission: { state: "activated", authUserId, emailNormalized: "member@example.test" },
    assignedTableIds: new Set(),
    assignedVenueIds: new Set(),
  };
}

test("returns only the verified member admission identity with no-store headers", async () => {
  let suppliedToken: string | null | undefined;
  const resolvePrincipal: VerifiedPrincipalResolver = async (token) => {
    suppliedToken = token;
    return memberPrincipal();
  };
  const handler = createMemberHomeGetHandler(resolvePrincipal);
  const response = await handler(new Request("http://127.0.0.1:8085/api/member/home", { headers: { cookie } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(suppliedToken, accessToken);
  assert.deepEqual(await response.json(), {
    member: { email: "member@example.test", admissionState: "activated" },
  });
});

test("requires cookies and denies unadmitted, unverified or staff-only principals", async () => {
  let calls = 0;
  const unadmittedToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJub25lIn0.signature_value-123";
  const adminToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature_value-123";
  const unverifiedToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1bnZlcmlmaWVkIn0.signature_value-123";
  const resolver: VerifiedPrincipalResolver = async (token) => {
    calls += 1;
    if (token === unadmittedToken) return {
      ...memberPrincipal(), admission: { state: "none", authUserId: null, emailNormalized: null },
    };
    if (token === adminToken) return {
      ...memberPrincipal(), staffRoles: new Set(["admin"]), admission: { state: "none", authUserId: null, emailNormalized: null },
    };
    if (token === unverifiedToken) return null;
    return memberPrincipal();
  };
  const handler = createMemberHomeGetHandler(resolver);

  const missing = await handler(new Request("http://127.0.0.1:8085/api/member/home", { headers: { authorization: `Bearer ${accessToken}` } }));
  assert.equal(missing.status, 401);
  assert.equal(calls, 0);

  for (const [token, expectedStatus] of [[unadmittedToken, 403], [adminToken, 403], [unverifiedToken, 401]] as const) {
    const response = await handler(new Request("http://127.0.0.1:8085/api/member/home", {
      headers: { cookie: `fw_access_token=${token}` },
    }));
    assert.equal(response.status, expectedStatus);
  }
  assert.equal(calls, 3);
});

test("returns a safe unavailable response when verified-principal resolution fails", async () => {
  const handler = createMemberHomeGetHandler(async () => { throw new Error("private provider detail"); });
  const response = await handler(new Request("http://127.0.0.1:8085/api/member/home", { headers: { cookie } }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "temporarily_unavailable", message: "Your member home is temporarily unavailable." },
  });
});
