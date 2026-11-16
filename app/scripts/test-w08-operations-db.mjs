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
const id = (n) => `e0800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), host = id(2), host2 = id(7), restaurant = id(8), restaurant2 = id(9), members = [id(3), id(4), id(5), id(6)];
const signups = [id(11), id(12), id(13), id(14)], admissions = [id(21), id(22), id(23), id(24)], guests = [id(31), id(32), id(33), id(34)];
const table = id(41), revision = id(51);
const requests = [id(61), id(62), id(63), id(64)], proposal = id(71), invitations = [id(81), id(82), id(83), id(84)];
const attempts = [id(91), id(92), id(93), id(94)], payments = [id(101), id(102), id(103)], seats = [id(111), id(112), id(113)];
const cancelRequest = id(121), ops = [id(141), id(142), id(143), id(144)];
const venue = id(60), venue2 = id(61);
const emails = members.map((_, i) => `w080-${i + 1}@ops.example`);
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
assert.equal(psql("select count(*) from public.app_ops_operations").length > 0, true, "apply 20261114150000 first");
assert.equal(psql(`select count(*) from auth.users where id in (${[admin, host, host2, restaurant, restaurant2, ...members].map(q).join(",")})`), "0", "fixture collision");

const staff = [[admin, "admin"], [host, "host"], [host2, "host"], [restaurant, "restaurant"], [restaurant2, "restaurant"]];
const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ${staff.map(([u, r]) => `(${q(u)},'authenticated','authenticated','w080-${r}-${u.slice(-2)}@ops.example',now(),'','{}','{}',now(),now())`).join(",\n  ")},
  ${members.map((u, i) => `(${q(u)},'authenticated','authenticated',${q(emails[i])},now(),'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values ${staff.map(([u, r]) => `(${q(u)},'${r}')`).join(",")};
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((_, i) => `(${q(signups[i])},${q(emails[i])},'Ops${i + 1}','Guest','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  ${members.map((u, i) => `(${q(admissions[i])},${q(signups[i])},${q(emails[i])},'activated',${q(admin)},${q(u)},now())`).join(",\n  ")};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((u, i) => `(${q(guests[i])},${q(u)},${q(admissions[i])},'approved',1,1,'Ops${i + 1}','Guest','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_supply_venues(venue_id,name,address,neighborhood,created_by) values (${q(venue)},'W08 Venue 1','1 Test Way','Inman Park',${q(admin)}),(${q(venue2)},'W08 Venue 2','2 Test Way','Inman Park',${q(admin)});
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${q(table)},'published','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  (${q(revision)},${q(table)},1,'published',jsonb_build_object('title','W08 Table','localDate',to_char((now()+interval '12 hours') at time zone 'America/New_York','YYYY-MM-DD'),
    'startLocalTime',to_char((now()+interval '12 hours') at time zone 'America/New_York','HH24:MI'),'neighborhood','Inman Park','stops',jsonb_build_array(
      jsonb_build_object('role','drinks','venueId','${venue}','venueName','Test Bar','venueAddress','1 Main St','minutesFromStart',0,'publicNotes','Reserve the back table','privateNotes','SECRET'),
      jsonb_build_object('role','dinner','venueId','${venue2}','venueName','Test Grill','venueAddress','2 Main St','minutesFromStart',60,'publicNotes','Quiet corner'),
      jsonb_build_object('role','dessert','venueId','${id(62)}','venueName','Test Sweets','venueAddress','3 Main St','minutesFromStart',120,'publicNotes','x'))),${q(admin)});
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values
  ${members.map((u, i) => `(${q(requests[i])},${q(table)},${q(guests[i])},${q(u)},'W08 Table',current_date+1,'19:00','Inman Park','pending')`).join(",\n  ")};
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
  (${q(proposal)},${q(table)},1,'approved',${q(revision)},'{}'::jsonb,${q(admin)},${q(admin)},${q(admin)},${q(admin)},now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version) values
  ${members.map((_, i) => `(${q(proposal)},${q(requests[i])},${q(guests[i])},1,1,1)`).join(",\n  ")};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  ${members.map((u, i) => `(${q(invitations[i])},${q(table)},${q(guests[i])},${q(u)},${q(requests[i])},${q(proposal)},${q(admin)},'active')`).join(",\n  ")};
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  ${payments.map((_, i) => `(${q(attempts[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},1,1,${q(revision)},'consumed',now()-interval '1 hour',now()-interval '58 minutes','test','w080-key-${i + 1}','cs_test_w080session${i + 1}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  ${payments.map((p, i) => `(${q(p)},${q(attempts[i])},'test','pi_w080_${i + 1}',2500,'USD','verified_paid',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at) values
  ${seats.map((s, i) => `(${q(s)},${q(invitations[i])},${q(table)},${q(guests[i])},${q(payments[i])},'${i === 1 ? "cancellation_requested" : "confirmed"}',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_seat_cancellation_requests(cancellation_request_id,seat_id,state,version,member_reason) values (${q(cancelRequest)},${q(seats[1])},'pending',1,'Might be late');
set local request.jwt.claims='{"role":"service_role"}';
do $w080$ declare v jsonb; msg text; t timestamptz; begin
  -- queue: admin only, table needs a decision with three valid paid guests
  v:=public.read_table_decision_queue(${q(admin)});
  if jsonb_array_length(v->'items')<>1 or v->'items'->0->>'status'<>'needs_decision' or (v->'items'->0->>'paidCount')::integer<>3 or not (v->'items'->0->>'canProceed')::boolean then raise exception 'queue wrong: %',v; end if;
  begin perform public.read_table_decision_queue(${q(host)}); raise exception 'host read the decision queue';
  exception when insufficient_privilege then null; end;

  -- check-in before proceed is refused; unassigned host is forbidden; assignment requires the host role
  begin perform public.check_in_guest(${q(admin)},'${table}','${seats[0]}'); raise exception 'check-in before proceed';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'table_not_proceeding' then raise; end if; end;
  begin perform public.read_table_attendance(${q(host)},'${table}'); raise exception 'unassigned host read attendance';
  exception when insufficient_privilege then null; end;
  begin perform public.set_host_assignment(${q(admin)},'${table}',${q(members[0])},true); raise exception 'member assigned as host';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'not_a_host' then raise; end if; end;
  begin perform public.set_host_assignment(${q(host)},'${table}',${q(host)},true); raise exception 'host assigned themselves';
  exception when insufficient_privilege then null; end;
  perform public.set_host_assignment(${q(admin)},'${table}',${q(host)},true);

  -- proceed: a host cannot; an invalid paid group cannot; a valid one can, once, idempotently
  begin perform public.record_table_proceed(${q(host)},'${table}',${q(ops[0])}); raise exception 'host recorded proceed';
  exception when insufficient_privilege then null; end;
  update public.app_seats set state='cancelled',cancelled_at=now() where seat_id='${seats[2]}';
  if (public.read_table_decision_queue(${q(admin)})->'items'->0->>'canProceed')::boolean then raise exception 'two paid guests shown as proceedable'; end if;
  begin perform public.record_table_proceed(${q(admin)},'${table}',${q(ops[0])}); raise exception 'under-three proceeded';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'group_invalid' then raise; end if; end;
  update public.app_seats set state='confirmed',cancelled_at=null where seat_id='${seats[2]}';
  v:=public.record_table_proceed(${q(admin)},'${table}',${q(ops[0])});
  if v->>'state'<>'proceeding' or (v->>'paidCount')::integer<>3 then raise exception 'proceed result wrong %',v; end if;
  if public.record_table_proceed(${q(admin)},'${table}',${q(ops[0])})<>v then raise exception 'proceed replay differed'; end if;
  begin perform public.record_table_proceed(${q(admin)},'${table}',${q(ops[1])}); raise exception 'second proceed accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'table_not_proceedable' then raise; end if; end;

  -- attendance: assigned host sees first names only, checks in a paid guest idempotently; unpaid/unknown seats refused
  v:=public.read_table_attendance(${q(host)},'${table}');
  if jsonb_array_length(v->'guests')<>3 or not (v->>'canCheckIn')::boolean or v::text like '%Guest%' or v::text like '%@%' or v::text like '%1990%' then raise exception 'host attendance view leaks or wrong %',v; end if;
  v:=public.check_in_guest(${q(host)},'${table}','${seats[0]}');
  t:=(v->>'checkedInAt')::timestamptz;
  if (public.check_in_guest(${q(host)},'${table}','${seats[0]}')->>'checkedInAt')::timestamptz<>t then raise exception 'check-in replay moved timestamp'; end if;
  if (select count(*) from public.app_table_attendance where seat_id='${seats[0]}')<>1 or (select count(*) from public.app_audit_events where action='table.attendance.checked_in' and subject_id='${seats[0]}')<>1 then raise exception 'check-in duplicated'; end if;
  begin perform public.check_in_guest(${q(host2)},'${table}','${seats[1]}'); raise exception 'unassigned host checked in';
  exception when insufficient_privilege then null; end;
  begin perform public.check_in_guest(${q(host)},'${table}',${q(id(999))}); raise exception 'unknown seat checked in';
  exception when sqlstate 'P0002' then null; end;
  perform public.check_in_guest(${q(admin)},'${table}','${seats[1]}');

  -- host flag: assigned host only, never decides; idempotent
  begin perform public.flag_cancellation_request(${q(host2)},'${cancelRequest}'); raise exception 'unassigned host flagged';
  exception when insufficient_privilege then null; end;
  perform public.flag_cancellation_request(${q(host)},'${cancelRequest}'); perform public.flag_cancellation_request(${q(host)},'${cancelRequest}');
  if (select state||':'||(host_flagged_by='${host}')::text from public.app_seat_cancellation_requests where cancellation_request_id='${cancelRequest}')<>'pending:true'
    or (select count(*) from public.app_audit_events where action='table.cancellation.flagged' and subject_id='${cancelRequest}')<>1 then raise exception 'flag wrong'; end if;
  if not (public.read_table_attendance(${q(host)},'${table}')->'guests'->1->>'cancellationFlagged')::boolean
    and not exists(select 1 from jsonb_array_elements(public.read_table_attendance(${q(host)},'${table}')->'guests') gx where (gx->>'cancellationFlagged')::boolean) then raise exception 'flag not visible to host'; end if;

  -- restaurant: venue membership, contact, DTO without guests; wrong venue / other user denied
  begin perform public.set_venue_membership(${q(admin)},'${venue}',${q(host)},true); raise exception 'host given a venue';
  exception when sqlstate 'P0001' then null; end;
  perform public.set_venue_membership(${q(admin)},'${venue}',${q(restaurant)},true);
  perform public.set_staff_contact(${q(admin)},${q(host)},'Hannah Host','hannah@host.example');
  v:=public.read_restaurant_workspace(${q(restaurant)});
  if v->>'selected'<>'${venue}' or jsonb_array_length(v->'services')<>1 or v->'services'->0->>'serviceLocalTime' is null or (v->'services'->0->>'paidCount')::integer<>3
    or v->'services'->0->'hostContacts'->0->>'businessContact'<>'hannah@host.example' or v->'services'->0->>'notes'<>'Reserve the back table' then raise exception 'restaurant view wrong %',v; end if;
  if v::text like '%SECRET%' or v::text like '%Ops%' or v::text like '%Guest%' or v::text like '%@ops.example%' or v::text like '%pi_w080%' then raise exception 'restaurant view leaks %',v; end if;
  begin perform public.read_restaurant_workspace(${q(restaurant)},'${venue2}'); raise exception 'restaurant read another venue';
  exception when insufficient_privilege then null; end;
  if public.read_restaurant_workspace(${q(restaurant2)})->'selected' is distinct from 'null'::jsonb then raise exception 'unassigned restaurant user sees a venue'; end if;
  begin perform public.read_restaurant_workspace(${q(host)}); raise exception 'host used restaurant workspace';
  exception when insufficient_privilege then null; end;
  perform public.set_venue_membership(${q(admin)},'${venue}',${q(restaurant)},false);
  if public.read_restaurant_workspace(${q(restaurant)})->'selected' is distinct from 'null'::jsonb then raise exception 'revoked membership still reads'; end if;

  -- removal that breaks validity suspends the proceeding Table
  update public.app_seats set state='cancelled',cancelled_at=now() where seat_id='${seats[2]}';
  if (select state from public.app_table_runtime where table_id='${table}')<>'review_required' then raise exception 'invalid proceeding group not suspended'; end if;
  v:=public.read_table_decision_queue(${q(admin)});
  if v->'items'->0->>'status'<>'suspended' or (v->'items'->0->>'canProceed')::boolean then raise exception 'suspended queue wrong %',v; end if;
  begin perform public.check_in_guest(${q(admin)},'${table}','${seats[1]}'); raise exception 'check-in on a suspended Table';
  exception when sqlstate 'P0001' then null; end;
  perform public.set_host_assignment(${q(admin)},'${table}',${q(host)},false);
  begin perform public.read_table_attendance(${q(host)},'${table}'); raise exception 'revoked host still reads';
  exception when insufficient_privilege then null; end;
end $w080$;
rollback;`;
psql(sql);
assert.equal(psql(`select count(*) from public.app_ops_operations where operation_id in (${ops.map(q).join(",")})`), "0", "rollback left rows");
console.log("w08-operations-db-test: decision queue, proceed gates/idempotency, host/admin check-in, assignment authority, host flag, restaurant DTO privacy, venue revocation and invalid-group suspension; rolled back.");
