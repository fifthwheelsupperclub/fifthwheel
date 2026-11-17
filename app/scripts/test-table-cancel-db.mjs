#!/usr/bin/env node
// W07.6 rollback-only DB acceptance for public.cancel_table. Targets only the isolated local test stack; never migrates or contacts Stripe.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const id = (n) => `e0760000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), outsider = id(2), members = [id(3), id(4), id(5), id(6)];
const signups = [id(11), id(12), id(13), id(14)], admissions = [id(21), id(22), id(23), id(24)], guests = [id(31), id(32), id(33), id(34)];
const table = id(41), otherTable = id(42), revision = id(51), otherRevision = id(52);
const requests = [id(61), id(62), id(63), id(64)], proposal = id(71), invitations = [id(81), id(82), id(83), id(84)];
const attempts = [id(91), id(92), id(93), id(94)], payments = [id(101), id(102), id(103)], seats = [id(111), id(112), id(113)];
const cancelRequest = id(121), partial = id(131), ops = [id(141), id(142), id(143), id(144)];
const emails = members.map((_, i) => `w076-${i + 1}@tablecancel.example`);
const q = (x) => `'${x}'`;

function psql(sql) {
  const r = spawnSync("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}
const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m, "wrong local project");
assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "linked/hosted target forbidden");
assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "hosted project ref forbidden");
assert.equal(psql("select count(*) from public.app_table_cancel_operations").length > 0, true, "apply 20261114120000 first");
assert.equal(psql(`select count(*) from auth.users where id in (${[admin, outsider, ...members].map(q).join(",")})`), "0", "fixture collision");

const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (${q(admin)},'authenticated','authenticated','w076-admin@tablecancel.example',now(),'','{}','{}',now(),now()),
  (${q(outsider)},'authenticated','authenticated','w076-outsider@tablecancel.example',now(),'','{}','{}',now(),now()),
  ${members.map((u, i) => `(${q(u)},'authenticated','authenticated',${q(emails[i])},now(),'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values (${q(admin)},'admin');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((_, i) => `(${q(signups[i])},${q(emails[i])},'Cancel','Guest ${i + 1}','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  ${members.map((u, i) => `(${q(admissions[i])},${q(signups[i])},${q(emails[i])},'activated',${q(admin)},${q(u)},now())`).join(",\n  ")};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((u, i) => `(${q(guests[i])},${q(u)},${q(admissions[i])},'Cancel','Guest ${i + 1}','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${q(table)},'published','current'),(${q(otherTable)},'published','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  ${[[revision, table], [otherRevision, otherTable]].map(([r, t]) => `(${q(r)},${q(t)},1,'published',jsonb_build_object('title','W07.6 Table','localDate',to_char(current_date+60,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park','stops',jsonb_build_array('{}','{}','{}')),${q(admin)})`).join(",\n  ")};
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values
  ${members.map((u, i) => `(${q(requests[i])},${q(table)},${q(guests[i])},${q(u)},'W07.6 Table',current_date+60,'19:00','Inman Park','pending')`).join(",\n  ")};
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
  (${q(proposal)},${q(table)},1,'approved',${q(revision)},'{}'::jsonb,${q(admin)},${q(admin)},${q(admin)},${q(admin)},now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision) values
  ${members.map((_, i) => `(${q(proposal)},${q(requests[i])},${q(guests[i])},1)`).join(",\n  ")};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  ${members.map((u, i) => `(${q(invitations[i])},${q(table)},${q(guests[i])},${q(u)},${q(requests[i])},${q(proposal)},${q(admin)},'active')`).join(",\n  ")};
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  ${members.map((u, i) => `(${q(attempts[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(u)},1,1,${q(revision)},${i < 3 ? "'consumed'" : "'open'"},
    ${i < 3 ? "now()-interval '1 hour',now()-interval '58 minutes'" : "now()+interval '20 minutes',now()+interval '21 minutes'"},'test','w076-key-${i + 1}','cs_test_w076session${i + 1}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  ${payments.map((p, i) => `(${q(p)},${q(attempts[i])},'test','pi_w076_${i + 1}',2500,'USD','verified_paid',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at,cancelled_at) values
  (${q(seats[0])},${q(invitations[0])},${q(table)},${q(guests[0])},${q(payments[0])},'confirmed',now()-interval '1 hour',null),
  (${q(seats[1])},${q(invitations[1])},${q(table)},${q(guests[1])},${q(payments[1])},'cancellation_requested',now()-interval '1 hour',null),
  (${q(seats[2])},${q(invitations[2])},${q(table)},${q(guests[2])},${q(payments[2])},'cancelled',now()-interval '1 hour',now()-interval '30 minutes');
insert into public.app_seat_cancellation_requests(cancellation_request_id,seat_id,state,version,member_reason) values (${q(cancelRequest)},${q(seats[1])},'pending',1,'Cannot attend');
set local request.jwt.claims='{"role":"service_role"}';
insert into public.app_refund_obligations(obligation_id,payment_id,source,amount_cents,currency,state) values (${q(partial)},${q(payments[2])},'cancellation',1000,'USD','open');
do $w076$ declare v jsonb; v2 jsonb; msg text; begin
  begin perform public.cancel_table(${q(outsider)},${q(table)},${q(ops[0])},'x'); raise exception 'non-admin cancelled a Table';
  exception when insufficient_privilege then get stacked diagnostics msg=message_text; if msg<>'admin_required' then raise; end if; end;
  begin perform public.cancel_table(${q(admin)},${q(table)},${q(ops[0])},'   '); raise exception 'blank reason accepted';
  exception when sqlstate '22023' then null; end;
  v:=public.cancel_table(${q(admin)},${q(table)},${q(ops[0])},'Venue closed');
  if v<>jsonb_build_object('tableId','${table}','state','cancelled','closedRequests',4,'closedInvitations',4,'releasedHolds',1,'cancelledSeats',2,
    'resolvedCancellationRequests',1,'refundObligations',3,'refundTotalCents',6500) then raise exception 'unexpected result %', v; end if;
  if (select state from public.app_table_runtime where table_id='${table}')<>'cancelled' then raise exception 'runtime not cancelled'; end if;
  if (select count(*) from public.app_table_requests where table_id='${table}' and state='closed_by_table')<>4
    or (select count(*) from public.app_table_requests where table_id='${table}' and state='pending')<>0 then raise exception 'pending requests not closed'; end if;
  if (select count(*) from public.app_table_invitations where table_id='${table}' and state='closed' and closed_at is not null)<>4 then raise exception 'active invitation not closed'; end if;
  if (select state from public.app_checkout_attempts where attempt_id='${attempts[3]}')<>'released' then raise exception 'hold not released'; end if;
  if (select count(*) from public.app_seats where table_id='${table}' and state='cancelled')<>3 then raise exception 'seats not cancelled'; end if;
  if (select amount_cents from public.app_refund_obligations where payment_id='${payments[0]}' and source='table_cancellation')<>2500
    or (select amount_cents from public.app_refund_obligations where payment_id='${payments[1]}' and source='table_cancellation')<>2500
    or (select amount_cents from public.app_refund_obligations where payment_id='${payments[2]}' and source='table_cancellation')<>1500
    then raise exception 'refund remainders wrong'; end if;
  if (select sum(amount_cents) from public.app_refund_obligations where payment_id='${payments[2]}')<>2500 then raise exception 'partial refund plus table remainder exceeded payment'; end if;
  if (select state||':'||refund_cents from public.app_seat_cancellation_requests where cancellation_request_id='${cancelRequest}')<>'approved:2500'
    or not exists(select 1 from public.app_seat_cancellation_notice_outbox where cancellation_request_id='${cancelRequest}') then raise exception 'pending Seat request not resolved'; end if;
  if (select count(*) from public.app_payments where payment_id in (${payments.map(q).join(",")}) and state='refund_pending')<>3 then raise exception 'payments not refund_pending'; end if;
  -- replay: same result, no new obligations or audit rows
  v2:=public.cancel_table(${q(admin)},${q(table)},${q(ops[0])},'Venue closed');
  if v2<>v then raise exception 'replay differed'; end if;
  begin perform public.cancel_table(${q(admin)},${q(table)},${q(ops[0])},'Different reason'); raise exception 'changed body replayed';
  exception when unique_violation then get stacked diagnostics msg=message_text; if msg<>'operation_conflict' then raise; end if; end;
  begin perform public.cancel_table(${q(admin)},${q(table)},${q(ops[1])},'Venue closed'); raise exception 'second cancellation of a cancelled Table accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'table_not_cancellable' then raise; end if; end;
  if (select count(*) from public.app_refund_obligations where payment_id in (${payments.map(q).join(",")}) and source='table_cancellation')<>3
    or (select count(*) from public.app_audit_events where action='table.cancelled' and subject_id='${table}')<>1 then raise exception 'retry duplicated obligations or audit'; end if;
  begin perform public.cancel_table(${q(admin)},${q(id(999))},${q(ops[2])},'x'); raise exception 'unknown Table cancelled';
  exception when sqlstate 'P0002' then null; end;
  if (select state from public.app_table_runtime where table_id='${otherTable}')<>'open' then raise exception 'other Table affected'; end if;
  -- a cancelled Table takes no new placements
  if (select state from public.app_table_requests where table_id='${table}' and auth_user_id=${q(members[0])} order by created_at desc limit 1)<>'closed_by_table' then raise exception 'request not closed by the Table'; end if;
end $w076$;
rollback;`;
psql(sql);
assert.equal(psql(`select count(*) from public.app_table_cancel_operations where operation_id in (${ops.map(q).join(",")})`), "0", "rollback left rows");
console.log("table-cancel-db-test: cancel_table closes requests/offers/holds, cancels Seats, adds only uncovered refund remainders, resolves pending Seat requests, replays idempotently, rejects non-admin/changed-body/second cancellation; rolled back.");
