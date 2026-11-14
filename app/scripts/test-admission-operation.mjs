#!/usr/bin/env node

// Local integration test for the admin admission transaction. It is hard-bound
// to the isolated test Supabase workdir and never starts or resets a stack.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(appRoot, "test-stack");
const expectedApi = "http://127.0.0.1:57421";
const expectedDb = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const testConfig = join(testWorkdir, "supabase", "config.toml");
const linkRef = join(testWorkdir, "supabase", ".temp", "project-ref");
const databaseUrl = process.env.TEST_ADMISSION_DATABASE_URL ?? expectedDb;

const fixture = Object.freeze({
  adminUserId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e",
  nonAdminUserId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df30",
  firstSignupId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df31",
  secondSignupId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df32",
  operationId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df41",
  adminEmail: "admission-rpc-admin@example.test",
  nonAdminEmail: "admission-rpc-nonadmin@example.test",
  firstEmail: "admission-rpc-first@example.test",
  secondEmail: "admission-rpc-second@example.test",
});

function fail(message) {
  console.error(`admission-operation-test: ${message}`);
  process.exit(1);
}

function preflight() {
  if (!existsSync(testConfig)) throw new Error("isolated test config is missing");
  const config = readFileSync(testConfig, "utf8");
  if (!/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(config)) {
    throw new Error("active test project_id does not match fifthwheel-rewrite-test");
  }
  if (!/^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m.test(config)) {
    throw new Error("active test API port does not match 57421");
  }
  if (!/^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m.test(config)) {
    throw new Error("active test database port does not match 57422");
  }
  if (existsSync(linkRef)) throw new Error("linked Supabase project metadata exists in test workdir");
  if (databaseUrl !== expectedDb) throw new Error("test database URL does not match isolated test database");
  if (process.env.SUPABASE_PROJECT_REF) throw new Error("refusing SUPABASE_PROJECT_REF");
  const guardedEnvironment = new Map([
    ["SUPABASE_URL", expectedApi],
    ["SUPABASE_DB_URL", expectedDb],
    ["DATABASE_URL", expectedDb],
  ]);
  for (const [name, expected] of guardedEnvironment) {
    const value = process.env[name];
    if (value && value !== expected) {
      throw new Error(`refusing non-target ${name}`);
    }
  }
  for (const path of [join(appRoot, ".env.test.local"), join(testWorkdir, ".env.test.local")]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL|SUPABASE_URL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, name, raw] = match;
      const value = raw.replace(/^['"]|['"]$/g, "").replace(/\s+#.*$/, "");
      const expected = guardedEnvironment.get(name);
      if (name === "SUPABASE_PROJECT_REF" || (value && expected && value !== expected)) {
        throw new Error(`refusing non-target ${name} in ${path}`);
      }
    }
  }

  // This wrapper validates environment targets, active TOML settings, linked
  // metadata, and current local API/database addresses before any SQL is run.
  const guardedStatus = spawnSync("node", [join(appRoot, "scripts", "local-supabase.mjs"), "test", "status"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (guardedStatus.status !== 0) throw new Error("guarded test-stack status check failed");

  const statusResult = spawnSync("supabase", ["status", "--workdir", testWorkdir, "-o", "json"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (statusResult.status !== 0) throw new Error("local Supabase status unavailable");
  const firstBrace = statusResult.stdout.indexOf("{");
  const lastBrace = statusResult.stdout.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) throw new Error("local Supabase status was malformed");
  const status = JSON.parse(statusResult.stdout.slice(firstBrace, lastBrace + 1));
  if (status.API_URL !== expectedApi || status.DB_URL !== expectedDb) {
    throw new Error("running Supabase API/database does not match the isolated test ports");
  }

  const routineCheck = spawnSync("psql", [databaseUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select to_regprocedure('public.admit_waitlist_signup(uuid,uuid,uuid)') is not null"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  if (routineCheck.status !== 0 || routineCheck.stdout.trim() !== "t") {
    throw new Error("admission RPC is not applied in the isolated test database");
  }
  const grantsCheck = spawnSync("psql", [databaseUrl, "-X", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c",
    "select has_function_privilege('anon','public.admit_waitlist_signup(uuid,uuid,uuid)','EXECUTE') || '|' || has_function_privilege('authenticated','public.admit_waitlist_signup(uuid,uuid,uuid)','EXECUTE') || '|' || has_function_privilege('service_role','public.admit_waitlist_signup(uuid,uuid,uuid)','EXECUTE')"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  if (grantsCheck.status !== 0 || grantsCheck.stdout.trim() !== "false|false|true") {
    throw new Error("admission RPC execute grants are not restricted to service_role");
  }
}

const setupSql = `
begin;
do $fixture_guard$
begin
  if exists (select 1 from auth.users where id in ('${fixture.adminUserId}', '${fixture.nonAdminUserId}')
      or email in ('${fixture.adminEmail}', '${fixture.nonAdminEmail}'))
    or exists (select 1 from public.waitlist_signups where id in ('${fixture.firstSignupId}', '${fixture.secondSignupId}')
      or email_normalized in ('${fixture.firstEmail}', '${fixture.secondEmail}'))
    or exists (select 1 from public.app_invitation_deliveries where operation_id = '${fixture.operationId}')
    or exists (select 1 from public.app_audit_events where operation_id = '${fixture.operationId}')
  then
    raise exception 'deterministic admission test fixture already exists';
  end if;
end;
$fixture_guard$;

insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('${fixture.adminUserId}', 'authenticated', 'authenticated', '${fixture.adminEmail}', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('${fixture.nonAdminUserId}', 'authenticated', 'authenticated', '${fixture.nonAdminEmail}', '', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.app_user_roles (user_id, role)
values ('${fixture.adminUserId}', 'admin');

insert into public.waitlist_signups (
  id, email_normalized, first_name, last_name, birthdate, identity, open_to,
  match_age_min, match_age_max, neighborhood, nights, referral, looking_for,
  surprise_game, source
) values
  ('${fixture.firstSignupId}', '${fixture.firstEmail}', 'Test', 'First', '1990-01-01', 'Woman', array['Women'],
   25, 45, 'Inman Park', array['Friday'], 'synthetic', 'Open', 'Yes, surprise me', 'landing-page'),
  ('${fixture.secondSignupId}', '${fixture.secondEmail}', 'Test', 'Second', '1990-01-01', 'Man', array['Men'],
   25, 45, 'Chamblee', array['Saturday'], 'synthetic', 'Casual', 'I''d rather keep it conversational', 'landing-page');
commit;
`;

const cleanupSql = `
begin;
delete from public.app_audit_events where operation_id = '${fixture.operationId}';
delete from public.app_invitation_deliveries where operation_id = '${fixture.operationId}';
delete from public.app_admissions where waitlist_signup_id in ('${fixture.firstSignupId}', '${fixture.secondSignupId}');
delete from public.waitlist_signups where id in ('${fixture.firstSignupId}', '${fixture.secondSignupId}');
delete from public.app_user_roles where user_id = '${fixture.adminUserId}' and role = 'admin';
delete from auth.users where id = '${fixture.adminUserId}' and email = '${fixture.adminEmail}';
delete from auth.users where id = '${fixture.nonAdminUserId}' and email = '${fixture.nonAdminEmail}';
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

function callRpc(signupId, operationId) {
  const query = `set role service_role; select public.admit_waitlist_signup('${signupId}', '${operationId}', '${fixture.adminUserId}');`;
  return runPsql(query);
}

async function test() {
  let fixturesCreated = false;
  try {
    preflight();
    const setup = await runPsql(setupSql);
    if (setup.code !== 0) throw new Error(`synthetic fixture setup failed: ${setup.stderr}`);
    fixturesCreated = true;

    const deniedCalls = await Promise.all([
      runPsql(`set role anon; select public.admit_waitlist_signup('${fixture.firstSignupId}', '${fixture.operationId}', '${fixture.adminUserId}')`),
      runPsql(`set role authenticated; select public.admit_waitlist_signup('${fixture.firstSignupId}', '${fixture.operationId}', '${fixture.adminUserId}')`),
      runPsql(`set role service_role; select public.admit_waitlist_signup('${fixture.firstSignupId}', '${fixture.operationId}', '${fixture.nonAdminUserId}')`),
    ]);
    assert.notEqual(deniedCalls[0].code, 0, "anon must not execute the admission RPC");
    assert.match(deniedCalls[0].stderr, /permission denied for function/);
    assert.notEqual(deniedCalls[1].code, 0, "authenticated must not execute the admission RPC");
    assert.match(deniedCalls[1].stderr, /permission denied for function/);
    assert.notEqual(deniedCalls[2].code, 0, "service_role must not approve as a non-admin user");
    assert.match(deniedCalls[2].stderr, /admin_required/);

    const deniedRows = await runPsql(`
      select (select count(*) from public.app_admissions where waitlist_signup_id = '${fixture.firstSignupId}') || '|' ||
             (select count(*) from public.app_invitation_deliveries where operation_id = '${fixture.operationId}') || '|' ||
             (select count(*) from public.app_audit_events where operation_id = '${fixture.operationId}')
    `);
    if (deniedRows.code !== 0) throw new Error(`authorization denial check failed: ${deniedRows.stderr}`);
    assert.equal(deniedRows.stdout, "0|0|0", "denied calls must leave no admission, delivery, or audit rows");

    const concurrentResults = await Promise.all(
      Array.from({ length: 8 }, () => callRpc(fixture.firstSignupId, fixture.operationId)),
    );
    for (const result of concurrentResults) {
      if (result.code !== 0) throw new Error(`concurrent RPC call failed: ${result.stderr}`);
    }
    const payloads = concurrentResults.map((result) => JSON.parse(result.stdout));
    const admissionIds = new Set(payloads.map((payload) => payload.admission.id));
    const deliveryIds = new Set(payloads.map((payload) => payload.delivery.id));
    assert.equal(admissionIds.size, 1, "concurrent calls must reuse one admission");
    assert.equal(deliveryIds.size, 1, "concurrent calls must queue one logical delivery");
    assert.equal(payloads.filter((payload) => payload.created).length, 1, "only one call creates the admission");
    assert.equal(payloads.filter((payload) => payload.delivery_created).length, 1, "only one call creates the delivery");
    const createdPayload = payloads.find((payload) => payload.created);
    assert.equal(createdPayload.admission.state, "invited");
    assert.equal(createdPayload.admission.waitlist_signup_id, fixture.firstSignupId);
    assert.equal(createdPayload.admission.email_normalized, fixture.firstEmail);
    assert.equal(createdPayload.admission.approved_by, fixture.adminUserId);
    assert.equal(createdPayload.delivery.state, "queued");
    assert.equal(createdPayload.delivery.admission_id, createdPayload.admission.id);
    assert.equal(createdPayload.delivery.operation_id, fixture.operationId);
    assert.equal(createdPayload.delivery.created_by, fixture.adminUserId);

    const repeat = await callRpc(fixture.firstSignupId, fixture.operationId);
    if (repeat.code !== 0) throw new Error(`idempotent repeat failed: ${repeat.stderr}`);
    const repeatedPayload = JSON.parse(repeat.stdout);
    assert.equal(repeatedPayload.admission.id, payloads[0].admission.id);
    assert.equal(repeatedPayload.delivery.id, payloads[0].delivery.id);
    assert.equal(repeatedPayload.created, false);
    assert.equal(repeatedPayload.delivery_created, false);

    const auditRows = await runPsql(`
      select coalesce(jsonb_agg(jsonb_build_object(
        'actor_type', actor_type,
        'actor_user_id', actor_user_id,
        'action', action,
        'subject_type', subject_type,
        'subject_id', subject_id,
        'operation_id', operation_id,
        'request_id', request_id,
        'metadata', metadata,
        'occurred_at', occurred_at
      ) order by action), '[]'::jsonb)
      from public.app_audit_events
      where operation_id = '${fixture.operationId}'
    `);
    if (auditRows.code !== 0) throw new Error(`audit verification failed: ${auditRows.stderr}`);
    const auditEvents = JSON.parse(auditRows.stdout);
    assert.equal(auditEvents.length, 2);
    const expectedAudit = [
      {
        actor_type: "user",
        actor_user_id: fixture.adminUserId,
        action: "app.admission.invited",
        subject_type: "app_admission",
        subject_id: createdPayload.admission.id,
        operation_id: fixture.operationId,
        request_id: null,
        metadata: { state: "invited" },
      },
      {
        actor_type: "user",
        actor_user_id: fixture.adminUserId,
        action: "app.invitation.queued",
        subject_type: "invitation_delivery",
        subject_id: createdPayload.delivery.id,
        operation_id: fixture.operationId,
        request_id: null,
        metadata: { state: "queued" },
      },
    ];
    for (const expected of expectedAudit) {
      const actual = auditEvents.find((event) => event.action === expected.action);
      assert.ok(actual, `missing audit action ${expected.action}`);
      for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `audit ${expected.action} ${key}`);
      assert.equal(Number.isFinite(Date.parse(actual.occurred_at)), true, `audit ${expected.action} needs a timestamp`);
    }

    const reusedOnOtherSignup = await callRpc(fixture.secondSignupId, fixture.operationId);
    assert.notEqual(reusedOnOtherSignup.code, 0, "operation ID must not be reusable for a different signup");
    assert.match(reusedOnOtherSignup.stderr, /operation_id_subject_conflict/);

    const verify = await runPsql(`
      select (select count(*) from public.app_admissions where waitlist_signup_id = '${fixture.firstSignupId}') || '|' ||
             (select count(*) from public.app_invitation_deliveries where operation_id = '${fixture.operationId}') || '|' ||
             (select count(*) from public.app_audit_events where operation_id = '${fixture.operationId}') || '|' ||
             (select count(*) from public.app_admissions where waitlist_signup_id = '${fixture.secondSignupId}')
    `);
    if (verify.code !== 0) throw new Error(`fixture verification failed: ${verify.stderr}`);
    assert.equal(verify.stdout, "1|1|2|0", "only one admission/delivery and two audit events should remain before cleanup");

    console.log("admission operation DB test passed: service-only execution, admin enforcement, 8 concurrent calls, idempotent retry, audit integrity, operation-ID subject binding");
  } finally {
    if (fixturesCreated) {
      const cleanup = await runPsql(cleanupSql);
      if (cleanup.code !== 0) throw new Error(`exact fixture cleanup failed: ${cleanup.stderr}`);
    }
  }
}

test().catch((error) => fail(error instanceof Error ? error.message : "unknown failure"));
