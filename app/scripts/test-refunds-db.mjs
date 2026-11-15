#!/usr/bin/env node

// W07.5 rollback-only DB acceptance. Do not run until coordinator review and
// explicit local authorization. Never resets, seeds, migrates, or contacts Stripe.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migrations = ["20261113181544", "20261113195200", "20261113204815"];
const runLock = join(workdir, ".refunds-db-test.lock");
const id = (n) => `e0750000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), members = [id(2), id(3), id(4)];
const signups = [id(11), id(12), id(13)], admissions = [id(21), id(22), id(23)], guests = [id(31), id(32), id(33)];
const tables = [id(41), id(42), id(43)], revisions = [id(51), id(52), id(53)], requests = [id(61), id(62), id(63)];
const proposals = [id(71), id(72), id(73)], invitations = [id(81), id(82), id(83)], attempts = [id(91), id(92), id(93)];
const payments = [id(101), id(102), id(103)], obligations = [id(111), id(112), id(113)], operations = [id(121), id(122), id(123)];
const emails = members.map((_, i) => `w075-refund-${i + 1}@refunds.example`), adminEmail = "w075-refund-admin@refunds.example";
const allIds = [admin, ...members, ...signups, ...admissions, ...guests, ...tables, ...revisions, ...requests, ...proposals,
  ...invitations, ...attempts, ...payments, ...obligations, ...operations];
const quote = (x) => `'${String(x).replaceAll("'", "''")}'`;
const list = (xs) => xs.map(quote).join(",");
function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, input, encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } });
  if (result.error) throw result.error;
  return result;
}
function psql(sql) {
  const result = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
function assertTarget() {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m, "wrong local project");
  assert.match(config, /^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m, "wrong API port");
  assert.match(config, /^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m, "wrong database port");
  assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "linked/hosted target forbidden");
  for (const [name, expected] of [["SUPABASE_URL", api], ["SUPABASE_DB_URL", db], ["DATABASE_URL", db]]) {
    if (process.env[name]) assert.equal(process.env[name], expected, `mismatched ${name}`);
  }
  assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "hosted project ref forbidden");
  const local = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(local.status, 0, local.stderr || local.stdout);
  const status = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf("{"), status.stdout.lastIndexOf("}") + 1));
  assert.equal(parsed.API_URL, api); assert.equal(parsed.DB_URL, db);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr || history.stdout);
  for (const version of migrations) assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(version) && !line.includes("|                ")),
    `required prior migration ${version} must be coordinator-applied; this script never applies migrations`);
}
function collisionCheck() {
  const emailsAll = [adminEmail, ...emails];
  const output = psql(`select concat(
    (not exists(select 1 from auth.users where id in (${list(allIds)}) or email in (${list(emailsAll)})))::text,'|',
    (not exists(select 1 from public.waitlist_signups where id in (${list(signups)}) or email_normalized in (${list(emails)})))::text,'|',
    (not exists(select 1 from public.app_admissions where id in (${list(admissions)}) or auth_user_id in (${list(members)})))::text,'|',
    (not exists(select 1 from public.app_member_profiles where guest_id in (${list(guests)}) or auth_user_id in (${list(members)})))::text,'|',
    (not exists(select 1 from public.app_user_roles where user_id=${quote(admin)}))::text,'|',
    (not exists(select 1 from public.app_supply_table_heads where table_id in (${list(tables)})))::text,'|',
    (not exists(select 1 from public.app_supply_table_revisions where revision_id in (${list(revisions)})))::text,'|',
    (not exists(select 1 from public.app_table_requests where request_id in (${list(requests)})))::text,'|',
    (not exists(select 1 from public.app_table_roster_proposals where proposal_id in (${list(proposals)})))::text,'|',
    (not exists(select 1 from public.app_table_invitations where invitation_id in (${list(invitations)})))::text,'|',
    (not exists(select 1 from public.app_checkout_attempts where attempt_id in (${list(attempts)}) or provider_session_id like 'cs_test_w075%'))::text,'|',
    (not exists(select 1 from public.app_payments where payment_id in (${list(payments)})))::text,'|',
    (not exists(select 1 from public.app_refund_obligations where obligation_id in (${list(obligations)})))::text,'|',
    (not exists(select 1 from public.app_refund_operations where operation_id in (${list(operations)})))::text,'|',
    (not exists(select 1 from public.app_refund_action_operations where request_id in (${list(operations)})))::text,'|',
    (not exists(select 1 from public.app_refund_work_items where operation_id in (${list(operations)})))::text,'|',
    (not exists(select 1 from public.app_audit_events where operation_id in (${list(operations)}) or subject_id in (${list(allIds)})))::text)`);
  assert.equal(output, Array(17).fill("true").join("|"), "refusing synthetic fixture collision");
}

const setupAndVerify = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (${quote(admin)},'authenticated','authenticated',${quote(adminEmail)},now(),'','{}','{}',now(),now()),
  ${members.map((user, i) => `(${quote(user)},'authenticated','authenticated',${quote(emails[i])},now(),'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values (${quote(admin)},'admin');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((_, i) => `(${quote(signups[i])},${quote(emails[i])},'Refund','Guest ${i + 1}','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  ${members.map((user, i) => `(${quote(admissions[i])},${quote(signups[i])},${quote(emails[i])},'activated',${quote(admin)},${quote(user)},now())`).join(",\n  ")};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((user, i) => `(${quote(guests[i])},${quote(user)},${quote(admissions[i])},'approved',1,1,'Refund','Guest ${i + 1}','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values ${tables.map((table) => `(${quote(table)},'published','current')`).join(",")};
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  ${tables.map((table, i) => `(${quote(revisions[i])},${quote(table)},1,'published',jsonb_build_object('title','W07.5 Table ${i + 1}','localDate',to_char(current_date+60,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park','stops',jsonb_build_array('{}','{}','{}')),${quote(admin)})`).join(",\n  ")};
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values
  ${tables.map((table, i) => `(${quote(requests[i])},${quote(table)},${quote(guests[i])},${quote(members[i])},'W07.5 Table ${i + 1}',current_date+60,'19:00','Inman Park','pending')`).join(",\n  ")};
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
  ${tables.map((table, i) => `(${quote(proposals[i])},${quote(table)},1,'approved',${quote(revisions[i])},'{}'::jsonb,${quote(admin)},${quote(admin)},${quote(admin)},${quote(admin)},now(),now())`).join(",\n  ")};
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version) values
  ${tables.map((_, i) => `(${quote(proposals[i])},${quote(requests[i])},${quote(guests[i])},1,1,1)`).join(",\n  ")};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  ${tables.map((table, i) => `(${quote(invitations[i])},${quote(table)},${quote(guests[i])},${quote(members[i])},${quote(requests[i])},${quote(proposals[i])},${quote(admin)},'active')`).join(",\n  ")};
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  ${tables.map((table, i) => `(${quote(attempts[i])},${quote(invitations[i])},${quote(table)},${quote(guests[i])},${quote(members[i])},1,1,${quote(revisions[i])},'consumed',now()-interval '1 hour',now()-interval '58 minutes','test','w075-key-${i + 1}','cs_test_w075session${i + 1}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  ${tables.map((_, i) => `(${quote(payments[i])},${quote(attempts[i])},'test','pi_w075_${i + 1}',2500,'USD','verified_paid',now()-interval '1 hour')`).join(",\n  ")};
set local request.jwt.claims='{"role":"service_role"}';
insert into public.app_refund_obligations(obligation_id,payment_id,source,amount_cents,currency,state) values
  ${payments.map((payment, i) => `(${quote(obligations[i])},${quote(payment)},'late_checkout_ineligible',1250,'USD','open')`).join(",\n  ")};
set local request.jwt.claims='{"role":"service_role"}';
do $w075$ declare v jsonb; v_msg text; v_jobs jsonb; j jsonb; v_detail jsonb; begin
  if public.queue_refund_dispatch('${admin}','${obligations[0]}','${operations[0]}',true)->'operation'->>'operationId'<>'${operations[0]}' then raise exception 'dispatch did not persist operation ID'; end if;
  perform public.queue_refund_dispatch('${admin}','${obligations[0]}','${operations[0]}',true);
  perform public.queue_refund_dispatch('${admin}','${obligations[1]}','${operations[1]}',true);
  perform public.queue_refund_dispatch('${admin}','${obligations[2]}','${operations[2]}',true);
  begin perform public.queue_refund_dispatch('${admin}','${obligations[1]}','${operations[0]}',true); raise exception 'changed dispatch body replayed';
  exception when sqlstate 'P0001' then get stacked diagnostics v_msg=message_text; if v_msg<>'operation_conflict' then raise; end if; end;
  begin insert into public.app_refund_obligations(payment_id,source,amount_cents,currency,state)
    values('${payments[0]}','cancellation',1500,'USD','open'); raise exception 'overcommitted payment balance';
  exception when check_violation or raise_exception then get stacked diagnostics v_msg=message_text;
    if v_msg not in ('balance_exhausted','overcommitted payment balance') then raise; end if; end;
  v_jobs:=public.claim_refund_work('${id(140)}',10);
  select value into j from jsonb_array_elements(v_jobs) where value->>'operationId'='${operations[0]}';
  if j is null then raise exception 'expected dispatch job was not claimed'; end if;
  v:=public.finish_refund_work((j->>'jobId')::uuid,(j->>'leaseToken')::uuid,'succeeded',null,null,null,null,null,null,null,null);
  if v->'operation'->>'state'<>'unknown' or v->'operation'->>'safeCode'<>'payment_mismatch'
    or (v->'operation'->>'canRetry')::boolean or (select state from public.app_payments where payment_id='${payments[0]}')<>'refund_pending'
    or (select state from public.app_refund_obligations where obligation_id='${obligations[0]}')<>'unknown' then
    raise exception 'unbound success was not held as unknown'; end if;
  v_detail:=public.read_admin_refund('${admin}','${obligations[0]}',true);
  if (v_detail->'operations'->0->>'canRetry')::boolean then raise exception 'payment_mismatch allowed unsafe retry'; end if;
  begin perform public.queue_refund_retry('${admin}','${operations[0]}','${id(130)}',true); raise exception 'payment_mismatch retry was queued';
  exception when sqlstate 'P0001' then get stacked diagnostics v_msg=message_text; if v_msg<>'not_retryable' then raise; end if; end;

  select value into j from jsonb_array_elements(v_jobs) where value->>'operationId'='${operations[1]}';
  if j is null then raise exception 'expected valid dispatch job was not claimed'; end if;
  v:=public.finish_refund_work((j->>'jobId')::uuid,(j->>'leaseToken')::uuid,'succeeded',null,'re_w075valid','test','',
    'pi_w075_2',1250,'USD','succeeded');
  if v->'operation'->>'state'<>'succeeded' or (select state from public.app_refund_obligations where obligation_id='${obligations[1]}')<>'succeeded'
    or (select state from public.app_payments where payment_id='${payments[1]}')<>'verified_paid' then
    raise exception 'valid partial refund did not settle without marking full payment refunded'; end if;

  select value into j from jsonb_array_elements(v_jobs) where value->>'operationId'='${operations[2]}';
  if j is null then raise exception 'expected mismatch test job was not claimed'; end if;
  v:=public.finish_refund_work((j->>'jobId')::uuid,(j->>'leaseToken')::uuid,'succeeded',null,'re_w075mismatch','test','',
    'pi_wrong',1250,'USD','pending');
  if v->'operation'->>'state'<>'unknown' or v->'operation'->>'safeCode'<>'payment_mismatch'
    or (select provider_refund_id from public.app_refund_operations where operation_id='${operations[2]}') is not null
    or (select state from public.app_payments where payment_id='${payments[2]}')<>'refund_pending' then
    raise exception 'mismatched provider binding reached settled state'; end if;
  if has_function_privilege('anon','public.queue_refund_dispatch(uuid,uuid,uuid,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.finish_refund_work(uuid,uuid,text,text,text,text,text,text,integer,text,text)','EXECUTE') then
    raise exception 'refund functions are directly exposed'; end if;
  if (select count(*) from public.app_refund_action_operations where request_id in ('${operations[0]}','${operations[1]}','${operations[2]}'))<>3
    or (select count(*) from public.app_refund_work_items where operation_id in ('${operations[0]}','${operations[1]}','${operations[2]}'))<>3 then
    raise exception 'dispatch replay duplicated action/job rows'; end if;
end $w075$;
rollback;`;

async function main() {
  assertTarget();
  try { writeFileSync(runLock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("refund DB harness already running or lock exists; inspect the isolated test stack"); }
  try {
    collisionCheck();
    const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", setupAndVerify]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const rows = psql(`select concat(
      (not exists(select 1 from auth.users where id in (${list(allIds)})))::text,'|',
      (not exists(select 1 from public.app_payments where payment_id in (${list(payments)})))::text,'|',
      (not exists(select 1 from public.app_refund_obligations where obligation_id in (${list(obligations)})))::text,'|',
      (not exists(select 1 from public.app_refund_operations where operation_id in (${list(operations)})))::text,'|',
      (not exists(select 1 from public.app_refund_work_items where operation_id in (${list(operations)})))::text)`);
    assert.equal(rows, "true|true|true|true|true", "rollback did not remove the exact synthetic transaction fixtures");
    process.stdout.write("W07.5 refund DB acceptance passed; all fixture writes rolled back.\n");
  } finally {
    try { if (existsSync(runLock)) unlinkSync(runLock); } catch { /* preserve the original failure; stale lock is inspectable */ }
  }
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "refund_db_test_failed"}\n`); process.exitCode = 1; });
