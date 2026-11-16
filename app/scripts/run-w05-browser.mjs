#!/usr/bin/env node

// Guarded W05.1 browser acceptance. Uses only the isolated fifthwheel-rewrite-test
// stack, a local-only synthetic provider, and exact run-scoped Auth/DB fixtures.
// It never resets the database or contacts Airtable.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(appRoot, "test-stack");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const appOrigin = "http://127.0.0.1:8086";
const migrationPath = join(appRoot, "supabase", "migrations", "20261112200122_supply_sync_staging.sql");
const managementMigrationPath = join(appRoot, "supabase", "migrations", "20261112202411_supply_draft_management.sql");
const candidateProjectionFixPath = join(appRoot, "supabase", "migrations", "20261112211128_supply_candidate_venue_projection_fix.sql");
const supplyListCapabilityPath = join(appRoot, "supabase", "migrations", "20261112215610_supply_list_capability_envelope.sql");
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");
const lockPath = join(tmpdir(), "fifthwheel-rewrite-test-w05-browser.lock");

function fail(message) { throw new Error(message); }

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  return values;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: appRoot, encoding: "utf8", ...options });
  if (result.error || result.status !== 0) fail(`${command} preflight failed`);
  return result.stdout ?? "";
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function loadAndGuardEnvironment() {
  const primary = join(appRoot, ".env.test.local");
  const fallback = join(testWorkdir, ".env.test.local");
  const values = parseEnvFile(existsSync(primary) ? primary : fallback);
  for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
  if (process.env.SUPABASE_PROJECT_REF) fail("refusing linked Supabase project for W05 local browser run");
  for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}`);
  }
  process.env.SUPABASE_URL = apiUrl;
  process.env.APP_ORIGIN = appOrigin;
}

function verifiedLocalTestStatus() {
  if (!existsSync(configPath) || !/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(readFileSync(configPath, "utf8")) || existsSync(linkedRefPath)) {
    fail("test Supabase config does not identify the isolated local project; no fixture was created");
  }
  const guarded = spawnSync("node", [join(appRoot, "scripts", "local-supabase.mjs"), "test", "status"], {
    cwd: appRoot, encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (guarded.error || guarded.status !== 0) fail("guarded local test status failed; no fixture was created");
  const raw = run("supabase", ["status", "--workdir", testWorkdir, "-o", "json"], { env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } });
  const open = raw.indexOf("{"); const close = raw.lastIndexOf("}");
  if (open < 0 || close < open) fail("local test Supabase status is malformed; no fixture was created");
  const status = JSON.parse(raw.slice(open, close + 1));
  if (status.API_URL !== apiUrl || status.DB_URL !== dbUrl) fail("active Supabase target is not fifthwheel-rewrite-test; no fixture was created");
  process.env.SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY === process.env.SUPABASE_SECRET_KEY) {
    fail("local test API keys are unavailable or invalid; no fixture was created");
  }
  const portCheck = spawnSync("lsof", ["-nP", "-iTCP:8086", "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (portCheck.error) fail("lsof is required to verify port 8086; no fixture was created");
  if (portCheck.status === 0 && portCheck.stdout.trim()) fail("test app port 8086 is occupied; no fixture was created");
  if (portCheck.status !== 0 && portCheck.status !== 1) fail("could not verify port 8086; no fixture was created");
  return status;
}

function assertSupplyMigrationAndTarget() {
  if (!existsSync(migrationPath) || !existsSync(managementMigrationPath) || !existsSync(candidateProjectionFixPath) || !existsSync(supplyListCapabilityPath)) fail("W05 supply migration source is missing; no fixture was created");
  const ready = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (to_regclass('public.app_supply_sync_runs') is not null)::text || '|' || (to_regclass('public.app_supply_sync_revisions') is not null)::text || '|' || (to_regclass('public.app_supply_external_mappings') is not null)::text || '|' || (to_regclass('public.app_supply_control') is not null)::text || '|' || (to_regprocedure('public.begin_supply_sync(uuid,uuid)') is not null)::text || '|' || (to_regprocedure('public.finish_supply_sync(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,integer)') is not null)::text || '|' || (to_regprocedure('public.read_supply_sync_summary(uuid)') is not null)::text || '|' || (to_regclass('public.app_supply_table_heads') is not null)::text || '|' || (to_regclass('public.app_supply_table_revisions') is not null)::text || '|' || (to_regclass('public.app_supply_table_operations') is not null)::text || '|' || (to_regprocedure('public.list_supply_tables(uuid,text,text,integer)') is not null)::text || '|' || (to_regprocedure('public.create_supply_draft(uuid,jsonb)') is not null)::text || '|' || (position('vn.value->>''name''' in pg_get_functiondef('public.create_supply_draft(uuid,jsonb)'::regprocedure))>0)::text || '|' || (position('v_candidates,''nextCursor'',v_next,''canCreateDraft'',v_admin' in pg_get_functiondef('public.list_supply_tables(uuid,text,text,integer)'::regprocedure))>0)::text || '|' || (to_regprocedure('public.save_supply_venue(uuid,uuid,text,text,text,boolean)') is not null)::text"], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  }).trim();
  if (ready !== "true|true|true|true|true|true|true|true|true|true|true|true|true|true|true") fail("W05 migrations are not applied to fifthwheel-rewrite-test; no fixture was created");
  const access = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.app_supply_sync_runs'::regclass,'public.app_supply_sync_revisions'::regclass,'public.app_supply_external_mappings'::regclass,'public.app_supply_control'::regclass,'public.app_supply_table_heads'::regclass,'public.app_supply_table_revisions'::regclass,'public.app_supply_table_operations'::regclass))::text || '|' || (has_table_privilege('anon','public.app_supply_sync_runs','select') or has_table_privilege('authenticated','public.app_supply_sync_runs','select') or has_table_privilege('anon','public.app_supply_sync_revisions','select') or has_table_privilege('authenticated','public.app_supply_sync_revisions','select') or has_table_privilege('anon','public.app_supply_table_heads','select') or has_table_privilege('authenticated','public.app_supply_table_heads','select') or has_table_privilege('anon','public.app_supply_table_revisions','select') or has_table_privilege('authenticated','public.app_supply_table_revisions','select') or has_table_privilege('anon','public.app_supply_table_operations','select') or has_table_privilege('authenticated','public.app_supply_table_operations','select'))::text"], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  }).trim();
  if (access !== "true|false") fail("W05 direct-table boundary is not ready on the isolated test project; no fixture was created");
}

async function createAuthUser(email) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: {} }),
    cache: "no-store", redirect: "error",
  });
  if (!response.ok) fail(`local Auth fixture creation failed (HTTP ${response.status})`);
  const body = await response.json();
  if (typeof body.id !== "string" || body.email?.toLowerCase() !== email.toLowerCase()) fail("local Auth fixture identity was invalid");
  return body.id;
}

async function deleteAuthUser(userId) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` },
    cache: "no-store", redirect: "error",
  });
  if (!response.ok && response.status !== 404) fail("exact W05 local Auth fixture cleanup failed");
}

function baselineSupplyControl() {
  const value = run("psql", [dbUrl, "-X", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c",
    "select coalesce(latest_staged_revision_id::text,''),coalesce(latest_candidate_hash,'') from public.app_supply_control where singleton=true"], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  }).trim();
  const [revision = "", hash = ""] = value.split("|");
  if (revision && !/^[0-9a-f-]{36}$/i.test(revision)) fail("existing staged pointer is malformed; no fixture was created");
  if (hash && !/^[a-f0-9]{64}$/.test(hash)) fail("existing candidate hash is malformed; no fixture was created");
  return { revision, hash };
}

async function printSupplyListRpcDiagnostics(fixture) {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/list_supply_tables`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ p_actor_user_id: fixture.adminId, p_state: null, p_cursor: null, p_limit: 50 }),
    cache: "no-store", redirect: "error",
  });
  let safeBody = {};
  try {
    const body = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      safeBody = { code: typeof body.code === "string" ? body.code.slice(0, 60) : null, message: typeof body.message === "string" ? body.message.slice(0, 140) : null };
    }
  } catch { safeBody = { responseKind: "non_json" }; }
  process.stderr.write(`W05 direct list RPC diagnostic: HTTP ${response.status} ${JSON.stringify(safeBody)}\n`);
}

function seedAdminRole(adminId) {
  const result = spawnSync("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], {
    cwd: appRoot,
    input: `insert into public.app_user_roles(user_id,role) values (${sqlLiteral(adminId)},'admin');\n`,
    encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" },
  });
  if (result.error || result.status !== 0) fail("exact W05 test admin role insert failed");
}

function cleanupSql(fixture, baseline) {
  const priorRevision = baseline.revision ? sqlLiteral(baseline.revision) : "null";
  const priorHash = baseline.hash ? sqlLiteral(baseline.hash) : "null";
  const prefix = sqlLiteral(`fixture:${fixture.suffix}:`);
  const actorId = sqlLiteral(fixture.adminId);
  return `begin;
delete from public.app_supply_weekly_clone_fixture_records where run_id=${sqlLiteral(fixture.suffix)};
delete from public.app_supply_weekly_clone_items where operation_id in (
  select operation_id from public.app_supply_weekly_clone_operations where actor_user_id=${sqlLiteral(fixture.adminId)}::uuid
);
delete from public.app_supply_weekly_clone_operations where actor_user_id=${sqlLiteral(fixture.adminId)}::uuid;
update public.app_supply_control
set latest_staged_revision_id=${priorRevision}::uuid, latest_candidate_hash=${priorHash}::text, updated_at=now()
where singleton=true and latest_staged_revision_id in (
  select candidate_revision_id from public.app_supply_sync_runs
  where actor_user_id=${sqlLiteral(fixture.adminId)} and candidate_revision_id is not null
);
do $cleanup_supply_management$
declare v_table_ids uuid[];
begin
  select coalesce(array_agg(distinct table_id),'{}'::uuid[]) into v_table_ids
  from public.app_supply_table_revisions where created_by=${actorId}::uuid;
  delete from public.app_supply_external_mappings where core_id=any(v_table_ids);
  update public.app_supply_table_heads set draft_revision_id=null,accepted_revision_id=null,published_revision_id=null
  where table_id=any(v_table_ids);
  delete from public.app_supply_table_operations where actor_user_id=${actorId}::uuid;
  delete from public.app_supply_table_revisions where table_id=any(v_table_ids);
  delete from public.app_table_runtime where table_id=any(v_table_ids);
  delete from public.app_supply_table_heads where table_id=any(v_table_ids);
  delete from public.app_supply_venues where created_by=${actorId}::uuid;
end
$cleanup_supply_management$;
delete from public.app_supply_external_mappings where left(source_record_id,length(${prefix}))=${prefix};
delete from public.app_supply_sync_revisions where run_id in (
  select run_id from public.app_supply_sync_runs where actor_user_id=${sqlLiteral(fixture.adminId)}
);
delete from public.app_supply_sync_runs where actor_user_id=${sqlLiteral(fixture.adminId)};
delete from public.app_user_roles where user_id=${sqlLiteral(fixture.adminId)} and role='admin';
commit;`;
}

async function runPlaywright() {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w05.config.ts"], {
    cwd: appRoot, env: process.env, stdio: "inherit",
  });
  return await new Promise((resolvePromise, reject) => {
    child.once("error", () => reject(new Error("Playwright could not start")));
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  loadAndGuardEnvironment();
  verifiedLocalTestStatus();
  assertSupplyMigrationAndTarget();
  try { mkdirSync(lockPath); } catch { fail("another W05 guarded browser run is active; no fixture was created"); }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const fixture = {
    suffix,
    adminEmail: `w05-admin-${suffix}@example.test`,
    nonAdminEmail: `w05-viewer-${suffix}@example.test`,
    adminId: null,
    nonAdminId: null,
  };
  const baseline = baselineSupplyControl();
  const createdUsers = [];
  let roleSeeded = false;
  let result = 1;
  try {
    fixture.adminId = await createAuthUser(fixture.adminEmail); createdUsers.push(fixture.adminId);
    fixture.nonAdminId = await createAuthUser(fixture.nonAdminEmail); createdUsers.push(fixture.nonAdminId);
    seedAdminRole(fixture.adminId); roleSeeded = true;
    process.env.W05_ADMIN_EMAIL = fixture.adminEmail;
    process.env.W05_NON_ADMIN_EMAIL = fixture.nonAdminEmail;
    process.env.W05_ADMIN_ID = fixture.adminId;
    process.env.W05_RUN_SUFFIX = suffix;
    process.env.SUPPLY_PROVIDER_MODE = "fixture";
    process.env.SUPPLY_FIXTURE_RUN_ID = suffix;
    result = await runPlaywright();
    if (result !== 0) {
      await printSupplyListRpcDiagnostics(fixture);
    }
  } finally {
    let cleanupFailure = null;
    if (roleSeeded) {
      const cleanup = spawnSync("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], {
        cwd: appRoot, input: cleanupSql(fixture, baseline), encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" },
      });
      if (cleanup.error || cleanup.status !== 0) cleanupFailure = new Error("exact W05 supply and role fixture cleanup failed");
    }
    for (const userId of createdUsers.reverse()) {
      try { await deleteAuthUser(userId); }
      catch { cleanupFailure ??= new Error("exact W05 local Auth fixture cleanup failed"); }
    }
    try { rmSync(lockPath, { recursive: true, force: true }); }
    catch { cleanupFailure ??= new Error("W05 browser run lock cleanup failed"); }
    if (cleanupFailure) throw cleanupFailure;
  }
  if (result !== 0) process.exitCode = result;
  else console.log("W05 guarded test-project browser journeys passed. Exact fixture users, role, venues, supply draft/revisions/operations and clone rows were removed; append-only audit events remain.");
}

main().catch((error) => {
  try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
  process.stderr.write(`${error instanceof Error ? error.message : "W05 local browser run failed"}\n`);
  process.exitCode = 1;
});
