#!/usr/bin/env node

// W06.3-W06.4 rollback-only acceptance against the isolated rewrite test stack.
// This script never resets/migrates the stack and never calls external providers.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migration = "20261113055016";
const fixtureId = (number) => `a0060000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const admin = fixtureId(1); const host = fixtureId(2); const unassignedHost = fixtureId(3);
const members = Array.from({ length: 7 }, (_, index) => fixtureId(10 + index));
const signups = Array.from({ length: 7 }, (_, index) => fixtureId(20 + index));
const admissions = Array.from({ length: 7 }, (_, index) => fixtureId(30 + index));
const guests = Array.from({ length: 7 }, (_, index) => fixtureId(40 + index));
const tables = [fixtureId(50), fixtureId(51), fixtureId(52)];
const revisions = [fixtureId(60), fixtureId(61), fixtureId(62), fixtureId(63)];
const requests = Array.from({ length: 21 }, (_, index) => fixtureId(70 + index));
const operations = Array.from({ length: 16 }, (_, index) => fixtureId(110 + index));
const adminEmail = `w06-roster-${admin.slice(-4)}@example.test`;
const hostEmail = `w06-roster-${host.slice(-4)}@example.test`;
const unassignedHostEmail = `w06-roster-${unassignedHost.slice(-4)}@example.test`;
const memberEmails = members.map((id) => `w06-roster-${id.slice(-4)}@example.test`);
const emails = [adminEmail, hostEmail, unassignedHostEmail, ...memberEmails];
const lockPath = join(workdir, ".roster-curation-db-test.lock");

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
  const localStatus = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(localStatus.status, 0, localStatus.stderr || localStatus.stdout);
  const status = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf("{"), status.stdout.lastIndexOf("}") + 1));
  assert.equal(parsed.API_URL, api); assert.equal(parsed.DB_URL, db);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr || history.stdout);
  assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                |")),
    `migration ${migration} must be applied after coordinator review; this harness does not apply migrations`);
}

assertTarget();
try { writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
catch { throw new Error("another roster DB harness is running or left a lock file; inspect the isolated test workdir before retrying"); }

try {
  const authIds = [admin, host, unassignedHost, ...members];
  const allIds = [...authIds, ...signups, ...admissions, ...guests, ...tables, ...revisions, ...requests, ...operations];
  const sqlList = (values) => values.map((id) => `'${id}'`).join(",");
  const collision = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `
    select concat(
      (not exists(select 1 from auth.users where id in (${sqlList(authIds)})))::text,'|',
      (not exists(select 1 from public.waitlist_signups where id in (${sqlList(signups)}) or email_normalized in (${emails.map((email) => `'${email}'`).join(",")})))::text,'|',
      (not exists(select 1 from public.app_admissions where id in (${sqlList(admissions)}) or auth_user_id in (${sqlList(authIds)})))::text,'|',
      (not exists(select 1 from public.app_member_profiles where guest_id in (${sqlList(guests)}) or auth_user_id in (${sqlList(authIds)})))::text,'|',
      (not exists(select 1 from public.app_user_roles where user_id in (${sqlList(authIds)})))::text,'|',
      (not exists(select 1 from public.app_supply_table_heads where table_id in (${sqlList(tables)})))::text,'|',
      (not exists(select 1 from public.app_supply_table_revisions where revision_id in (${sqlList(revisions)}) or table_id in (${sqlList(tables)})))::text,'|',
      (not exists(select 1 from public.app_supply_table_assignments where table_id in (${sqlList(tables)}) or user_id in (${sqlList(authIds)})))::text,'|',
      (not exists(select 1 from public.app_table_requests where request_id in (${sqlList(requests)}) or table_id in (${sqlList(tables)}) or guest_id in (${sqlList(guests)}) or auth_user_id in (${sqlList(authIds)})))::text,'|',
      (not exists(select 1 from public.app_table_roster_proposals where proposal_id in (${sqlList(allIds)}) or table_id in (${sqlList(tables)})))::text,'|',
      (not exists(select 1 from public.app_table_roster_proposal_members where proposal_id in (${sqlList(allIds)}) or request_id in (${sqlList(requests)}) or guest_id in (${sqlList(guests)})))::text,'|',
      (not exists(select 1 from public.app_table_invitations where invitation_id in (${sqlList(allIds)}) or table_id in (${sqlList(tables)}) or guest_id in (${sqlList(guests)}) or auth_user_id in (${sqlList(authIds)}) or source_request_id in (${sqlList(requests)})))::text,'|',
      (not exists(select 1 from public.app_table_invitation_outbox where outbox_id in (${sqlList(allIds)}) or invitation_id in (${sqlList(allIds)}) or operation_id in (${sqlList(operations)})))::text,'|',
      (not exists(select 1 from public.app_table_roster_operations where operation_id in (${sqlList(operations)})))::text,'|',
      (not exists(select 1 from public.app_audit_events where operation_id in (${sqlList(operations)}) or subject_id in (${sqlList(tables)},${sqlList(requests)},${sqlList(guests)})))::text)`]);
  assert.equal(collision.status, 0, collision.stderr);
  assert.equal(collision.stdout.trim(), "true|true|true|true|true|true|true|true|true|true|true|true|true|true|true", "refusing synthetic fixture collisions across all owned relations");

  const hidden = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
    has_function_privilege('anon','public.list_curation_assigned_tables(uuid,text,integer)','EXECUTE')::text,'|',
    has_function_privilege('authenticated','public.save_table_roster_proposal(uuid,uuid,jsonb)','EXECUTE')::text,'|',
    has_function_privilege('service_role','public.approve_table_roster(uuid,uuid,jsonb)','EXECUTE')::text,'|',
    (select bool_and(not has_table_privilege(r.role_name,t.table_name,p.privilege))::text
      from (values ('anon'),('authenticated'),('service_role')) r(role_name)
      cross join (values ('public.app_table_roster_proposals'),('public.app_table_roster_proposal_members'),
        ('public.app_table_invitations'),('public.app_table_invitation_outbox'),('public.app_table_roster_operations')) t(table_name)
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege)))`]);
  assert.equal(hidden.status, 0, hidden.stderr);
  assert.equal(hidden.stdout.trim(), "false|false|true|true", "roster relations must remain private and RPCs service-only");

  const preferenceSets = [["man", "non_binary"], ["woman", "non_binary"], ["woman", "man"],
    ["woman"], ["man"], ["non_binary"], ["woman", "man", "non_binary"]];
  const marketingPreference = { woman: "Women", man: "Men", non_binary: "Non-binary people" };
  const identities = ["woman", "man", "non_binary", "woman", "man", "non_binary", "woman"];
  const birthdates = ["1997-01-01", "1994-01-01", "1992-01-01", "1991-01-01", "1990-01-01", "1984-01-01", "1993-01-01"];
  const waitlistValues = [admin, host, ...members].map((userId, index) => {
    const signupId = index < 2 ? null : signups[index - 2];
    if (!signupId) return null;
    const email = memberEmails[index - 2];
    const identity = identities[index - 2] === "woman" ? "Woman" : identities[index - 2] === "man" ? "Man" : "Non-binary";
    const open = preferenceSets[index - 2].map((value) => marketingPreference[value]); const dob = birthdates[index - 2];
    return `('${signupId}','${email}','Guest${index}','Roster','${dob}','${identity}',array[${open.map((v) => `'${v}'`).join(",")}],21,120,'Inman Park',array[]::text[],'','Open','Yes, surprise me'),`;
  }).filter(Boolean).join("\n").replace(/,\s*$/, "");
  const authValues = authIds.map((id, index) => `('${id}','authenticated','authenticated','${emails[index]}',now(),'','{}','{}',now(),now())`).join(",\n");
  const roleValues = `('${admin}','admin'),('${host}','host'),('${unassignedHost}','host')`;
  const admissionValues = members.map((userId, index) => `('${admissions[index]}','${signups[index]}','${memberEmails[index]}','activated','${admin}','${userId}',now())`).join(",\n");
  const profileValues = members.map((userId, index) => {
    const open = preferenceSets[index];
    const ageMin = index === 3 ? 40 : 21; const ageMax = index === 3 ? 50 : 120;
    return `('${guests[index]}','${userId}','${admissions[index]}','approved',1,1,'Guest${index + 1}','Roster','${birthdates[index]}','${identities[index]}',array[${open.map((v) => `'${v}'`).join(",")}],${ageMin},${ageMax},'Inman Park',array[]::text[],'Open','Yes, surprise me')`;
  }).join(",\n");
  const tableValues = tables.map((id) => `('${id}','published','current')`).join(",\n");
  const revisionValues = tables.map((tableId, index) => `('${revisions[index]}','${tableId}',1,'published',jsonb_build_object('title','Roster Test ${index + 1}','localDate','2027-12-10','startLocalTime','19:00','neighborhood','Inman Park','hostNotes','SECRET_HOST_NOTE','stops',jsonb_build_array()),'${admin}')`).concat(
    [`('${revisions[3]}','${tables[2]}',2,'published',jsonb_build_object('title','Roster Test C revised','localDate','2027-12-11','startLocalTime','19:00','neighborhood','Inman Park','stops',jsonb_build_array()),'${admin}')`]).join(",\n");
  const requestValues = requests.map((requestId, index) => {
    const tableIndex = Math.floor(index / 7); const memberIndex = index % 7;
    return `('${requestId}','${tables[tableIndex]}','${guests[memberIndex]}','${members[memberIndex]}','Roster Test ${tableIndex + 1}','2027-12-10','19:00','Inman Park','pending')`;
  }).join(",\n");

  const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values ${authValues};
insert into public.app_user_roles(user_id,role) values ${roleValues};
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game) values ${waitlistValues};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values ${admissionValues};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game) values ${profileValues};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values ${tableValues};
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values ${revisionValues};
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id and r.revision=1;
insert into public.app_supply_table_assignments(table_id,user_id,assigned_by) select t, '${host}'::uuid, '${admin}'::uuid from unnest(array['${tables.join("','")}']::uuid[]) t;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values ${requestValues};
set local request.jwt.claims='{"role":"service_role"}';
do $w06_roster$
declare detail jsonb; page_one jsonb; page_two jsonb; page_three jsonb; save_one jsonb; replay_one jsonb; invalid_pair jsonb; invalid_span jsonb; invalid_open jsonb; submitted jsonb; approved jsonb; approval_replay jsonb;
  selected jsonb; error_message text; stale_profile_save jsonb; stale_supply_save jsonb; member_item jsonb;
begin
  -- RLS/service authorization and resource assignments are checked via direct RPC calls, not only UI behavior.
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin perform public.read_table_roster_context('${admin}','${tables[0]}',null,10); raise exception 'authenticated caller reached service-only RPC';
  exception when insufficient_privilege then get stacked diagnostics error_message=message_text;
    if error_message<>'service_role_required' then raise; end if; end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin perform public.read_table_roster_context('${unassignedHost}','${tables[0]}',null,10); raise exception 'unassigned host read another Table';
  exception when insufficient_privilege then get stacked diagnostics error_message=message_text;
    if error_message<>'not_assigned' then raise; end if; end;

  detail:=public.read_table_roster_context('${admin}','${tables[0]}',null,50);
  if jsonb_array_length(detail->'applicants'->'items')<>7 then raise exception 'candidate matrix count wrong'; end if;
  for member_item in select value from jsonb_array_elements(detail->'applicants'->'items') loop
    if (member_item->>'eligible')<>'true' or member_item ? 'dateOfBirth' or member_item ? 'identity' or member_item ? 'openTo'
      or member_item ? 'phone' then raise exception 'candidate is ineligible or safe DTO leaked profile fields'; end if;
  end loop;
  if (detail->'table'->>'hostNotes') is not null then raise exception 'Table detail leaked host notes'; end if;
  page_one:=public.read_table_roster_context('${admin}','${tables[0]}',null,3);
  if jsonb_array_length(page_one->'applicants'->'items')<>3 or page_one->'applicants'->>'nextCursor' is null then raise exception 'candidate cursor first page failed'; end if;
  page_two:=public.read_table_roster_context('${admin}','${tables[0]}',page_one->'applicants'->>'nextCursor',3);
  page_three:=public.read_table_roster_context('${admin}','${tables[0]}',page_two->'applicants'->>'nextCursor',3);
  if jsonb_array_length(page_two->'applicants'->'items')<>3 or jsonb_array_length(page_three->'applicants'->'items')<>1
    or page_three->'applicants'->>'nextCursor' is not null
    or page_one->'applicants'->'items'->0->>'requestId'=page_two->'applicants'->'items'->0->>'requestId'
    or page_two->'applicants'->'items'->0->>'requestId'=page_three->'applicants'->'items'->0->>'requestId' then
    raise exception 'candidate cursor continuation/uniqueness failed'; end if;

  save_one:=public.save_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[0]}','expectedProposalRevision',null,
    'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[0]}','${requests[1]}','${requests[2]}')));
  replay_one:=public.save_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[0]}','expectedProposalRevision',null,
    'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[2]}','${requests[0]}','${requests[1]}')));
  if save_one<>replay_one then raise exception 'canonical selection replay changed result'; end if;
  begin perform public.save_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[0]}','expectedProposalRevision',null,
      'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[0]}','${requests[1]}','${requests[3]}')));
    raise exception 'operation ID with a changed body was accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'operation_conflict' then raise; end if; end;
  begin perform public.save_table_roster_proposal('${admin}','${tables[0]}',jsonb_build_object('operationId','${operations[0]}','expectedProposalRevision',null,
      'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[0]}','${requests[1]}','${requests[2]}')));
    raise exception 'operation ID replay by a different actor was accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'operation_conflict' then raise; end if; end;
  if save_one->'validation'->>'valid'<>'true' then raise exception 'valid mutual roster rejected'; end if;

  invalid_pair:=public.save_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[1]}','expectedProposalRevision',1,
    'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[0]}','${requests[1]}','${requests[3]}')));
  if invalid_pair->'validation'->>'valid'<>'false' or not (invalid_pair->'validation'->'issues' @> '[{"code":"pair_age_mismatch"}]'::jsonb) then raise exception 'pairwise age matrix failed'; end if;
  begin perform public.submit_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[2]}','expectedProposalRevision',2));
    raise exception 'invalid pair proposal submitted';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'validation_failed' then raise; end if; end;

  invalid_span:=public.save_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[3]}','expectedProposalRevision',2,
    'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[0]}','${requests[1]}','${requests[5]}')));
  if invalid_span->'validation'->>'valid'<>'false' or not (invalid_span->'validation'->'issues' @> '[{"code":"age_span_exceeded"}]'::jsonb) then raise exception '12/13-year age span matrix failed'; end if;
  invalid_open:=public.save_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[4]}','expectedProposalRevision',3,
    'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[0]}','${requests[1]}','${requests[4]}')));
  if invalid_open->'validation'->>'valid'<>'false' or not (invalid_open->'validation'->'issues' @> '[{"code":"missing_mutual_open_connection"}]'::jsonb) then raise exception 'mutual-open graph matrix failed'; end if;

  -- Replace invalid drafts with a valid one; submission/approval is atomic and replay-safe.
  submitted:=public.save_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[5]}','expectedProposalRevision',4,
    'supplyRevisionId','${revisions[0]}','selectedRequestIds',jsonb_build_array('${requests[0]}','${requests[1]}','${requests[2]}')));
  if submitted->'validation'->>'valid'<>'true' then raise exception 'valid replacement proposal rejected'; end if;
  submitted:=public.submit_table_roster_proposal('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[6]}','expectedProposalRevision',5));
  begin perform public.approve_table_roster('${host}','${tables[0]}',jsonb_build_object('operationId','${operations[14]}','expectedProposalRevision',5));
    raise exception 'assigned host approved a roster';
  exception when insufficient_privilege then get stacked diagnostics error_message=message_text; if error_message<>'forbidden' then raise; end if; end;
  if exists(select 1 from public.app_table_roster_operations where operation_id='${operations[14]}')
    or exists(select 1 from public.app_audit_events where operation_id='${operations[14]}') then raise exception 'denied host approval wrote operation or audit'; end if;
  approved:=public.approve_table_roster('${admin}','${tables[0]}',jsonb_build_object('operationId','${operations[7]}','expectedProposalRevision',5));
  approval_replay:=public.approve_table_roster('${admin}','${tables[0]}',jsonb_build_object('operationId','${operations[7]}','expectedProposalRevision',5));
  if approved<>approval_replay or jsonb_array_length(approved->'invitations')<>3 then raise exception 'approval replay/invitation result mismatch'; end if;
  if (select count(*) from public.app_table_invitations where table_id='${tables[0]}' and state='active')<>3
    or (select count(*) from public.app_table_invitation_outbox o join public.app_table_invitations i using(invitation_id) where i.table_id='${tables[0]}')<>3
    or (select protected_by_activity from public.app_supply_table_heads where table_id='${tables[0]}') is not true then raise exception 'approval not atomic or activity latch missing'; end if;
  detail:=public.read_table_roster_context('${admin}','${tables[0]}',null,50);
  if detail->'currentProposal'->'validation'->>'valid'<>'true' or jsonb_array_length(detail->'currentProposal'->'selectedGuests')<>3 then
    raise exception 'approved proposal invalidated by its own invitations or history names missing'; end if;
  if (detail->'currentProposal'->'selectedGuests'->0) ? 'dateOfBirth' then raise exception 'selected guest DTO leaked private profile data'; end if;

  -- An unrelated profile edit after submission yields no partial offer/outbox rows.
  stale_profile_save:=public.save_table_roster_proposal('${host}','${tables[1]}',jsonb_build_object('operationId','${operations[8]}','expectedProposalRevision',null,
    'supplyRevisionId','${revisions[1]}','selectedRequestIds',jsonb_build_array('${requests[7]}','${requests[8]}','${requests[9]}')));
  perform public.submit_table_roster_proposal('${host}','${tables[1]}',jsonb_build_object('operationId','${operations[9]}','expectedProposalRevision',1));
  update public.app_member_profiles set profile_revision=profile_revision+1 where guest_id='${guests[0]}';
  begin perform public.approve_table_roster('${admin}','${tables[1]}',jsonb_build_object('operationId','${operations[10]}','expectedProposalRevision',1));
    raise exception 'stale profile approval succeeded';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'validation_failed' then raise; end if; end;
  if exists(select 1 from public.app_table_invitations where table_id='${tables[1]}') or exists(select 1 from public.app_table_invitation_outbox o join public.app_table_invitations i using(invitation_id) where i.table_id='${tables[1]}') then
    raise exception 'stale profile left partial invitation/outbox rows'; end if;
  if exists(select 1 from public.app_table_roster_operations where operation_id='${operations[10]}')
    or exists(select 1 from public.app_audit_events where operation_id='${operations[10]}') then raise exception 'failed stale-profile approval wrote operation or audit'; end if;

  -- A changed publication pointer blocks approval and leaves no partial writes.
  stale_supply_save:=public.save_table_roster_proposal('${host}','${tables[2]}',jsonb_build_object('operationId','${operations[11]}','expectedProposalRevision',null,
    'supplyRevisionId','${revisions[2]}','selectedRequestIds',jsonb_build_array('${requests[14]}','${requests[15]}','${requests[16]}')));
  perform public.submit_table_roster_proposal('${host}','${tables[2]}',jsonb_build_object('operationId','${operations[12]}','expectedProposalRevision',1));
  update public.app_supply_table_heads set published_revision_id='${revisions[3]}' where table_id='${tables[2]}';
  begin perform public.approve_table_roster('${admin}','${tables[2]}',jsonb_build_object('operationId','${operations[13]}','expectedProposalRevision',1));
    raise exception 'stale supply approval succeeded';
  exception when sqlstate 'P0001' then get stacked diagnostics error_message=message_text; if error_message<>'stale_table' then raise; end if; end;
  if exists(select 1 from public.app_table_invitations where table_id='${tables[2]}') or exists(select 1 from public.app_table_invitation_outbox o join public.app_table_invitations i using(invitation_id) where i.table_id='${tables[2]}') then
    raise exception 'stale supply left partial invitation/outbox rows'; end if;
  if exists(select 1 from public.app_table_roster_operations where operation_id='${operations[13]}')
    or exists(select 1 from public.app_audit_events where operation_id='${operations[13]}') then raise exception 'failed stale-supply approval wrote operation or audit'; end if;
end
$w06_roster$;
rollback;`;
  const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  console.log(`roster-curation-db-test: guarded fifthwheel-rewrite-test; migration ${migration}; direct service/host/admin authorization, exact seven preference sets, cursor pagination, pairwise age/mutual-open/span rules, canonical replay and operation conflicts, invalid-submit atomicity, approval/outbox/latch idempotency, post-approval validation, stale-profile/supply rejection, no failed-operation/audit writes, DTO privacy and rollback passed; concurrency races remain unverified by this single-session harness`);
} finally {
  try { unlinkSync(lockPath); } catch { /* already removed */ }
}
