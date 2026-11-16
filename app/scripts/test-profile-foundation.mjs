#!/usr/bin/env node

// W04 database acceptance for the isolated rewrite test stack only.
// It never resets schema/data and cleans only its generated .test fixtures.

import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(appRoot, "test-stack");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migrationVersion = "20261112171256";
const wrapper = join(appRoot, "scripts", "local-supabase.mjs");
const fixtureIds = {
  user: randomUUID(),
  admin: randomUUID(),
  signup: randomUUID(),
  admission: randomUUID(),
  operation: randomUUID(),
};
const runId = randomUUID().replaceAll("-", "").slice(0, 16);
const email = `w04-${runId}@example.test`;
const adminEmail = `w04-admin-${runId}@example.test`;
const password = `Local-only-${randomUUID()}!`;
let secretKey;
let publishableKey;
let memberAccessToken;
let adminAccessToken;
let guestId;
let cleanupFiles = [];
let cleanupAuditSubjects = [];

function fail(message) { throw new Error(message); }

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (result.error) fail(`could not run ${command}`);
  return result;
}

function assertGuardedTestStack() {
  const guarded = run(process.execPath, [wrapper, "test", "status"]);
  if (guarded.status !== 0 || !guarded.stdout.includes("fifthwheel-rewrite-test")
    || !guarded.stdout.includes("57421") || !guarded.stdout.includes("57422")) {
    fail("guarded test status did not confirm fifthwheel-rewrite-test on 57421/57422");
  }
  if (existsSync(join(workdir, "supabase", ".temp", "project-ref"))) fail("test workdir has linked project metadata");
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  if (!config.includes('project_id = "fifthwheel-rewrite-test"') || !config.includes("port = 57421") || !config.includes("port = 57422")) {
    fail("isolated test TOML identity or ports do not match");
  }
  const migrations = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  if (migrations.status !== 0 || !migrations.stdout.includes(migrationVersion)) fail("local migration history is unavailable or W04 migration is not present");
  const pending = migrations.stdout.split(/\r?\n/).find((line) => line.includes(migrationVersion));
  if (!pending || !pending.includes(migrationVersion)) fail("W04 migration version could not be verified in local history");

  const status = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  if (status.status !== 0) fail("Supabase CLI cannot confirm local test project status");
  const first = status.stdout.indexOf("{");
  const last = status.stdout.lastIndexOf("}");
  if (first < 0 || last < first) fail("local Supabase status JSON is invalid");
  const parsed = JSON.parse(status.stdout.slice(first, last + 1));
  if (parsed.API_URL !== apiUrl || parsed.DB_URL !== dbUrl) fail("CLI local status targets unexpected addresses");
  // Prefer the legacy service-role JWT for RPCs that inspect auth.jwt()->>'role'.
  // Supabase CLI v2.105 also prints an opaque sb_secret_* API key as SECRET_KEY.
  secretKey = parsed.SERVICE_ROLE_KEY ?? parsed.SECRET_KEY;
  publishableKey = parsed.PUBLISHABLE_KEY ?? parsed.ANON_KEY;
  if (!secretKey || !publishableKey) fail("test project did not expose local API keys");
}

function headers(role = "service", accessToken = null, extra = {}) {
  const key = role === "anon" || role === "member" ? publishableKey : secretKey;
  return {
    apikey: key,
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : role === "service" ? { authorization: `Bearer ${secretKey}` } : {}),
    accept: "application/json",
    ...extra,
  };
}

async function fetchJson(path, init = {}, role = "service", accessToken = null) {
  let response;
  try {
    response = await fetch(new URL(path, apiUrl), {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { ...headers(role, accessToken), ...(init.headers ?? {}) },
    });
  } catch (error) {
    const method = init.method ?? "GET";
    const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
    fail(`local test API request ${method} ${path} ${reason}`);
  }
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { response, body };
}

async function rpc(name, args, role = "service", accessToken = null) {
  return fetchJson(`/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  }, role, accessToken);
}

async function createAuthUser(targetEmail) {
  const { response, body } = await fetchJson("/auth/v1/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: targetEmail, password, email_confirm: true, user_metadata: {} }),
  });
  if (!response.ok || typeof body?.id !== "string" || body.email?.toLowerCase() !== targetEmail) {
    fail(`local Auth fixture creation failed (${response.status}); no provider target outside test stack is configured`);
  }
  return body.id;
}

async function signIn(targetEmail) {
  const generated = await fetchJson("/auth/v1/admin/generate_link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: targetEmail, redirect_to: "http://127.0.0.1:8086/auth/callback" }),
  });
  if (!generated.response.ok || typeof generated.body?.hashed_token !== "string") {
    fail(`local Auth fixture magic-link generation failed (${generated.response.status})`);
  }
  const verified = await fetchJson("/auth/v1/verify", {
    method: "POST",
    headers: { apikey: publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ token_hash: generated.body.hashed_token, type: "magiclink" }),
  }, "anon");
  if (!verified.response.ok || typeof verified.body?.access_token !== "string") {
    fail(`local Auth fixture magic-link verification failed (${verified.response.status})`);
  }
  return verified.body.access_token;
}

async function assertPrivateTableDenied(table, accessToken) {
  const probePath = `/rest/v1/${table}?select=*`;
  for (const [role, token] of [["anon", null], ["member", accessToken]]) {
    for (const [method, body] of [
      ["GET", undefined],
      ["POST", { guest_id: guestId }],
      ["PATCH", { first_name: "forbidden" }],
      ["DELETE", undefined],
    ]) {
      const { response } = await fetchJson(probePath, {
        method,
        headers: body ? { "content-type": "application/json", prefer: "return=minimal" } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      }, role, token);
      assert.ok(!response.ok, `${role} ${method} on ${table} unexpectedly succeeded`);
    }
  }
}

async function authRoleProbe() {
  for (const [role, token] of [["anon", null], ["member", memberAccessToken]]) {
    const { response } = await rpc("ensure_member_profile", { p_auth_user_id: fixtureIds.user }, role, token);
    assert.ok(!response.ok, `${role} unexpectedly executed service-only profile RPC`);
  }
  const ok = await rpc("ensure_member_profile", { p_auth_user_id: fixtureIds.user });
  assert.equal(ok.response.ok, true, `service_role could not execute member profile bootstrap (${ok.response.status}; ${JSON.stringify(ok.body)})`);
  const profile = ok.body;
  assert.equal(profile.auth_user_id, fixtureIds.user);
  assert.equal(profile.admission_id, fixtureIds.admission);
  guestId = profile.guest_id;
}

async function insertSignupAndAdmission() {
  const existing = await fetchJson(`/rest/v1/waitlist_signups?select=id&email_normalized=eq.${encodeURIComponent(email)}`);
  assert.equal(existing.response.ok, true);
  assert.equal(existing.body.length, 0, "synthetic signup email already exists");
  const signup = await fetchJson("/rest/v1/waitlist_signups", {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      id: fixtureIds.signup,
      email_normalized: email,
      first_name: "W04",
      last_name: "Synthetic",
      birthdate: "1990-04-14",
      identity: "Woman",
      open_to: ["Women", "Men", "Non-binary people"],
      match_age_min: 21,
      match_age_max: 120,
      neighborhood: "Inman Park",
      nights: ["Wednesday"],
      referral: "synthetic local W04 DB fixture",
      looking_for: "Open",
      surprise_game: "Yes, surprise me",
      source: "landing-page",
    }),
  });
  assert.equal(signup.response.status, 201, "could not insert exact synthetic waitlist row");
  const role = await fetchJson("/rest/v1/app_user_roles", {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ user_id: fixtureIds.admin, role: "admin", created_by: fixtureIds.admin }),
  });
  assert.equal(role.response.status, 201, "could not insert synthetic admin role");
  const admission = await fetchJson("/rest/v1/app_admissions", {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      id: fixtureIds.admission,
      waitlist_signup_id: fixtureIds.signup,
      email_normalized: email,
      state: "activated",
      approved_by: fixtureIds.admin,
      approved_at: new Date().toISOString(),
      auth_user_id: fixtureIds.user,
      activated_at: new Date().toISOString(),
    }),
  });
  assert.equal(admission.response.status, 201, "could not insert synthetic activated admission");
}

async function finalizeSyntheticEvidence(kind, profileRevision, identityVersion) {
  const id = randomUUID();
  const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
  const quarantineKey = `quarantine/${guestId}/${id}`;
  const expiresAt = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  const intent = await rpc("create_profile_upload_intent", {
    p_auth_user_id: fixtureIds.user,
    p_expected_revision: profileRevision,
    p_expected_identity_version: identityVersion,
    p_operation_id: randomUUID(),
    p_file_id: id,
    p_kind: kind,
    p_content_type: "image/jpeg",
    p_byte_size: 1024,
    p_quarantine_key: quarantineKey,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });
  assert.equal(intent.response.ok, true, `synthetic ${kind} upload intent failed`);
  const consumed = await rpc("consume_profile_upload_grant", {
    p_auth_user_id: fixtureIds.user,
    p_file_id: id,
    p_token_hash: tokenHash,
    p_received_size: 1024,
  });
  assert.equal(consumed.response.ok, true, `upload grant was not consumed (${consumed.response.status}; ${JSON.stringify(consumed.body)})`);
  const began = await rpc("begin_profile_normalization", {
    p_auth_user_id: fixtureIds.user,
    p_file_id: id,
    p_expected_revision: profileRevision,
    p_expected_identity_version: identityVersion,
  });
  assert.equal(began.response.ok, true, "normalization transition failed");
  const normalizedKey = `normalized/${guestId}/${id}/${randomUUID()}`;
  const finalized = await rpc("finalize_profile_upload", {
    p_auth_user_id: fixtureIds.user,
    p_file_id: id,
    p_expected_revision: profileRevision,
    p_expected_identity_version: identityVersion,
    p_normalized_key: normalizedKey,
    p_normalized_type: "image/jpeg",
    p_normalized_size: 900,
    p_width: 1200,
    p_height: 1200,
  });
  assert.equal(finalized.response.ok, true, "synthetic normalized file finalization failed");
  cleanupFiles.push({ id, quarantineKey, normalizedKey });
  return finalized.body.profile;
}

async function assertDirectStorageDenied(accessToken) {
  const key = `quarantine/${guestId}/blocked-${randomUUID()}`;
  for (const [role, token] of [["anon", null], ["member", accessToken]]) {
    const { response } = await fetchJson(`/storage/v1/object/identity-evidence/${key}`, {
      method: "POST",
      headers: { "content-type": "image/jpeg", "x-upsert": "false" },
      body: new Uint8Array([1, 2, 3]),
    }, role, token);
    assert.ok(!response.ok, `${role} direct Storage upload unexpectedly succeeded`);
  }
}

async function cleanup() {
  if (!secretKey) return;
  for (const file of cleanupFiles) {
    for (const key of [file.quarantineKey, file.normalizedKey]) {
      if (!key) continue;
      await fetchJson("/storage/v1/object/identity-evidence", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      }).catch(() => undefined);
    }
  }
  if (guestId) {
    await fetchJson(`/rest/v1/app_profile_files?guest_id=eq.${guestId}`, { method: "DELETE", headers: { prefer: "return=minimal" } }).catch(() => undefined);
    await fetchJson(`/rest/v1/app_identity_reviews?guest_id=eq.${guestId}`, { method: "DELETE", headers: { prefer: "return=minimal" } }).catch(() => undefined);
    await fetchJson(`/rest/v1/app_member_profiles?guest_id=eq.${guestId}`, { method: "DELETE", headers: { prefer: "return=minimal" } }).catch(() => undefined);
  }
  await fetchJson(`/rest/v1/app_admissions?id=eq.${fixtureIds.admission}`, { method: "DELETE", headers: { prefer: "return=minimal" } }).catch(() => undefined);
  await fetchJson(`/rest/v1/waitlist_signups?id=eq.${fixtureIds.signup}&email_normalized=eq.${encodeURIComponent(email)}`, { method: "DELETE", headers: { prefer: "return=minimal" } }).catch(() => undefined);
  await fetchJson(`/rest/v1/app_user_roles?user_id=eq.${fixtureIds.admin}&role=eq.admin`, { method: "DELETE", headers: { prefer: "return=minimal" } }).catch(() => undefined);
  for (const userId of [fixtureIds.user, fixtureIds.admin]) {
    if (!userId) continue;
    await fetchJson(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function main() {
  assertGuardedTestStack();
  fixtureIds.user = await createAuthUser(email);
  fixtureIds.admin = await createAuthUser(adminEmail);
  memberAccessToken = await signIn(email);
  adminAccessToken = await signIn(adminEmail);
  await insertSignupAndAdmission();
  await authRoleProbe();

  for (const table of ["app_member_profiles", "app_identity_reviews", "app_profile_files"]) {
    await assertPrivateTableDenied(table, memberAccessToken);
  }
  await assertDirectStorageDenied(memberAccessToken);

  let profile = await rpc("ensure_member_profile", { p_auth_user_id: fixtureIds.user }).then((r) => r.body);
  profile = await finalizeSyntheticEvidence("photo", profile.profile_revision, profile.critical_identity_version);
  const firstPhoto = cleanupFiles.at(-1).id;
  profile = await finalizeSyntheticEvidence("photo", profile.profile_revision, profile.critical_identity_version);
  const secondPhoto = cleanupFiles.at(-1).id;
  let filesResponse = await fetchJson(`/rest/v1/app_profile_files?select=file_id,kind,state,critical_identity_version&guest_id=eq.${guestId}&order=file_id.asc`);
  assert.equal(filesResponse.response.ok, true);
  const readyPhotos = filesResponse.body.filter((item) => item.kind === "photo" && item.state === "ready");
  assert.equal(readyPhotos.length, 2);
  assert.ok(readyPhotos.every((item) => item.critical_identity_version === profile.critical_identity_version), "adding a second photo must rebind the full current evidence set");
  assert.ok([firstPhoto, secondPhoto].every((id) => readyPhotos.some((item) => item.file_id === id)));

  profile = await finalizeSyntheticEvidence("selfie", profile.profile_revision, profile.critical_identity_version);
  const reviewResult = await rpc("submit_member_profile", {
    p_auth_user_id: fixtureIds.user,
    p_expected_revision: profile.profile_revision,
    p_operation_id: randomUUID(),
  });
  assert.equal(reviewResult.response.ok, true, "complete photo/selfie set should submit");
  const submitted = reviewResult.body.profile;
  const review = reviewResult.body.review;
  assert.equal(review.profile_revision, submitted.profile_revision, "review must capture the post-submit profile revision");
  assert.equal(submitted.identity_status, "submitted");

  const changed = await rpc("save_member_profile", {
    p_auth_user_id: fixtureIds.user,
    p_expected_revision: submitted.profile_revision,
    p_operation_id: randomUUID(),
    p_first_name: submitted.first_name,
    p_last_name: submitted.last_name,
    p_date_of_birth: submitted.date_of_birth,
    p_identity: submitted.identity,
    p_open_to: submitted.open_to,
    p_match_age_min: 24,
    p_match_age_max: 120,
    p_neighborhood: submitted.neighborhood,
    p_nights: submitted.nights,
    p_looking_for: submitted.looking_for,
    p_surprise_game: submitted.surprise_game,
    p_phone: submitted.phone,
    p_one_liner: submitted.one_liner,
  });
  assert.equal(changed.response.ok, true, "preference-only save during submitted review should preserve review");
  assert.equal(changed.body.identity_status, "submitted");

  const detail = await rpc("prepare_identity_review_read", {
    p_actor_user_id: fixtureIds.admin,
    p_guest_id: guestId,
    p_review_id: review.review_id,
    p_expected_identity_version: changed.body.critical_identity_version,
    p_request_id: randomUUID(),
  });
  assert.equal(detail.response.ok, true);
  const detailFiles = detail.body.files;
  const confirm = await rpc("confirm_identity_review_read_set", {
    p_actor_user_id: fixtureIds.admin,
    p_guest_id: guestId,
    p_review_id: review.review_id,
    p_expected_identity_version: changed.body.critical_identity_version,
    p_request_id: randomUUID(),
    p_file_ids: detailFiles.map((file) => file.file_id),
  });
  assert.equal(confirm.response.ok, true, "admin evidence audit/read-set check failed");
  assert.equal(confirm.body.length, 3);

  const criticalEdit = await rpc("save_member_profile", {
    p_auth_user_id: fixtureIds.user,
    p_expected_revision: changed.body.profile_revision,
    p_operation_id: randomUUID(),
    p_first_name: changed.body.first_name,
    p_last_name: changed.body.last_name,
    p_date_of_birth: "1990-04-15",
    p_identity: changed.body.identity,
    p_open_to: changed.body.open_to,
    p_match_age_min: changed.body.match_age_min,
    p_match_age_max: changed.body.match_age_max,
    p_neighborhood: changed.body.neighborhood,
    p_nights: changed.body.nights,
    p_looking_for: changed.body.looking_for,
    p_surprise_game: changed.body.surprise_game,
    p_phone: changed.body.phone,
    p_one_liner: changed.body.one_liner,
  });
  assert.equal(criticalEdit.response.ok, true, "critical edit should save while invalidating a submitted review");
  assert.equal(criticalEdit.body.guest_id, guestId, "critical edit must stay bound to this synthetic member");
  assert.equal(criticalEdit.body.identity_status, "draft");
  assert.equal(criticalEdit.body.critical_identity_version, changed.body.critical_identity_version + 1);
  const persistedCriticalEdit = await fetchJson(`/rest/v1/app_member_profiles?select=guest_id,profile_revision,critical_identity_version,identity_status&guest_id=eq.${criticalEdit.body.guest_id}`);
  assert.equal(persistedCriticalEdit.response.ok, true);
  assert.equal(persistedCriticalEdit.body.length, 1, "critical edit should persist the member profile before stale-decision recovery");
  const staleDecision = await rpc("decide_identity_review", {
    p_actor_user_id: fixtureIds.admin,
    p_guest_id: criticalEdit.body.guest_id,
    p_review_id: review.review_id,
    p_expected_revision: changed.body.profile_revision,
    p_operation_id: randomUUID(),
    p_decision: "approved",
    p_correction_reason: null,
  });
  assert.equal(staleDecision.response.ok, false, "stale review must not approve after a critical profile edit");
  assert.equal(staleDecision.body.message, "review_revision_conflict");
  const supersededFiles = await fetchJson(`/rest/v1/app_profile_files?select=state,normalized_key,retention_due_at&guest_id=eq.${guestId}&order=file_id.asc`);
  assert.equal(supersededFiles.response.ok, true);
  assert.ok(supersededFiles.body.filter((file) => file.state === "superseded").length >= 3);
  assert.ok(supersededFiles.body.filter((file) => file.state === "superseded").every((file) => file.normalized_key && file.retention_due_at),
    "superseded evidence keeps its private cleanup pointer until retention expires");

  let currentProfile = criticalEdit.body;
  currentProfile = await finalizeSyntheticEvidence("photo", currentProfile.profile_revision, currentProfile.critical_identity_version);
  currentProfile = await finalizeSyntheticEvidence("selfie", currentProfile.profile_revision, currentProfile.critical_identity_version);
  const resubmitted = await rpc("submit_member_profile", {
    p_auth_user_id: fixtureIds.user,
    p_expected_revision: currentProfile.profile_revision,
    p_operation_id: randomUUID(),
  });
  assert.equal(resubmitted.response.ok, true, "critical edit should require new evidence and a new review attempt");
  assert.equal(resubmitted.body.review.attempt_number, 2);
  const currentReview = resubmitted.body.review;

  const decision = await rpc("decide_identity_review", {
    p_actor_user_id: fixtureIds.admin,
    p_guest_id: guestId,
    p_review_id: currentReview.review_id,
    p_expected_revision: resubmitted.body.profile.profile_revision,
    p_operation_id: randomUUID(),
    p_decision: "approved",
    p_correction_reason: null,
  });
  assert.equal(decision.response.ok, true, "fresh attempt should approve after a critical edit and new evidence");
  assert.equal(decision.body.profile.reviewed_identity_version, decision.body.profile.critical_identity_version);
  assert.equal(decision.body.profile.identity_status, "approved");

  const audit = await fetchJson(`/rest/v1/app_audit_events?select=action,actor_user_id,subject_type,subject_id,request_id,metadata&subject_id=in.(${detailFiles.map((f) => f.file_id).join(",")})`);
  assert.equal(audit.response.ok, true);
  const readEvents = audit.body.filter((item) => item.action === "identity.evidence.read");
  assert.ok(readEvents.length >= detailFiles.length * 2);
  assert.ok(readEvents.every((event) => event.actor_user_id === fixtureIds.admin && event.subject_type === "profile_file"
    && event.metadata.guest_id === guestId && event.metadata.critical_identity_version === changed.body.critical_identity_version));

  const due = await fetchJson(`/rest/v1/app_profile_files?guest_id=eq.${guestId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ retention_due_at: "2000-01-01T00:00:00Z" }),
  });
  assert.ok(due.response.ok);
  const claimed = await rpc("claim_due_profile_evidence_cleanup", { p_limit: 10 });
  assert.equal(claimed.response.ok, true);
  assert.equal(claimed.body.length, 5, "the three superseded originals and two approved current files should be eligible after their retention markers are due");
  for (const row of claimed.body) {
    const finish = await rpc("finish_profile_evidence_cleanup", { p_file_id: row.file_id, p_claimed_at: row.cleanup_claimed_at });
    assert.equal(finish.response.ok, true);
  }
  const afterPurge = await rpc("ensure_member_profile", { p_auth_user_id: fixtureIds.user });
  assert.equal(afterPurge.body.identity_status, "approved");
  assert.equal(afterPurge.body.reviewed_identity_version, afterPurge.body.critical_identity_version);
  assert.ok(afterPurge.body.evidence_received_at);
  assert.ok(afterPurge.body.evidence_deleted_at);
  filesResponse = await fetchJson(`/rest/v1/app_profile_files?select=state,deleted_at&guest_id=eq.${guestId}`);
  assert.ok(filesResponse.body.every((item) => item.state === "deleted" && item.deleted_at));

  const names = await Promise.all([
    fetchJson(`/rest/v1/app_audit_events?select=action,actor_user_id,subject_type,subject_id,metadata&subject_id=eq.${currentReview.review_id}`),
  ]);
  assert.ok(names[0].response.ok);
  const decisionAudit = names[0].body.find((item) => item.action === "identity.review.decided");
  assert.ok(decisionAudit);
  assert.equal(decisionAudit.actor_user_id, fixtureIds.admin);
  assert.equal(decisionAudit.subject_type, "identity_review");
  assert.equal(decisionAudit.metadata.decision, "approved");
  assert.equal(decisionAudit.metadata.critical_identity_version, decision.body.profile.critical_identity_version);

  console.log("W04 profile DB checks passed: role denials, evidence-set versioning, preference edit, stale-decision conflict, critical-edit invalidation, fresh review, approval, and version-safe retention");
}

// Rollback-only DB edge cases: 21+ birthdate cutoff (America/New_York), 29 Feb, 21-120 matching bounds. Leaves no rows.
function assertDobAndAgeRangeEdges() {
  const sql = `begin;
do $edge$ declare
  today date := timezone('America/New_York', now())::date;
  cutoff date := (timezone('America/New_York', now())::date - interval '21 years')::date;
  u uuid := gen_random_uuid(); s uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  em text := 'edge-' || replace(gen_random_uuid()::text,'-','') || '@example.test';
  n integer := 0;
  -- attempt an insert into one of the two age-constrained tables; return sqlstate or 'ok'
  r text;
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (u,'authenticated','authenticated',em,now(),'','{}','{}',now(),now());
  insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game)
    values (s,em,'Edge','Case','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me');
  insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at)
    values (a,s,em,'activated',u,u,now());
  insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game)
    values (gen_random_uuid(),u,a,'Edge','Case',cutoff,'woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me');  -- exactly 21 today passes
  update public.app_member_profiles set date_of_birth=date '2004-02-29' where auth_user_id=u;  -- 29 Feb birthdate, long past 21
  update public.app_member_profiles set match_age_min=21,match_age_max=120 where auth_user_id=u;  -- 21 and 120 both accepted

  -- each bad update must fail with check_violation (23514) and not change the row
  foreach r in array array[
    format('date_of_birth=%L', cutoff + 1),                      -- turns 21 tomorrow
    format('date_of_birth=%L', today),
    'match_age_min=20,match_age_max=120',
    'match_age_min=21,match_age_max=121',                        -- 121 refused as upper bound
    'match_age_min=30,match_age_max=29'                          -- inverted range
  ] loop
    begin execute 'update public.app_member_profiles set '||r||' where auth_user_id='||quote_literal(u);
      raise exception 'profile accepted %', r;
    exception when check_violation then n := n + 1; end;
  end loop;
  if n<>5 then raise exception 'expected 5 refusals, got %', n; end if;
  if (select date_of_birth from public.app_member_profiles where auth_user_id=u) <> date '2004-02-29' then raise exception 'row changed by refused update'; end if;

  -- waitlist_signups: same 21+ cutoff and 21-120 range
  update public.waitlist_signups set birthdate=cutoff where id=s;
  update public.waitlist_signups set match_age_min=21,match_age_max=120 where id=s;
  n := 0;
  foreach r in array array[format('birthdate=%L', cutoff + 1),'match_age_min=20','match_age_max=121','match_age_min=40,match_age_max=39'] loop
    begin execute 'update public.waitlist_signups set '||r||' where id='||quote_literal(s);
      raise exception 'signup accepted %', r;
    exception when check_violation then n := n + 1; end;
  end loop;
  if n<>4 then raise exception 'expected 4 signup refusals, got %', n; end if;

  -- 21 + 29 Feb arithmetic the cutoff and age() rely on: leap-day birth turns 21 on 1 Mar in a non-leap year
  if (date '2025-02-28' - interval '21 years')::date <> date '2004-02-28' or (date '2025-03-01' - interval '21 years')::date <> date '2004-03-01' then raise exception 'cutoff arithmetic changed'; end if;
  if date '2004-02-29' <= (date '2025-02-28' - interval '21 years')::date then raise exception '29 Feb birth counted as 21 on 28 Feb'; end if;
  if date '2004-02-29' > (date '2025-03-01' - interval '21 years')::date then raise exception '29 Feb birth not 21 on 1 Mar'; end if;
  if extract(year from age(date '2025-02-28', date '2004-02-29'))::integer <> 20 or extract(year from age(date '2025-03-01', date '2004-02-29'))::integer <> 21 then raise exception 'age() leap-day semantics changed'; end if;
  -- age 120 / 121 as a computed attendee age
  if extract(year from age(date '2026-11-15', date '1906-11-15'))::integer <> 120 or extract(year from age(date '2026-11-15', date '1905-11-15'))::integer <> 121 then raise exception 'age 120/121 arithmetic'; end if;
end $edge$;
rollback;`;
  const r = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const left = run("psql", [dbUrl, "-X", "-At", "-c", "select count(*) from auth.users where email like 'edge-%@example.test'"]);
  assert.equal(left.stdout.trim(), "0", "dob edge check left rows");
  console.log("W04 DOB/age-range edges passed: 21 today ok, 21 tomorrow refused, 29 Feb, 21-120 bounds, inverted range; rolled back");
}

async function runMain() {
  assertGuardedTestStack();
  assertDobAndAgeRangeEdges();
  try {
    await main();
  } finally {
    await cleanup();
  }
}

runMain().catch((error) => {
  console.error(error instanceof Error ? error.message : "W04 local DB check failed");
  process.exitCode = 1;
});
