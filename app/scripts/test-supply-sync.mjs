#!/usr/bin/env node

// Transactional W05.1 database check. Bound to the isolated test stack, no reset,
// no provider calls, and all synthetic rows are rolled back before process exit.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migration = "20261112212740";
const admin = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6001";
const member = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6002";
const priorOperation = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6003";
const incompleteOperation = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6010";
const invalidOperation = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6011";
const missingOperation = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6012";
const reappearOperation = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6013";
const acceptOperation = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6014";
const publishOperation = "d5c05c6a-f9c1-45b8-8ef8-bcd0045a6015";
const tableId = "e205c6a0-36bd-4aa0-9a2f-000000000001";
const venueId = "e205c6a0-36bd-4aa0-9a2f-000000000002";
const priorSyncRevision = "e205c6a0-36bd-4aa0-9a2f-000000000003";
const draftRevision = "e205c6a0-36bd-4aa0-9a2f-000000000004";
const acceptedRevision = "e205c6a0-36bd-4aa0-9a2f-000000000005";
const publishedRevision = "e205c6a0-36bd-4aa0-9a2f-000000000006";
const adminEmail = "w05-complete-scan-admin@example.test";
const memberEmail = "w05-complete-scan-member@example.test";
const tableSourceId = "w05-complete-scan-table-v1";
const venueSourceId = "w05-complete-scan-venue-v1";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", ...options,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", ...options.env },
  });
  if (result.error) throw result.error;
  return result;
}

function assertTarget() {
  const configPath = join(workdir, "supabase", "config.toml");
  const config = readFileSync(configPath, "utf8");
  assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m);
  assert.match(config, /^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m);
  assert.match(config, /^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m);
  assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false);
  for (const [name, expected] of [["SUPABASE_URL", api], ["SUPABASE_DB_URL", db], ["DATABASE_URL", db]]) {
    if (process.env[name]) assert.equal(process.env[name], expected, `refusing mismatched ${name}`);
  }
  assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "refusing hosted project reference");
  for (const file of [join(root, ".env.test.local"), join(workdir, ".env.test.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL|SUPABASE_URL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, name, raw] = match;
      const value = raw.replace(/^['"]|['"]$/g, "").replace(/\s+#.*$/, "");
      assert.notEqual(name, "SUPABASE_PROJECT_REF");
      assert.equal(value, name === "SUPABASE_URL" ? api : db, `refusing mismatched ${name} in ${file}`);
    }
  }
  const guarded = run(process.execPath, [join(root, "scripts", "local-supabase.mjs"), "test", "status"]);
  assert.equal(guarded.status, 0, guarded.stderr || guarded.stdout);
  const status = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  assert.equal(status.status, 0, status.stderr);
  const first = status.stdout.indexOf("{");
  const last = status.stdout.lastIndexOf("}");
  const parsed = JSON.parse(status.stdout.slice(first, last + 1));
  assert.equal(parsed.API_URL, api);
  assert.equal(parsed.DB_URL, db);
  const list = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(list.status, 0, list.stderr);
  const row = list.stdout.split(/\r?\n/).find((line) => line.includes(migration));
  assert.ok(row && row.includes(migration) && !row.includes("|                |"), "W05 migration must be applied locally");
}

assertTarget();
const preflight = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
  "select concat((to_regprocedure('public.begin_supply_sync(uuid,uuid)') is not null)::text,'|',(to_regprocedure('public.finish_supply_sync(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,integer)') is not null)::text,'|',(to_regprocedure('public.read_supply_sync_summary(uuid)') is not null)::text,'|',(to_regprocedure('public.read_supply_table_detail(uuid,uuid)') is not null)::text,'|',(to_regprocedure('public.accept_supply_draft(uuid,uuid,jsonb)') is not null)::text,'|',(to_regprocedure('public.publish_supply_draft(uuid,uuid,jsonb)') is not null)::text)"]);
assert.equal(preflight.status, 0, preflight.stderr);
assert.equal(preflight.stdout.trim(), "true|true|true|true|true|true");

const collision = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
select concat(
  (not exists(select 1 from auth.users where id in ('${admin}'::uuid,'${member}'::uuid) or email in ('${adminEmail}','${memberEmail}')))::text,'|',
  (not exists(select 1 from public.app_user_roles where user_id in ('${admin}'::uuid,'${member}'::uuid)))::text,'|',
  (not exists(select 1 from public.app_supply_sync_runs where run_id='${priorSyncRevision}'::uuid or operation_id in ('${priorOperation}'::uuid,'${incompleteOperation}'::uuid,'${invalidOperation}'::uuid,'${missingOperation}'::uuid,'${reappearOperation}'::uuid)))::text,'|',
  (not exists(select 1 from public.app_supply_table_heads where table_id='${tableId}'::uuid))::text,'|',
  (not exists(select 1 from public.app_supply_table_revisions where revision_id in ('${draftRevision}'::uuid,'${acceptedRevision}'::uuid,'${publishedRevision}'::uuid)))::text,'|',
  (not exists(select 1 from public.app_supply_sync_revisions where revision_id='${priorSyncRevision}'::uuid))::text,'|',
  (not exists(select 1 from public.app_supply_external_mappings where (entity_kind='table' and source_record_id='${tableSourceId}') or (entity_kind='venue' and source_record_id='${venueSourceId}') or core_id in ('${tableId}'::uuid,'${venueId}'::uuid)))::text,'|',
  (not exists(select 1 from public.app_audit_events where operation_id in ('${priorOperation}'::uuid,'${incompleteOperation}'::uuid,'${invalidOperation}'::uuid,'${missingOperation}'::uuid,'${reappearOperation}'::uuid,'${acceptOperation}'::uuid,'${publishOperation}'::uuid)))::text,'|',
  (not exists(select 1 from public.app_supply_table_operations where operation_id in ('${acceptOperation}'::uuid,'${publishOperation}'::uuid)))::text
)`]);
assert.equal(collision.status, 0, collision.stderr);
assert.equal(collision.stdout.trim(), "true|true|true|true|true|true|true|true|true", "run-scoped fixtures must not collide with existing rows");

const grants = run("psql", [db, "-X", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c",
  "select concat((has_function_privilege('anon','public.begin_supply_sync(uuid,uuid)','EXECUTE'))::text,'|',(has_function_privilege('authenticated','public.begin_supply_sync(uuid,uuid)','EXECUTE'))::text,'|',(has_function_privilege('service_role','public.begin_supply_sync(uuid,uuid)','EXECUTE'))::text,'|',(has_table_privilege('anon','public.app_supply_sync_runs','SELECT'))::text,'|',(has_table_privilege('authenticated','public.app_supply_sync_runs','SELECT'))::text)"]);
assert.equal(grants.status, 0, grants.stderr);
assert.equal(grants.stdout.trim(), "false|false|true|false|false");

const scenarioArgs = [db, "-X", "-v", "ON_ERROR_STOP=1"];
const fixtureVars = {
  admin, member, prior_operation: priorOperation, incomplete_operation: incompleteOperation,
  invalid_operation: invalidOperation, missing_operation: missingOperation, reappear_operation: reappearOperation,
  accept_operation: acceptOperation, publish_operation: publishOperation, table_id: tableId, venue_id: venueId,
  prior_sync_revision: priorSyncRevision, draft_revision: draftRevision, accepted_revision: acceptedRevision,
  published_revision: publishedRevision, admin_email: adminEmail, member_email: memberEmail,
  table_source_id: tableSourceId, venue_source_id: venueSourceId,
  hash_f: "f".repeat(64), hash_a: "a".repeat(64), hash_b: "b".repeat(64),
};
for (const [name, value] of Object.entries(fixtureVars)) scenarioArgs.push("-v", name + "=" + value);
scenarioArgs.push("-f", join(root, "scripts", "test-supply-sync-complete-scan.sql"));
const check = run("psql", scenarioArgs);
assert.equal(check.status, 0, check.stderr || check.stdout);
const residual = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
  "select concat((not exists(select 1 from auth.users where id in ('" + admin + "'::uuid,'" + member + "'::uuid) or email in ('" + adminEmail + "','" + memberEmail + "')))::text,'|',(not exists(select 1 from public.app_user_roles where user_id in ('" + admin + "'::uuid,'" + member + "'::uuid)))::text,'|',(not exists(select 1 from public.app_supply_sync_runs where run_id='" + priorSyncRevision + "'::uuid or operation_id in ('" + priorOperation + "'::uuid,'" + incompleteOperation + "'::uuid,'" + invalidOperation + "'::uuid,'" + missingOperation + "'::uuid,'" + reappearOperation + "'::uuid)))::text,'|',(not exists(select 1 from public.app_supply_table_heads where table_id='" + tableId + "'::uuid))::text,'|',(not exists(select 1 from public.app_supply_table_revisions where revision_id in ('" + draftRevision + "'::uuid,'" + acceptedRevision + "'::uuid,'" + publishedRevision + "'::uuid)))::text,'|',(not exists(select 1 from public.app_supply_sync_revisions where revision_id='" + priorSyncRevision + "'::uuid))::text,'|',(not exists(select 1 from public.app_supply_external_mappings where (entity_kind='table' and source_record_id='" + tableSourceId + "') or (entity_kind='venue' and source_record_id='" + venueSourceId + "') or core_id in ('" + tableId + "'::uuid,'" + venueId + "'::uuid)))::text,'|',(not exists(select 1 from public.app_audit_events where operation_id in ('" + priorOperation + "'::uuid,'" + incompleteOperation + "'::uuid,'" + invalidOperation + "'::uuid,'" + missingOperation + "'::uuid,'" + reappearOperation + "'::uuid,'" + acceptOperation + "'::uuid,'" + publishOperation + "'::uuid)))::text,'|',(not exists(select 1 from public.app_supply_table_operations where operation_id in ('" + acceptOperation + "'::uuid,'" + publishOperation + "'::uuid)))::text)"]);
assert.equal(residual.status, 0, residual.stderr);
assert.equal(residual.stdout.trim(), "true|true|true|true|true|true|true|true|true", "rollback should leave no run-scoped fixture rows");
console.log("supply-sync-test: guarded project fifthwheel-rewrite-test; migration " + migration + "; complete/malformed scan, missing/reappearance, pointers, guards, audit, and rollback cleanup passed");
