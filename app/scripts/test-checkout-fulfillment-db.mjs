#!/usr/bin/env node

// W07.2 rollback-only fulfillment acceptance. It requires the isolated local
// test migrations to be applied by the coordinator; it never resets/migrates or
// contacts Stripe/Auth/email. Do not run without an explicit coordinator go-ahead.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migration = "20261113181544";
const ids = Array.from({ length: 32 }, (_, index) => `a0072000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const [admin, user, signup, admission, guest, table, revision, request, proposal, invitation, attempt, operation,
  paymentEvent, refundUser, refundSignup, refundAdmission, refundGuest, refundTable, refundRevision, refundRequest,
  refundProposal, refundInvitation, refundAttempt, refundOperation, refundEvent, ...rest] = ids;
const emails = ["w072-payment@example.test", "w072-refund@example.test"];
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: {
    ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
  } });
  if (result.error) throw result.error;
  return result;
}
function list(values) { return values.map((value) => `'${value}'`).join(","); }
function targetGuard() {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m);
  assert.match(config, /^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m);
  assert.match(config, /^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m);
  assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "hosted linked target is forbidden");
  for (const [name, expected] of [["SUPABASE_URL", api], ["SUPABASE_DB_URL", db], ["DATABASE_URL", db]]) {
    if (process.env[name]) assert.equal(process.env[name], expected, `refusing mismatched ${name}`);
  }
  assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "hosted project ref is forbidden");
  const local = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(local.status, 0, local.stderr || local.stdout);
  const status = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf("{"), status.stdout.lastIndexOf("}") + 1));
  assert.equal(parsed.API_URL, api); assert.equal(parsed.DB_URL, db);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr || history.stdout);
  assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                ")),
    `migration ${migration} must already be applied; this script never applies it`);
}

targetGuard();
const collision = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", `select concat(
  (not exists(select 1 from auth.users where id in (${list([admin,user,refundUser])}) or email in (${list(emails)})))::text,'|',
  (not exists(select 1 from public.waitlist_signups where id in (${list([signup,refundSignup])}) or email_normalized in (${list(emails)})))::text,'|',
  (not exists(select 1 from public.app_admissions where id in (${list([admission,refundAdmission])}) or auth_user_id in (${list([user,refundUser])})))::text,'|',
  (not exists(select 1 from public.app_member_profiles where guest_id in (${list([guest,refundGuest])}) or auth_user_id in (${list([user,refundUser])})))::text,'|',
  (not exists(select 1 from public.app_user_roles where user_id='${admin}'))::text,'|',
  (not exists(select 1 from public.app_supply_table_heads where table_id in (${list([table,refundTable])})))::text,'|',
  (not exists(select 1 from public.app_supply_table_revisions where revision_id in (${list([revision,refundRevision])}) or table_id in (${list([table,refundTable])})))::text,'|',
  (not exists(select 1 from public.app_table_requests where request_id in (${list([request,refundRequest])}) or table_id in (${list([table,refundTable])})))::text,'|',
  (not exists(select 1 from public.app_table_roster_proposals where proposal_id in (${list([proposal,refundProposal])})))::text,'|',
  (not exists(select 1 from public.app_table_roster_proposal_members where proposal_id in (${list([proposal,refundProposal])})))::text,'|',
  (not exists(select 1 from public.app_table_invitations where invitation_id in (${list([invitation,refundInvitation])})))::text,'|',
  (not exists(select 1 from public.app_checkout_attempts where attempt_id in (${list([attempt,refundAttempt])}) or provider_session_id in ('cs_test_w072pay','cs_test_w072late')))::text,'|',
  (not exists(select 1 from public.app_checkout_operations where operation_id in (${list([operation,refundOperation])})))::text,'|',
  (not exists(select 1 from public.app_payments where provider_payment_id in ('pi_w072pay','pi_w072late') or attempt_id in (${list([attempt,refundAttempt])})))::text,'|',
  (not exists(select 1 from public.app_seats where invitation_id in (${list([invitation,refundInvitation])}) or payment_id in (select payment_id from public.app_payments where provider_payment_id in ('pi_w072pay','pi_w072late'))))::text,'|',
  (not exists(select 1 from public.app_stripe_checkout_events where event_id in ('evt_w072pay','evt_w072fail','evt_w072late')))::text,'|',
  (not exists(select 1 from public.app_refund_obligations where payment_id in (select payment_id from public.app_payments where provider_payment_id in ('pi_w072pay','pi_w072late'))))::text,'|',
  (not exists(select 1 from public.app_audit_events where operation_id in (${list([...ids])}) or subject_id in (${list([attempt,refundAttempt,invitation,refundInvitation])})))::text)`]);
assert.equal(collision.status, 0, collision.stderr || collision.stdout);
assert.equal(collision.stdout.trim(), Array(18).fill("true").join("|"), "refusing fixture collisions across W07.2 rows");

const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('${admin}','authenticated','authenticated','w072-admin@example.test',now(),'','{}','{}',now(),now()),
 ('${user}','authenticated','authenticated','${emails[0]}',now(),'','{}','{}',now(),now()),
 ('${refundUser}','authenticated','authenticated','${emails[1]}',now(),'','{}','{}',now(),now());
insert into public.app_user_roles(user_id,role) values ('${admin}','admin');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
 ('${signup}','${emails[0]}','Paid','Member','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me'),
 ('${refundSignup}','${emails[1]}','Late','Member','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me');
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
 ('${admission}','${signup}','${emails[0]}','activated','${admin}','${user}',now()),
 ('${refundAdmission}','${refundSignup}','${emails[1]}','activated','${admin}','${refundUser}',now());
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
 ('${guest}','${user}','${admission}','Paid','Member','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me'),
 ('${refundGuest}','${refundUser}','${refundAdmission}','Late','Member','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me');
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values ('${table}','published','current'),('${refundTable}','published','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
 ('${revision}','${table}',1,'published',jsonb_build_object('title','W07.2 Dinner','localDate',to_char(current_date+60,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park','stops',jsonb_build_array('{}','{}','{}')),'${admin}'),
 ('${refundRevision}','${refundTable}',1,'published',jsonb_build_object('title','W07.2 Late Dinner','localDate',to_char(current_date+60,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park','stops',jsonb_build_array('{}','{}','{}')),'${admin}');
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values
 ('${request}','${table}','${guest}','${user}','W07.2 Dinner',current_date+60,'19:00','Inman Park','pending'),
 ('${refundRequest}','${refundTable}','${refundGuest}','${refundUser}','W07.2 Late Dinner',current_date+60,'19:00','Inman Park','pending');
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
 ('${proposal}','${table}',1,'approved','${revision}','{"valid":true,"issues":[]}'::jsonb,'${admin}','${admin}','${admin}','${admin}',now(),now()),
 ('${refundProposal}','${refundTable}',1,'approved','${refundRevision}','{"valid":true,"issues":[]}'::jsonb,'${admin}','${admin}','${admin}','${admin}',now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision) values
 ('${proposal}','${request}','${guest}',1),('${refundProposal}','${refundRequest}','${refundGuest}',1);
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
 ('${invitation}','${table}','${guest}','${user}','${request}','${proposal}','${admin}','active'),
 ('${refundInvitation}','${refundTable}','${refundGuest}','${refundUser}','${refundRequest}','${refundProposal}','${admin}','active');
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
 ('${attempt}','${invitation}','${table}','${guest}','${user}',1,1,'${revision}','open',now()+interval '30 minutes',now()+interval '32 minutes','test','w072-op-1','cs_test_w072pay','seat-checkout-v1',now()),
 ('${refundAttempt}','${refundInvitation}','${refundTable}','${refundGuest}','${refundUser}',1,1,'${refundRevision}','open',now()-interval '1 minute',now()+interval '1 minute','test','w072-op-2','cs_test_w072late','seat-checkout-v1',now());
set local request.jwt.claims='{"role":"service_role"}';
do $w072$
declare persisted jsonb; paid jsonb; paid_again jsonb; failed jsonb; late_paid jsonb; own_binding jsonb; eligibility jsonb; recovery jsonb; err text; seat_count integer; payment_count integer; obligation_count integer;
begin
  if not has_function_privilege('anon','public.fulfill_paid_checkout_session(text,text,text,uuid,text,text,text,text,integer,text,timestamp with time zone)','EXECUTE')
    and not has_function_privilege('authenticated','public.fulfill_paid_checkout_session(text,text,text,uuid,text,text,text,text,integer,text,timestamp with time zone)','EXECUTE')
    and has_function_privilege('service_role','public.fulfill_paid_checkout_session(text,text,text,uuid,text,text,text,text,integer,text,timestamp with time zone)','EXECUTE') then null;
  else raise exception 'fulfillment RPC grants are not service-only'; end if;
  own_binding:=public.read_checkout_return_binding('${user}','${invitation}','${attempt}');
  if own_binding->>'providerSessionId'<>'cs_test_w072pay' then raise exception 'owner return binding missing'; end if;
  begin perform public.read_checkout_return_binding('${refundUser}','${invitation}','${attempt}'); raise exception 'cross-owner return binding allowed';
  exception when sqlstate 'P0002' then get stacked diagnostics err=message_text; if err<>'not_found' then raise; end if; end;
  persisted:=public.persist_stripe_checkout_event('evt_w072pay','checkout.session.completed','test','','${new Date().toISOString()}','cs_test_w072pay');
  if persisted->>'state'<>'received' then raise exception 'event not durably inserted first'; end if;
  paid:=public.fulfill_paid_checkout_session('evt_w072pay','test','','${attempt}','cs_test_w072pay','pi_w072pay','complete','paid',2500,'usd',clock_timestamp());
  paid_again:=public.fulfill_paid_checkout_session('evt_w072pay','test','','${attempt}','cs_test_w072pay','pi_w072pay','complete','paid',2500,'usd',clock_timestamp());
  if paid->>'paymentState'<>'confirmed' or paid->>'seatId'<>paid_again->>'seatId' then raise exception 'paid fulfillment/replay did not return one Seat'; end if;
  select count(*) into seat_count from public.app_seats where invitation_id='${invitation}';
  select count(*) into payment_count from public.app_payments where attempt_id='${attempt}';
  if seat_count<>1 or payment_count<>1 then raise exception 'duplicate Seat/payment on event replay'; end if;
  recovery:=public.read_my_checkout_attempt('${user}','${attempt}');
  if recovery->>'paymentState'<>'confirmed' or recovery->>'seatId'<>paid->>'seatId' then raise exception 'owner recovery did not report confirmed Seat'; end if;
  begin perform public.fulfill_paid_checkout_session(null,'test','','${attempt}','cs_test_w072pay','pi_w072pay','complete','paid',2400,'usd',clock_timestamp()); raise exception 'wrong amount fulfilled';
  exception when sqlstate 'P0001' then get stacked diagnostics err=message_text; if err<>'payment_truth_invalid' then raise; end if; end;

  -- A provider-confirmed asynchronous failure releases the unresolved attempt.
  persisted:=public.persist_stripe_checkout_event('evt_w072fail','checkout.session.async_payment_failed','test','','${new Date().toISOString()}','cs_test_w072late');
  failed:=public.release_failed_checkout_session('evt_w072fail','test','','cs_test_w072late');
  if failed->>'state'<>'released' or failed->>'changed'<>'true'
    or (select state from public.app_checkout_attempts where attempt_id='${refundAttempt}')<>'released'
    or (select state from public.app_stripe_checkout_events where event_id='evt_w072fail' and provider_mode='test')<>'processed'
    or (select result_code from public.app_stripe_checkout_events where event_id='evt_w072fail' and provider_mode='test')<>'payment_failed' then
    raise exception 'confirmed asynchronous failure did not atomically release its attempt and finish the event'; end if;

  -- A later verified paid event for that released session is still fulfilled/refunded safely.
  -- The Table's supply goes stale after a delayed charge: retain the verified charge and create a full refund obligation.
  update public.app_supply_table_heads set sync_state='stale' where table_id='${refundTable}';
  persisted:=public.persist_stripe_checkout_event('evt_w072late','checkout.session.async_payment_succeeded','test','','${new Date().toISOString()}','cs_test_w072late');
  late_paid:=public.fulfill_paid_checkout_session('evt_w072late','test','','${refundAttempt}','cs_test_w072late','pi_w072late','complete','paid',2500,'usd',clock_timestamp());
  if late_paid->>'paymentState'<>'refund_pending' or late_paid->>'seatId' is not null or late_paid->>'refundObligationId' is null then raise exception 'ineligible late payment did not create refund obligation'; end if;
  select count(*) into obligation_count from public.app_refund_obligations where payment_id=(late_paid->>'paymentId')::uuid and amount_cents=2500 and state='open';
  if obligation_count<>1 then raise exception 'late charge refund liability missing'; end if;
  update public.app_supply_table_heads set sync_state='current' where table_id='${refundTable}';
  eligibility:=public.read_checkout_eligibility('${refundUser}','${refundInvitation}','seat-checkout-v1','approved copy',true);
  if eligibility->'eligibility'->>'reasonCode'<>'payment_unresolved' then raise exception 'unsettled refund did not block a new checkout'; end if;
  recovery:=public.read_my_checkout_attempt('${refundUser}','${refundAttempt}');
  if recovery->>'paymentState'<>'refund_pending' then raise exception 'refund obligation not shown in owner recovery'; end if;
  update public.app_refund_obligations set state='succeeded' where obligation_id=(late_paid->>'refundObligationId')::uuid;
  update public.app_payments set state='refunded' where payment_id=(late_paid->>'paymentId')::uuid;
  eligibility:=public.read_checkout_eligibility('${refundUser}','${refundInvitation}','seat-checkout-v1','approved copy',true);
  if eligibility->'eligibility'->>'reasonCode' is not null then raise exception 'settled refund did not release retry eligibility'; end if;
end $w072$;
rollback;`;
const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql]);
assert.equal(result.status, 0, result.stderr || result.stdout);
console.log(`checkout-fulfillment-db-test: guarded fifthwheel-rewrite-test; migration ${migration}; account-scoped durable ingress, owner binding/denial, replay-safe Seat/payment, wrong amount denial, late-charge refund liability, owner recovery/payment_unresolved gate and settlement release passed; transaction rolled back; no provider contacted`);
