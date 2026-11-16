import assert from "node:assert/strict";
import test from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import {
  ProfileRepositoryError,
  type ProfileRepository,
  type StoredProfile,
} from "./profile.contract.server.ts";
import { createProfileService } from "./profile.service.server.ts";

const ownerId = "10000000-0000-4000-8000-000000000001";
const adminId = "10000000-0000-4000-8000-000000000002";
const guestId = "20000000-0000-4000-8000-000000000001";
const operationId = "50000000-0000-4000-8000-000000000001";
const nowValue = new Date("2026-11-12T17:00:00.000Z");

function principal(userId: string, role: "member" | "admin" | "host" | "restaurant" = "member"): ServerVerifiedPrincipal {
  return {
    userId,
    emailNormalized: `${role}-${userId.slice(-4)}@example.test`,
    emailVerified: true,
    staffRoles: new Set(role === "admin" || role === "host" || role === "restaurant" ? [role] : []),
    admission: role === "member"
      ? { state: "activated", authUserId: userId, emailNormalized: `${role}-${userId.slice(-4)}@example.test` }
      : { state: "none", authUserId: null, emailNormalized: null },
    assignedTableIds: new Set(),
    assignedVenueIds: new Set(),
  };
}

function profile(overrides: Partial<StoredProfile> = {}): StoredProfile {
  return {
    guestId,
    authUserId: ownerId,
    admissionId: "60000000-0000-4000-8000-000000000001",
    profileRevision: 1,
    firstName: "Casey",
    lastName: "Example",
    dateOfBirth: "1990-04-14",
    identity: "woman",
    openTo: ["woman", "non_binary"],
    matchAgeMin: 21,
    matchAgeMax: 120,
    neighborhood: "Inman Park",
    nights: ["Wednesday"],
    lookingFor: "Open",
    surpriseGame: "Yes, surprise me",
    phone: null,
    oneLiner: null,
    updatedAt: nowValue.toISOString(),
    ...overrides,
  };
}

function createService(options: Readonly<{
  principals?: Record<string, ServerVerifiedPrincipal>;
  resolvePrincipal?: (token: string | null | undefined) => Promise<ServerVerifiedPrincipal | null>;
  repository?: Partial<ProfileRepository>;
}> = {}) {
  const repository: ProfileRepository = {
    ensureProfile: async (authUserId) => profile({ authUserId }),
    saveProfile: async (input) => profile({ authUserId: input.authUserId, profileRevision: input.expectedProfileRevision + 1 }),
    ...options.repository,
  };
  const service = createProfileService({
    resolvePrincipal: options.resolvePrincipal ?? (async (token) => options.principals?.[String(token)] ?? null),
    repository,
    createId: () => operationId,
    now: () => new Date(nowValue),
  });
  return { service };
}

test("W04-PROFILE-01/02: profile reads are tied to the verified owner and DTO omits storage internals", async () => {
  let requestedUserId = "";
  const setup = createService({
    principals: { owner: principal(ownerId) },
    repository: {
      ensureProfile: async (authUserId) => {
        requestedUserId = authUserId;
        return profile();
      },
    },
  });

  const result = await setup.service.readMemberProfile("owner");
  assert.equal(result.ok, true);
  assert.equal(requestedUserId, ownerId);
  if (!result.ok) return;
  assert.deepEqual(result.data.openTo, ["woman", "non_binary"]);
  assert.equal(JSON.stringify(result.data).includes(guestId), false);
  assert.equal(JSON.stringify(result.data).includes("admissionId"), false);
});

test("W04 service outages are retryable and are not reported as signed-out sessions", async () => {
  const setup = createService({ resolvePrincipal: async () => { throw new Error("local Auth timeout"); } });
  const result = await setup.service.readMemberProfile("owner");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "temporarily_unavailable");
    assert.equal(result.retryable, true);
  }
});

test("W04-PROFILE-05: valid save forwards expected revision and stale storage conflict is safe", async () => {
  const setup = createService({
    principals: { owner: principal(ownerId) },
    repository: {
      saveProfile: async (input) => {
        assert.equal(input.authUserId, ownerId);
        assert.equal(input.expectedProfileRevision, 1);
        assert.deepEqual(input.fields.openTo, ["man", "non_binary"]);
        return profile({ profileRevision: 2, openTo: ["man", "non_binary"] });
      },
    },
  });
  const request = {
    operationId,
    expectedProfileRevision: 1,
    firstName: "Casey",
    lastName: "Example",
    dateOfBirth: "1990-04-14",
    identity: "woman" as const,
    openTo: ["man", "non_binary"] as const,
    matchAgeMin: 21,
    matchAgeMax: 120,
    neighborhood: "Inman Park",
    nights: ["Wednesday"],
    lookingFor: "Open" as const,
    surpriseGame: "Yes, surprise me" as const,
    phone: null,
    oneLiner: null,
  };
  const saved = await setup.service.saveMemberProfile("owner", request);
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.data.profileRevision, 2);
    assert.deepEqual(saved.data.openTo, ["man", "non_binary"]);
  }

  const conflict = createService({
    principals: { owner: principal(ownerId) },
    repository: { saveProfile: async () => { throw new ProfileRepositoryError("conflict"); } },
  });
  const stale = await conflict.service.saveMemberProfile("owner", request);
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.code, "conflict");
    assert.equal(stale.retryable, true);
    assert.equal(stale.message.includes(ownerId), false);
  }
});

test("W04-PROFILE-01: admin, host, unadmitted, and anonymous principals cannot use member profile operations", async () => {
  let repoCalls = 0;
  const setup = createService({
    principals: {
      admin: principal(adminId, "admin"),
      host: principal(adminId, "host"),
      unadmitted: { ...principal(adminId), admission: { state: "invited", authUserId: null, emailNormalized: null } },
    },
    repository: { ensureProfile: async () => { repoCalls += 1; return profile(); } },
  });
  for (const token of ["admin", "host", "unadmitted", "anonymous"]) {
    const result = await setup.service.readMemberProfile(token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.code === "forbidden" || result.code === "unauthenticated");
  }
  assert.equal(repoCalls, 0);
});
