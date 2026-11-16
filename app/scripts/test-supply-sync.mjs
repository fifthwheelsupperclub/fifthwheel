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
// Partial-failure scenarios (rollback-only, own random fixtures): an abandoned run and a finish that aborts midway leave
// last-good pointers, mappings, Table state and staged revisions untouched; the next complete run recovers once.
const partial = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `begin;
do $partial$ declare
  adm uuid := gen_random_uuid(); tbl uuid := gen_random_uuid(); other uuid := gen_random_uuid(); newv uuid := gen_random_uuid();
  op1 uuid := gen_random_uuid(); op2 uuid := gen_random_uuid(); op3 uuid := gen_random_uuid();
  src text := 'w05-partial-' || replace(gen_random_uuid()::text,'-','');
  hx text := repeat('c',64); hy text := repeat('d',64);
  c0 public.app_supply_control%rowtype; run1 uuid; run2 uuid; r jsonb; b jsonb; maps integer; revs integer; revs_all integer; caught boolean := false;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (adm,'authenticated','authenticated','w05-partial-'||adm||'@example.test','','{}','{}',now(),now());
  insert into public.app_user_roles(user_id,role) values (adm,'admin');
  insert into public.app_supply_table_heads(table_id,sync_state,lifecycle) values (tbl,'current','draft');
  insert into public.app_supply_external_mappings(entity_kind,source_record_id,core_id) values ('table',src,tbl);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select * into c0 from public.app_supply_control where singleton;
  select count(*) into maps from public.app_supply_external_mappings;
  select count(*) into revs_all from public.app_supply_sync_revisions;

  -- 1. worker died after begin: run stays running, then is failed on replay once stale; supply untouched
  b := public.begin_supply_sync(op1,adm); run1 := (b->'run'->>'run_id')::uuid;
  if public.begin_supply_sync(op1,adm)->'run'->>'state' <> 'running' or (public.begin_supply_sync(op1,adm)->>'created')::boolean then raise exception 'live run not replayed as running'; end if;
  update public.app_supply_sync_runs set started_at = now() - interval '11 minutes' where run_id = run1;
  r := public.begin_supply_sync(op1,adm);
  if r->'run'->>'state' <> 'failed' or r->'run'->>'retry_disposition' <> 'new_operation_required' then raise exception 'stale abandoned run not failed %', r; end if;
  if (select count(*) from public.app_supply_sync_revisions) <> revs_all then raise exception 'abandoned run staged a revision'; end if;

  -- 2. finish aborts midway (mapping_conflict after the missing-Table reconcile ran): everything inside rolls back
  b := public.begin_supply_sync(op2,adm); run2 := (b->'run'->>'run_id')::uuid;
  begin
    perform public.finish_supply_sync(run2,adm,'staged','{"tablePages":1,"venuePages":1,"tables":1,"venues":1}'::jsonb,hx,
      jsonb_build_array(jsonb_build_object('id',other)),
      jsonb_build_array(jsonb_build_object('entityKind','venue','sourceRecordId',src||'-new','coreId',newv),
                        jsonb_build_object('entityKind','table','sourceRecordId',src,'coreId',other)),
      '[]'::jsonb,'blocked',null,0);
    raise exception 'conflicting mapping finish succeeded';
  exception when unique_violation then caught := true; end;
  if not caught then raise exception 'no mapping_conflict raised'; end if;
  if (select state from public.app_supply_sync_runs where run_id=run2) <> 'running' then raise exception 'aborted finish moved the run out of running'; end if;
  if exists(select 1 from public.app_supply_external_mappings where source_record_id = src||'-new') then raise exception 'partial mapping insert survived the abort'; end if;
  if (select count(*) from public.app_supply_external_mappings) <> maps or (select core_id from public.app_supply_external_mappings where entity_kind='table' and source_record_id=src) <> tbl then raise exception 'mappings changed by aborted finish'; end if;
  if (select count(*) from public.app_supply_sync_revisions) <> revs_all then raise exception 'aborted finish staged a revision'; end if;
  if (select sync_state from public.app_supply_table_heads where table_id=tbl) <> 'current' then raise exception 'aborted finish left Table marked missing'; end if;
  if exists(select 1 from public.app_audit_events where subject_id=tbl and action like 'supply.sync.missing%') then raise exception 'aborted finish left a missing audit row'; end if;
  if (select (latest_staged_revision_id,latest_candidate_hash,last_good_published_revision_id,last_good_published_at) from public.app_supply_control where singleton)
     is distinct from (select (c0.latest_staged_revision_id,c0.latest_candidate_hash,c0.last_good_published_revision_id,c0.last_good_published_at)) then raise exception 'aborted finish changed supply pointers'; end if;

  -- 3. the worker records the failure; the next complete run (new operation) stages once, advances only the staged pointer
  r := public.finish_supply_sync(run2,adm,'failed','{"tablePages":1,"venuePages":1,"tables":1,"venues":1}'::jsonb,null,null,'[]'::jsonb,'[]'::jsonb,'new_operation_required','finish aborted',null);
  if r->>'state' <> 'failed' then raise exception 'failure not recorded %', r; end if;
  b := public.begin_supply_sync(op3,adm);
  r := public.finish_supply_sync((b->'run'->>'run_id')::uuid,adm,'staged','{"tablePages":1,"venuePages":1,"tables":1,"venues":1}'::jsonb,hy,
    jsonb_build_array(jsonb_build_object('id',tbl),jsonb_build_object('id',newv)),
    jsonb_build_array(jsonb_build_object('entityKind','table','sourceRecordId',src,'coreId',tbl),jsonb_build_object('entityKind','venue','sourceRecordId',src||'-new','coreId',newv)),
    '[]'::jsonb,'blocked',null,0);
  if r->>'state' <> 'staged' or r->>'candidate_revision_id' is null then raise exception 'recovery run did not stage %', r; end if;
  if (select count(*) from public.app_supply_sync_revisions) <> revs_all + 1 or (select count(*) from public.app_supply_external_mappings) <> maps + 1 then raise exception 'recovery duplicated or skipped rows'; end if;
  if (select latest_staged_revision_id from public.app_supply_control where singleton) <> (r->>'candidate_revision_id')::uuid
     or (select last_good_published_revision_id from public.app_supply_control where singleton) is distinct from c0.last_good_published_revision_id
     or (select last_good_published_at from public.app_supply_control where singleton) is distinct from c0.last_good_published_at then raise exception 'recovery moved the wrong pointers'; end if;
  -- replaying the finished run changes nothing
  if public.finish_supply_sync((b->'run'->>'run_id')::uuid,adm,'staged','{"tablePages":1,"venuePages":1,"tables":1,"venues":1}'::jsonb,hy,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'blocked',null,0)->>'state' <> 'staged'
     or (select count(*) from public.app_supply_sync_revisions) <> revs_all + 1 then raise exception 'finish replay not idempotent'; end if;
end $partial$;
rollback;`]);
assert.equal(partial.status, 0, partial.stderr || partial.stdout);
const left = run("psql", [db, "-X", "-At", "-c", "select count(*) from public.app_supply_external_mappings where source_record_id like 'w05-partial-%' or source_record_id like 'w05-partial-%-new'"]);
assert.equal(left.stdout.trim(), "0", "partial-failure scenario left mappings");
console.log("supply-sync-test: partial failure (abandoned run, aborted finish, recovery on next complete run) passed; rolled back");
console.log("supply-sync-test: guarded project fifthwheel-rewrite-test; migration " + migration + "; complete/malformed scan, missing/reappearance, pointers, guards, audit, and rollback cleanup passed");
