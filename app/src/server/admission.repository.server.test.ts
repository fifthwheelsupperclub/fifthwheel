import assert from "node:assert/strict";
import test from "node:test";
import {
  AdmissionRepositoryError,
  createAdmissionRepository,
} from "./admission.repository.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

const config: SupabaseServerConfig = {
  url: "http://127.0.0.1:57421",
  publishableKey: "test-public-key",
  secretKey: "test-server-secret",
};

const command = {
  signupId: "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0",
  operationId: "a80394c5-23d2-4c3f-b84d-eec48222ad62",
  approvedByUserId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e",
} as const;

const originalAdminId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df30";
const admissionId = "5f4836d7-4f52-44cb-83a3-f035b792a0ab";
const deliveryId = "7f7c9d27-22c6-4d6f-9307-f9d4ba7f59b1";
const timestamp = "2026-11-12T12:00:00.000Z";

function rpcPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admission: {
      id: admissionId,
      waitlist_signup_id: command.signupId,
      email_normalized: "fixture@example.test",
      state: "invited",
      approved_by: command.approvedByUserId,
      approved_at: timestamp,
      auth_user_id: null,
      activated_at: null,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    },
    delivery: {
      id: deliveryId,
      admission_id: admissionId,
      operation_id: command.operationId,
      state: "queued",
      provider_message_id: null,
      attempt_count: 0,
      error_code: null,
      queued_at: timestamp,
      next_attempt_at: timestamp,
      lease_until: null,
      attempted_at: null,
      accepted_at: null,
      delivered_at: null,
      created_by: command.approvedByUserId,
      created_at: timestamp,
    },
    created: true,
    delivery_created: true,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("calls the atomic RPC with server-only credentials and maps the typed result", async () => {
  const captured: { url?: URL; init?: RequestInit } = {};
  const repository = createAdmissionRepository(config, async (input, init) => {
    captured.url = new URL(input.toString());
    captured.init = init ?? {};
    return response(rpcPayload());
  });

  const result = await repository.admitAndQueueInvitation(command);

  assert.equal(result.created, true);
  assert.equal(result.admission.state, "invited");
  assert.equal(result.delivery.state, "queued");
  assert.equal(result.admission.waitlist_signup_id, command.signupId);
  assert.equal(result.admission.approved_by, command.approvedByUserId);
  assert.equal(result.delivery.operation_id, command.operationId);
  assert.equal(result.delivery.created_by, command.approvedByUserId);
  assert.equal(captured.url?.pathname, "/rest/v1/rpc/admit_waitlist_signup");
  assert.equal(captured.init?.method, "POST");
  const headers = new Headers(captured.init?.headers);
  assert.equal(headers.get("apikey"), config.secretKey);
  assert.equal(headers.get("authorization"), `Bearer ${config.secretKey}`);
  assert.notEqual(headers.get("apikey"), config.publishableKey);
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(captured.init?.body)), {
    p_signup_id: command.signupId,
    p_operation_id: command.operationId,
    p_approved_by: command.approvedByUserId,
  });
});

test("maps an idempotent reused admission and an already-advanced delivery without changing actors", async () => {
  const body = rpcPayload({
    admission: {
      ...(rpcPayload().admission as Record<string, unknown>),
      approved_by: originalAdminId,
    },
    delivery: {
      ...(rpcPayload().delivery as Record<string, unknown>),
      state: "accepted",
      accepted_at: timestamp,
      created_by: originalAdminId,
    },
    created: false,
    delivery_created: false,
  });
  const repository = createAdmissionRepository(config, async () => response(body));

  const result = await repository.admitAndQueueInvitation(command);

  assert.equal(result.created, false);
  assert.equal(result.admission.approved_by, originalAdminId);
  assert.equal(result.delivery.state, "accepted");
  assert.equal(result.delivery.created_by, originalAdminId);
  assert.equal(result.delivery.accepted_at, timestamp);
});

test("keeps malformed success responses uncertain because the transaction may have committed", async () => {
  const invalidBodies = [
    rpcPayload({ admission: { id: admissionId } }),
    rpcPayload({ admission: { ...(rpcPayload().admission as Record<string, unknown>), state: "activated" } }),
    rpcPayload({ delivery: { ...(rpcPayload().delivery as Record<string, unknown>), operation_id: admissionId } }),
    rpcPayload({ delivery: { ...(rpcPayload().delivery as Record<string, unknown>), state: "mystery" } }),
    rpcPayload({ delivery_created: "true" }),
    rpcPayload({ created: true, delivery_created: false }),
  ];

  for (const body of invalidBodies) {
    const repository = createAdmissionRepository(config, async () => response(body));
    await assert.rejects(
      () => repository.admitAndQueueInvitation(command),
      (error: unknown) => error instanceof AdmissionRepositoryError && error.code === "provider_outcome_unknown",
    );
  }
});

test("keeps an unreadable 2xx body uncertain", async () => {
  const repository = createAdmissionRepository(config, async () => new Response("not json", { status: 200 }));
  await assert.rejects(
    () => repository.admitAndQueueInvitation(command),
    (error: unknown) => error instanceof AdmissionRepositoryError && error.code === "provider_outcome_unknown",
  );
});

test("a retry after uncertain success must use the same operation ID", async () => {
  const operationIds: string[] = [];
  let attempt = 0;
  const repository = createAdmissionRepository(config, async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as { p_operation_id: string };
    operationIds.push(requestBody.p_operation_id);
    attempt += 1;
    return attempt === 1 ? response({ admission: null }) : response(rpcPayload({ created: false, delivery_created: false }));
  });

  await assert.rejects(
    () => repository.admitAndQueueInvitation(command),
    (error: unknown) => error instanceof AdmissionRepositoryError && error.code === "provider_outcome_unknown",
  );
  const recovered = await repository.admitAndQueueInvitation(command);
  assert.equal(recovered.created, false);
  assert.deepEqual(operationIds, [command.operationId, command.operationId]);
});

test("maps safe RPC errors and never returns provider details", async () => {
  const cases = [
    { status: 403, body: { code: "42501", message: "admin_required", details: "private detail" }, code: "forbidden" },
    { status: 404, body: { code: "P0002", message: "waitlist_signup_not_found" }, code: "not_found" },
    { status: 409, body: { code: "23505", message: "operation_id_subject_conflict", details: "secret" }, code: "conflict" },
    { status: 400, body: { code: "22023", message: "invalid_input" }, code: "validation_failed" },
    { status: 503, body: { message: "private upstream payload" }, code: "provider_outcome_unknown" },
  ] as const;

  for (const item of cases) {
    const repository = createAdmissionRepository(config, async () => response(item.body, item.status));
    await assert.rejects(
      () => repository.admitAndQueueInvitation(command),
      (error: unknown) => error instanceof AdmissionRepositoryError
        && error.code === item.code
        && !error.message.includes("private")
        && !error.message.includes("secret"),
    );
  }
});

test("treats network failure as uncertain and rejects invalid commands before fetch", async () => {
  let calls = 0;
  const offline = createAdmissionRepository(config, async () => {
    calls += 1;
    throw new Error("private network detail");
  });
  await assert.rejects(
    () => offline.admitAndQueueInvitation(command),
    (error: unknown) => error instanceof AdmissionRepositoryError
      && error.code === "provider_outcome_unknown"
      && !error.message.includes("private"),
  );
  await assert.rejects(
    () => offline.admitAndQueueInvitation({ ...command, signupId: "bad-id" }),
    (error: unknown) => error instanceof AdmissionRepositoryError && error.code === "validation_failed",
  );
  assert.equal(calls, 1);
});

test("finds only an activated admission by normalized email with server-only credentials", async () => {
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  const activeRow = {
    id: admissionId,
    waitlist_signup_id: command.signupId,
    email_normalized: "member@example.test",
    state: "activated",
    approved_by: command.approvedByUserId,
    approved_at: timestamp,
    auth_user_id: originalAdminId,
    activated_at: timestamp,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const repository = createAdmissionRepository(config, async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedHeaders = new Headers(init?.headers);
    return response([activeRow]);
  });
  const row = await repository.findActiveAdmissionByEmail("member@example.test");
  assert.equal(row?.id, admissionId);
  assert.equal(capturedUrl?.pathname, "/rest/v1/app_admissions");
  assert.equal(capturedUrl?.searchParams.get("state"), "eq.activated");
  assert.equal(capturedHeaders?.get("apikey"), config.secretKey);
  assert.equal(capturedHeaders?.get("authorization"), `Bearer ${config.secretKey}`);
});

test("activates from a verified identity through an atomic RPC and maps idempotent outcomes", async () => {
  const verifiedUserId = originalAdminId;
  const row = {
    id: admissionId,
    waitlist_signup_id: command.signupId,
    email_normalized: "member@example.test",
    state: "activated",
    approved_by: command.approvedByUserId,
    approved_at: timestamp,
    auth_user_id: verifiedUserId,
    activated_at: timestamp,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  let captured: { url?: URL; init?: RequestInit } = {};
  const repository = createAdmissionRepository(config, async (input, init) => {
    captured = { url: new URL(String(input)), init };
    return response({ kind: "activated", admission: row });
  });
  const result = await repository.activateFromVerifiedIdentity({ authUserId: verifiedUserId, emailNormalized: "member@example.test", activatedAt: timestamp });
  assert.equal(result.kind, "activated");
  assert.equal(result.admission?.auth_user_id, verifiedUserId);
  assert.equal(captured.url?.pathname, "/rest/v1/rpc/activate_app_admission");
  const headers = new Headers(captured.init?.headers);
  assert.equal(headers.get("apikey"), config.secretKey);
  assert.deepEqual(JSON.parse(String(captured.init?.body)), { p_auth_user_id: verifiedUserId, p_email_normalized: "member@example.test", p_activated_at: timestamp });

  const miss = createAdmissionRepository(config, async () => response({ kind: "not_admitted" }));
  assert.deepEqual(await miss.activateFromVerifiedIdentity({ authUserId: verifiedUserId, emailNormalized: "member@example.test", activatedAt: timestamp }), { kind: "not_admitted" });
});

test("loads trusted invitation recipient context and begins/finishes an attempt through RPCs", async () => {
  const attemptId = "a4bb2390-1c72-4dc7-8ea8-435d5ac9c3e2";
  const opId = "b4bb2390-1c72-4dc7-8ea8-435d5ac9c3e2";
  const delivery = {
    id: deliveryId, admission_id: admissionId, operation_id: command.operationId, state: "sending", provider_message_id: null,
    attempt_count: 1, error_code: null, queued_at: timestamp, next_attempt_at: timestamp, lease_until: "2026-11-12T12:10:00.000Z",
    attempted_at: timestamp, accepted_at: null, delivered_at: null, created_by: command.approvedByUserId, created_at: timestamp,
  };
  const attempt = { id: attemptId, delivery_id: deliveryId, operation_id: opId, started_by_user_id: command.approvedByUserId, attempt_number: 1, state: "sending", provider_message_id: null, error_code: null, started_at: timestamp, finished_at: null };
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const repository = createAdmissionRepository(config, async (input, init) => {
    const url = new URL(String(input)); requests.push({ url, init });
    if (url.pathname.endsWith("app_invitation_deliveries")) return response([{ id: deliveryId, admission_id: admissionId, admission: { id: admissionId, waitlist_signup_id: command.signupId, email_normalized: "member@example.test", state: "invited" } }]);
    if (url.pathname.endsWith("begin_invitation_delivery_attempt")) return response({ delivery, attempt, created: true });
    if (url.pathname.endsWith("finish_invitation_delivery_attempt")) return response({ delivery: { ...delivery, state: "accepted" }, attempt: { ...attempt, state: "accepted" } });
    return response(null, 404);
  });
  assert.deepEqual(await repository.findInvitationDeliveryContext(deliveryId), {
    deliveryId, admissionId, signupId: command.signupId, recipientEmail: "member@example.test", admissionState: "invited",
  });
  const begun = await repository.beginDeliveryAttempt({ deliveryId, operationId: opId, startedByUserId: command.approvedByUserId });
  assert.equal(begun?.attempt.id, attemptId);
  assert.equal(begun?.created, true);
  await repository.finishDeliveryAttempt({ attemptId, state: "accepted", providerMessageId: "mailpit-1", finishedAt: timestamp });
  assert.deepEqual(requests.map((request) => request.url.pathname), [
    "/rest/v1/app_invitation_deliveries",
    "/rest/v1/rpc/begin_invitation_delivery_attempt",
    "/rest/v1/rpc/finish_invitation_delivery_attempt",
  ]);
  for (const request of requests.slice(1)) {
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("apikey"), config.secretKey);
    assert.equal(headers.get("authorization"), `Bearer ${config.secretKey}`);
  }
});
