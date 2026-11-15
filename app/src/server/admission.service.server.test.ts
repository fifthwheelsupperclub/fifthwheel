import assert from "node:assert/strict";
import test from "node:test";
import type {
  AdmissionDeliveryOperation,
  WaitlistReviewItem,
} from "./admission.contracts.server.ts";
import type { ServerVerifiedPrincipal, StaffRole } from "./authorization.server.ts";
import {
  createAdmissionService,
  type AdmissionServiceDependencies,
} from "./admission.service.server.ts";
import { AdmissionRepositoryError } from "./admission.repository.server.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";
import { WaitlistSearchRepositoryError } from "./waitlist.search.repository.server.ts";

const adminId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e";
const signupId = "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const operationId = "a80394c5-23d2-4c3f-b84d-eec48222ad62";
const admissionId = "5f4836d7-4f52-44cb-83a3-f035b792a0ab";
const deliveryId = "7f7c9d27-22c6-4d6f-9307-f9d4ba7f59b1";

function principal(roles: readonly StaffRole[] = ["admin"]): ServerVerifiedPrincipal {
  return {
    userId: adminId,
    emailNormalized: "admin@example.test",
    emailVerified: true,
    staffRoles: new Set(roles),
    admission: { state: "none", authUserId: null, emailNormalized: null },
    assignedTableIds: new Set(),
    assignedVenueIds: new Set(),
  };
}

const reviewItem: WaitlistReviewItem = {
  id: signupId,
  firstName: "Casey",
  lastName: "Example",
  emailNormalized: "casey@example.test",
  neighborhood: "Inman Park",
  identity: "Woman",
  openTo: ["Women"],
  receivedAt: "2026-11-12T12:00:00Z",
  admissionState: "none",
  latestDelivery: null,
};

function operationResult(): AdmissionDeliveryOperation {
  return {
    admission: {
      id: admissionId,
      waitlist_signup_id: signupId,
      email_normalized: "casey@example.test",
      state: "invited",
      approved_by: adminId,
      approved_at: "2026-11-12T12:00:00Z",
      auth_user_id: null,
      activated_at: null,
      deleted_at: null,
      created_at: "2026-11-12T12:00:00Z",
      updated_at: "2026-11-12T12:00:00Z",
    },
    delivery: {
      id: deliveryId,
      admission_id: admissionId,
      operation_id: operationId,
      state: "queued",
      provider_message_id: null,
      attempt_count: 0,
      error_code: null,
      queued_at: "2026-11-12T12:00:00Z",
      next_attempt_at: "2026-11-12T12:00:00Z",
      lease_until: null,
      attempted_at: null,
      accepted_at: null,
      delivered_at: null,
      created_by: adminId,
      created_at: "2026-11-12T12:00:00Z",
    },
    created: true,
  };
}

function setup(overrides: Partial<AdmissionServiceDependencies> = {}) {
  const calls = { search: 0, admit: 0, resolve: 0 };
  const commands: unknown[] = [];
  const resolvePrincipal: VerifiedPrincipalResolver = async (token) => {
    calls.resolve += 1;
    if (token === "anonymous") return null;
    if (token === "member") return { ...principal([]), admission: { state: "activated", authUserId: adminId, emailNormalized: "admin@example.test" } };
    if (token === "host") return principal(["host"]);
    return principal();
  };
  const waitlistRepository = {
    async search(input: Parameters<AdmissionServiceDependencies["waitlistRepository"]["search"]>[0]) {
      calls.search += 1;
      commands.push(input);
      return { rows: [reviewItem], nextCursor: null };
    },
  };
  const admissionRepository = {
    async admitAndQueueInvitation(input: Parameters<AdmissionServiceDependencies["admissionRepository"]["admitAndQueueInvitation"]>[0]) {
      calls.admit += 1;
      commands.push(input);
      return operationResult();
    },
  };
  return {
    calls,
    commands,
    service: createAdmissionService({
      resolvePrincipal,
      waitlistRepository,
      admissionRepository,
      ...overrides,
    }),
  };
}

test("anonymous, member and wrong-role callers are denied before privileged repositories", async () => {
  const { service, calls } = setup();
  const deniedSearches = await Promise.all([
    service.searchWaitlist({ accessToken: "anonymous", limit: 10 }),
    service.searchWaitlist({ accessToken: "member", limit: 10 }),
    service.searchWaitlist({ accessToken: "host", limit: 10 }),
  ]);
  for (const result of deniedSearches) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(["unauthenticated", "forbidden"].includes(result.error.code));
  }

  const deniedAdmission = await Promise.all([
    service.admitWaitlistMember({ accessToken: "anonymous", signupId, operationId }),
    service.admitWaitlistMember({ accessToken: "member", signupId, operationId }),
    service.admitWaitlistMember({ accessToken: "host", signupId, operationId }),
  ]);
  for (const result of deniedAdmission) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(["unauthenticated", "forbidden"].includes(result.error.code));
  }
  assert.equal(calls.resolve, 6);
  assert.equal(calls.search, 0);
  assert.equal(calls.admit, 0);
});

test("authorized search passes only filters to the repo and returns a narrow DTO", async () => {
  const maliciousReviewItem = { ...reviewItem, birthdate: "1990-01-01", referral: "private-value" } as unknown as WaitlistReviewItem;
  const { service, calls, commands } = setup({
    waitlistRepository: {
      async search(input) {
        calls.search += 1;
        commands.push(input);
        return { rows: [maliciousReviewItem], nextCursor: "next" };
      },
    },
  });

  const result = await service.searchWaitlist({
    accessToken: "admin",
    query: "Casey",
    neighborhood: "Inman Park",
    cursor: "cursor",
    limit: 20,
  });

  assert.deepEqual(commands[0], {
    query: "Casey",
    neighborhood: "Inman Park",
    cursor: "cursor",
    limit: 20,
  });
  assert.equal(calls.search, 1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.items.length, 1);
    assert.equal("birthdate" in result.value.items[0], false);
    assert.equal("referral" in result.value.items[0], false);
    assert.equal(result.value.items[0].emailNormalized, reviewItem.emailNormalized);
    assert.equal(result.value.nextCursor, "next");
  }
});

test("authorized admission derives actor from principal and returns no repository rows or recipient email", async () => {
  const { service, calls, commands } = setup();
  const forgedInput = {
    accessToken: "admin",
    signupId,
    operationId,
    approvedByUserId: "00000000-0000-0000-0000-000000000001",
  } as Parameters<typeof service.admitWaitlistMember>[0];

  const result = await service.admitWaitlistMember(forgedInput);

  assert.deepEqual(commands[0], {
    signupId,
    operationId,
    approvedByUserId: adminId,
  });
  assert.equal(calls.admit, 1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      signupId,
      admissionId,
      admissionState: "invited",
      deliveryId,
      operationId,
      deliveryState: "queued",
      created: true,
    });
    assert.equal("emailNormalized" in result.value, false);
    assert.equal("admission" in result.value, false);
    assert.equal("delivery" in result.value, false);
    assert.equal(JSON.stringify(result.value).includes("casey@example.test"), false);
  }
});

test("malformed UUIDs fail after authorization and before the admission repository", async () => {
  const { service, calls } = setup();
  const result = await service.admitWaitlistMember({
    accessToken: "admin",
    signupId: "not-a-uuid",
    operationId,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "validation_failed");
  assert.equal(calls.admit, 0);
});

test("repository failures become safe ServiceResult errors", async () => {
  const searchSetup = setup({
    waitlistRepository: {
      async search() {
        throw new WaitlistSearchRepositoryError("provider_failed");
      },
    },
  });
  const search = await searchSetup.service.searchWaitlist({ accessToken: "admin", limit: 10 });
  assert.equal(search.ok, false);
  if (!search.ok) {
    assert.equal(search.error.code, "temporarily_unavailable");
    assert.equal(search.error.safeMessage.includes("provider"), false);
  }

  const admitSetup = setup({
    admissionRepository: {
      async admitAndQueueInvitation() {
        throw new AdmissionRepositoryError("provider_outcome_unknown");
      },
    },
  });
  const admit = await admitSetup.service.admitWaitlistMember({ accessToken: "admin", signupId, operationId });
  assert.equal(admit.ok, false);
  if (!admit.ok) {
    assert.equal(admit.error.code, "provider_outcome_unknown");
    assert.equal(admit.error.safeMessage.includes("casey@example.test"), false);
  }
});

test("principal resolution failure denies before either repository", async () => {
  const { calls, service } = setup({
    resolvePrincipal: async () => { throw new Error("secret auth read failure"); },
  });
  const search = await service.searchWaitlist({ accessToken: "admin", limit: 5 });
  const admission = await service.admitWaitlistMember({ accessToken: "admin", signupId, operationId });
  assert.equal(search.ok, false);
  assert.equal(admission.ok, false);
  if (!search.ok) assert.equal(search.error.safeMessage.includes("secret"), false);
  assert.equal(calls.search, 0);
  assert.equal(calls.admit, 0);
});
