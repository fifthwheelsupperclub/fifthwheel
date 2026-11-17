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

const signupId = "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const approvedByUserId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e";
const verifiedUserId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df30";
const admissionId = "5f4836d7-4f52-44cb-83a3-f035b792a0ab";
const timestamp = "2026-11-12T12:00:00.000Z";

const activeRow = {
  id: admissionId,
  waitlist_signup_id: signupId,
  email_normalized: "member@example.test",
  state: "activated",
  approved_by: approvedByUserId,
  approved_at: timestamp,
  auth_user_id: verifiedUserId,
  activated_at: timestamp,
  deleted_at: null,
  created_at: timestamp,
  updated_at: timestamp,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("finds an invited or activated admission by normalized email with server-only credentials", async () => {
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  const repository = createAdmissionRepository(config, async (input, init) => {
    capturedUrl = new URL(String(input));
    capturedHeaders = new Headers(init?.headers);
    return response([activeRow]);
  });
  const row = await repository.findActiveAdmissionByEmail("member@example.test");
  assert.equal(row?.id, admissionId);
  assert.equal(capturedUrl?.pathname, "/rest/v1/app_admissions");
  assert.equal(capturedUrl?.searchParams.get("state"), "in.(invited,activated)");
  assert.equal(capturedHeaders?.get("apikey"), config.secretKey);
  assert.equal(capturedHeaders?.get("authorization"), `Bearer ${config.secretKey}`);

  const invitedRow = { ...activeRow, state: "invited", auth_user_id: null, activated_at: null };
  const invited = createAdmissionRepository(config, async () => response([invitedRow]));
  assert.equal((await invited.findActiveAdmissionByEmail("member@example.test"))?.state, "invited");

  for (const bad of [{ ...activeRow, state: "deleted" }, { ...invitedRow, auth_user_id: verifiedUserId }, { ...activeRow, auth_user_id: null }]) {
    const repo = createAdmissionRepository(config, async () => response([bad]));
    await assert.rejects(
      () => repo.findActiveAdmissionByEmail("member@example.test"),
      (error: unknown) => error instanceof AdmissionRepositoryError && error.code === "provider_data_invalid",
    );
  }
});

test("activates from a verified identity through an atomic RPC and maps idempotent outcomes", async () => {
  let captured: { url?: URL; init?: RequestInit } = {};
  const repository = createAdmissionRepository(config, async (input, init) => {
    captured = { url: new URL(String(input)), init };
    return response({ kind: "activated", admission: activeRow });
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

test("maps safe RPC errors and never returns provider details", async () => {
  const cases = [
    { status: 403, body: { code: "42501", message: "admin_required", details: "private detail" }, code: "forbidden" },
    { status: 404, body: { code: "P0002", message: "not_found" }, code: "not_found" },
    { status: 409, body: { code: "23505", message: "conflict", details: "secret" }, code: "conflict" },
    { status: 400, body: { code: "22023", message: "invalid_input" }, code: "validation_failed" },
    { status: 503, body: { message: "private upstream payload" }, code: "provider_outcome_unknown" },
  ] as const;

  for (const item of cases) {
    const repository = createAdmissionRepository(config, async () => response(item.body, item.status));
    await assert.rejects(
      () => repository.activateFromVerifiedIdentity({ authUserId: verifiedUserId, emailNormalized: "member@example.test", activatedAt: timestamp }),
      (error: unknown) => error instanceof AdmissionRepositoryError
        && error.code === item.code
        && !error.message.includes("private")
        && !error.message.includes("secret"),
    );
  }
});
