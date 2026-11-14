#!/usr/bin/env node

// W06.1-W06.2 local rollback-only RPC acceptance. Never resets a stack or calls
// Airtable, email, Stripe, or a hosted Supabase project.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migration = "20261113043146";
const admin = "e0566c4f-1239-428d-a104-813ab3357001";
const member = "e0566c4f-1239-428d-a104-813ab3357002";
const otherMember = "e0566c4f-1239-428d-a104-813ab3357003";
const unadmitted = "e0566c4f-1239-428d-a104-813ab3357004";
const signup = "e0566c4f-1239-428d-a104-813ab3357011";
const otherSignup = "e0566c4f-1239-428d-a104-813ab3357012";
const admission = "e0566c4f-1239-428d-a104-813ab3357021";
const otherAdmission = "e0566c4f-1239-428d-a104-813ab3357022";
const guest = "e0566c4f-1239-428d-a104-813ab3357031";
const otherGuest = "e0566c4f-1239-428d-a104-813ab3357032";
const futureA = "e0566c4f-1239-428d-a104-813ab3357041";
const futureB = "e0566c4f-1239-428d-a104-813ab3357042";
const pastTable = "e0566c4f-1239-428d-a104-813ab3357043";
const draftTable = "e0566c4f-1239-428d-a104-813ab3357044";
const revA = "e0566c4f-1239-428d-a104-813ab3357051";
const revB = "e0566c4f-1239-428d-a104-813ab3357052";
const revPast = "e0566c4f-1239-428d-a104-813ab3357053";
const revDraft = "e0566c4f-1239-428d-a104-813ab3357054";
const opCreate = "e0566c4f-1239-428d-a104-813ab3357061";
const opDuplicate = "e0566c4f-1239-428d-a104-813ab3357062";
const opWithdraw = "e0566c4f-1239-428d-a104-813ab3357064";
const opWithdrawReplay = "e0566c4f-1239-428d-a104-813ab3357065";
const opReapply = "e0566c4f-1239-428d-a104-813ab3357066";
const opReapplyAfterDecline = "e0566c4f-1239-428d-a104-813ab3357067";
const opSecondTable = "e0566c4f-1239-428d-a104-813ab3357068";
const opWithdrawAfterProfileChange = "e0566c4f-1239-428d-a104-813ab3357069";
const opProfileDenied = "e0566c4f-1239-428d-a104-813ab3357070";
const runLock = join(workdir, ".table-requests-db-test.lock");

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
  for (const [name, expected] of [["SUPABASE_URL", api], ["SUPABASE_DB_URL", db], ["DATABASE_URL", db]]) {
    if (process.env[name]) assert.equal(process.env[name], expected, `refusing mismatched ${name}`);
  }
  assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "refusing hosted project reference");
  for (const file of [join(root, ".env.test.local"), join(workdir, ".env.test.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL|SUPABASE_URL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, name, raw] = match; const value = raw.replace(/^['"]|['"]$/g, "").replace(/\s+#.*$/, "");
      assert.notEqual(name, "SUPABASE_PROJECT_REF");
      assert.equal(value, name === "SUPABASE_URL" ? api : db, `refusing mismatched ${name} in ${file}`);
    }
  }
  const status = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr);
  assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                |")),
    `W06 migration ${migration} must be applied by the coordinator after review; this harness does not migrate`);
}

assertTarget();
try { writeFileSync(runLock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
catch { throw new Error("another W06 request DB harness is running or left a lock file; inspect the isolated test workdir before retrying"); }
try {
  const operationIds = [opCreate, opDuplicate, opWithdraw, opWithdrawReplay, opReapply, opReapplyAfterDecline,
    opSecondTable, opWithdrawAfterProfileChange, opProfileDenied];
  const collision = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
    select concat(
      (not exists(select 1 from auth.users where id in ('${admin}','${member}','${otherMember}','${unadmitted}') or email like 'w06-request-%@example.test'))::text,'|',
      (not exists(select 1 from public.waitlist_signups where id in ('${signup}','${otherSignup}') or email_normalized like 'w06-request-%@example.test'))::text,'|',
      (not exists(select 1 from public.app_admissions where id in ('${admission}','${otherAdmission}') or auth_user_id in ('${member}','${otherMember}')))::text,'|',
      (not exists(select 1 from public.app_member_profiles where guest_id in ('${guest}','${otherGuest}') or auth_user_id in ('${member}','${otherMember}')))::text,'|',
      (not exists(select 1 from public.app_supply_table_heads where table_id in ('${futureA}','${futureB}','${pastTable}','${draftTable}'))
        and not exists(select 1 from public.app_supply_table_revisions where revision_id in ('${revA}','${revB}','${revPast}','${revDraft}')))::text,'|',
      (not exists(select 1 from public.app_table_requests where auth_user_id in ('${member}','${otherMember}') or table_id in ('${futureA}','${futureB}','${pastTable}','${draftTable}'))
        and not exists(select 1 from public.app_table_request_operations where operation_id in (${operationIds.map((id)=>`'${id}'`).join(",")}))
        and not exists(select 1 from public.app_audit_events where operation_id in (${operationIds.map((id)=>`'${id}'`).join(",")})))::text)`]);
  assert.equal(collision.status, 0, collision.stderr);
  assert.equal(collision.stdout.trim(), "true|true|true|true|true|true", "refusing synthetic W06 fixture collisions");

  const privileges = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
    has_function_privilege('anon','public.list_published_tables(uuid,text,text,text,text,integer)','EXECUTE')::text,'|',
    has_function_privilege('authenticated','public.create_table_request(uuid,uuid,uuid)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.list_published_tables(uuid,text,text,text,text,integer)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.read_published_table_preview(uuid)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.create_table_request(uuid,uuid,uuid)','EXECUTE')::text,'|',
    (select bool_and(not has_table_privilege(r.role_name,t.table_name,p.privilege))::text
      from (values ('anon'),('authenticated'),('service_role')) r(role_name)
      cross join (values ('public.app_table_requests'),('public.app_table_request_operations')) t(table_name)
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege)))`]);
  assert.equal(privileges.status, 0, privileges.stderr);
  assert.equal(privileges.stdout.trim(), "false|false|true|true|true|true", "W06 RPCs must be service-only and tables private");

  const content = (title, date, time, neighborhood, hostNote) => JSON.stringify({ title, localDate: date, startLocalTime: time,
    neighborhood, hostNotes: hostNote, stops: [
      { role: "drinks", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", venueName: "Public Bar", venueAddress: "1 Test Way", minutesFromStart: 0, publicNotes: "First stop" },
      { role: "dinner", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", venueName: "Public Kitchen", venueAddress: "2 Test Way", minutesFromStart: 60, publicNotes: "Dinner notes" },
      { role: "dessert", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", venueName: "Public Cafe", venueAddress: "3 Test Way", minutesFromStart: 120, publicNotes: "Dessert notes" },
    ] });
  const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${admin}','authenticated','authenticated','w06-request-admin@example.test',now(),'','{}','{}',now(),now()),
       ('${member}','authenticated','authenticated','w06-request-member@example.test',now(),'','{}','{}',now(),now()),
       ('${otherMember}','authenticated','authenticated','w06-request-other@example.test',now(),'','{}','{}',now(),now()),
       ('${unadmitted}','authenticated','authenticated','w06-request-unadmitted@example.test',now(),'','{}','{}',now(),now());
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game)
values ('${signup}','w06-request-member@example.test','Request','Member','1990-01-01','Woman',array['Women'],21,120,'Inman Park',array[]::text[],'','Open','Yes, surprise me'),
       ('${otherSignup}','w06-request-other@example.test','Other','Member','1990-01-01','Man',array['Women'],21,120,'Chamblee',array[]::text[],'','Open','Yes, surprise me');
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at)
values ('${admission}','${signup}','w06-request-member@example.test','activated','${admin}','${member}',now()),
       ('${otherAdmission}','${otherSignup}','w06-request-other@example.test','activated','${admin}','${otherMember}',now());
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game)
values ('${guest}','${member}','${admission}','approved',1,1,'Request','Member','1990-01-01','woman',array['woman'],21,120,'Inman Park',array[]::text[],'Open','Yes, surprise me'),
       ('${otherGuest}','${otherMember}','${otherAdmission}','resubmission_required',null,1,'Other','Member','1990-01-01','man',array['woman'],21,120,'Chamblee',array[]::text[],'Open','Yes, surprise me');
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values
  ('${futureA}','draft','current'),('${futureB}','draft','current'),('${pastTable}','draft','current'),('${draftTable}','draft','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  ('${revA}','${futureA}',1,'draft','${content("June Table A", "2099-06-03", "19:00", "Inman Park", "private staff A").replaceAll("'", "''")}'::jsonb,'${admin}'),
  ('${revB}','${futureB}',1,'draft','${content("June Table B", "2099-06-10", "19:30", "Chamblee", "private staff B").replaceAll("'", "''")}'::jsonb,'${admin}'),
  ('${revPast}','${pastTable}',1,'draft','${content("Past Table", "2001-06-03", "19:00", "Inman Park", "private staff past").replaceAll("'", "''")}'::jsonb,'${admin}'),
  ('${revDraft}','${draftTable}',1,'draft','${content("Unpublished Draft", "2099-06-04", "18:30", "Inman Park", "private staff draft").replaceAll("'", "''")}'::jsonb,'${admin}');
update public.app_supply_table_revisions set state='published' where revision_id in ('${revA}','${revB}','${revPast}');
update public.app_supply_table_heads set lifecycle='published',published_revision_id='${revA}' where table_id='${futureA}';
update public.app_supply_table_heads set lifecycle='published',published_revision_id='${revB}' where table_id='${futureB}';
update public.app_supply_table_heads set lifecycle='published',published_revision_id='${revPast}' where table_id='${pastTable}';
update public.app_supply_table_heads set draft_revision_id='${revDraft}' where table_id='${draftTable}';
set local request.jwt.claims='{"role":"service_role"}';
do $w06_test$
declare page_one jsonb; page_two jsonb; filtered jsonb; preview jsonb; detail jsonb; first_request jsonb; replay_request jsonb; duplicate_request jsonb;
  withdrawn jsonb; withdrawal_replay jsonb; new_request jsonb; declined_request jsonb; history jsonb; stale_profile_message text;
  second_table_request jsonb; before_head jsonb; after_head jsonb; own_history jsonb; cursor_value text;
begin
  if (select count(*) from jsonb_array_elements(public.list_published_tables('${member}',null,null,null,null,1)->'items'))<>1 then
    raise exception 'published future list did not return one row'; end if;
  page_one:=public.list_published_tables('${member}',null,null,null,null,1);
  if page_one->'items'->0->>'tableId'<>'${futureA}' or page_one->'items'->0->>'seatPriceCents'<>'2500'
      or page_one->'items'->0->>'currency'<>'USD' or page_one->'items'->0->'ownRequest'<>'null'::jsonb
      or coalesce((page_one->'items'->0->'content') is not null,false)
      or page_one->'items'->0 ? 'sourceRecordId' or page_one->'items'->0 ? 'hostNotes'
      or page_one->'items'->0->>'localDate'<>'2099-06-03' or page_one->'items'->0->>'neighborhood'<>'Inman Park' then
    raise exception 'guest list DTO leaked supply fields, omitted price, or has unexpected ordering'; end if;
  if page_one->>'nextCursor' is null then raise exception 'published list cursor missing'; end if;
  page_two:=public.list_published_tables('${member}',null,null,null,page_one->>'nextCursor',1);
  if page_two->'items'->0->>'tableId'<>'${futureB}' or page_two->>'nextCursor' is not null then raise exception 'stable cursor pagination failed'; end if;
  filtered:=public.list_published_tables('${member}','2099-06-04','2099-06-12','chamblee',null,25);
  if jsonb_array_length(filtered->'items')<>1 or filtered->'items'->0->>'tableId'<>'${futureB}' then raise exception 'date/neighborhood filters failed'; end if;
  preview:=public.read_published_table_preview('${futureA}');
  if preview->>'view'<>'preview' or (select count(*) from jsonb_object_keys(preview->'table'))<>4
    or preview->'table' ? 'startLocalTime' or preview->'table' ? 'seatPriceCents' or preview->'table' ? 'stops'
    or public.read_published_table_preview('${draftTable}') is not null or public.read_published_table_preview('${pastTable}') is not null then
    raise exception 'minimal preview included private details or non-readable record'; end if;
  detail:=public.read_published_table_detail('${member}','${futureA}');
  if detail->>'view'<>'member' or detail->'table'->>'seatPriceCents'<>'2500' or detail->'table'->>'currency'<>'USD'
    or jsonb_array_length(detail->'table'->'stops')<>3 or detail->'table'->'stops'->0 ? 'venueId'
    or detail->'table' ? 'hostNotes' or detail->'table'->'ownRequest'<>'null'::jsonb then raise exception 'full member detail DTO fields incorrect/leaked'; end if;
  begin perform public.list_published_tables('${unadmitted}',null,null,null,null,25); raise exception 'unadmitted browse was allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.read_published_table_detail('${otherMember}','${futureA}'); raise exception 'unapproved profile full detail was allowed';
  exception when sqlstate 'P0001' then get stacked diagnostics stale_profile_message=message_text; if stale_profile_message<>'profile_incomplete' then raise; end if; end;

  before_head:= (select jsonb_build_object('lifecycle',lifecycle,'draft',draft_revision_id,'accepted',accepted_revision_id,'published',published_revision_id,'activity',protected_by_activity)
    from public.app_supply_table_heads where table_id='${futureA}');
  first_request:=public.create_table_request('${member}','${futureA}','${opCreate}');
  replay_request:=public.create_table_request('${member}','${futureA}','${opCreate}');
  duplicate_request:=public.create_table_request('${member}','${futureA}','${opDuplicate}');
  if first_request<>replay_request or first_request->>'requestId'<>duplicate_request->>'requestId'
    or first_request->>'state'<>'pending' then raise exception 'create idempotency/one-active-request failed'; end if;
  begin perform public.create_table_request('${member}','${futureB}','${opCreate}'); raise exception 'operation ID rebinding was allowed';
  exception when sqlstate 'P0001' then get stacked diagnostics stale_profile_message=message_text; if stale_profile_message<>'operation_conflict' then raise; end if; end;
  if (select count(*) from public.app_table_requests where auth_user_id='${member}' and table_id='${futureA}' and state='pending')<>1
    or (select count(*) from public.app_audit_events where operation_id='${opCreate}' and action='table.request.created')<>1 then
    raise exception 'duplicate request made extra active row or audit event'; end if;
  second_table_request:=public.create_table_request('${member}','${futureB}','${opSecondTable}');
  if second_table_request->>'state'<>'pending' then raise exception 'request on second published Table failed'; end if;
  cursor_value:=(public.list_member_table_requests('${member}',null,1)->>'nextCursor');
  own_history:=public.list_member_table_requests('${member}',null,25);
  if cursor_value is null or jsonb_array_length(own_history->'items')<>2 then raise exception 'request history or bounded cursor missing'; end if;
  if not exists(select 1 from jsonb_array_elements(own_history->'items') i(value) where i.value->>'requestId'=first_request->>'requestId'
      and i.value->'table'->>'title'='June Table A' and i.value->'table'->>'isCurrentlyPublished'='true') then raise exception 'request history snapshot missing'; end if;
  if (select count(*) from jsonb_array_elements(public.list_member_table_requests('${otherMember}',null,25)->'items'))<>0 then raise exception 'history exposed another member requests'; end if;
  begin perform public.withdraw_table_request('${otherMember}',(first_request->>'requestId')::uuid,'${opWithdrawReplay}'); raise exception 'wrong-owner withdrawal was allowed';
  exception when sqlstate 'P0002' then null; end;

  withdrawn:=public.withdraw_table_request('${member}',(first_request->>'requestId')::uuid,'${opWithdraw}');
  withdrawal_replay:=public.withdraw_table_request('${member}',(first_request->>'requestId')::uuid,'${opWithdraw}');
  if withdrawn<>withdrawal_replay or withdrawn->>'state'<>'withdrawn' then raise exception 'withdraw replay did not preserve result'; end if;
  begin perform public.withdraw_table_request('${member}',(first_request->>'requestId')::uuid,'${opWithdrawReplay}'); raise exception 'non-pending withdrawal was accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics stale_profile_message=message_text; if stale_profile_message<>'invalid_transition' then raise; end if; end;
  new_request:=public.create_table_request('${member}','${futureA}','${opReapply}');
  if new_request->>'requestId'=first_request->>'requestId' then raise exception 'withdrawal reapply overwrote request history'; end if;
  update public.app_table_requests set state='declined',decline_reason='This group is full; we will keep your request history.'
    where request_id=(new_request->>'requestId')::uuid;
  declined_request:=public.create_table_request('${member}','${futureA}','${opReapplyAfterDecline}');
  if declined_request->>'requestId'=new_request->>'requestId' then raise exception 'decline reapply overwrote request history'; end if;
  if public.create_table_request('${member}','${futureA}','${opReapplyAfterDecline}')<>declined_request then raise exception 'create replay after profile state changed did not return saved result'; end if;

  update public.app_member_profiles set identity_status='resubmission_required',reviewed_identity_version=null where auth_user_id='${member}';
  begin perform public.list_published_tables('${member}',null,null,null,null,25); raise exception 'unapproved member browse was allowed';
  exception when sqlstate 'P0001' then get stacked diagnostics stale_profile_message=message_text; if stale_profile_message<>'profile_incomplete' then raise; end if; end;
  begin perform public.create_table_request('${member}','${futureB}','${opProfileDenied}'::uuid); raise exception 'unapproved member created a new request';
  exception when sqlstate 'P0001' then get stacked diagnostics stale_profile_message=message_text; if stale_profile_message<>'profile_incomplete' then raise; end if; end;
  if public.create_table_request('${member}','${futureA}','${opReapplyAfterDecline}')<>declined_request then raise exception 'operation retry after profile review change did not replay'; end if;
  withdrawn:=public.withdraw_table_request('${member}',(second_table_request->>'requestId')::uuid,'${opWithdrawAfterProfileChange}');
  if withdrawn->>'state'<>'withdrawn' then raise exception 'profile review change blocked withdrawal'; end if;
  history:=public.list_member_table_requests('${member}',null,50);
  if not exists(select 1 from jsonb_array_elements(history->'items') i(value) where i.value->>'state'='declined'
      and i.value->>'declineReason'='This group is full; we will keep your request history.') then raise exception 'decline reason missing from own history'; end if;
  if jsonb_array_length(public.list_member_table_requests('${otherMember}',null,25)->'items')<>0 then raise exception 'wrong member history was returned'; end if;
  update public.app_supply_table_heads set lifecycle='upstream_missing',published_revision_id=null where table_id='${futureA}';
  history:=public.list_member_table_requests('${member}',null,50);
  if not exists(select 1 from jsonb_array_elements(history->'items') i(value) where i.value->>'requestId'=declined_request->>'requestId'
      and i.value->'table'->>'title'='June Table A' and i.value->'table'->>'isCurrentlyPublished'='false') then
    raise exception 'unpublished Table request snapshot was not retained as unavailable'; end if;
  after_head:=(select jsonb_build_object('lifecycle',lifecycle,'draft',draft_revision_id,'accepted',accepted_revision_id,'published',published_revision_id,'activity',protected_by_activity)
    from public.app_supply_table_heads where table_id='${futureB}');
  if (after_head->>'lifecycle')<>'published' or (after_head->>'protected_by_activity')<>'false'
    or (select count(*) from public.app_table_requests where auth_user_id='${member}')<>4 then
    raise exception 'request operations mutated supply/runtime state or lost request history'; end if;
  if (select count(*) from public.app_audit_events where actor_user_id='${member}' and action='table.request.created')<>4
    or (select count(*) from public.app_audit_events where actor_user_id='${member}' and action='table.request.withdrawn')<>2 then
    raise exception 'request/withdraw audit counts did not match committed logical actions'; end if;
  if exists(select 1 from public.app_table_request_operations where operation_id='${opCreate}' and request_hash<>md5(jsonb_build_object('tableId','${futureA}'::uuid)::text))
    then raise exception 'operation replay hash changed'; end if;
end
$w06_test$;
rollback;`;
  const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(`table-requests-db-test: guarded fifthwheel-rewrite-test; migration ${migration}; service-only RPC/grants, published/future filters and cursor, minimal preview, redacted member detail, admission/profile gates, request replay/concurrency lock, withdraw/reapply history, wrong-owner denial, unavailable Table snapshot, audit and rollback passed`);
} finally {
  try { unlinkSync(runLock); } catch { /* already removed */ }
}
