#!/usr/bin/env node

// W05.3 rollback-only transactional acceptance against the isolated local test DB.
// No reset, hosted target, or provider request is performed.
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
const undoOperation = "d7a6c8e2-51e8-4a2b-9672-052160a54506";
const runId = "d7a6c8e2-51e8-4a2b-9672-052160a54507";
const sourceTwo = "d7a6c8e2-51e8-4a2b-9672-052160a54508";
const revisionTwo = "d7a6c8e2-51e8-4a2b-9672-052160a54509";
const operationTwo = "d7a6c8e2-51e8-4a2b-9672-052160a54510";
const operationThree = "d7a6c8e2-51e8-4a2b-9672-052160a54512";
const operationFour = "d7a6c8e2-51e8-4a2b-9672-052160a54513";
const operationFive = "d7a6c8e2-51e8-4a2b-9672-052160a54514";
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
  for (const version of ["20261112202411", "20261112205628", "20261112211128", "20261112212740", "20261112215610", "20261112220943", "20261113035800", "20261113040500", "20261113042000", "20261113042100", "20261113042200"]) {
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
      (not exists(select 1 from public.app_supply_weekly_clone_operations where operation_id in ('${operation}','${operationTwo}','${operationThree}','${operationFour}','${operationFive}')) and not exists(select 1 from public.app_audit_events where operation_id in ('${operation}','${operationTwo}','${operationThree}','${operationFour}','${operationFive}','${undoOperation}')))::text,'|',
      (not exists(select 1 from public.app_supply_weekly_clone_fixture_records where run_id='${runId}'))::text)`]);
  assert.equal(collision.status, 0, collision.stderr);
  assert.equal(collision.stdout.trim(), "true|true|true|true|true", "refusing synthetic fixture ID/email/run collisions");
  const grants = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
    has_function_privilege('anon','public.preview_weekly_supply_clone(uuid,date,date)','EXECUTE')::text,'|',
    has_function_privilege('authenticated','public.preview_weekly_supply_clone(uuid,date,date)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.preview_weekly_supply_clone(uuid,date,date)','EXECUTE')::text,'|',
    (not has_table_privilege('anon','public.app_supply_weekly_clone_operations','SELECT') and not has_table_privilege('authenticated','public.app_supply_weekly_clone_items','SELECT'))::text)`]);
  assert.equal(grants.status, 0, grants.stderr);
  assert.equal(grants.stdout.trim(), "false|false|true|true", "clone RPC/table grants must be service-only");

  const content = JSON.stringify({ title: "Synthetic weekly Table", localDate: "2026-11-19", startLocalTime: "19:00", neighborhood: "Inman Park", hostNotes: "private fixture note", stops: [
    { role: "drinks", venueId: "d7a6c8e2-51e8-4a2b-9672-052160a54511", venueName: "Fixture Bar", venueAddress: "1 Test Way", minutesFromStart: 0, publicNotes: "" },
    { role: "dinner", venueId: "d7a6c8e2-51e8-4a2b-9672-052160a54512", venueName: "Fixture Restaurant", venueAddress: "2 Test Way", minutesFromStart: 60, publicNotes: "" },
    { role: "dessert", venueId: "d7a6c8e2-51e8-4a2b-9672-052160a54513", venueName: "Fixture Dessert", venueAddress: "3 Test Way", minutesFromStart: 120, publicNotes: "" },
  ] });
  const sql = `begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${admin}','authenticated','authenticated','w05.3-admin@example.test','','{}','{}',now(),now()),('${member}','authenticated','authenticated','w05.3-member@example.test','','{}','{}',now(),now());
insert into public.app_user_roles(user_id,role) values ('${admin}','admin');
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values ('${source}','draft','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by)
values ('${revision}','${source}',1,'draft','${content.replaceAll("'", "''")}'::jsonb,'${admin}');
update public.app_supply_table_heads set draft_revision_id='${revision}' where table_id='${source}';
set local request.jwt.claims='{"role":"service_role"}';
do $test$
declare v_preview jsonb; v_op jsonb; v_replay jsonb; v_work jsonb; v_created jsonb; v_unknown jsonb; v_lookup jsonb;
  v_undo jsonb; v_deleted jsonb; v_list jsonb; v_item jsonb; v_hash text; v_provider text; v_marker uuid; v_target uuid; v_target_rev uuid; v_count int;
begin
  v_preview:=public.preview_weekly_supply_clone('${admin}'::uuid,'${week}'::date,'${targetWeek}'::date);
  if v_preview->>'weekDelta'<>'1' or jsonb_array_length(v_preview->'items')<>1 or v_preview->'items'->0->>'targetLocalDate'<>'2026-11-26'
    or v_preview->'items'->0->>'eligibility'<>'eligible' then raise exception 'Monday week preview/date shifting failed'; end if;
  v_hash:=v_preview->>'planHash';
  begin perform public.preview_weekly_supply_clone('${admin}'::uuid,'2026-11-17'::date,'${targetWeek}'::date); raise exception 'non-Monday source accepted';
    exception when invalid_parameter_value then null; end;
  begin perform public.preview_weekly_supply_clone('${member}'::uuid,'${week}'::date,'${targetWeek}'::date); raise exception 'member preview accepted';
    exception when insufficient_privilege then null; end;
  v_op:=public.begin_weekly_supply_clone('${admin}'::uuid,'${operation}'::uuid,'${week}'::date,'${targetWeek}'::date,v_hash);
  v_replay:=public.begin_weekly_supply_clone('${admin}'::uuid,'${operation}'::uuid,'${week}'::date,'${targetWeek}'::date,v_hash);
  if v_op<>v_replay or v_op->'operation'->>'state'<>'running' then raise exception 'same-operation replay was not stable'; end if;
  begin perform public.begin_weekly_supply_clone('${admin}'::uuid,'${operation}'::uuid,'${week}'::date,'2026-11-30'::date,md5('other')); raise exception 'operation payload reuse accepted';
    exception when unique_violation then null; end;
  v_work:=public.claim_weekly_supply_clone_item('${admin}'::uuid,'${operation}'::uuid);
  v_marker:=(v_work->>'markerId')::uuid; v_target:=(v_work->>'targetTableId')::uuid;
  v_target_rev:=(v_op->'items'->0->>'target_revision_id')::uuid;
  v_created:=public.fixture_create_weekly_clone_record('${admin}'::uuid,'${runId}',v_marker,null,v_work->'content',v_work->>'contentHash');
  v_provider:=v_created->>'providerRecordId';
  v_unknown:=public.finish_weekly_supply_clone_item('${admin}'::uuid,'${operation}'::uuid,'${source}'::uuid,'outcome_unknown',null);
  if v_unknown->'operation'->>'state'<>'outcome_unknown' then raise exception 'uncertain create was not durable'; end if;
  v_lookup:=public.fixture_reconcile_weekly_clone_create('${admin}'::uuid,'${runId}',v_marker,null,v_work->>'contentHash');
  if v_lookup->>'state'<>'found' or v_lookup->>'providerRecordId'<>v_provider then raise exception 'fixture restart reconciliation did not find exact marker'; end if;
  v_op:=public.reconcile_weekly_supply_clone_item('${admin}'::uuid,'${operation}'::uuid,'${source}'::uuid,'found',v_provider);
  if v_op->'operation'->>'state'<>'completed' then raise exception 'reconciliation did not complete clone'; end if;
  if not exists(select 1 from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id
    where h.table_id=v_target and h.lifecycle='draft' and h.accepted_revision_id is null and h.published_revision_id is null
      and r.state='draft' and r.content->>'localDate'='2026-11-26' and r.content->>'hostNotes'='private fixture note') then raise exception 'clone was not created as a shifted draft'; end if;
  if not exists(select 1 from public.app_supply_table_heads where table_id='${source}' and draft_revision_id='${revision}') then raise exception 'source changed during clone'; end if;
  v_list:=public.list_weekly_supply_clone_operations('${admin}'::uuid,null,1);
  if jsonb_array_length(v_list->'items')<>1 or v_list->'items'->0->>'operationId' not like 'd7a6c8e2-%' then raise exception 'operation list DTO malformed'; end if;
  v_hash:=(v_op->'operation'->>'manifest_revision')::int;
  v_undo:=public.begin_weekly_supply_clone_undo('${admin}'::uuid,'${operation}'::uuid,'${undoOperation}'::uuid,v_hash::int);
  if v_undo->'operation'->>'undo_expected_manifest_revision'<>v_hash::text then raise exception 'original undo request revision was not persisted'; end if;
  if public.begin_weekly_supply_clone_undo('${admin}'::uuid,'${operation}'::uuid,'${undoOperation}'::uuid,v_hash::int)<>v_undo then raise exception 'same undo request replay changed result'; end if;
  begin perform public.begin_weekly_supply_clone_undo('${admin}'::uuid,'${operation}'::uuid,'${undoOperation}'::uuid,(v_hash::int+1)::int); raise exception 'same undo key accepted a different request revision';
    exception when unique_violation then null; end;
  begin update public.app_supply_table_heads set lifecycle='accepted' where table_id=v_target; raise exception 'undo guard allowed concurrent accept';
    exception when raise_exception then if sqlerrm not like '%undo_in_progress%' then raise; end if; end;
  v_item:=v_undo->'items'->0;
  -- The first delete call is never committed: exact marker reconciliation finds
  -- it still present and permits only the same undo operation to retry.
  v_undo:=public.finish_weekly_supply_clone_undo_item('${admin}'::uuid,'${operation}'::uuid,'${source}'::uuid,'outcome_unknown');
  if v_undo->'operation'->>'state'<>'undo_unknown' then raise exception 'lost delete response was not recorded as unknown'; end if;
  v_lookup:=public.fixture_reconcile_weekly_clone_delete('${admin}'::uuid,'${runId}',v_marker,v_provider,v_work->>'contentHash');
  if v_lookup->>'state'<>'found' then raise exception 'surviving provider marker was not reconciled as present'; end if;
  v_undo:=public.finish_weekly_supply_clone_undo_item('${admin}'::uuid,'${operation}'::uuid,'${source}'::uuid,'present');
  if v_undo->'operation'->>'undo_retry_disposition'<>'same_operation_after_no_delete' then raise exception 'present marker did not permit same-operation retry'; end if;
  v_undo:=public.begin_weekly_supply_clone_undo('${admin}'::uuid,'${operation}'::uuid,'${undoOperation}'::uuid,v_hash::int);
  v_deleted:=public.fixture_delete_weekly_clone_record('${admin}'::uuid,'${runId}',v_marker,v_provider,v_work->>'contentHash');
  if v_deleted->>'state'<>'deleted' then raise exception 'fixture undo did not delete exact marker'; end if;
  v_undo:=public.finish_weekly_supply_clone_undo_item('${admin}'::uuid,'${operation}'::uuid,'${source}'::uuid,'outcome_unknown');
  v_lookup:=public.fixture_reconcile_weekly_clone_delete('${admin}'::uuid,'${runId}',v_marker,v_provider,v_work->>'contentHash');
  if v_lookup->>'state'<>'absent' then raise exception 'committed delete was not reconciled as absent'; end if;
  v_undo:=public.finish_weekly_supply_clone_undo_item('${admin}'::uuid,'${operation}'::uuid,'${source}'::uuid,'deleted');
  if v_undo->'operation'->>'state'<>'undone' or exists(select 1 from public.app_supply_table_heads where table_id=v_target) then raise exception 'undo left a target draft'; end if;
  if not exists(select 1 from public.app_supply_table_heads where table_id='${source}' and draft_revision_id='${revision}') then raise exception 'undo touched source'; end if;
  select count(*) into v_count from public.app_supply_weekly_clone_fixture_records where run_id='${runId}';
  if v_count<>1 or not exists(select 1 from public.app_supply_weekly_clone_fixture_records where run_id='${runId}' and marker_id=v_marker and state='deleted') then raise exception 'fixture deletion state missing'; end if;

  -- A second source makes a multi-item operation: one exact create succeeds,
  -- then a duplicate marker with different contents is reported as conflict.
  insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values ('${sourceTwo}','draft','current');
  insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by)
    values ('${revisionTwo}','${sourceTwo}',1,'draft',jsonb_set('${content.replaceAll("'", "''")}'::jsonb,'{title}',to_jsonb('Second synthetic weekly Table'::text)),'${admin}');
  update public.app_supply_table_heads set draft_revision_id='${revisionTwo}' where table_id='${sourceTwo}';
  v_preview:=public.preview_weekly_supply_clone('${admin}'::uuid,'${week}'::date,'${targetWeek}'::date);
  if jsonb_array_length(v_preview->'items')<>2 or v_preview->>'weekDelta'<>'1' then raise exception 'multi-item plan was not complete'; end if;
  v_op:=public.begin_weekly_supply_clone('${admin}'::uuid,'${operationTwo}'::uuid,'${week}'::date,'${targetWeek}'::date,v_preview->>'planHash');
  v_work:=public.claim_weekly_supply_clone_item('${admin}'::uuid,'${operationTwo}'::uuid);
  if v_work->>'sourceTableId'<>'${source}' then raise exception 'stable source order changed'; end if;
  v_marker:=(v_work->>'markerId')::uuid;
  v_created:=public.fixture_create_weekly_clone_record('${admin}'::uuid,'${runId}',v_marker,null,v_work->'content',v_work->>'contentHash');
  v_provider:=v_created->>'providerRecordId';
  v_op:=public.finish_weekly_supply_clone_item('${admin}'::uuid,'${operationTwo}'::uuid,'${source}'::uuid,'created',v_provider);
  v_work:=public.claim_weekly_supply_clone_item('${admin}'::uuid,'${operationTwo}'::uuid);
  if v_work->>'sourceTableId'<>'${sourceTwo}' then raise exception 'second source claim is missing'; end if;
  v_marker:=(v_work->>'markerId')::uuid;
  insert into public.app_supply_weekly_clone_fixture_records(run_id,marker_id,provider_record_id,content_hash,content,state,created_by)
    values('${runId}',v_marker,'fixture-weekly-conflict:${runId}:duplicate',md5('different contents'),'{}'::jsonb,'active','${admin}');
  v_created:=public.fixture_create_weekly_clone_record('${admin}'::uuid,'${runId}',v_marker,null,v_work->'content',v_work->>'contentHash');
  if v_created->>'state'<>'conflict' then raise exception 'duplicate marker with different contents was not rejected'; end if;
  v_op:=public.finish_weekly_supply_clone_item('${admin}'::uuid,'${operationTwo}'::uuid,'${sourceTwo}'::uuid,'conflict',null);
  if v_op->'operation'->>'state'<>'partial' or v_op->'operation'->>'retry_disposition'<>'blocked'
    or not exists(select 1 from public.app_supply_weekly_clone_items where operation_id='${operationTwo}' and source_table_id='${sourceTwo}' and safe_code='provider_conflict')
    or not exists(select 1 from public.app_supply_weekly_clone_items where operation_id='${operationTwo}' and source_table_id='${source}' and state='created') then
    raise exception 'partial conflict manifest does not preserve completed item and block retry'; end if;
  begin perform public.claim_weekly_supply_clone_item('${admin}'::uuid,'${operationTwo}'::uuid); raise exception 'blocked conflict item was retried';
    exception when raise_exception then if sqlerrm not like '%operation_unresolved%' then raise; end if; end;
  v_list:=public.list_weekly_supply_clone_operations('${admin}'::uuid,null,1);
  if jsonb_array_length(v_list->'items')<>1 or v_list->'nextCursor' is null then raise exception 'first cursor page missing continuation'; end if;
  v_list:=public.list_weekly_supply_clone_operations('${admin}'::uuid,v_list->>'nextCursor',1);
  if jsonb_array_length(v_list->'items')<>1 or v_list->>'nextCursor' is not null then raise exception 'second cursor page failed'; end if;

  -- The first all-or-nothing undo preflight refuses a target that has gained
  -- protected activity; neither item is deleted nor marked for partial undo.
  v_preview:=public.preview_weekly_supply_clone('${admin}'::uuid,'${week}'::date,'${targetWeek}'::date);
  v_op:=public.begin_weekly_supply_clone('${admin}'::uuid,'${operationThree}'::uuid,'${week}'::date,'${targetWeek}'::date,v_preview->>'planHash');
  for v_count in 1..2 loop
    v_work:=public.claim_weekly_supply_clone_item('${admin}'::uuid,'${operationThree}'::uuid);
    v_marker:=(v_work->>'markerId')::uuid;
    v_created:=public.fixture_create_weekly_clone_record('${admin}'::uuid,'${runId}',v_marker,null,v_work->'content',v_work->>'contentHash');
    v_op:=public.finish_weekly_supply_clone_item('${admin}'::uuid,'${operationThree}'::uuid,(v_work->>'sourceTableId')::uuid,'created',v_created->>'providerRecordId');
  end loop;
  select target_table_id into v_target from public.app_supply_weekly_clone_items where operation_id='${operationThree}' order by ordinal limit 1;
  update public.app_supply_table_heads set protected_by_activity=true where table_id=v_target;
  begin perform public.begin_weekly_supply_clone_undo('${admin}'::uuid,'${operationThree}'::uuid,'${undoOperation}'::uuid,(v_op->'operation'->>'manifest_revision')::int); raise exception 'active clone was allowed to undo';
    exception when raise_exception then if sqlerrm not like '%undo_refused%' then raise; end if; end;
  if exists(select 1 from public.app_supply_weekly_clone_operations where operation_id='${operationThree}' and undo_operation_id is not null)
    or (select count(*) from public.app_supply_table_heads where table_id in (select target_table_id from public.app_supply_weekly_clone_items where operation_id='${operationThree}'))<>2 then
    raise exception 'activity refusal partially changed clone targets'; end if;

  -- A content/revision change after clone has the same all-or-nothing refusal.
  v_preview:=public.preview_weekly_supply_clone('${admin}'::uuid,'${week}'::date,'${targetWeek}'::date);
  v_op:=public.begin_weekly_supply_clone('${admin}'::uuid,'${operationFour}'::uuid,'${week}'::date,'${targetWeek}'::date,v_preview->>'planHash');
  for v_count in 1..2 loop
    v_work:=public.claim_weekly_supply_clone_item('${admin}'::uuid,'${operationFour}'::uuid);
    v_marker:=(v_work->>'markerId')::uuid;
    v_created:=public.fixture_create_weekly_clone_record('${admin}'::uuid,'${runId}',v_marker,null,v_work->'content',v_work->>'contentHash');
    v_op:=public.finish_weekly_supply_clone_item('${admin}'::uuid,'${operationFour}'::uuid,(v_work->>'sourceTableId')::uuid,'created',v_created->>'providerRecordId');
  end loop;
  select i.target_table_id,h.draft_revision_id into v_target,v_target_rev from public.app_supply_weekly_clone_items i join public.app_supply_table_heads h on h.table_id=i.target_table_id
    where i.operation_id='${operationFour}' order by i.ordinal limit 1;
  insert into public.app_supply_table_revisions(table_id,revision,state,content,created_by)
    select v_target,2,'draft',jsonb_set(r.content,'{title}',to_jsonb('Edited clone after copy'::text)),'${admin}'::uuid from public.app_supply_table_revisions r where r.revision_id=v_target_rev;
  update public.app_supply_table_heads set draft_revision_id=(select revision_id from public.app_supply_table_revisions where table_id=v_target and revision=2) where table_id=v_target;
  begin perform public.begin_weekly_supply_clone_undo('${admin}'::uuid,'${operationFour}'::uuid,'${undoOperation}'::uuid,(v_op->'operation'->>'manifest_revision')::int); raise exception 'changed clone was allowed to undo';
    exception when raise_exception then if sqlerrm not like '%undo_refused%' then raise; end if; end;
  if exists(select 1 from public.app_supply_weekly_clone_operations where operation_id='${operationFour}' and undo_operation_id is not null)
    or (select count(*) from public.app_supply_table_heads where table_id in (select target_table_id from public.app_supply_weekly_clone_items where operation_id='${operationFour}'))<>2 then
    raise exception 'changed-record refusal partially changed clone targets'; end if;

  -- Source-head edits after begin() do not invalidate a successful provider
  -- write: the target is materialized from the accepted immutable manifest.
  v_preview:=public.preview_weekly_supply_clone('${admin}'::uuid,'${week}'::date,'${targetWeek}'::date);
  v_op:=public.begin_weekly_supply_clone('${admin}'::uuid,'${operationFive}'::uuid,'${week}'::date,'${targetWeek}'::date,v_preview->>'planHash');
  v_work:=public.claim_weekly_supply_clone_item('${admin}'::uuid,'${operationFive}'::uuid);
  v_marker:=(v_work->>'markerId')::uuid;
  insert into public.app_supply_table_revisions(table_id,revision,state,content,created_by)
    select '${source}'::uuid,2,'draft',jsonb_set(r.content,'{title}',to_jsonb('Source edited after clone began'::text)),'${admin}'::uuid from public.app_supply_table_revisions r where r.revision_id='${revision}';
  update public.app_supply_table_heads set draft_revision_id=(select revision_id from public.app_supply_table_revisions where table_id='${source}' and revision=2) where table_id='${source}';
  v_created:=public.fixture_create_weekly_clone_record('${admin}'::uuid,'${runId}',v_marker,null,v_work->'content',v_work->>'contentHash');
  v_op:=public.finish_weekly_supply_clone_item('${admin}'::uuid,'${operationFive}'::uuid,'${source}'::uuid,'created',v_created->>'providerRecordId');
  if not exists(select 1 from public.app_supply_weekly_clone_items i join public.app_supply_table_revisions r on r.revision_id=i.target_revision_id
    where i.operation_id='${operationFive}' and i.source_table_id='${source}' and i.state='created'
      and r.content->>'title'='${JSON.parse(content).title}' and r.content->>'localDate'='2026-11-26') then
    raise exception 'successful provider create did not materialize its immutable captured source snapshot'; end if;
  if not exists(select 1 from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id
    where h.table_id='${source}' and r.content->>'title'='Source edited after clone began') then raise exception 'concurrent source edit was lost'; end if;
end $test$;
rollback;`;
  const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const residue = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
    (not exists(select 1 from auth.users where id in ('${admin}','${member}')))::text,'|',
    (not exists(select 1 from public.app_supply_table_heads where table_id in ('${source}')))::text,'|',
    (not exists(select 1 from public.app_supply_weekly_clone_operations where operation_id in ('${operation}','${operationTwo}','${operationThree}','${operationFour}','${operationFive}')) and not exists(select 1 from public.app_supply_table_heads where table_id in ('${sourceTwo}')))::text,'|',
    (not exists(select 1 from public.app_supply_weekly_clone_fixture_records where run_id='${runId}'))::text,'|',
    (not exists(select 1 from public.app_audit_events where operation_id in ('${operation}','${operationTwo}','${operationThree}','${operationFour}','${operationFive}','${undoOperation}')))::text)`]);
  assert.equal(residue.status, 0, residue.stderr);
  assert.equal(residue.stdout.trim(), "true|true|true|true|true", "rollback must remove all exact synthetic fixtures and audit rows");
  console.log("W05.3 local DB acceptance passed: role/grants, Monday preview, operation idempotency/pagination, partial duplicate-marker conflict, create/delete uncertainty, undo-key binding, activity/change refusal, captured-source snapshot, and exact rollback.");
} finally { unlinkSync(lock); }
