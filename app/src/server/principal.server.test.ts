import assert from "node:assert/strict";
import test from "node:test";
import { authorize } from "./authorization.server.ts";
import {
  createVerifiedPrincipalResolver,
  noResourceAssignments,
  PrincipalAssemblyError,
  type TrustedAssignmentReader,
} from "./principal.server.ts";
import type { SupabaseServerClient } from "./supabase.server.ts";

const authUserId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e";
const tableId = "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const venueId = "a80394c5-23d2-4c3f-b84d-eec48222ad62";

function verifiedClient(overrides: Partial<SupabaseServerClient> = {}): SupabaseServerClient {
  return {
    async verifyAccessToken() {
      return { authUserId, emailNormalized: "fixture@example.test", emailVerified: true };
    },
    async readTrustedAuthorizationFacts() {
      return {
        staffRoles: [],
        admission: { state: "none", authUserId: null, emailNormalized: null },
      };
    },
    ...overrides,
  };
}

test("assembles member authority only from verified identity and trusted admission linkage", async () => {
  const client = verifiedClient({
    async readTrustedAuthorizationFacts(userId) {
      assert.equal(userId, authUserId);
      return {
        staffRoles: [],
        admission: { state: "activated", authUserId, emailNormalized: "fixture@example.test" },
      };
    },
  });
  const resolvePrincipal = createVerifiedPrincipalResolver(client, noResourceAssignments);
  const principal = await resolvePrincipal("verified-token");

  assert.equal(principal?.userId, authUserId);
  assert.equal(principal?.emailVerified, true);
  assert.equal(authorize(principal, { workspace: "member", action: "member:read-own" }).allowed, true);
  assert.deepEqual([...principal!.staffRoles], []);
});

test("trusted staff roles do not grant members, and assignments are required for host/venue actions", async () => {
  const client = verifiedClient({
    async readTrustedAuthorizationFacts() {
      return {
        staffRoles: ["host", "restaurant"],
        admission: { state: "none", authUserId: null, emailNormalized: null },
      };
    },
  });

  const deniedByDefault = await createVerifiedPrincipalResolver(client)("verified-token");
  assert.deepEqual(authorize(deniedByDefault, { workspace: "member", action: "member:read-own" }), {
    allowed: false,
    reason: "member-not-admitted",
  });
  assert.deepEqual(authorize(deniedByDefault, { workspace: "host", action: "table:operate", tableId }), {
    allowed: false,
    reason: "resource-not-assigned",
  });

  const assignments: TrustedAssignmentReader = {
    async readForAuthUser(userId) {
      assert.equal(userId, authUserId);
      return { tableIds: [tableId], venueIds: [venueId] };
    },
  };
  const assigned = await createVerifiedPrincipalResolver(client, assignments)("verified-token");
  assert.equal(authorize(assigned, { workspace: "host", action: "table:operate", tableId }).allowed, true);
  assert.equal(authorize(assigned, { workspace: "restaurant", action: "venue:read-service", venueId }).allowed, true);
  assert.deepEqual(authorize(assigned, {
    workspace: "host",
    action: "table:operate",
    tableId: "57cf3791-30f7-4f4b-a4ad-222222222222",
  }), { allowed: false, reason: "resource-not-assigned" });
});

test("invalid tokens stop before privileged reads, and assignment failures reject principal assembly", async () => {
  let trustedReads = 0;
  const invalidClient = verifiedClient({
    async verifyAccessToken() { return null; },
    async readTrustedAuthorizationFacts() { trustedReads += 1; return { staffRoles: [], admission: { state: "none", authUserId: null, emailNormalized: null } }; },
  });
  assert.equal(await createVerifiedPrincipalResolver(invalidClient)("expired-token"), null);
  assert.equal(trustedReads, 0);

  let unverifiedTrustedReads = 0;
  let unverifiedAssignmentReads = 0;
  const unverifiedClient = verifiedClient({
    async verifyAccessToken() {
      return { authUserId, emailNormalized: "fixture@example.test", emailVerified: false };
    },
    async readTrustedAuthorizationFacts() {
      unverifiedTrustedReads += 1;
      return { staffRoles: [], admission: { state: "none", authUserId: null, emailNormalized: null } };
    },
  });
  const unverifiedAssignments: TrustedAssignmentReader = {
    async readForAuthUser() {
      unverifiedAssignmentReads += 1;
      return { tableIds: [], venueIds: [] };
    },
  };
  assert.equal(await createVerifiedPrincipalResolver(unverifiedClient, unverifiedAssignments)("unverified-token"), null);
  assert.equal(unverifiedTrustedReads, 0);
  assert.equal(unverifiedAssignmentReads, 0);

  const assignmentReader: TrustedAssignmentReader = {
    async readForAuthUser() { throw new Error("raw backend failure"); },
  };
  await assert.rejects(
    () => createVerifiedPrincipalResolver(verifiedClient(), assignmentReader)("verified-token"),
    (error: unknown) => error instanceof PrincipalAssemblyError && error.code === "trusted_assignments_unavailable",
  );
});
