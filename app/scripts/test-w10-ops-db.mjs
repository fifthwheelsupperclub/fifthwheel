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
const id = (n) => `e0830000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ops = [id(141), id(142), id(143), id(144)];
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
assert.equal(psql("select to_regprocedure('public.read_admin_overview(uuid)') is not null"), "t", "apply 20261115100000 first");

const N = 7; // guests 0..5 hold paid Seats; guest 6 is admitted but never invited
const range = (base) => Array.from({ length: N }, (_, i) => id(base + i));
const admin = id(1), host = id(2), members = range(100), signups = range(120), admissions = range(140), guests = range(160), requests = range(180), invitations = range(200), attempts = range(220), payments = range(240), seats = range(260);
const table = id(41), revision = id(51), proposal = id(71), emails = members.map((_, i) => `w083-${i + 1}@vote.example`), venueIds = [id(300), id(301), id(302)];
const [A, B, C, D, E, F, G] = guests;
const paid = [0, 1, 2, 3, 4, 5];
assert.equal(psql(`select count(*) from auth.users where id in (${[admin, host, ...members].map(q).join(",")})`), "0", "fixture collision");
const sql = `begin;
create function pg_temp.shift(m integer) returns void language plpgsql as $f$
begin
  update public.app_supply_table_revisions set content = content || jsonb_build_object(
    'localDate', to_char((clock_timestamp() - m * interval '1 minute') at time zone 'America/New_York','YYYY-MM-DD'),
    'startLocalTime', to_char((clock_timestamp() - m * interval '1 minute') at time zone 'America/New_York','HH24:MI')) where revision_id='${revision}';
  -- keep check-in times fixed relative to the moved start: A-D on time (start+10m), E late (start+95m)
  update public.app_vote_periods set opens_at=app_private.table_start('${table}')+interval '90 minutes',closes_at=app_private.table_start('${table}')+interval '120 minutes';
  update public.app_mutual_results set expires_at=app_private.table_start('${table}')+interval '90 days';
  update public.app_table_attendance a set checked_in_at=app_private.table_start('${table}')+(case when a.guest_id='${E}' then 95 else 10 end)*interval '1 minute';
end $f$;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (${q(admin)},'authenticated','authenticated','w083-admin@vote.example',now(),'','{}','{}',now(),now()),
  (${q(host)},'authenticated','authenticated','w083-host@vote.example',now(),'','{}','{}',now(),now()),
  ${members.map((u, i) => `(${q(u)},'authenticated','authenticated',${q(emails[i])},now(),'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values (${q(admin)},'admin'),(${q(host)},'host');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((_, i) => `(${q(signups[i])},${q(emails[i])},'Vote${"ABCDEFG"[i]}','Surname${i}','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  ${members.map((u, i) => `(${q(admissions[i])},${q(signups[i])},${q(emails[i])},'activated',${q(admin)},${q(u)},now())`).join(",\n  ")};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((u, i) => `(${q(guests[i])},${q(u)},${q(admissions[i])},'approved',1,1,'Vote${"ABCDEFG"[i]}','Surname${i}','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${q(table)},'published','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  (${q(revision)},${q(table)},1,'published',jsonb_build_object('title','W09 Table','localDate',to_char(current_date,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park','stops',jsonb_build_array(
    jsonb_build_object('role','drinks','venueId','${venueIds[0]}','venueName','Bar One','venueAddress','1 Main','minutesFromStart',0,'publicNotes','n'),
    jsonb_build_object('role','dinner','venueId','${venueIds[1]}','venueName','Grill Two','venueAddress','2 Main','minutesFromStart',60,'publicNotes','n'),
    jsonb_build_object('role','dessert','venueId','${venueIds[2]}','venueName','Sweets Three','venueAddress','3 Main','minutesFromStart',120,'publicNotes','n'))),${q(admin)});
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values
  ${paid.map((i) => `(${q(requests[i])},${q(table)},${q(guests[i])},${q(members[i])},'W09 Table',current_date,'19:00','Inman Park','pending')`).join(",\n  ")};
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
  (${q(proposal)},${q(table)},1,'approved',${q(revision)},'{}'::jsonb,${q(admin)},${q(admin)},${q(admin)},${q(admin)},now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version) values
  ${paid.map((i) => `(${q(proposal)},${q(requests[i])},${q(guests[i])},1,1,1)`).join(",\n  ")};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  ${paid.map((i) => `(${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},${q(requests[i])},${q(proposal)},${q(admin)},'active')`).join(",\n  ")};
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  ${paid.map((i) => `(${q(attempts[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},1,1,${q(revision)},'consumed',now()-interval '1 hour',now()-interval '58 minutes','test','w083-key-${i}','cs_test_w083session${i}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  ${paid.map((i) => `(${q(payments[i])},${q(attempts[i])},'test','pi_w083_${i}',2500,'USD','verified_paid',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at) values
  ${paid.map((i) => `(${q(seats[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(payments[i])},'confirmed',now()-interval '1 hour')`).join(",\n  ")};
update public.app_table_runtime set state='proceeding' where table_id='${table}';
set local request.jwt.claims='{"role":"service_role"}';
do $w083$ declare v jsonb; b jsonb; a jsonb; msg text; n integer; begin
  perform pg_temp.shift(130);
  -- ---- heartbeat and overview ------------------------------------------------------------------------------------
  begin perform public.read_admin_overview(${q(host)}); raise exception 'host read overview';
  exception when insufficient_privilege then null; end;
  begin perform public.read_admin_overview(${q(members[0])}); raise exception 'member read overview';
  exception when insufficient_privilege then null; end;
  delete from public.app_worker_heartbeats;
  v:=public.read_admin_overview(${q(admin)});
  if (v->'heartbeat'->>'healthy')::boolean or v->'heartbeat'->'ageMinutes' is distinct from 'null'::jsonb then raise exception 'heartbeat healthy with no runs %',v; end if;
  perform public.record_worker_heartbeat(true,'{"invitations":{"delivered":1}}'::jsonb);
  v:=public.read_admin_overview(${q(admin)});
  if not (v->'heartbeat'->>'healthy')::boolean or (v->'heartbeat'->>'ageMinutes')::integer<>0 then raise exception 'fresh heartbeat unhealthy %',v; end if;
  update public.app_worker_heartbeats set last_run_at=clock_timestamp()-interval '11 minutes',last_ok_at=clock_timestamp()-interval '11 minutes';
  if (public.read_admin_overview(${q(admin)})->'heartbeat'->>'healthy')::boolean then raise exception 'stale heartbeat healthy'; end if;
  perform public.record_worker_heartbeat(false,'{"error":true}'::jsonb);
  v:=public.read_admin_overview(${q(admin)});
  if (v->'heartbeat'->>'ageMinutes')::integer<>0 or (select last_ok_at from public.app_worker_heartbeats)>clock_timestamp()-interval '10 minutes' then raise exception 'failed pass refreshed the last-ok time %',v; end if;
  update public.app_worker_heartbeats set last_ok_at=clock_timestamp()-interval '31 minutes';
  perform public.record_worker_heartbeat(false,'{"error":true}'::jsonb);
  if (public.read_admin_overview(${q(admin)})->'heartbeat'->>'healthy')::boolean then raise exception 'worker failing for over 30 minutes reported healthy'; end if;
  -- each queue count moves by exactly one when one matching row appears
  b:=public.read_admin_overview(${q(admin)})->'counts';
  insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game)
    values(${q(id(900))},'w083-lonely@vote.example','Lone','Wolf','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me');
  update public.app_member_profiles set identity_status='submitted',reviewed_identity_version=null where guest_id='${G}';
  insert into public.app_conduct_reports(operation_id,table_id,author_guest_id,body,created_at) values(${q(id(901))},'${table}','${A}','new report',now()),(${q(id(902))},'${table}','${B}','old report',now()-interval '13 months');
  insert into public.app_conduct_reports(operation_id,table_id,author_guest_id,body,created_at,held) values(${q(id(903))},'${table}','${C}','held old report',now()-interval '13 months',true);
  update public.app_supply_table_heads set sync_state='stale' where table_id='${table}';
  insert into public.app_seat_cancellation_requests(cancellation_request_id,seat_id,state,version,member_reason,host_flagged_at,host_flagged_by) values(${q(id(904))},'${seats[2]}','pending',1,'x',now(),${q(host)});
  insert into public.app_refund_obligations(obligation_id,payment_id,source,amount_cents,currency,state) values(${q(id(905))},'${payments[3]}','cancellation',500,'USD','open');
  insert into public.app_vote_periods(table_id,opens_at,closes_at) values('${table}',now()-interval '3 days',now()-interval '3 days'+interval '30 minutes');
  a:=public.read_admin_overview(${q(admin)})->'counts';
  for msg in select unnest(array['waitlistAwaitingInvite','identityReviews','supplyNeedsAttention','cancellationsPending','cancellationsFlagged','refundsOpen','votesNotFinalized']) loop
    if (a->>msg)::integer<>(b->>msg)::integer+1 then raise exception 'count % moved from % to %',msg,b->>msg,a->>msg; end if;
  end loop;
  if (a->>'conductReportsNew')::integer<>(b->>'conductReportsNew')::integer+3 then raise exception 'new reports count wrong'; end if;
  if (a->>'conductReportsReviewDue')::integer<>(b->>'conductReportsReviewDue')::integer+1 then raise exception 'review-due count must skip held reports'; end if;
  if a::text like '%report%@%' or a::text like '%Surname%' then raise exception 'overview carries names or text'; end if;
  delete from public.app_vote_periods where table_id='${table}';

  -- ---- retention -------------------------------------------------------------------------------------------------
  insert into public.app_ratings(table_id,guest_id,overall,note) values('${table}','${A}',5,'keep note'),('${table}','${B}',4,null);
  perform pg_temp.shift(60*24*100);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata,occurred_at) values('user',${q(admin)},'table.proceed.recorded','supply_table','${table}','{}'::jsonb,now()-interval '100 days'),
    ('user',${q(admin)},'table.proceed.recorded','supply_table','${table}','{}'::jsonb,now()-interval '10 days');
  v:=public.run_retention();
  if (v->>'ratingsAnonymized')::integer<>2 or (v->>'ratingsDeleted')::integer<>0 or (v->>'auditDeleted')::integer<1 then raise exception 'retention result wrong %',v; end if;
  if exists(select 1 from public.app_ratings where guest_id in ('${A}','${B}')) or (select count(*) from public.app_ratings where anonymized_at is not null)<>2 then raise exception 'ratings not de-identified'; end if;
  if (select count(*) from public.app_ratings where note='keep note')<>1 then raise exception 'anonymisation lost the rating itself'; end if;
  if exists(select 1 from public.app_audit_events where occurred_at<now()-interval '90 days') or not exists(select 1 from public.app_audit_events where occurred_at>now()-interval '30 days' and action='table.proceed.recorded') then raise exception 'audit expiry wrong'; end if;
  if (public.run_retention()->>'ratingsAnonymized')::integer<>0 then raise exception 'retention not idempotent'; end if;
  perform pg_temp.shift(60*24*400);
  v:=public.run_retention(); if (v->>'ratingsDeleted')::integer<>2 or exists(select 1 from public.app_ratings) then raise exception 'ratings kept past 12 months % %',v,(select count(*) from public.app_ratings); end if;
  perform pg_temp.shift(130);

  -- ---- conduct report deletion review ----------------------------------------------------------------------------
  begin perform public.delete_conduct_report(${q(host)},(select report_id from public.app_conduct_reports where operation_id=${q(id(902))})); raise exception 'host deleted a report';
  exception when insufficient_privilege then null; end;
  begin perform public.delete_conduct_report(${q(admin)},(select report_id from public.app_conduct_reports where operation_id=${q(id(903))})); raise exception 'held report deleted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'case_held' then raise; end if; end;
  begin perform public.delete_conduct_report(${q(admin)},(select report_id from public.app_conduct_reports where operation_id=${q(id(901))})); raise exception 'recent report deleted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'review_not_due' then raise; end if; end;
  perform public.delete_conduct_report(${q(admin)},(select report_id from public.app_conduct_reports where operation_id=${q(id(902))}));
  if exists(select 1 from public.app_conduct_reports where operation_id=${q(id(902))}) or exists(select 1 from public.app_audit_events where metadata::text ilike '%old report%') then raise exception 'report not deleted cleanly'; end if;

  -- ---- account deletion ------------------------------------------------------------------------------------------
  begin perform public.delete_member_account(${q(host)},'${G}'); raise exception 'host deleted an account';
  exception when insufficient_privilege then null; end;
  update public.app_table_runtime set state='proceeding' where table_id='${table}';
  begin perform public.delete_member_account(${q(admin)},'${A}'); raise exception 'account with a live paid Seat deleted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'active_seat_exists' then raise; end if; end;
  insert into public.app_table_requests(table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state)
    values('${table}','${G}',${q(members[6])},'W10',current_date+3,'19:00','Inman Park','pending');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(${q(id(950))},${q(members[6])},now(),now());
  v:=public.delete_member_account(${q(admin)},'${G}');
  if not (v->>'deleted')::boolean or (v->>'alreadyDeleted')::boolean then raise exception 'delete result wrong %',v; end if;
  if (select state from public.app_admissions where id=${q(admissions[6])})<>'deleted' or (select first_name||last_name from public.app_member_profiles where guest_id='${G}')<>'DeletedMember'
    or exists(select 1 from public.app_member_profiles where guest_id='${G}' and (phone is not null or one_liner is not null))
    or exists(select 1 from public.waitlist_signups where id=${q(signups[6])} and (email_normalized like '%vote.example' or last_name<>'Member')) then raise exception 'person not pseudonymised'; end if;
  if (select email from auth.users where id=${q(members[6])}) not like 'deleted+%' or (select banned_until from auth.users where id=${q(members[6])}) is null or exists(select 1 from auth.sessions where user_id=${q(members[6])}) then raise exception 'sign-in authority not ended'; end if;
  if exists(select 1 from public.app_table_requests where auth_user_id=${q(members[6])} and state='pending') then raise exception 'pending request survived'; end if;
  begin perform public.read_my_recap(${q(members[6])},'${table}'); raise exception 'deleted member still reads';
  exception when insufficient_privilege then null; end;
  if (public.delete_member_account(${q(admin)},'${G}')->>'alreadyDeleted')::boolean is not true then raise exception 'second delete not idempotent'; end if;
  begin perform public.delete_member_account(${q(admin)},${q(id(998))}); raise exception 'unknown guest deleted';
  exception when sqlstate 'P0002' then null; end;
  -- money and other guests survive: payments untouched, other members' profiles intact
  if (select count(*) from public.app_payments where state in ('verified_paid','refund_pending'))<6 or (select first_name from public.app_member_profiles where guest_id='${A}')<>'VoteA' then raise exception 'deletion touched other records'; end if;
  -- ---- 200+ row queues: overview counts, claim_notices batch drain (the paginated queue), notice problem list ------
  declare
    base_q integer; base_p integer; got uuid[]:='{}'; batch jsonb; total integer; b2 jsonb; a2 jsonb; ids uuid[]; lease uuid; nid uuid; att integer;
  begin
    -- overview counts stay exact with 250 synthetic waitlist rows
    b2:=public.read_admin_overview(${q(admin)})->'counts';
    insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game)
      select gen_random_uuid(),'w083-bulk-'||g||'@vote.example','Bulk','Row'||g,'1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me' from generate_series(1,250) g;
    a2:=public.read_admin_overview(${q(admin)})->'counts';
    if (a2->>'waitlistAwaitingInvite')::integer<>(b2->>'waitlistAwaitingInvite')::integer+250 then raise exception 'waitlist count with 250 rows: % -> %',b2->>'waitlistAwaitingInvite',a2->>'waitlistAwaitingInvite'; end if;

    -- 250 queued notices, plus whatever the fixture triggers queued: claim in batches of 20 until empty
    delete from public.app_notice_outbox where recipient_user_id=${q(members[6])};
    insert into public.app_notice_outbox(kind,recipient_user_id,dedupe_key,payload)
      select 't48_reminder',${q(members[0])},'w083-bulk:'||g,'{}'::jsonb from generate_series(1,250) g;
    select count(*) into total from public.app_notice_outbox where state='queued';
    if total<250 then raise exception 'seed failed %',total; end if;
    begin perform public.claim_notices(21); raise exception 'limit 21 accepted'; exception when sqlstate '22023' then null; end;
    begin perform public.claim_notices(0); raise exception 'limit 0 accepted'; exception when sqlstate '22023' then null; end;
    loop
      batch:=public.claim_notices(20);
      exit when jsonb_array_length(batch)=0;
      if jsonb_array_length(batch)>20 then raise exception 'batch over limit'; end if;
      ids:=array(select (e->>'noticeId')::uuid from jsonb_array_elements(batch) e);
      if ids && got then raise exception 'a notice was claimed twice across batches'; end if;
      got:=got||ids;
    end loop;
    if cardinality(got)<>total or (select count(distinct x) from unnest(got) x)<>total then raise exception 'drain returned % of % notices',cardinality(got),total; end if;
    if exists(select 1 from public.app_notice_outbox where state='queued' and next_attempt_at<=clock_timestamp()) or (select count(*) from public.app_notice_outbox where state='sending')<>total then raise exception 'drain left queued or mis-stated rows'; end if;

    -- worker died mid-send: expired leases become unknown, are never handed out again, and wait for an operator
    update public.app_notice_outbox set lease_until=clock_timestamp()-interval '1 second' where state='sending';
    batch:=public.claim_notices(20);
    if jsonb_array_length(batch)<>0 then raise exception 'expired lease re-sent automatically %',batch; end if;
    if (select count(*) from public.app_notice_outbox where state='unknown' and error_code='lease_expired' and lease_token is null)<>total or exists(select 1 from public.app_notice_outbox where state in ('queued','sending')) then raise exception 'abandoned leases not unknown'; end if;
    if jsonb_array_length(public.claim_notices(20))<>0 then raise exception 'unknown notice claimed on a later pass'; end if;
    perform public.enqueue_due_notices();
    if exists(select 1 from public.app_notice_outbox where state in ('queued','sending')) then raise exception 'enqueue re-queued an unknown notice'; end if;
    -- a late finish from the dead worker's stale lease is refused
    select notice_id into nid from public.app_notice_outbox where dedupe_key='w083-bulk:1';
    begin perform public.finish_notice(nid,gen_random_uuid(),'accepted',false,'m1',null); raise exception 'finish on abandoned notice accepted';
    exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'lease_lost' then raise; end if; end;
    -- operator list returns every row exactly once (it is unpaginated: 250+ items in one reply)
    v:=public.list_notice_problems(${q(admin)});
    if jsonb_array_length(v->'items')<>total or (select count(distinct i->>'noticeId') from jsonb_array_elements(v->'items') i)<>total then raise exception 'problem list % of %',jsonb_array_length(v->'items'),total; end if;
    -- operator retry re-queues exactly that notice once; attempt_count is capped below the limit
    select attempt_count into att from public.app_notice_outbox where notice_id=nid;
    perform public.resolve_notice(${q(admin)},nid,'retry');
    batch:=public.claim_notices(20);
    if jsonb_array_length(batch)<>1 or batch->0->>'noticeId'<>nid::text then raise exception 'retry not claimed exactly once %',batch; end if;
    perform public.finish_notice(nid,(batch->0->>'leaseToken')::uuid,'accepted',false,'m1',null);
    begin perform public.resolve_notice(${q(admin)},nid,'retry'); raise exception 'accepted notice re-queued';
    exception when sqlstate 'P0001' then null; end;
  end;
end $w083$;
rollback;`;
psql(sql);
assert.equal(psql(`select count(*) from public.waitlist_signups where email_normalized like 'w083-%'`), "0", "rollback left signups");
assert.equal(psql(`select count(*) from public.app_notice_outbox where dedupe_key like 'w083-bulk:%'`), "0", "rollback left notices");
assert.equal(psql(`select count(*) from public.app_conduct_reports where operation_id in (${[id(901), id(902), id(903)].map(q).join(",")})`), "0", "rollback left rows");
console.log("w10-ops-db-test: heartbeat health, overview counts move by exactly one and expose no text, ratings de-identified at 90 days and deleted at 12 months, audit expiry, idempotent retention, conduct deletion review (hold and age), account deletion (guards, pseudonymisation, sign-in ended, idempotent); rolled back.");
