#!/usr/bin/env node

// W06.5 rollback-only acceptance against fifthwheel-rewrite-test. This script never
// resets/applies migrations and never contacts Mailpit, Auth, or another provider.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migration = "20261113142334";
const fixtureId = (n) => `a0075000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = fixtureId(1); const secondAdmin = fixtureId(2); const host = fixtureId(3);
const members = [fixtureId(10), fixtureId(11), fixtureId(12)];
const signups = [fixtureId(20), fixtureId(21), fixtureId(22)];
const admissions = [fixtureId(30), fixtureId(31), fixtureId(32)];
const guests = [fixtureId(40), fixtureId(41), fixtureId(42)];
const tables = [fixtureId(50), fixtureId(51), fixtureId(52)];
const revisions = [fixtureId(60), fixtureId(61), fixtureId(62)];
const requests = [fixtureId(70), fixtureId(71), fixtureId(72)];
const proposals = [fixtureId(80), fixtureId(81), fixtureId(82)];
const invitations = [fixtureId(90), fixtureId(91), fixtureId(92)];
const outboxes = [fixtureId(100), fixtureId(101), fixtureId(102)];
const outboxOperations = [fixtureId(110), fixtureId(111), fixtureId(112)];
const attempts = [fixtureId(120), fixtureId(121), fixtureId(122), fixtureId(123)];
const attemptOperations = [fixtureId(130), fixtureId(131), fixtureId(132), fixtureId(133)];
const adminOperations = [fixtureId(140), fixtureId(141), fixtureId(142)];
const emails = members.map((id) => `w06-table-mail-${id.slice(-4)}@example.test`);
const lockPath = join(workdir, ".table-invitation-delivery-db-test.lock");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", ...options.env } });
  if (result.error) throw result.error;
  return result;
}
function sqlList(values) { return values.map((id) => `'${id}'`).join(","); }

function assertTarget() {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m);
  assert.match(config, /^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m);
  assert.match(config, /^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m);
  assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "refusing linked/hosted Supabase target");
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
  const local = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(local.status, 0, local.stderr || local.stdout);
  const status = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf("{"), status.stdout.lastIndexOf("}") + 1));
  assert.equal(parsed.API_URL, api); assert.equal(parsed.DB_URL, db);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr || history.stdout);
  assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                |")),
    `migration ${migration} must already be applied; this harness never applies migrations`);
}

assertTarget();
try { writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
catch { throw new Error("another W06.5 DB harness is running or left a lock; inspect the isolated test workdir before retrying"); }

try {
  const authIds = [admin, secondAdmin, host, ...members];
  const allIds = [...authIds, ...signups, ...admissions, ...guests, ...tables, ...revisions, ...requests, ...proposals,
    ...invitations, ...outboxes, ...outboxOperations, ...attempts, ...attemptOperations, ...adminOperations];
  const collision = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
    select concat(
      (not exists(select 1 from auth.users where id in (${sqlList(authIds)}) or email in (${emails.map((e) => `'${e}'`).join(",")})))::text,'|',
      (not exists(select 1 from public.waitlist_signups where id in (${sqlList(signups)}) or email_normalized in (${emails.map((e) => `'${e}'`).join(",")})))::text,'|',
      (not exists(select 1 from public.app_admissions where id in (${sqlList(admissions)}) or auth_user_id in (${sqlList(members)})))::text,'|',
      (not exists(select 1 from public.app_member_profiles where guest_id in (${sqlList(guests)}) or auth_user_id in (${sqlList(members)})))::text,'|',
      (not exists(select 1 from public.app_user_roles where user_id in (${sqlList(authIds)})))::text,'|',
      (not exists(select 1 from public.app_supply_table_heads where table_id in (${sqlList(tables)})))::text,'|',
      (not exists(select 1 from public.app_supply_table_revisions where revision_id in (${sqlList(revisions)}) or table_id in (${sqlList(tables)})))::text,'|',
      (not exists(select 1 from public.app_table_requests where request_id in (${sqlList(requests)}) or table_id in (${sqlList(tables)}) or guest_id in (${sqlList(guests)}) or auth_user_id in (${sqlList(members)})))::text,'|',
      (not exists(select 1 from public.app_table_roster_proposals where proposal_id in (${sqlList(proposals)}) or table_id in (${sqlList(tables)})))::text,'|',
      (not exists(select 1 from public.app_table_roster_proposal_members where proposal_id in (${sqlList(proposals)}) or request_id in (${sqlList(requests)}) or guest_id in (${sqlList(guests)})))::text,'|',
      (not exists(select 1 from public.app_table_invitations where invitation_id in (${sqlList(invitations)}) or table_id in (${sqlList(tables)}) or guest_id in (${sqlList(guests)})))::text,'|',
      (not exists(select 1 from public.app_table_invitation_outbox where outbox_id in (${sqlList(outboxes)}) or invitation_id in (${sqlList(invitations)}) or operation_id in (${sqlList(outboxOperations)})))::text,'|',
      (not exists(select 1 from public.app_table_invitation_attempts where attempt_id in (${sqlList(attempts)}) or operation_id in (${sqlList(attemptOperations)}) or outbox_id in (${sqlList(outboxes)})))::text,'|',
      (not exists(select 1 from public.app_table_invitation_operations where operation_id in (${sqlList(adminOperations)})))::text,'|',
      (not exists(select 1 from public.app_audit_events where operation_id in (${sqlList([...allIds])}) or subject_id in (${sqlList([...tables,...requests,...invitations,...attempts])})))::text)`]);
  assert.equal(collision.status, 0, collision.stderr || collision.stdout);
  assert.equal(collision.stdout.trim(), "true|true|true|true|true|true|true|true|true|true|true|true|true|true|true",
    "refusing synthetic W06.5 fixture collisions across touched relations");

  const privileges = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
    has_function_privilege('anon','public.read_member_table_invitation(uuid,uuid)','EXECUTE')::text,'|',
    has_function_privilege('authenticated','public.retry_failed_table_invitation_delivery(uuid,uuid,jsonb)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.read_member_table_invitation(uuid,uuid)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.begin_next_table_invitation_delivery_attempt(uuid)','EXECUTE')::text,'|',
    (select bool_and(not has_table_privilege(r.role_name,t.table_name,p.privilege))::text
      from (values ('anon'),('authenticated'),('service_role')) r(role_name)
      cross join (values ('public.app_table_invitation_attempts'),('public.app_table_invitation_operations')) t(table_name)
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege)))`]);
  assert.equal(privileges.status, 0, privileges.stderr || privileges.stdout);
  assert.equal(privileges.stdout.trim(), "false|false|true|true|true", "new RPCs must be service-only and private relations inaccessible");

  const userValues = authIds.map((id, i) => `('${id}','authenticated','authenticated','${i < 3 ? `w06-table-staff-${i}@example.test` : emails[i - 3]}',now(),'','{}','{}',now(),now())`).join(",\n");
  const memberValues = members.map((id, i) => `('${signups[i]}','${emails[i]}','Table${i + 1}','Guest','1990-01-01','Woman',array['Women'],21,120,'Inman Park',array[]::text[],'','Open','Yes, surprise me')`).join(",\n");
  const admissionValues = members.map((id, i) => `('${admissions[i]}','${signups[i]}','${emails[i]}','activated','${admin}','${id}',now())`).join(",\n");
  const profileValues = members.map((id, i) => `('${guests[i]}','${id}','${admissions[i]}','Table${i + 1}','Guest','1990-01-01','woman',array['woman'],21,120,'Inman Park',array[]::text[],'Open','Yes, surprise me')`).join(",\n");
  const headValues = tables.map((id) => `('${id}','published','current',null)`).join(",\n");
  const revisionValues = tables.map((tableId, i) => `('${revisions[i]}','${tableId}',1,'published',jsonb_build_object(
    'title','W06.5 Dinner ${i + 1}','localDate','2099-12-${String(10 + i).padStart(2, "0")}','startLocalTime','19:00','neighborhood','Inman Park',
    'hostNotes','PRIVATE_HOST_NOTE','stops',jsonb_build_array(
      jsonb_build_object('role','drinks','venueName','Test Bar','venueAddress','1 Test Way','minutesFromStart',0,'publicNotes','Drinks'),
      jsonb_build_object('role','dinner','venueName','Test Kitchen','venueAddress','2 Test Way','minutesFromStart',60,'publicNotes','Dinner'),
      jsonb_build_object('role','dessert','venueName','Test Cafe','venueAddress','3 Test Way','minutesFromStart',120,'publicNotes','Dessert'))),'${admin}')`).join(",\n");
  const requestValues = requests.map((id, i) => `('${id}','${tables[i]}','${guests[i]}','${members[i]}','W06.5 Dinner ${i + 1}',
    '2099-12-${String(10 + i).padStart(2, "0")}','19:00','Inman Park','pending')`).join(",\n");
  const proposalValues = proposals.map((id, i) => `('${id}','${tables[i]}',1,'approved','${revisions[i]}','{"valid":true,"issues":[]}',
    '${admin}','${admin}','${admin}','${admin}',now(),now(),now(),now())`).join(",\n");
  const proposalMemberValues = proposals.map((id, i) => `('${id}','${requests[i]}','${guests[i]}',1)`).join(",\n");
  const invitationValues = invitations.map((id, i) => `('${id}','${tables[i]}','${guests[i]}','${members[i]}','${requests[i]}','${proposals[i]}','${admin}','active')`).join(",\n");
  const outboxValues = outboxes.map((id, i) => {
    const state = i === 1 ? "failed" : "queued"; const attemptsCount = i === 1 ? 1 : 0;
    return `('${id}','${invitations[i]}','${outboxOperations[i]}','${state}',${attemptsCount},${i === 1 ? "'synthetic_rejected'" : "null"},
      now(),now(),null,${i === 1 ? "now()" : "null"},null,null,'invitation',false)`;
  }).join(",\n");
  const failedAttempt = `('${attempts[1]}','${outboxes[1]}','${attemptOperations[1]}',1,'failed',null,'synthetic_rejected',now(),now())`;

  const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ${userValues};
insert into public.app_user_roles(user_id,role) values ('${admin}','admin'),('${secondAdmin}','admin'),('${host}','host');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game) values ${memberValues};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values ${admissionValues};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game) values ${profileValues};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state,published_revision_id) values ${headValues};
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values ${revisionValues};
update public.app_supply_table_heads h set published_revision_id=r.revision_id
  from public.app_supply_table_revisions r where h.table_id=r.table_id and r.revision=1;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values ${requestValues};
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,created_at,updated_at,submitted_at,approved_at) values ${proposalValues};
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision) values ${proposalMemberValues};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values ${invitationValues};
insert into public.app_table_invitation_outbox(outbox_id,invitation_id,operation_id,state,attempt_count,error_code,queued_at,next_attempt_at,lease_until,attempted_at,accepted_at,delivered_at,message_kind,manual_retry_requested) values ${outboxValues};
insert into public.app_table_invitation_attempts(attempt_id,outbox_id,operation_id,attempt_number,state,provider_message_id,error_code,started_at,finished_at) values ${failedAttempt};
set local request.jwt.claims='{"role":"service_role"}';
do $w06_table_invitation_delivery$
declare d jsonb; other_d jsonb; admin_list jsonb; ctx jsonb; unknown_ctx jsonb; begun jsonb; replay jsonb; finished jsonb; delivered jsonb; delivered_replay jsonb;
  accepted_attempt_id uuid; unknown_attempt_id uuid;
  retry jsonb; retry_replay jsonb; error_message text; outbox_state text; num_attempts integer;
begin
  -- A member sees only their own offer details and safe Table data.
  d:=public.read_member_table_invitation('${members[0]}','${invitations[0]}');
  if d->>'invitationId'<>'${invitations[0]}' or d->>'state'<>'active' or d->'delivery'->>'state'<>'queued'
    or d->'table'->>'seatPriceCents'<>'2500' or d->'table'->>'currency'<>'USD'
    or jsonb_array_length(d->'table'->'stops')<>3 or d->'table'->'stops'->0 ? 'venueId'
    or d->'table' ? 'hostNotes' or d ? 'recipientEmail' then raise exception 'member detail wrong or leaked private fields'; end if;
  begin perform public.read_member_table_invitation('${members[1]}','${invitations[0]}'); raise exception 'cross-member detail was allowed';
  exception when sqlstate 'P0002' then get stacked diagnostics error_message=message_text; if error_message<>'not_found' then raise; end if; end;

  -- Service grants and table RLS are checked separately; forged caller IDs do not bypass helper checks.
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin perform public.read_member_table_invitation('${members[0]}','${invitations[0]}'); raise exception 'authenticated role called service-only function';
  exception when insufficient_privilege then get stacked diagnostics error_message=message_text; if error_message<>'service_role_required' then raise; end if; end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin perform public.retry_failed_table_invitation_delivery('${members[1]}','${invitations[1]}',jsonb_build_object('operationId','${adminOperations[0]}','expectedAttemptCount',1));
    raise exception 'member retried admin delivery';
  exception when insufficient_privilege then get stacked diagnostics error_message=message_text; if error_message<>'forbidden' then raise; end if; end;
  begin perform public.retry_failed_table_invitation_delivery('${host}','${invitations[1]}',jsonb_build_object('operationId','${adminOperations[0]}','expectedAttemptCount',1));
    raise exception 'host retried admin delivery';
  exception when insufficient_privilege then get stacked diagnostics error_message=message_text; if error_message<>'forbidden' then raise; end if; end;

  -- Admin DTO may include approved display names and safe status, never recipient/provider identifiers.
  admin_list:=public.list_admin_table_invitations('${admin}',null,50);
  if jsonb_array_length(admin_list->'items')<>3 or admin_list->'items'->0 ? 'email'
    or admin_list->'items'->0->'delivery' ? 'providerMessageId'
    or admin_list->'items'->0->'attempts'->0 ? 'providerMessageId'
    or admin_list::text like '%${emails[0]}%' or admin_list::text like '%PRIVATE_HOST_NOTE%'
    or admin_list::text like '%synthetic-provider-accepted%' then raise exception 'admin DTO missing rows or exposed private delivery fields'; end if;
  if not exists(select 1 from jsonb_array_elements(admin_list->'items') i(value)
      where i.value->>'invitationId'='${invitations[1]}' and i.value->'delivery'->>'safeErrorCode'='synthetic_rejected') then
    raise exception 'admin safe failure code missing'; end if;

  -- Worker context comes from the linked active invitation/profile/admission/Auth identity only.
  ctx:=public.read_table_invitation_delivery_context('${invitations[0]}');
  if ctx->>'invitationId'<>'${invitations[0]}' or ctx->>'recipientEmail'<>'${emails[0]}'
    or ctx->'table'->>'title'<>'W06.5 Dinner 1' or ctx ? 'authUserId' then raise exception 'trusted delivery context mismatch'; end if;
  unknown_ctx:=public.read_table_invitation_delivery_context('${invitations[2]}');
  if unknown_ctx->>'recipientEmail'<>'${emails[2]}' then raise exception 'third invitation trusted context mismatch'; end if;

  -- Queue claim is operation-idempotent; provider is not contacted by these database RPC calls.
  begun:=public.begin_table_invitation_delivery_attempt('${outboxes[0]}','${attemptOperations[0]}');
  replay:=public.begin_table_invitation_delivery_attempt('${outboxes[0]}','${attemptOperations[0]}');
  if begun->>'created'<>'true' or replay->>'created'<>'false' or begun->'attempt'->>'attempt_id'<>replay->'attempt'->>'attempt_id'
    or begun->'outbox'->>'state'<>'sending' then raise exception 'begin attempt/replay failed'; end if;
  accepted_attempt_id:=(begun->'attempt'->>'attempt_id')::uuid;
  if accepted_attempt_id is null then raise exception 'begin did not return generated attempt ID'; end if;
  if (select attempt_count from public.app_table_invitation_outbox where outbox_id='${outboxes[0]}')<>1
    or (select count(*) from public.app_table_invitation_attempts where outbox_id='${outboxes[0]}')<>1 then raise exception 'begin replay duplicated attempt'; end if;
  finished:=public.finish_table_invitation_delivery_attempt(accepted_attempt_id,'accepted','synthetic-provider-accepted',null);
  if finished->'outbox'->>'state'<>'accepted' or finished->'attempt'->>'state'<>'accepted' then raise exception 'finish accepted did not persist'; end if;
  delivered:=public.mark_table_invitation_delivery_delivered(accepted_attempt_id,'synthetic-provider-accepted');
  delivered_replay:=public.mark_table_invitation_delivery_delivered(accepted_attempt_id,'synthetic-provider-accepted');
  if delivered->'outbox'->>'state'<>'delivered' or delivered->'attempt'->>'state'<>'delivered'
    or delivered_replay->>'changed'<>'false' then raise exception 'matching accepted-to-delivered transition/replay failed'; end if;
  begin perform public.mark_table_invitation_delivery_delivered(accepted_attempt_id,'different-provider-id'); raise exception 'delivered with wrong provider ID';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'attempt_not_accepted' then raise; end if; end;

  -- Unknown outcomes remain unknown, block both another attempt and admin retry, and the read-only check changes nothing.
  begun:=public.begin_table_invitation_delivery_attempt('${outboxes[2]}','${attemptOperations[2]}');
  unknown_attempt_id:=(begun->'attempt'->>'attempt_id')::uuid;
  if begun->>'created'<>'true' or unknown_attempt_id is null then raise exception 'unknown begin did not return generated attempt ID'; end if;
  finished:=public.finish_table_invitation_delivery_attempt(unknown_attempt_id,'unknown',null,'synthetic_timeout');
  unknown_ctx:=public.read_unknown_table_invitation_delivery_context('${invitations[2]}',1);
  if unknown_ctx->>'attemptId'<>unknown_attempt_id::text or unknown_ctx->'providerMessageId'<>'null'::jsonb
    or unknown_ctx->>'recipientEmail'<>'${emails[2]}' then raise exception 'unknown reconciliation context failed'; end if;
  begin perform public.begin_table_invitation_delivery_attempt('${outboxes[2]}','${attemptOperations[3]}'); raise exception 'unknown attempt was resent';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'attempt_reconciliation_required' then raise; end if; end;
  begin perform public.retry_failed_table_invitation_delivery('${admin}','${invitations[2]}',jsonb_build_object('operationId','${adminOperations[2]}','expectedAttemptCount',1));
    raise exception 'admin retried unknown outcome';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'attempt_reconciliation_required' then raise; end if; end;
  select o.state,o.attempt_count into outbox_state,num_attempts from public.app_table_invitation_outbox o where o.outbox_id='${outboxes[2]}';
  if outbox_state<>'unknown' or num_attempts<>1 or (select count(*) from public.app_table_invitation_attempts where outbox_id='${outboxes[2]}')<>1 then
    raise exception 'inconclusive reconciliation changed state or created a resend'; end if;

  -- A known failed attempt can be queued once; exact replay returns the saved result, changed body/actor conflicts.
  retry:=public.retry_failed_table_invitation_delivery('${admin}','${invitations[1]}',jsonb_build_object('operationId','${adminOperations[0]}','expectedAttemptCount',1));
  retry_replay:=public.retry_failed_table_invitation_delivery('${admin}','${invitations[1]}',jsonb_build_object('operationId','${adminOperations[0]}','expectedAttemptCount',1));
  if retry<>retry_replay or retry->>'deliveryState'<>'queued' or retry->>'attemptCount'<>'1' then raise exception 'failed retry exact replay failed'; end if;
  begin perform public.retry_failed_table_invitation_delivery('${admin}','${invitations[1]}',jsonb_build_object('operationId','${adminOperations[0]}','expectedAttemptCount',2));
    raise exception 'retry operation key accepted changed body';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'operation_conflict' then raise; end if; end;
  begin perform public.retry_failed_table_invitation_delivery('${secondAdmin}','${invitations[1]}',jsonb_build_object('operationId','${adminOperations[0]}','expectedAttemptCount',1));
    raise exception 'retry operation key accepted changed actor';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'operation_conflict' then raise; end if; end;
  if (select state from public.app_table_invitation_outbox where outbox_id='${outboxes[1]}')<>'queued'
    or (select count(*) from public.app_table_invitation_operations where operation_id='${adminOperations[0]}')<>1
    or (select count(*) from public.app_audit_events where operation_id='${adminOperations[0]}' and action='app.invitation.retry_requested')<>1 then
    raise exception 'failed retry duplicated operation/audit or did not queue'; end if;
  if (select count(*) from public.app_table_invitations where invitation_id in (${sqlList(invitations)}))<>3 then raise exception 'delivery action mutated invitations'; end if;
end
$w06_table_invitation_delivery$;
rollback;`;
  const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(`table-invitation-delivery-db-test: guarded fifthwheel-rewrite-test; migration ${migration}; owner-only detail/cross-member 404, safe admin DTO, role gates/RLS, trusted context, begin/finish replay, unknown retry/re-send denial, accepted-to-delivered ID binding, failed retry idempotency/conflict, invitation immutability and rollback passed; no provider contacted`);
} finally {
  try { unlinkSync(lockPath); } catch { /* already removed */ }
}
