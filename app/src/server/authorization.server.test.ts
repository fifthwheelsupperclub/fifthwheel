import assert from "node:assert/strict";
import test from "node:test";
import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";

function principal(overrides: Partial<ServerVerifiedPrincipal> = {}): ServerVerifiedPrincipal {
  return {
    userId: "user-1",
    emailNormalized: "member@example.test",
    emailVerified: true,
    staffRoles: new Set(),
    admission: { state: "none", authUserId: null, emailNormalized: null },
    assignedTableIds: new Set(),
    assignedVenueIds: new Set(),
    ...overrides,
  };
}

test("anonymous and unverified identities cannot enter protected workspaces", () => {
  assert.deepEqual(authorize(null, { workspace: "admin", action: "waitlist:read" }), {
    allowed: false,
    reason: "unauthenticated",
  });
  assert.deepEqual(authorize(principal({ emailVerified: false, staffRoles: new Set(["admin"]) }), {
    workspace: "admin",
    action: "waitlist:read",
  }), { allowed: false, reason: "email-unverified" });
});

test("member access requires an activated admission linked by Auth user ID and email", () => {
  const admitted = principal({
    admission: { state: "activated", authUserId: "user-1", emailNormalized: " member@example.test " },
  });
  assert.equal(authorize(admitted, { workspace: "member", action: "member:read-own" }).allowed, true);
  assert.deepEqual(authorize(principal({
    admission: { state: "invited", authUserId: null, emailNormalized: "member@example.test" },
  }), { workspace: "member", action: "member:read-own" }), { allowed: false, reason: "member-not-admitted" });
  assert.deepEqual(authorize(principal({
    admission: { state: "activated", authUserId: "another-user", emailNormalized: "member@example.test" },
  }), { workspace: "member", action: "member:read-own" }), { allowed: false, reason: "member-not-admitted" });
  assert.deepEqual(authorize(principal({
    admission: { state: "activated", authUserId: "user-1", emailNormalized: "someone-else@example.test" },
  }), { workspace: "member", action: "member:read-own" }), { allowed: false, reason: "member-not-admitted" });
});

test("admission does not grant staff authority and an admin role does not grant member access", () => {
  const admittedMember = principal({
    admission: { state: "activated", authUserId: "user-1", emailNormalized: "member@example.test" },
  });
  assert.deepEqual(authorize(admittedMember, { workspace: "admin", action: "admission:invite" }), {
    allowed: false,
    reason: "forbidden",
  });

  const adminWithoutAdmission = principal({ staffRoles: new Set(["admin"]) });
  assert.equal(authorize(adminWithoutAdmission, { workspace: "admin", action: "waitlist:read" }).allowed, true);
  assert.deepEqual(authorize(adminWithoutAdmission, { workspace: "member", action: "member:read-own" }), {
    allowed: false,
    reason: "member-not-admitted",
  });
});

test("host and restaurant access requires the trusted role and exact resource assignment", () => {
  const host = principal({
    staffRoles: new Set(["host"]),
    assignedTableIds: new Set(["table-1"]),
  });
  assert.equal(authorize(host, { workspace: "host", action: "table:operate", tableId: "table-1" }).allowed, true);
  assert.deepEqual(authorize(host, { workspace: "host", action: "table:operate", tableId: "table-2" }), {
    allowed: false,
    reason: "resource-not-assigned",
  });
  assert.deepEqual(authorize(host, { workspace: "admin", action: "admission:invite" }), {
    allowed: false,
    reason: "forbidden",
  });

  const restaurant = principal({
    staffRoles: new Set(["restaurant"]),
    assignedVenueIds: new Set(["venue-1"]),
  });
  assert.equal(authorize(restaurant, { workspace: "restaurant", action: "venue:read-service", venueId: "venue-1" }).allowed, true);
  assert.deepEqual(authorize(restaurant, { workspace: "restaurant", action: "venue:read-service", venueId: "venue-2" }), {
    allowed: false,
    reason: "resource-not-assigned",
  });
});
