#!/usr/bin/env node

// Isolated local DB checks for durable invitation attempts and the matching-age
// upper bound. This runner never starts, resets, or links a Supabase project.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(appRoot, "test-stack");
const expectedApi = "http://127.0.0.1:57421";
const expectedDb = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const databaseUrl = process.env.TEST_ADMISSION_DATABASE_URL ?? expectedDb;
const testConfig = join(testWorkdir, "supabase", "config.toml");
const linkRef = join(testWorkdir, "supabase", ".temp", "project-ref");

const fixture = Object.freeze({
  adminId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e",
  nonAdminId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df30",
  signupId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df61",
  unknownSignupId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df62",
  admissionId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df63",
  unknownAdmissionId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df64",
  activationSignupId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df70",
  deletedSignupId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df71",
  activationAdmissionId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df72",
  deletedAdmissionId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df73",
  deliveryId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df65",
  unknownDeliveryId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df66",
  queueOperationId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df67",
  unknownQueueOperationId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df68",
  attemptOperationId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df69",
  staleAttemptOperationId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df6a",
  unknownAttemptOperationId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df6b",
  forbiddenAttemptOperationId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df6c",
  staleAttemptId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df6d",
  adminEmail: "attempt-rpc-admin@example.test",
  nonAdminEmail: "attempt-rpc-nonadmin@example.test",
  signupEmail: "attempt-rpc-first@example.test",
  unknownSignupEmail: "attempt-rpc-unknown@example.test",
  activationSignupEmail: "attempt-rpc-activation@example.test",
  deletedSignupEmail: "attempt-rpc-deleted@example.test",
});

function fail(message) {
  console.error(`invitation-attempt-test: ${message}`);
  process.exit(1);
}

function preflight() {
  if (!existsSync(testConfig)) throw new Error("isolated test config is missing");
  const config = readFileSync(testConfig, "utf8");
  if (!/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(config)) throw new Error("wrong test project_id");
  if (!/^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m.test(config)) throw new Error("wrong test API port");
  if (!/^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m.test(config)) throw new Error("wrong test database port");
  if (existsSync(linkRef)) throw new Error("linked project metadata exists in test workdir");
  if (databaseUrl !== expectedDb) throw new Error("test database URL does not match isolated database");
  if (process.env.SUPABASE_PROJECT_REF) throw new Error("refusing SUPABASE_PROJECT_REF");
  for (const [key, expected] of [["SUPABASE_URL", expectedApi], ["SUPABASE_DB_URL", expectedDb], ["DATABASE_URL", expectedDb]]) {
    if (process.env[key] && process.env[key] !== expected) throw new Error(`refusing non-target ${key}`);
  }
  for (const path of [join(appRoot, ".env.test.local"), join(testWorkdir, ".env.test.local")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL|SUPABASE_URL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, key, raw] = match;
      const value = raw.replace(/^['"]|['"]$/g, "").replace(/\s+#.*$/, "");
      const expected = key === "SUPABASE_URL" ? expectedApi : expectedDb;
      if (key === "SUPABASE_PROJECT_REF" || value !== expected) throw new Error(`refusing non-target ${key} in ${path}`);
    }
  }

  const guarded = spawnSync("node", [join(appRoot, "scripts", "local-supabase.mjs"), "test", "status"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (guarded.status !== 0) throw new Error("guarded local test status failed");

  const statusResult = spawnSync("supabase", ["status", "--workdir", testWorkdir, "-o", "json"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (statusResult.status !== 0) throw new Error("local test project status is unavailable");
  const firstBrace = statusResult.stdout.indexOf("{");
  const lastBrace = statusResult.stdout.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) throw new Error("local status response is malformed");
  const status = JSON.parse(statusResult.stdout.slice(firstBrace, lastBrace + 1));
  if (status.API_URL !== expectedApi || status.DB_URL !== expectedDb) throw new Error("running target is not the isolated test project");

  const procedures = spawnSync("psql", [databaseUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (to_regprocedure('public.begin_invitation_delivery_attempt(uuid,uuid,uuid)') is not null)::text || '|' || (to_regprocedure('public.finish_invitation_delivery_attempt(uuid,text,text,text,timestamp with time zone)') is not null)::text || '|' || (to_regprocedure('public.activate_app_admission(uuid,text,timestamp with time zone)') is not null)::text || '|' || (to_regprocedure('public.claim_member_link_cooldown(uuid,timestamp with time zone,integer)') is not null)::text || '|' || (to_regprocedure('public.reconcile_unknown_invitation_attempt(uuid,text,text,timestamp with time zone)') is not null)::text"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  if (procedures.status !== 0 || procedures.stdout.trim() !== "true|true|true|true|true") throw new Error("required admission and recovery RPC migrations are not applied to test target");
}

const setupSql = `
begin;
do $fixture_guard$
begin
  if exists (select 1 from auth.users where id in ('${fixture.adminId}', '${fixture.nonAdminId}') or email in ('${fixture.adminEmail}', '${fixture.nonAdminEmail}'))
    or exists (select 1 from public.waitlist_signups where id in ('${fixture.signupId}', '${fixture.unknownSignupId}', '${fixture.activationSignupId}', '${fixture.deletedSignupId}') or email_normalized in ('${fixture.signupEmail}', '${fixture.unknownSignupEmail}', '${fixture.activationSignupEmail}', '${fixture.deletedSignupEmail}'))
    or exists (select 1 from public.app_admissions where id in ('${fixture.activationAdmissionId}', '${fixture.deletedAdmissionId}'))
    or exists (select 1 from public.app_invitation_deliveries where id in ('${fixture.deliveryId}', '${fixture.unknownDeliveryId}') or operation_id in ('${fixture.queueOperationId}', '${fixture.unknownQueueOperationId}'))
    or exists (select 1 from public.app_invitation_delivery_attempts where operation_id in ('${fixture.attemptOperationId}', '${fixture.staleAttemptOperationId}', '${fixture.unknownAttemptOperationId}', '${fixture.forbiddenAttemptOperationId}'))
    or exists (select 1 from public.app_audit_events where operation_id in ('${fixture.attemptOperationId}', '${fixture.staleAttemptOperationId}', '${fixture.unknownAttemptOperationId}', '${fixture.forbiddenAttemptOperationId}'))
  then raise exception 'deterministic invitation attempt fixture already exists'; end if;
end;
$fixture_guard$;

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('${fixture.adminId}', 'authenticated', 'authenticated', '${fixture.adminEmail}', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('${fixture.nonAdminId}', 'authenticated', 'authenticated', '${fixture.nonAdminEmail}', '', '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.app_user_roles (user_id, role) values ('${fixture.adminId}', 'admin');
insert into public.waitlist_signups (
  id,email_normalized,first_name,last_name,birthdate,identity,open_to,
  match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game,source
) values
  ('${fixture.signupId}','${fixture.signupEmail}','Test','Attempt','1990-01-01','Woman',array['Women'],21,120,'Inman Park',array[]::text[],'synthetic','Open','Yes, surprise me','landing-page'),
  ('${fixture.unknownSignupId}','${fixture.unknownSignupEmail}','Test','Unknown','1990-01-01','Man',array['Men'],21,120,'Chamblee',array[]::text[],'synthetic','Open','Yes, surprise me','landing-page'),
  ('${fixture.activationSignupId}','${fixture.activationSignupEmail}','Test','Activation','1990-01-01','Woman',array['Women'],21,120,'Inman Park',array[]::text[],'synthetic','Open','Yes, surprise me','landing-page'),
  ('${fixture.deletedSignupId}','${fixture.deletedSignupEmail}','Test','Deleted','1990-01-01','Man',array['Men'],21,120,'Chamblee',array[]::text[],'synthetic','Open','Yes, surprise me','landing-page');
insert into public.app_admissions (id,waitlist_signup_id,email_normalized,state,approved_by,approved_at,activated_at,deleted_at)
values
  ('${fixture.admissionId}','${fixture.signupId}','${fixture.signupEmail}','invited','${fixture.adminId}',now(),null,null),
  ('${fixture.unknownAdmissionId}','${fixture.unknownSignupId}','${fixture.unknownSignupEmail}','invited','${fixture.adminId}',now(),null,null),
  ('${fixture.activationAdmissionId}','${fixture.activationSignupId}','${fixture.activationSignupEmail}','invited','${fixture.adminId}',now(),null,null),
  ('${fixture.deletedAdmissionId}','${fixture.deletedSignupId}','${fixture.deletedSignupEmail}','deleted','${fixture.adminId}',now(),null,now());
insert into public.app_invitation_deliveries (id,admission_id,operation_id,state,created_by)
values
  ('${fixture.deliveryId}','${fixture.admissionId}','${fixture.queueOperationId}','queued','${fixture.adminId}'),
  ('${fixture.unknownDeliveryId}','${fixture.unknownAdmissionId}','${fixture.unknownQueueOperationId}','queued','${fixture.adminId}');
commit;
`;

const cleanupSql = `
begin;
delete from public.app_audit_events where operation_id in ('${fixture.attemptOperationId}','${fixture.staleAttemptOperationId}','${fixture.unknownAttemptOperationId}','${fixture.forbiddenAttemptOperationId}') or subject_id='${fixture.activationAdmissionId}';
delete from public.app_invitation_delivery_attempts where delivery_id in ('${fixture.deliveryId}','${fixture.unknownDeliveryId}');
delete from public.app_invitation_deliveries where id in ('${fixture.deliveryId}','${fixture.unknownDeliveryId}');
delete from public.app_admissions where id in ('${fixture.admissionId}','${fixture.unknownAdmissionId}');
delete from public.app_admissions where id in ('${fixture.activationAdmissionId}','${fixture.deletedAdmissionId}');
delete from public.waitlist_signups where id in ('${fixture.signupId}','${fixture.unknownSignupId}','${fixture.activationSignupId}','${fixture.deletedSignupId}');
delete from public.app_user_roles where user_id = '${fixture.adminId}' and role = 'admin';
delete from auth.users where id = '${fixture.adminId}' and email = '${fixture.adminEmail}';
delete from auth.users where id = '${fixture.nonAdminId}' and email = '${fixture.nonAdminEmail}';
commit;
`;

function runPsql(sql) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("psql", [databaseUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
      cwd: appRoot,
      env: { ...process.env, PGPASSWORD: "postgres" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => resolveRun({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function callBegin(operationId, deliveryId = fixture.deliveryId, actorId = fixture.adminId) {
  return runPsql(`set role service_role; select public.begin_invitation_delivery_attempt('${deliveryId}','${operationId}','${actorId}');`);
}

async function test() {
  let fixturesCreated = false;
  try {
    preflight();

    // Boundary proof runs inside a rolled-back transaction. Applicant DOB is
    // over 21 for both rows; only match-age preference max differs.
    const ageBoundary = await runPsql(`
      begin;
      insert into public.waitlist_signups (email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game,source)
      values ('age-120-${fixture.signupEmail}','Age','Max','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me','landing-page');
      do $age_121$
      begin
        begin
          insert into public.waitlist_signups (email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game,source)
          values ('age-121-${fixture.signupEmail}','Age','TooHigh','1990-01-01','Woman',array['Women'],21,121,'Inman Park','Open','Yes, surprise me','landing-page');
          raise exception 'age_121_unexpectedly_accepted';
        exception when check_violation then null;
        end;
      end;
      $age_121$;
      rollback;
      select '120-accepted|121-rejected';
    `);
    if (ageBoundary.code !== 0 || ageBoundary.stdout !== "120-accepted|121-rejected") throw new Error(`matching age boundary check failed: ${ageBoundary.stderr}`);

    const setup = await runPsql(setupSql);
    if (setup.code !== 0) throw new Error(`fixture setup failed: ${setup.stderr}`);
    fixturesCreated = true;

    const activation = await runPsql(`set role service_role; select public.activate_app_admission('${fixture.adminId}','${fixture.activationSignupEmail}',clock_timestamp());`);
    assert.equal(activation.code, 0, activation.stderr);
    assert.equal(JSON.parse(activation.stdout).kind, "activated");
    const activationReplay = await runPsql(`set role service_role; select public.activate_app_admission('${fixture.adminId}','${fixture.activationSignupEmail}',clock_timestamp());`);
    assert.equal(JSON.parse(activationReplay.stdout).kind, "already_active");
    const activationCrossUser = await runPsql(`set role service_role; select public.activate_app_admission('${fixture.nonAdminId}','${fixture.activationSignupEmail}',clock_timestamp());`);
    assert.equal(JSON.parse(activationCrossUser.stdout).kind, "not_admitted");
    const deletedActivation = await runPsql(`set role service_role; select public.activate_app_admission('${fixture.adminId}','${fixture.deletedSignupEmail}',clock_timestamp());`);
    assert.equal(JSON.parse(deletedActivation.stdout).kind, "not_admitted");
    const activationState = await runPsql(`select state || '|' || auth_user_id::text || '|' || (activated_at is not null)::text from public.app_admissions where id='${fixture.activationAdmissionId}'`);
    assert.equal(activationState.stdout, `activated|${fixture.adminId}|true`);

    const cooldownClaims = await Promise.all(Array.from({ length: 8 }, () => runPsql(`set role service_role; select public.claim_member_link_cooldown('${fixture.activationAdmissionId}',clock_timestamp(),300);`)));
    for (const result of cooldownClaims) assert.equal(result.code, 0, result.stderr);
    assert.equal(cooldownClaims.filter((result) => result.stdout === "t").length, 1, "concurrent recipient cooldown admits only one request");
    const cooldownRepeat = await runPsql(`set role service_role; select public.claim_member_link_cooldown('${fixture.activationAdmissionId}',clock_timestamp(),300);`);
    assert.equal(cooldownRepeat.stdout, "f");
    const cooldownDenied = await runPsql(`set role service_role; select public.claim_member_link_cooldown('${fixture.deletedAdmissionId}',clock_timestamp(),300);`);
    assert.equal(cooldownDenied.stdout, "f", "deleted admission cannot request a link");
    const nullCooldown = await runPsql(`set role service_role; select public.claim_member_link_cooldown('${fixture.activationAdmissionId}',clock_timestamp(),null);`);
    assert.notEqual(nullCooldown.code, 0);
    assert.match(nullCooldown.stderr, /invalid_input/);

    const grants = await runPsql(`
      select has_function_privilege('anon','public.begin_invitation_delivery_attempt(uuid,uuid,uuid)','EXECUTE') || '|' ||
             has_function_privilege('authenticated','public.begin_invitation_delivery_attempt(uuid,uuid,uuid)','EXECUTE') || '|' ||
             has_function_privilege('service_role','public.begin_invitation_delivery_attempt(uuid,uuid,uuid)','EXECUTE') || '|' ||
             has_function_privilege('anon','public.finish_invitation_delivery_attempt(uuid,text,text,text,timestamptz)','EXECUTE') || '|' ||
             has_function_privilege('authenticated','public.finish_invitation_delivery_attempt(uuid,text,text,text,timestamptz)','EXECUTE') || '|' ||
             has_function_privilege('service_role','public.finish_invitation_delivery_attempt(uuid,text,text,text,timestamptz)','EXECUTE')
    `);
    assert.equal(grants.code, 0, grants.stderr);
    assert.equal(grants.stdout, "false|false|true|false|false|true");

    const authRpcGrants = await runPsql(`
      select has_function_privilege('anon','public.activate_app_admission(uuid,text,timestamptz)','EXECUTE') || '|' ||
             has_function_privilege('authenticated','public.activate_app_admission(uuid,text,timestamptz)','EXECUTE') || '|' ||
             has_function_privilege('service_role','public.activate_app_admission(uuid,text,timestamptz)','EXECUTE') || '|' ||
             has_function_privilege('anon','public.claim_member_link_cooldown(uuid,timestamptz,integer)','EXECUTE') || '|' ||
             has_function_privilege('authenticated','public.claim_member_link_cooldown(uuid,timestamptz,integer)','EXECUTE') || '|' ||
             has_function_privilege('service_role','public.claim_member_link_cooldown(uuid,timestamptz,integer)','EXECUTE') || '|' ||
             has_function_privilege('anon','public.reconcile_unknown_invitation_attempt(uuid,text,text,timestamptz)','EXECUTE') || '|' ||
             has_function_privilege('authenticated','public.reconcile_unknown_invitation_attempt(uuid,text,text,timestamptz)','EXECUTE') || '|' ||
             has_function_privilege('service_role','public.reconcile_unknown_invitation_attempt(uuid,text,text,timestamptz)','EXECUTE')
    `);
    assert.equal(authRpcGrants.code, 0, authRpcGrants.stderr);
    assert.equal(authRpcGrants.stdout, "false|false|true|false|false|true|false|false|true");

    const denied = await Promise.all([
      runPsql(`set role anon; select public.begin_invitation_delivery_attempt('${fixture.deliveryId}','${fixture.forbiddenAttemptOperationId}','${fixture.adminId}')`),
      runPsql(`set role authenticated; select public.begin_invitation_delivery_attempt('${fixture.deliveryId}','${fixture.forbiddenAttemptOperationId}','${fixture.adminId}')`),
      runPsql(`set role service_role; select public.begin_invitation_delivery_attempt('${fixture.deliveryId}','${fixture.forbiddenAttemptOperationId}','${fixture.nonAdminId}')`),
      runPsql(`set role anon; select public.activate_app_admission('${fixture.adminId}','${fixture.activationSignupEmail}',clock_timestamp())`),
      runPsql(`set role authenticated; select public.claim_member_link_cooldown('${fixture.activationAdmissionId}',clock_timestamp(),300)`),
    ]);
    assert.notEqual(denied[0].code, 0); assert.match(denied[0].stderr, /permission denied for function/);
    assert.notEqual(denied[1].code, 0); assert.match(denied[1].stderr, /permission denied for function/);
    assert.notEqual(denied[2].code, 0); assert.match(denied[2].stderr, /admin_required/);
    assert.notEqual(denied[3].code, 0); assert.match(denied[3].stderr, /permission denied for function/);
    assert.notEqual(denied[4].code, 0); assert.match(denied[4].stderr, /permission denied for function/);

    const claims = await Promise.all(Array.from({ length: 8 }, () => callBegin(fixture.attemptOperationId)));
    for (const result of claims) if (result.code !== 0) throw new Error(`concurrent claim failed: ${result.stderr}`);
    const claimPayloads = claims.map((result) => JSON.parse(result.stdout));
    const attemptIds = new Set(claimPayloads.map((item) => item.attempt.id));
    assert.equal(attemptIds.size, 1, "concurrent duplicate operation calls share one attempt");
    assert.equal(claimPayloads.filter((item) => item.created).length, 1, "one concurrent call creates the attempt");
    const firstAttempt = claimPayloads[0].attempt;
    assert.equal(firstAttempt.operation_id, fixture.attemptOperationId);
    assert.equal(firstAttempt.operation_id === fixture.queueOperationId, false, "attempt key is distinct from queue operation key");
    assert.equal(firstAttempt.started_by_user_id, fixture.adminId);
    assert.equal(firstAttempt.state, "sending");
    assert.equal(firstAttempt.attempt_number, 1);

    const replay = await callBegin(fixture.attemptOperationId);
    assert.equal(replay.code, 0, replay.stderr);
    const replayPayload = JSON.parse(replay.stdout);
    assert.equal(replayPayload.created, false);
    assert.equal(replayPayload.attempt.id, firstAttempt.id);

    // Simulate a newer current attempt becoming authoritative while the first
    // worker is still in flight, then prove the first worker cannot overwrite it.
    const newerSetup = await runPsql(`
      begin;
      update public.app_invitation_deliveries set attempt_count=2,state='sending',attempted_at=now(),lease_until=now()+interval '10 minutes' where id='${fixture.deliveryId}';
      insert into public.app_invitation_delivery_attempts (id,delivery_id,operation_id,started_by_user_id,attempt_number,state,started_at)
      values ('${fixture.staleAttemptId}','${fixture.deliveryId}','${fixture.staleAttemptOperationId}','${fixture.adminId}',2,'sending',now());
      commit;
    `);
    assert.equal(newerSetup.code, 0, newerSetup.stderr);
    const stale = await runPsql(`set role service_role; select public.finish_invitation_delivery_attempt('${firstAttempt.id}','accepted','stale-worker-msg',null,clock_timestamp());`);
    assert.notEqual(stale.code, 0);
    assert.match(stale.stderr, /stale_or_invalid_attempt_finish/);
    const noOverwrite = await runPsql(`
      select delivery.state || '|' || delivery.attempt_count || '|' || old_attempt.state || '|' || new_attempt.state
      from public.app_invitation_deliveries delivery
      join public.app_invitation_delivery_attempts old_attempt on old_attempt.id='${firstAttempt.id}'
      join public.app_invitation_delivery_attempts new_attempt on new_attempt.id='${fixture.staleAttemptId}'
      where delivery.id='${fixture.deliveryId}'
    `);
    assert.equal(noOverwrite.stdout, "sending|2|sending|sending");

    const finished = await runPsql(`set role service_role; select public.finish_invitation_delivery_attempt('${fixture.staleAttemptId}','accepted','current-worker-msg',null,clock_timestamp());`);
    assert.equal(finished.code, 0, finished.stderr);
    const duplicateFinish = await runPsql(`set role service_role; select public.finish_invitation_delivery_attempt('${fixture.staleAttemptId}','accepted','current-worker-msg',null,(select finished_at from public.app_invitation_delivery_attempts where id='${fixture.staleAttemptId}'));`);
    assert.equal(duplicateFinish.code, 0, duplicateFinish.stderr);
    const accepted = await runPsql(`select state || '|' || provider_message_id || '|' || (accepted_at is not null)::text || '|' || (lease_until is null)::text from public.app_invitation_deliveries where id='${fixture.deliveryId}'`);
    assert.equal(accepted.stdout, "accepted|current-worker-msg|true|true");

    const unknownClaim = await callBegin(fixture.unknownAttemptOperationId, fixture.unknownDeliveryId);
    assert.equal(unknownClaim.code, 0, unknownClaim.stderr);
    const unknownAttempt = JSON.parse(unknownClaim.stdout).attempt;
    const markUnknown = await runPsql(`set role service_role; select public.finish_invitation_delivery_attempt('${unknownAttempt.id}','unknown',null,'provider_outcome_unknown',clock_timestamp());`);
    assert.equal(markUnknown.code, 0, markUnknown.stderr);
    const retryUnknown = await runPsql(`set role service_role; select coalesce(public.begin_invitation_delivery_attempt('${fixture.unknownDeliveryId}','${fixture.forbiddenAttemptOperationId}','${fixture.adminId}')::text,'NULL');`);
    assert.equal(retryUnknown.code, 0, retryUnknown.stderr);
    assert.equal(retryUnknown.stdout, "NULL", "unknown delivery is never re-sent by the claim RPC");
    const unknownState = await runPsql(`
      select delivery.state || '|' || attempt.state || '|' || (delivery.lease_until is null)::text || '|' ||
        (select count(*) from public.app_invitation_delivery_attempts where delivery_id='${fixture.unknownDeliveryId}')
      from public.app_invitation_deliveries delivery
      join public.app_invitation_delivery_attempts attempt on attempt.delivery_id=delivery.id
      where delivery.id='${fixture.unknownDeliveryId}'
    `);
    assert.equal(unknownState.stdout, "unknown|unknown|true|1");

    const reconcile = await runPsql(`set role service_role; select public.reconcile_unknown_invitation_attempt('${unknownAttempt.id}','accepted','mailpit-reconciled-1',clock_timestamp());`);
    assert.equal(reconcile.code, 0, reconcile.stderr);
    assert.equal(JSON.parse(reconcile.stdout).changed, true);
    const reconcileState = await runPsql(`select delivery.state || '|' || attempt.state || '|' || delivery.provider_message_id from public.app_invitation_deliveries delivery join public.app_invitation_delivery_attempts attempt on attempt.delivery_id=delivery.id where delivery.id='${fixture.unknownDeliveryId}'`);
    assert.equal(reconcileState.stdout, "accepted|accepted|mailpit-reconciled-1");
    const reconcileReplay = await runPsql(`set role service_role; select public.reconcile_unknown_invitation_attempt('${unknownAttempt.id}','accepted','mailpit-reconciled-1',clock_timestamp());`);
    assert.notEqual(reconcileReplay.code, 0, "a resolved attempt cannot be rewritten by a later provider result");

    const deniedRows = await runPsql(`
      select (select count(*) from public.app_invitation_delivery_attempts where operation_id='${fixture.forbiddenAttemptOperationId}') || '|' ||
             (select count(*) from public.app_audit_events where operation_id in ('${fixture.attemptOperationId}','${fixture.staleAttemptOperationId}','${fixture.unknownAttemptOperationId}','${fixture.forbiddenAttemptOperationId}') and actor_user_id='${fixture.nonAdminId}')
    `);
    assert.equal(deniedRows.stdout, "0|0");

    console.log("admission/auth DB test passed: age 120/121, atomic activation/replay/cross-user/deleted denial, cooldown race/deny/null guard, service-role grants, admin gate, concurrent attempt idempotency, stale finish, unknown non-resend/reconciliation");
  } finally {
    if (fixturesCreated) {
      const cleanup = await runPsql(cleanupSql);
      if (cleanup.code !== 0) throw new Error(`exact fixture cleanup failed: ${cleanup.stderr}`);
      const residual = await runPsql(`
        select
          (select count(*) from auth.users where id in ('${fixture.adminId}','${fixture.nonAdminId}')) || '|' ||
          (select count(*) from public.waitlist_signups where id in ('${fixture.signupId}','${fixture.unknownSignupId}','${fixture.activationSignupId}','${fixture.deletedSignupId}')) || '|' ||
          (select count(*) from public.app_admissions where id in ('${fixture.admissionId}','${fixture.unknownAdmissionId}','${fixture.activationAdmissionId}','${fixture.deletedAdmissionId}')) || '|' ||
          (select count(*) from public.app_invitation_deliveries where id in ('${fixture.deliveryId}','${fixture.unknownDeliveryId}')) || '|' ||
          (select count(*) from public.app_invitation_delivery_attempts where delivery_id in ('${fixture.deliveryId}','${fixture.unknownDeliveryId}')) || '|' ||
          (select count(*) from public.app_audit_events where operation_id in ('${fixture.attemptOperationId}','${fixture.staleAttemptOperationId}','${fixture.unknownAttemptOperationId}','${fixture.forbiddenAttemptOperationId}') or subject_id='${fixture.activationAdmissionId}') || '|' ||
          (select count(*) from public.app_member_link_cooldowns where admission_id='${fixture.activationAdmissionId}')
      `);
      if (residual.code !== 0 || residual.stdout !== "0|0|0|0|0|0|0") throw new Error(`synthetic fixture residual count not zero: ${residual.stdout} ${residual.stderr}`);
      console.log("exact synthetic fixture cleanup verified: 0|0|0|0|0|0|0");
    }
  }
}

test().catch((error) => fail(error instanceof Error ? error.message : "unknown failure"));
