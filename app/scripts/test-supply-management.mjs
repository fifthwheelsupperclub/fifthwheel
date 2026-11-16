#!/usr/bin/env node

// W05.2 local-only transactional RPC acceptance. No reset, no provider access,
// no committed fixture rows; every synthetic row is rolled back by PostgreSQL.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migrations = ["20261112202411", "20261112205628", "20261112211128", "20261112212740", "20261112215610", "20261117090000"];
const admin = "d7a6c8e2-51e8-4a2b-9672-052160a54001";
const host = "d7a6c8e2-51e8-4a2b-9672-052160a54002";
const member = "d7a6c8e2-51e8-4a2b-9672-052160a54003";
const venueA = "d7a6c8e2-51e8-4a2b-9672-052160a54101";
const venueB = "d7a6c8e2-51e8-4a2b-9672-052160a54102";
const venueC = "d7a6c8e2-51e8-4a2b-9672-052160a54103";
const venueD = "d7a6c8e2-51e8-4a2b-9672-052160a54104";
const venueArchived = "d7a6c8e2-51e8-4a2b-9672-052160a54105";
const candidateTable = "7f7d8f66-30de-5de3-9ef1-53910370c301";
const candidateSourceId = "fixture:ac9f65fc94e4:table:2026-11-19-example";
const syncRun = "d7a6c8e2-51e8-4a2b-9672-052160a54301";
const syncOperation = "d7a6c8e2-51e8-4a2b-9672-052160a54302";
const candidateCreateOp = "d7a6c8e2-51e8-4a2b-9672-052160a54303";
const createOp = "d7a6c8e2-51e8-4a2b-9672-052160a54201";
const updateOp = "d7a6c8e2-51e8-4a2b-9672-052160a54202";
const acceptOp = "d7a6c8e2-51e8-4a2b-9672-052160a54203";
const publishOp = "d7a6c8e2-51e8-4a2b-9672-052160a54204";

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
  const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf("{"), status.stdout.lastIndexOf("}") + 1));
  assert.equal(parsed.API_URL, api);
  assert.equal(parsed.DB_URL, db);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr);
  for (const migration of migrations) assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                |")), `W05.2 migration ${migration} must be applied locally`);
}

assertTarget();
const lockPath = join(workdir, ".supply-management-test.lock");
try { writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
catch { throw new Error("another W05.2 database harness is running or left a lock file; inspect the exact local test workdir before retrying"); }
try {
const collisions = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
select concat(
 (not exists(select 1 from auth.users where id in ('${admin}','${host}','${member}') or email in ('w05.2-admin@example.test','w05.2-host@example.test','w05.2-member@example.test')))::text,'|',
 (not exists(select 1 from public.app_user_roles where user_id in ('${admin}','${host}','${member}')))::text,'|',
 (not exists(select 1 from public.app_supply_table_operations where operation_id in ('${createOp}','${candidateCreateOp}','${updateOp}','${acceptOp}','${publishOp}','d7a6c8e2-51e8-4a2b-9672-052160a54205','d7a6c8e2-51e8-4a2b-9672-052160a54206','d7a6c8e2-51e8-4a2b-9672-052160a54207','d7a6c8e2-51e8-4a2b-9672-052160a54208'))
   and not exists(select 1 from public.app_supply_sync_runs where run_id='${syncRun}' or operation_id='${syncOperation}')
   and not exists(select 1 from public.app_audit_events where operation_id in ('${createOp}','${candidateCreateOp}','${updateOp}','${acceptOp}','${publishOp}','${syncOperation}','d7a6c8e2-51e8-4a2b-9672-052160a54205','d7a6c8e2-51e8-4a2b-9672-052160a54206','d7a6c8e2-51e8-4a2b-9672-052160a54207','d7a6c8e2-51e8-4a2b-9672-052160a54208')))::text,'|',
 (not exists(select 1 from public.app_supply_external_mappings where source_record_id in ('w05.2-venue-a','w05.2-venue-b','w05.2-venue-c','w05.2-venue-d','${candidateSourceId}') or core_id in ('${venueA}','${venueB}','${venueC}','${venueD}','${candidateTable}'))
   and not exists(select 1 from public.app_supply_venues where venue_id in ('${venueA}','${venueB}','${venueC}','${venueD}','${venueArchived}')))::text,'|',
 (not exists(select 1 from public.app_supply_table_heads where table_id in ('${admin}','${host}','${member}','${venueA}','${venueB}','${venueC}','${venueD}','${candidateTable}'))
   and not exists(select 1 from public.app_supply_table_revisions where table_id in ('${admin}','${host}','${member}','${venueA}','${venueB}','${venueC}','${venueD}','${candidateTable}')))::text)`]);
assert.equal(collisions.status, 0, collisions.stderr);
assert.equal(collisions.stdout.trim(), "true|true|true|true|true", "refusing synthetic fixture ID/email/source/core collisions");
const auditBaselineResult = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", "select count(*) from public.app_audit_events"]);
assert.equal(auditBaselineResult.status, 0, auditBaselineResult.stderr);
const auditBaseline = auditBaselineResult.stdout.trim();
const grants = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
select concat(
  (has_function_privilege('anon','public.create_supply_draft(uuid,jsonb)','EXECUTE'))::text,'|',
  (has_function_privilege('authenticated','public.create_supply_draft(uuid,jsonb)','EXECUTE'))::text,'|',
  (has_function_privilege('service_role','public.create_supply_draft(uuid,jsonb)','EXECUTE'))::text,'|',
  (has_function_privilege('anon','public.publish_supply_draft(uuid,uuid,jsonb)','EXECUTE'))::text,'|',
  (has_function_privilege('authenticated','public.publish_supply_draft(uuid,uuid,jsonb)','EXECUTE'))::text,'|',
  (has_function_privilege('service_role','public.publish_supply_draft(uuid,uuid,jsonb)','EXECUTE'))::text,'|',
  (select bool_and(not has_table_privilege(r.role_name,t.table_name,p.privilege))::text
   from (values ('anon'),('authenticated')) r(role_name)
   cross join (values ('public.app_supply_table_heads'),('public.app_supply_table_revisions'),('public.app_supply_table_assignments'),('public.app_supply_table_operations')) t(table_name)
   cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege)))`]);
assert.equal(grants.status, 0, grants.stderr);
assert.equal(grants.stdout.trim(), "false|false|true|false|false|true|true");

const sql = `
begin;
insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,email_confirmed_at)
values ('${admin}','authenticated','authenticated','w05.2-admin@example.test','','{}','{}',now(),now(),now()),
       ('${host}','authenticated','authenticated','w05.2-host@example.test','','{}','{}',now(),now(),now()),
       ('${member}','authenticated','authenticated','w05.2-member@example.test','','{}','{}',now(),now(),now());
insert into public.app_user_roles(user_id,role) values ('${admin}','admin'),('${host}','host');
insert into public.app_supply_external_mappings(entity_kind,source_record_id,core_id) values
('venue','w05.2-venue-a','${venueA}'),('venue','w05.2-venue-b','${venueB}'),('venue','w05.2-venue-c','${venueC}'),('venue','w05.2-venue-d','${venueD}'),
('table','${candidateSourceId}','${candidateTable}');
insert into public.app_supply_sync_runs(run_id,operation_id,actor_user_id,state,started_at,finished_at,table_count,venue_count,candidate_source_hash)
values('${syncRun}','${syncOperation}','${admin}','staged',now(),now(),1,4,repeat('c',64));
with candidate as (
  insert into public.app_supply_sync_revisions(run_id,source_hash,table_count,venue_count,normalized_candidate)
  values('${syncRun}',repeat('c',64),1,4,jsonb_build_array(
    jsonb_build_object('id','${venueA}','sourceRecordId','w05.2-venue-a','name','Test Venue A','address','1 Test Way','neighborhood','Inman Park'),
    jsonb_build_object('id','${venueB}','sourceRecordId','w05.2-venue-b','name','Test Venue B','address','2 Test Way','neighborhood','Inman Park'),
    jsonb_build_object('id','${venueC}','sourceRecordId','w05.2-venue-c','name','Test Venue C','address','3 Test Way','neighborhood','Inman Park'),
    jsonb_build_object('id','${venueD}','sourceRecordId','w05.2-venue-d','name','Unassigned Venue','address','4 Test Way','neighborhood','Inman Park'),
    jsonb_build_object('id','${candidateTable}','sourceRecordId','${candidateSourceId}','title','Synthetic Candidate Table',
      'localDate','2026-12-03','startLocalTime','19:00','startsAt','2026-12-04T00:00:00Z','neighborhood','Inman Park','publicationIntent','candidate',
      'stops',jsonb_build_array(jsonb_build_object('role','drinks','venueId','${venueA}','minutesFromStart',0),
        jsonb_build_object('role','dinner','venueId','${venueB}','minutesFromStart',45),jsonb_build_object('role','dessert','venueId','${venueC}','minutesFromStart',120)))))
  returning revision_id
) update public.app_supply_sync_runs set candidate_revision_id=(select revision_id from candidate) where run_id='${syncRun}';
update public.app_supply_control set latest_staged_revision_id=(select revision_id from public.app_supply_sync_revisions where run_id='${syncRun}'),latest_candidate_hash=repeat('c',64) where singleton;
set local request.jwt.claims='{"role":"service_role"}';
do $management_test$
declare content jsonb; req jsonb; created jsonb; replay jsonb; updated jsonb; updated_replay jsonb; preview jsonb; accepted jsonb; accepted_replay jsonb; published jsonb; published_replay jsonb;
  v_table uuid; draft_id uuid; accepted_id uuid; candidate_revision uuid; candidate_created jsonb; candidate_replay jsonb; candidate_request jsonb; stale_message text; admin_list jsonb; host_list jsonb; host_detail jsonb; venue_list jsonb; admin_venues jsonb;
  saved jsonb;
begin
  -- Venues are app-owned: admins create them through save_supply_venue; a retry with the same id updates instead of duplicating.
  perform public.save_supply_venue('${admin}'::uuid,'${venueA}'::uuid,'Test Venue A','1 Test Way','Inman Park',true);
  perform public.save_supply_venue('${admin}'::uuid,'${venueB}'::uuid,'Test Venue B','2 Test Way','Inman Park',true);
  perform public.save_supply_venue('${admin}'::uuid,'${venueC}'::uuid,'Test Venue C','3 Test Way','Inman Park',true);
  perform public.save_supply_venue('${admin}'::uuid,'${venueD}'::uuid,'Unassigned Venue','4 Test Way','Inman Park',true);
  perform public.save_supply_venue('${admin}'::uuid,'${venueArchived}'::uuid,'Archived Venue','5 Test Way','Inman Park',true);
  saved := public.save_supply_venue('${admin}'::uuid,'${venueArchived}'::uuid,'Archived Venue','5 Test Way','Inman Park',false);
  if saved->>'active'<>'false' or (select count(*) from public.app_supply_venues where venue_id='${venueArchived}')<>1 then raise exception 'venue upsert/archive failed'; end if;
  if (select count(*) from public.app_audit_events where actor_user_id='${admin}'::uuid and action='supply.venue.saved')<>6 then raise exception 'venue save audit missing'; end if;
  begin perform public.save_supply_venue('${host}'::uuid,'${venueA}'::uuid,'Hijacked','1 Test Way','Inman Park',true); raise exception 'host venue save was allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.save_supply_venue('${admin}'::uuid,'${venueA}'::uuid,' ','1 Test Way','Inman Park',true); raise exception 'blank venue name was allowed';
  exception when sqlstate '22023' then null; end;
  select revision_id into candidate_revision from public.app_supply_sync_revisions where run_id='${syncRun}';
  admin_list:=public.list_supply_tables('${admin}'::uuid,null,null,25);
  if admin_list->>'canCreateDraft'<>'true'
    or not exists(select 1 from jsonb_array_elements(admin_list->'stagedCandidates') candidate(value)
      where candidate.value->>'tableId'='${candidateTable}' and candidate.value->>'canCreateDraft'='true') then
    raise exception 'admin list-level or candidate-level create capability missing';
  end if;
  host_list:=public.list_supply_tables('${host}'::uuid,null,null,25);
  if host_list->>'canCreateDraft'<>'false' or jsonb_array_length(host_list->'stagedCandidates')<>0 then
    raise exception 'host staged candidate capability was not denied';
  end if;
  candidate_request:=jsonb_build_object('operationId','${candidateCreateOp}','source',jsonb_build_object('kind','candidate','revisionId',candidate_revision,'tableId','${candidateTable}'));
  candidate_created:=public.create_supply_draft('${admin}'::uuid,candidate_request);
  candidate_replay:=public.create_supply_draft('${admin}'::uuid,candidate_request);
  if candidate_created<>candidate_replay or candidate_created->>'tableId'<>'${candidateTable}' or candidate_created->'draft'->>'state'<>'draft'
    or candidate_created->'draft'->'content'->'stops'->2->>'venueName'<>'Test Venue C' then raise exception 'staged candidate create lookup/content/replay failed'; end if;

  content := jsonb_build_object('title','Synthetic integration Table','localDate','2026-12-03','startLocalTime','19:00',
    'neighborhood','Inman Park','hostNotes','Staff-only operational note',
    'stops',jsonb_build_array(
      jsonb_build_object('role','drinks','venueId','${venueA}','venueName','Test Venue A','venueAddress','1 Test Way','minutesFromStart',0,'publicNotes',''),
      jsonb_build_object('role','dinner','venueId','${venueB}','venueName','Test Venue B','venueAddress','2 Test Way','minutesFromStart',45,'publicNotes','Dinner note'),
      jsonb_build_object('role','dessert','venueId','${venueC}','venueName','Test Venue C','venueAddress','3 Test Way','minutesFromStart',120,'publicNotes','')));
  req := jsonb_build_object('operationId','${createOp}','source',jsonb_build_object('kind','manual','content',content));
  created := public.create_supply_draft('${admin}'::uuid,req);
  replay := public.create_supply_draft('${admin}'::uuid,req);
  if created<>replay then raise exception 'create operation replay changed result'; end if;
  v_table := (created->>'tableId')::uuid; draft_id := (created->'draft'->>'revisionId')::uuid;
  if created->'draft'->'content'->>'hostNotes'<>'Staff-only operational note' then raise exception 'management draft DTO lost hostNotes'; end if;
  admin_list := public.list_supply_tables('${admin}'::uuid,null,null,25);
  if admin_list->>'canCreateDraft'<>'true' or admin_list->'stagedCandidates' is null then raise exception 'admin capabilities/candidate envelope invalid'; end if;
  if exists(select 1 from jsonb_array_elements(admin_list->'items') item(value)
    where item.value->>'syncState' is null or item.value->>'syncState' not in ('current','stale','missing')) then
    raise exception 'Table list syncState projection missing or invalid';
  end if;
  if coalesce((admin_list->'items'->0) ? 'hostNotes',false) then raise exception 'list DTO exposed private host notes'; end if;
  begin perform public.list_supply_tables('${member}'::uuid,null,null,25); raise exception 'member supply list was allowed';
  exception when insufficient_privilege then null; end;
  insert into public.app_supply_table_assignments(table_id,user_id,assigned_by) values(v_table,'${host}'::uuid,'${admin}'::uuid);
  host_list := public.list_supply_tables('${host}'::uuid,null,null,25);
  if host_list->>'canCreateDraft'<>'false' or jsonb_array_length(host_list->'stagedCandidates')<>0 then raise exception 'host create capability leaked'; end if;
  host_detail := public.read_supply_table_detail('${host}'::uuid,v_table);
  if host_detail->>'canEditDraft'<>'true' or host_detail->>'canAccept'<>'false' or host_detail->>'canPublish'<>'false' then raise exception 'host role capability mismatch'; end if;
  venue_list := public.list_supply_venues('${host}'::uuid,null);
  if jsonb_typeof(venue_list->'items')<>'array' then raise exception 'assigned host venue options did not return a safe list'; end if;
  if (select count(*) from jsonb_array_elements(venue_list->'items') venue where venue.value->>'venueId' in ('${venueA}','${venueB}','${venueC}'))<>3
    or exists(select 1 from jsonb_array_elements(venue_list->'items') venue where venue.value->>'venueId'='${venueD}') then raise exception 'host saw venue outside assigned draft'; end if;
  admin_venues := public.list_supply_venues('${admin}'::uuid,null);
  if (select count(*) from jsonb_array_elements(admin_venues->'items'))<>5
    or not exists(select 1 from jsonb_array_elements(admin_venues->'items') venue where venue.value->>'venueId'='${venueArchived}' and venue.value->>'active'='false')
    then raise exception 'admin venue list did not include every venue with its active flag'; end if;
  begin
    perform public.create_supply_draft('${admin}'::uuid,jsonb_build_object('operationId','d7a6c8e2-51e8-4a2b-9672-052160a54212','source',jsonb_build_object('kind','manual','content',
      content || jsonb_build_object('stops',jsonb_set(content->'stops','{0,venueId}',to_jsonb('${venueArchived}'::text))))));
    raise exception 'draft with an archived venue was allowed';
  exception when sqlstate '22023' then null; end;
  begin perform public.create_supply_draft('${host}'::uuid,req); raise exception 'host draft creation was allowed';
  exception when insufficient_privilege then null; end;

  req := jsonb_build_object('operationId','${updateOp}','expectedDraftRevision',1,'content',content || jsonb_build_object('title','Synthetic revised Table'));
  updated := public.update_supply_draft('${host}'::uuid,draft_id,req);
  updated_replay := public.update_supply_draft('${host}'::uuid,draft_id,req);
  if updated<>updated_replay or (updated->>'revision')::integer<>2 then raise exception 'update idempotency/revision failed'; end if;
  draft_id := (updated->>'revisionId')::uuid;
  preview := public.read_supply_draft_preview('${admin}'::uuid,draft_id,2);
  if preview->'draft'->>'revisionId'<>draft_id::text then raise exception 'preview did not return current detail'; end if;

  req := jsonb_build_object('operationId','${acceptOp}','expectedDraftRevision',2);
  accepted := public.accept_supply_draft('${admin}'::uuid,draft_id,req);
  accepted_replay := public.accept_supply_draft('${admin}'::uuid,draft_id,req);
  if accepted->>'state'<>'accepted' or accepted<>accepted_replay then raise exception 'accept state/replay mismatch'; end if;
  req := jsonb_build_object('operationId','${publishOp}','expectedDraftRevision',2);
  published := public.publish_supply_draft('${admin}'::uuid,draft_id,req);
  published_replay := public.publish_supply_draft('${admin}'::uuid,draft_id,req);
  if published->>'tableId'<>v_table::text or published->'published'->>'state'<>'published' or published<>published_replay then raise exception 'publish state/replay mismatch'; end if;
  accepted_id := draft_id;

  req := jsonb_build_object('operationId','d7a6c8e2-51e8-4a2b-9672-052160a54205','expectedDraftRevision',2,'content',content || jsonb_build_object('title','Cosmetic newer draft'));
  updated := public.update_supply_draft('${admin}'::uuid,draft_id,req);
  if updated->>'revision'<>'3' then raise exception 'post-publish draft revision missing'; end if;
  draft_id := (updated->>'revisionId')::uuid;
  if not exists(select 1 from public.app_supply_table_heads h where h.table_id=v_table and h.accepted_revision_id=accepted_id and h.published_revision_id=accepted_id) then raise exception 'update moved accepted/published pointers'; end if;
  -- Exercise the activity protection latch independently of W06's not-yet-built
  -- Table invitation/Seat records. W06 must connect real activity to this latch.
  update public.app_supply_table_heads set protected_by_activity=true where table_id=v_table;
  updated := public.update_supply_draft('${admin}'::uuid,draft_id,jsonb_build_object(
    'operationId','d7a6c8e2-51e8-4a2b-9672-052160a54209','expectedDraftRevision',3,
    'content',content || jsonb_build_object('title','Post-activity cosmetic correction')));
  if updated->>'revision'<>'4' or updated->'content'->>'title'<>'Post-activity cosmetic correction' then
    raise exception 'cosmetic correction was blocked while activity protection was set';
  end if;
  draft_id := (updated->>'revisionId')::uuid;
  begin
    perform public.update_supply_draft('${admin}'::uuid,draft_id,jsonb_build_object(
      'operationId','d7a6c8e2-51e8-4a2b-9672-052160a54210','expectedDraftRevision',4,
      'content',content || jsonb_build_object('localDate','2026-12-10')));
    raise exception 'protected schedule change was allowed';
  exception when sqlstate 'P0001' then
    get stacked diagnostics stale_message=message_text;
    if stale_message<>'protected_change' then raise; end if;
  end;
  begin
    perform public.update_supply_draft('${admin}'::uuid,draft_id,jsonb_build_object(
      'operationId','d7a6c8e2-51e8-4a2b-9672-052160a54211','expectedDraftRevision',4,
      'content',content || jsonb_build_object('stops',jsonb_set(content->'stops','{1,venueId}',to_jsonb('${venueD}'::text)))));
    raise exception 'protected venue change was allowed';
  exception when sqlstate 'P0001' then
    get stacked diagnostics stale_message=message_text;
    if stale_message<>'protected_change' then raise; end if;
  end;
  if not exists(select 1 from public.app_supply_table_heads h where h.table_id=v_table and h.draft_revision_id=draft_id
      and h.accepted_revision_id=accepted_id and h.published_revision_id=accepted_id)
    or exists(select 1 from public.app_supply_table_operations where operation_id in
      ('d7a6c8e2-51e8-4a2b-9672-052160a54210','d7a6c8e2-51e8-4a2b-9672-052160a54211')) then
    raise exception 'protected critical edits mutated supply state or consumed operation IDs';
  end if;
  if (select count(*) from public.app_audit_events where actor_user_id='${admin}'::uuid and action='supply.draft.updated')<>2 then
    raise exception 'cosmetic update audit was missing or protected attempts were audited as successful updates';
  end if;
  begin
    perform public.update_supply_draft('${admin}'::uuid,draft_id,jsonb_build_object('operationId','d7a6c8e2-51e8-4a2b-9672-052160a54206','expectedDraftRevision',2,'content',content));
    raise exception 'stale update was accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics stale_message=message_text; if stale_message<>'revision_conflict' then raise; end if; end;
  begin perform public.accept_supply_draft('${host}'::uuid,draft_id,jsonb_build_object('operationId','d7a6c8e2-51e8-4a2b-9672-052160a54207','expectedDraftRevision',3)); raise exception 'host acceptance was allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.publish_supply_draft('${host}'::uuid,draft_id,jsonb_build_object('operationId','d7a6c8e2-51e8-4a2b-9672-052160a54208','expectedDraftRevision',3)); raise exception 'host publication was allowed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.app_audit_events where actor_user_id='${admin}'::uuid and action in ('supply.draft.created','supply.draft.accepted','supply.draft.published'))<>4 then raise exception 'admin action audit missing'; end if;
  if (select count(*) from public.app_audit_events where actor_user_id='${host}'::uuid and action='supply.draft.updated')<>1 then raise exception 'host edit audit missing'; end if;

  -- Restaurant staff can be attached to an app-owned venue that has no Tables yet; unknown venues are refused.
  insert into public.app_user_roles(user_id,role) values ('${member}','restaurant');
  if public.set_venue_membership('${admin}'::uuid,'${venueD}'::uuid,'${member}'::uuid,true)->>'assigned'<>'true' then raise exception 'venue membership on app-owned venue failed'; end if;
  begin perform public.set_venue_membership('${admin}'::uuid,'d7a6c8e2-51e8-4a2b-9672-052160a54199'::uuid,'${member}'::uuid,true); raise exception 'membership on unknown venue was allowed';
  exception when sqlstate 'P0002' then null; end;
  if (public.read_staff_assignments('${admin}'::uuid)->'venues')::text like '%${venueArchived}%' then raise exception 'archived venue offered for staff assignment'; end if;
end;
$management_test$;
rollback;
`;
const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql]);
assert.equal(result.status, 0, result.stderr || result.stdout);
const auditAfterResult = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", "select count(*) from public.app_audit_events"]);
assert.equal(auditAfterResult.status, 0, auditAfterResult.stderr);
assert.equal(auditAfterResult.stdout.trim(), auditBaseline, "fixture audit rows must roll back with the fixture transaction");
console.log(`supply-management-test: guarded project fifthwheel-rewrite-test; migrations ${migrations.join(",")}; role grants, venue save/archive/role boundaries, archived-venue draft refusal, venue membership, admin/host boundaries, create/update replay, preview, accept/publish, pointer preservation, stale and activity-latch critical conflicts, cosmetic correction audit passed; auth/role/operation/mapping/core collisions absent; audit count ${auditBaseline} unchanged after fixture transaction rollback`);
} finally {
  try { unlinkSync(lockPath); } catch { /* already removed */ }
}
