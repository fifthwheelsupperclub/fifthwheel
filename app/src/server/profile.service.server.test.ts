import assert from "node:assert/strict";
import test from "node:test";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import {
  ProfileRepositoryError,
  type ProfileRepository,
  type ProfileStorage,
  type StoredProfile,
  type StoredProfileFile,
} from "./profile.contract.server.ts";
import { createProfileService } from "./profile.service.server.ts";

const ownerId = "10000000-0000-4000-8000-000000000001";
const adminId = "10000000-0000-4000-8000-000000000002";
const guestId = "20000000-0000-4000-8000-000000000001";
const fileId = "30000000-0000-4000-8000-000000000001";
const selfieFileId = "30000000-0000-4000-8000-000000000002";
const reviewId = "40000000-0000-4000-8000-000000000001";
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
    criticalIdentityVersion: 1,
    reviewedIdentityVersion: null,
    identityStatus: "draft",
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
    latestCorrectionReason: null,
    evidenceReceivedAt: null,
    evidenceDeletedAt: null,
    updatedAt: nowValue.toISOString(),
    ...overrides,
  };
}

function storedFile(overrides: Partial<StoredProfileFile> = {}): StoredProfileFile {
  return {
    fileId,
    guestId,
    authUserId: ownerId,
    kind: "photo",
    state: "ready",
    contentType: "image/jpeg",
    declaredByteSize: 1024,
    actualByteSize: 1024,
    normalizedByteSize: 800,
    profileRevisionAtIntent: 1,
    criticalIdentityVersion: 1,
    quarantineKey: null,
    normalizedKey: "normalized/private-random-key",
    uploadTokenHash: null,
    uploadExpiresAt: null,
    uploadConsumedAt: null,
    receivedAt: nowValue.toISOString(),
    retentionDueAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function createRepository(overrides: Partial<ProfileRepository> = {}) {
  const calls: string[] = [];
  const repo: ProfileRepository = {
    ensureProfile: async (authUserId) => { calls.push(`ensure:${authUserId}`); return profile({ authUserId }); },
    readProfile: async (authUserId) => { calls.push(`read:${authUserId}`); return { profile: profile({ authUserId }), files: [] }; },
    saveProfile: async (input) => { calls.push(`save:${input.authUserId}:${input.expectedProfileRevision}`); return profile({ authUserId: input.authUserId, profileRevision: input.expectedProfileRevision + 1 }); },
    createUploadIntent: async (input) => {
      calls.push(`intent:${input.authUserId}`);
      return { fileId: input.fileId, guestId: input.guestId, criticalIdentityVersion: input.request.expectedCriticalIdentityVersion, expiresAt: input.expiresAt };
    },
    consumeUploadGrant: async () => { throw new Error("unused"); },
    beginNormalization: async (input) => {
      calls.push(`normalize:${input.authUserId}:${input.fileId}`);
      return storedFile({ state: "normalizing", actualByteSize: 1024, uploadConsumedAt: nowValue.toISOString() });
    },
    failUpload: async () => { calls.push("fail-upload"); },
    finalizeUpload: async () => { throw new Error("unused"); },
    deleteFile: async () => { throw new Error("unused"); },
    getOwnerReadFile: async () => ({ normalizedKey: "normalized/private-random-key", contentType: "image/jpeg" }),
    submitProfile: async () => ({ profile: profile({ identityStatus: "submitted" }), review: { review_id: reviewId, attempt_number: 1 } }),
    listIdentityReviews: async () => ({ items: [], nextCursor: null }),
    findCurrentIdentityReview: async (requestedGuestId) => {
      calls.push(`find-review:${requestedGuestId}`);
      return { reviewId, criticalIdentityVersion: 1 };
    },
    prepareIdentityReviewRead: async (input) => {
      calls.push(`audit-before-sign:${input.actorUserId}:${input.guestId}`);
      return {
        profile: profile({ identityStatus: "submitted" }),
        review: { review_id: reviewId, critical_identity_version: 1, submitted_at: nowValue.toISOString(), attempt_number: 1, correction_reason: null },
        files: [{ fileId, kind: "photo", normalizedKey: "normalized/private-random-key" }],
      };
    },
    confirmIdentityReviewReadSet: async (input) => {
      calls.push(`confirm-read-set:${input.actorUserId}:${input.fileIds.length}`);
      return [
        { fileId, kind: "photo", normalizedKey: "normalized/private-photo-key" },
        { fileId: selfieFileId, kind: "selfie", normalizedKey: "normalized/private-selfie-key" },
      ];
    },
    decideIdentityReview: async (input) => { calls.push(`decision:${input.actorUserId}`); return profile({ identityStatus: input.request.decision }); },
    ...overrides,
  };
  return { repo, calls };
}

function createStorage(calls: string[] = []): ProfileStorage {
  return {
    upload: async () => { calls.push("storage-upload"); },
    remove: async () => { calls.push("storage-remove"); },
    createReadUrl: async (_key, seconds) => {
      const expiry = seconds ?? 300;
      calls.push(`sign:${expiry}`);
      return { url: "http://127.0.0.1:57421/storage/v1/object/sign/identity-evidence/private", expiresAt: new Date(nowValue.getTime() + expiry * 1000).toISOString() };
    },
    download: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }),
  };
}

function createService(options: Readonly<{
  principals?: Record<string, ServerVerifiedPrincipal>;
  resolvePrincipal?: (token: string | null | undefined) => Promise<ServerVerifiedPrincipal | null>;
  repository?: Partial<ProfileRepository>;
  storage?: ProfileStorage;
}> = {}) {
  let next = 0;
  const { repo, calls } = createRepository(options.repository);
  const storageCalls: string[] = [];
  const service = createProfileService({
    resolvePrincipal: options.resolvePrincipal ?? (async (token) => options.principals?.[String(token)] ?? null),
    repository: repo,
    storage: options.storage ?? createStorage(storageCalls),
    normalizer: { normalize: async ({ bytes, claimedContentType }) => ({ bytes, contentType: claimedContentType as "image/jpeg", width: 1, height: 1 }) },
    createId: () => {
      next += 1;
      return next === 1 ? operationId : "70000000-0000-4000-8000-000000000001";
    },
    now: () => new Date(nowValue),
    appOrigin: "http://127.0.0.1:8086",
  });
  return { service, calls, storageCalls };
}

test("W04-PROFILE-01/02: profile reads are tied to the verified owner and DTO omits storage and review internals", async () => {
  let requestedUserId = "";
  const setup = createService({
    principals: { owner: principal(ownerId) },
    repository: {
      readProfile: async (authUserId) => {
        requestedUserId = authUserId;
        return { profile: profile(), files: [storedFile()] };
      },
    },
  });

  const result = await setup.service.readMemberProfile("owner");
  assert.equal(result.ok, true);
  assert.equal(requestedUserId, ownerId);
  if (!result.ok) return;
  assert.deepEqual(result.data.openTo, ["woman", "non_binary"]);
  assert.equal(result.data.identityStatus, "draft");
  assert.deepEqual(result.data.missingFields, ["selfie"]);
  assert.equal(JSON.stringify(result.data).includes("normalized/private-random-key"), false);
  assert.equal(JSON.stringify(result.data).includes("uploadTokenHash"), false);
  assert.equal(JSON.stringify(result.data).includes("reviewedAt"), false);
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

test("W04-RETENTION-01: purged image bytes do not make an unchanged approved profile incomplete", async () => {
  const approved = profile({
    identityStatus: "approved",
    criticalIdentityVersion: 4,
    reviewedIdentityVersion: 4,
    evidenceReceivedAt: "2026-10-01T12:00:00.000Z",
    evidenceDeletedAt: "2026-10-31T12:00:00.000Z",
  });
  const setup = createService({
    principals: { owner: principal(ownerId) },
    repository: {
      readProfile: async () => ({
        profile: approved,
        files: [
          storedFile({ state: "deleted", criticalIdentityVersion: 4, quarantineKey: null, normalizedKey: null, deletedAt: "2026-10-31T12:00:00.000Z" }),
          storedFile({ fileId: selfieFileId, kind: "selfie", state: "deleted", criticalIdentityVersion: 4, quarantineKey: null, normalizedKey: null, deletedAt: "2026-10-31T12:00:00.000Z" }),
        ],
      }),
    },
  });
  const result = await setup.service.readMemberProfile("owner");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.identityStatus, "approved");
  assert.equal(result.data.reviewedIdentityVersion, result.data.criticalIdentityVersion);
  assert.deepEqual(result.data.missingFields, []);
  assert.deepEqual(result.data.files.map((file) => file.state), ["deleted", "deleted"]);
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
      readProfile: async () => ({ profile: profile({ profileRevision: 2, openTo: ["man", "non_binary"] }), files: [] }),
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
    repository: { readProfile: async () => { repoCalls += 1; return { profile: profile(), files: [] }; } },
  });
  for (const token of ["admin", "host", "unadmitted", "anonymous"]) {
    const result = await setup.service.readMemberProfile(token);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.code === "forbidden" || result.code === "unauthenticated");
  }
  assert.equal(repoCalls, 0);
});

test("W04-UPLOAD-01/02: intent is owner-bound, short-lived, token hash only, and exact-origin content is required", async () => {
  const intentCapture: { value?: Parameters<ProfileRepository["createUploadIntent"]>[0] } = {};
  const setup = createService({
    principals: { owner: principal(ownerId), other: principal("10000000-0000-4000-8000-000000000003") },
    repository: {
      createUploadIntent: async (input) => {
        intentCapture.value = input;
        return { fileId: input.fileId, guestId: input.guestId, criticalIdentityVersion: 1, expiresAt: input.expiresAt };
      },
      consumeUploadGrant: async () => { throw new ProfileRepositoryError("not_found"); },
    },
  });
  const intent = await setup.service.createMemberUploadIntent("owner", {
    operationId, expectedProfileRevision: 1, expectedCriticalIdentityVersion: 1,
    kind: "photo", contentType: "image/jpeg", byteSize: 1024,
  });
  assert.equal(intent.ok, true);
  const capturedIntent = intentCapture.value;
  assert.ok(capturedIntent);
  assert.equal(capturedIntent.authUserId, ownerId);
  assert.equal(capturedIntent.guestId, guestId);
  assert.equal(capturedIntent.quarantineKey.startsWith(`quarantine/${guestId}/`), true);
  assert.equal(capturedIntent.uploadTokenHash.length, 64);
  assert.equal(capturedIntent.expiresAt, new Date(nowValue.getTime() + 4 * 60 * 1000 + 30 * 1000).toISOString());
  if (!intent.ok) return;
  const token = (intent.data as { uploadToken: string }).uploadToken;
  assert.equal(token.length >= 40, true);
  assert.equal(capturedIntent.uploadTokenHash.includes(token), false);

  const denied = await setup.service.receiveMemberUpload("other", fileId, token, new Request("http://127.0.0.1:8086/api/member/profile/files/x/content", {
    method: "PUT", headers: { origin: "http://127.0.0.1:8086", "content-type": "image/jpeg" }, body: new Uint8Array([1]),
  }));
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "not_found");

  const wrongOrigin = await setup.service.receiveMemberUpload("owner", fileId, token, new Request("http://127.0.0.1:8086/api/member/profile/files/x/content", {
    method: "PUT", headers: { origin: "https://attacker.example", "content-type": "image/jpeg" }, body: new Uint8Array([1]),
  }));
  assert.equal(wrongOrigin.ok, false);
  if (!wrongOrigin.ok) assert.equal(wrongOrigin.code, "forbidden");
});

test("W04-REVIEW-01/02: only admin enters purpose-limited review, and audit preparation precedes signing", async () => {
  const order: string[] = [];
  const setup = createService({
    principals: { admin: principal(adminId, "admin"), owner: principal(ownerId) },
    repository: {
      findCurrentIdentityReview: async (requestedGuestId) => {
        order.push(`find-review:${requestedGuestId}`);
        return { reviewId, criticalIdentityVersion: 1 };
      },
      prepareIdentityReviewRead: async (input) => {
        order.push(`audit:${input.actorUserId}:${input.guestId}`);
        return {
          profile: profile({ identityStatus: "submitted" }),
          review: { review_id: reviewId, critical_identity_version: 1, submitted_at: nowValue.toISOString(), attempt_number: 1, correction_reason: null },
          files: [
            { fileId, kind: "photo", normalizedKey: "normalized/private-photo-key" },
            { fileId: selfieFileId, kind: "selfie", normalizedKey: "normalized/private-selfie-key" },
          ],
        };
      },
      confirmIdentityReviewReadSet: async (input) => {
        order.push(`confirm:${input.fileIds.length}`);
        assert.deepEqual(input.fileIds, [fileId, selfieFileId]);
        return [
          { fileId, kind: "photo", normalizedKey: "normalized/private-photo-key" },
          { fileId: selfieFileId, kind: "selfie", normalizedKey: "normalized/private-selfie-key" },
        ];
      },
    },
    storage: {
      ...createStorage(),
      createReadUrl: async (key, seconds) => {
        const expiry = seconds ?? 300;
        order.push(`sign:${key}:${expiry}`);
        return { url: `http://127.0.0.1:57421/storage/v1/object/sign/identity-evidence/${key}`, expiresAt: new Date(nowValue.getTime() + expiry * 1000).toISOString() };
      },
    },
  });
  const denied = await setup.service.readAdminIdentityReview("owner", guestId);
  assert.equal(denied.ok, false);
  assert.deepEqual(order, []);

  const detail = await setup.service.readAdminIdentityReview("admin", guestId);
  assert.equal(detail.ok, true);
  assert.deepEqual(order, [
    `find-review:${guestId}`,
    `audit:${adminId}:${guestId}`,
    "confirm:2",
    "sign:normalized/private-photo-key:300",
    "sign:normalized/private-selfie-key:300",
  ]);
  if (detail.ok) {
    assert.equal(detail.data.evidence[0]?.expiresAt, new Date(nowValue.getTime() + 5 * 60 * 1000).toISOString());
    assert.deepEqual(detail.data.evidence.map((item) => item.kind), ["photo", "selfie"]);
    assert.equal(JSON.stringify(detail.data.profile).includes("readUrl"), false);
    assert.equal(JSON.stringify(detail.data.profile).includes("phone"), false);
    assert.deepEqual(detail.data.profile.missingFields, []);
  }
});
