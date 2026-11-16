#!/usr/bin/env node

// W05.3 rollback-only acceptance for the single-transaction weekly clone RPC
// against the isolated local test DB. No reset or hosted target is used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const admin = "d7a6c8e2-51e8-4a2b-9672-052160a54501";
const member = "d7a6c8e2-51e8-4a2b-9672-052160a54502";
const source = "d7a6c8e2-51e8-4a2b-9672-052160a54503";
const revision = "d7a6c8e2-51e8-4a2b-9672-052160a54504";
const operation = "d7a6c8e2-51e8-4a2b-9672-052160a54505";
const sourceTwo = "d7a6c8e2-51e8-4a2b-9672-052160a54508";
const revisionTwo = "d7a6c8e2-51e8-4a2b-9672-052160a54509";
const operationTwo = "d7a6c8e2-51e8-4a2b-9672-052160a54510";
const operationThree = "d7a6c8e2-51e8-4a2b-9672-052160a54512";
const operationFour = "d7a6c8e2-51e8-4a2b-9672-052160a54513";
const operations = [operation, operationTwo, operationThree, operationFour].map((id) => `'${id}'`).join(",");
const week = "2026-11-16";
const targetWeek = "2026-11-23";
const lock = join(workdir, ".weekly-clone-db-test.lock");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", ...options.env } });
  if (result.error) throw result.error;
  return result;
}

function assertTarget() {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m);
  assert.match(config, /^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m);
  assert.match(config, /^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m);
  assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false);
  for (const [name, expected] of [["SUPABASE_URL", "http://127.0.0.1:57421"], ["SUPABASE_DB_URL", db], ["DATABASE_URL", db]]) {
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
      assert.equal(value, name === "SUPABASE_URL" ? "http://127.0.0.1:57421" : db, `refusing mismatched ${name} in ${file}`);
    }
  }
  const status = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr);
  for (const version of ["20261112202411", "20261112205628", "20261112211128", "20261112212740", "20261112215610", "20261112220943", "20261117100000"]) {
    assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(version) && !line.includes("|                |")), `${version} must be applied locally`);
  }
}

assertTarget();
try { writeFileSync(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
catch { throw new Error("another weekly clone DB harness is running or left a lock file; inspect the exact local test workdir before retrying"); }
try {
  const collision = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
    select concat(
      (not exists(select 1 from auth.users where id in ('${admin}','${member}') or email in ('w05.3-admin@example.test','w05.3-member@example.test')))::text,'|',
      (not exists(select 1 from public.app_user_roles where user_id in ('${admin}','${member}')))::text,'|',
      (not exists(select 1 from public.app_supply_table_heads where table_id in ('${source}','${sourceTwo}')) and not exists(select 1 from public.app_supply_table_revisions where revision_id in ('${revision}','${revisionTwo}')))::text,'|',
      (not exists(select 1 from public.app_supply_weekly_clone_operations where operation_id in (${operations})) and not exists(select 1 from public.app_audit_events where operation_id in (${operations})))::text)`]);
  assert.equal(collision.status, 0, collision.stderr);
  assert.equal(collision.stdout.trim(), "true|true|true|true", "refusing synthetic fixture ID/email collisions");
  const grants = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
    has_function_privilege('anon','public.clone_weekly_supply(uuid,uuid,date,date)','EXECUTE')::text,'|',
    has_function_privilege('authenticated','public.undo_weekly_supply_clone(uuid,uuid)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.clone_weekly_supply(uuid,uuid,date,date)','EXECUTE')::text,'|',
    (not has_table_privilege('anon','public.app_supply_weekly_clone_operations','SELECT') and not has_table_privilege('authenticated','public.app_supply_weekly_clone_items','SELECT'))::text,'|',
    (to_regclass('public.app_supply_weekly_clone_fixture_records') is null and to_regprocedure('public.claim_weekly_supply_clone_item(uuid,uuid)') is null)::text)`]);
  assert.equal(grants.status, 0, grants.stderr);
  assert.equal(grants.stdout.trim(), "false|false|true|true|true", "clone RPC/table grants must be service-only and provider machinery removed");

  const content = JSON.stringify({ title: "Synthetic weekly Table", localDate: "2026-11-19", startLocalTime: "19:00", neighborhood: "Inman Park", hostNotes: "private fixture note", stops: [
    { role: "drinks", venueId: "d7a6c8e2-51e8-4a2b-9672-052160a54521", venueName: "Fixture Bar", venueAddress: "1 Test Way", minutesFromStart: 0, publicNotes: "" },
    { role: "dinner", venueId: "d7a6c8e2-51e8-4a2b-9672-052160a54522", venueName: "Fixture Restaurant", venueAddress: "2 Test Way", minutesFromStart: 60, publicNotes: "" },
    { role: "dessert", venueId: "d7a6c8e2-51e8-4a2b-9672-052160a54523", venueName: "Fixture Dessert", venueAddress: "3 Test Way", minutesFromStart: 120, publicNotes: "" },
  ] });
  const quoted = content.replaceAll("'", "''");
  const sql = `begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${admin}','authenticated','authenticated','w05.3-admin@example.test','','{}','{}',now(),now()),('${member}','authenticated','authenticated','w05.3-member@example.test','','{}','{}',now(),now());
insert into public.app_user_roles(user_id,role) values ('${admin}','admin');
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values ('${source}','draft','current'),('${sourceTwo}','draft','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by)
values ('${revision}','${source}',1,'draft','${quoted}'::jsonb,'${admin}'),
  ('${revisionTwo}','${sourceTwo}',1,'draft',jsonb_set('${quoted}'::jsonb,'{title}',to_jsonb('Second synthetic weekly Table'::text)),'${admin}');
update public.app_supply_table_heads set draft_revision_id='${revision}' where table_id='${source}';
update public.app_supply_table_heads set draft_revision_id='${revisionTwo}' where table_id='${sourceTwo}';
set local request.jwt.claims='{"role":"service_role"}';
do $test$
declare v_preview jsonb; v_op jsonb; v_replay jsonb; v_undo jsonb; v_list jsonb; v_heads int; v_audit int; v_target uuid; v_target_rev uuid;
begin
  -- Preview: Monday weeks, date shift, admin-only.
  v_preview:=public.preview_weekly_supply_clone('${admin}'::uuid,'${week}'::date,'${targetWeek}'::date);
  if v_preview->>'weekDelta'<>'1' or jsonb_array_length(v_preview->'items')<>2 or v_preview->'items'->0->>'targetLocalDate'<>'2026-11-26'
    or v_preview->'items'->0->>'eligibility'<>'eligible' then raise exception 'Monday week preview/date shifting failed'; end if;
  begin perform public.preview_weekly_supply_clone('${admin}'::uuid,'2026-11-17'::date,'${targetWeek}'::date); raise exception 'non-Monday source accepted';
    exception when invalid_parameter_value then null; end;
  begin perform public.preview_weekly_supply_clone('${member}'::uuid,'${week}'::date,'${targetWeek}'::date); raise exception 'member preview accepted';
    exception when insufficient_privilege then null; end;

  -- Clone: non-admin forbidden, then one transaction creates shifted drafts.
  begin perform public.clone_weekly_supply('${member}'::uuid,'${operation}'::uuid,'${week}'::date,'${targetWeek}'::date); raise exception 'member clone accepted';
    exception when insufficient_privilege then null; end;
  if exists(select 1 from public.app_supply_weekly_clone_operations where operation_id='${operation}') then raise exception 'forbidden clone left rows'; end if;
  v_op:=public.clone_weekly_supply('${admin}'::uuid,'${operation}'::uuid,'${week}'::date,'${targetWeek}'::date);
  if v_op->>'state'<>'completed' or v_op->>'undoState'<>'available' or (v_op->>'draftCount')::int<>2 or jsonb_array_length(v_op->'items')<>2 then
    raise exception 'clone result malformed: %',v_op; end if;
  v_target:=(v_op->'items'->0->>'targetTableId')::uuid;
  if not exists(select 1 from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id
    where h.table_id=v_target and h.lifecycle='draft' and h.sync_state='current' and h.source_revision_id is null
      and h.accepted_revision_id is null and h.published_revision_id is null
      and r.revision=1 and r.state='draft' and r.source_revision_id is null and r.content->>'localDate'='2026-11-26' and r.content->>'hostNotes'='private fixture note') then
    raise exception 'clone was not created as a shifted revision-1 draft'; end if;
  if not exists(select 1 from public.app_supply_table_heads where table_id='${source}' and draft_revision_id='${revision}') then raise exception 'source changed during clone'; end if;
  if (select count(*) from public.app_audit_events where operation_id='${operation}' and action='supply.weekly_clone.started')<>1
    or (select count(*) from public.app_audit_events where operation_id='${operation}' and action='supply.weekly_clone.item_created')<>2 then
    raise exception 'clone audit events missing'; end if;

  -- Same operation ID replay is a no-op; reuse with different weeks conflicts.
  select count(*) into v_heads from public.app_supply_table_heads;
  select count(*) into v_audit from public.app_audit_events where operation_id='${operation}';
  v_replay:=public.clone_weekly_supply('${admin}'::uuid,'${operation}'::uuid,'${week}'::date,'${targetWeek}'::date);
  if v_replay<>v_op then raise exception 'same-operation replay changed result'; end if;
  if (select count(*) from public.app_supply_table_heads)<>v_heads or (select count(*) from public.app_audit_events where operation_id='${operation}')<>v_audit then
    raise exception 'same-operation replay wrote again'; end if;
  begin perform public.clone_weekly_supply('${admin}'::uuid,'${operation}'::uuid,'${week}'::date,'2026-11-30'::date); raise exception 'operation payload reuse accepted';
    exception when unique_violation then null; end;
  begin perform public.clone_weekly_supply('${admin}'::uuid,'${operationTwo}'::uuid,'2026-12-07'::date,'2026-12-14'::date); raise exception 'empty week cloned';
    exception when invalid_parameter_value then if sqlerrm<>'no_eligible_sources' then raise; end if; end;

  -- History: read and cursor pagination.
  if public.read_weekly_supply_clone_operation('${admin}'::uuid,'${operation}'::uuid)<>v_op then raise exception 'read differs from clone result'; end if;
  perform public.clone_weekly_supply('${admin}'::uuid,'${operationTwo}'::uuid,'${week}'::date,'${targetWeek}'::date);
  v_list:=public.list_weekly_supply_clone_operations('${admin}'::uuid,null,1);
  if jsonb_array_length(v_list->'items')<>1 or v_list->>'nextCursor' is null then raise exception 'first cursor page missing continuation: %',v_list; end if;
  v_list:=public.list_weekly_supply_clone_operations('${admin}'::uuid,v_list->>'nextCursor',1);
  if jsonb_array_length(v_list->'items')<>1 or v_list->'items'->0->>'operationId' not like 'd7a6c8e2-%' then raise exception 'second cursor page failed: %',v_list; end if;

  -- Undo: admin-only, removes every untouched clone, replay is a no-op.
  begin perform public.undo_weekly_supply_clone('${member}'::uuid,'${operation}'::uuid); raise exception 'member undo accepted';
    exception when insufficient_privilege then null; end;
  v_undo:=public.undo_weekly_supply_clone('${admin}'::uuid,'${operation}'::uuid);
  if v_undo->>'state'<>'undone' or v_undo->>'undoState'<>'undone' or exists(select 1 from public.app_supply_table_heads where table_id in
    (select target_table_id from public.app_supply_weekly_clone_items where operation_id='${operation}')) then raise exception 'undo left a target draft'; end if;
  if not exists(select 1 from public.app_supply_table_heads where table_id='${source}' and draft_revision_id='${revision}') then raise exception 'undo touched source'; end if;
  if public.undo_weekly_supply_clone('${admin}'::uuid,'${operation}'::uuid)<>v_undo then raise exception 'undo replay changed result'; end if;
  if (select count(*) from public.app_audit_events where operation_id='${operation}' and action='supply.weekly_clone.item_undone')<>2 then raise exception 'undo audit missing'; end if;

  -- Protected activity on one clone refuses the whole undo.
  v_op:=public.clone_weekly_supply('${admin}'::uuid,'${operationThree}'::uuid,'${week}'::date,'${targetWeek}'::date);
  update public.app_supply_table_heads set protected_by_activity=true where table_id=(v_op->'items'->0->>'targetTableId')::uuid;
  if public.read_weekly_supply_clone_operation('${admin}'::uuid,'${operationThree}'::uuid)->>'undoState'<>'blocked' then raise exception 'activity did not block undo'; end if;
  begin perform public.undo_weekly_supply_clone('${admin}'::uuid,'${operationThree}'::uuid); raise exception 'active clone was allowed to undo';
    exception when raise_exception then if sqlerrm<>'undo_refused' then raise; end if; end;
  if (select count(*) from public.app_supply_table_heads where table_id in (select target_table_id from public.app_supply_weekly_clone_items where operation_id='${operationThree}'))<>2 then
    raise exception 'activity refusal partially removed clones'; end if;

  -- An edited clone (new draft revision) refuses the whole undo.
  v_op:=public.clone_weekly_supply('${admin}'::uuid,'${operationFour}'::uuid,'${week}'::date,'${targetWeek}'::date);
  v_target:=(v_op->'items'->1->>'targetTableId')::uuid;
  insert into public.app_supply_table_revisions(table_id,revision,state,content,created_by)
    select v_target,2,'draft',jsonb_set(r.content,'{title}',to_jsonb('Edited clone after copy'::text)),'${admin}'::uuid
    from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id where h.table_id=v_target
    returning revision_id into v_target_rev;
  update public.app_supply_table_heads set draft_revision_id=v_target_rev where table_id=v_target;
  begin perform public.undo_weekly_supply_clone('${admin}'::uuid,'${operationFour}'::uuid); raise exception 'edited clone was allowed to undo';
    exception when raise_exception then if sqlerrm<>'undo_refused' then raise; end if; end;
  if (select count(*) from public.app_supply_table_heads where table_id in (select target_table_id from public.app_supply_weekly_clone_items where operation_id='${operationFour}'))<>2 then
    raise exception 'edit refusal partially removed clones'; end if;
end $test$;
rollback;`;
  const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const residue = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
    (not exists(select 1 from auth.users where id in ('${admin}','${member}')))::text,'|',
    (not exists(select 1 from public.app_supply_table_heads where table_id in ('${source}','${sourceTwo}')))::text,'|',
    (not exists(select 1 from public.app_supply_weekly_clone_operations where operation_id in (${operations})))::text,'|',
    (not exists(select 1 from public.app_audit_events where operation_id in (${operations})))::text)`]);
  assert.equal(residue.status, 0, residue.stderr);
  assert.equal(residue.stdout.trim(), "true|true|true|true", "rollback must remove all synthetic fixtures and audit rows");
  console.log("W05.3 local DB acceptance passed: service-only grants, provider machinery removed, Monday preview, admin-only clone/undo, single-transaction shifted drafts, same-operation replay no-op, payload conflict, pagination, all-or-nothing undo with activity/edit refusal, and exact rollback.");
} finally { unlinkSync(lock); }
