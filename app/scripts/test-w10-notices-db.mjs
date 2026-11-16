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
const id = (n) => `e0840000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
assert.equal(psql("select to_regprocedure('public.claim_notices(integer)') is not null"), "t", "apply 20261115150000 first");

const N = 7; // guests 0..5 hold paid Seats; guest 6 is admitted but never invited
const range = (base) => Array.from({ length: N }, (_, i) => id(base + i));
const admin = id(1), host = id(2), members = range(100), signups = range(120), admissions = range(140), guests = range(160), requests = range(180), invitations = range(200), attempts = range(220), payments = range(240), seats = range(260);
const table = id(41), revision = id(51), proposal = id(71), emails = members.map((_, i) => `w084-${i + 1}@vote.example`), venueIds = [id(300), id(301), id(302)];
const [A, B, C, D, E, F, G] = guests;
const paid = [0, 1, 2, 3, 4, 5];
assert.equal(psql(`select count(*) from auth.users where id in (${[admin, host, ...members].map(q).join(",")})`), "0", "fixture collision");
const sql = `begin;
select set_config('app.skip_waitlist_confirmation','on',true); -- fixture signups need no confirmation email
update public.app_notice_outbox set next_attempt_at=clock_timestamp()+interval '1 year' where state='queued'; -- other runs' queued email stays out of these claims
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
  (${q(admin)},'authenticated','authenticated','w084-admin@vote.example',now(),'','{}','{}',now(),now()),
  (${q(host)},'authenticated','authenticated','w084-host@vote.example',now(),'','{}','{}',now(),now()),
  ${members.map((u, i) => `(${q(u)},'authenticated','authenticated',${q(emails[i])},now(),'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values (${q(admin)},'admin'),(${q(host)},'host');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((_, i) => `(${q(signups[i])},${q(emails[i])},'Vote${"ABCDEFG"[i]}','Surname${i}','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  ${members.map((u, i) => `(${q(admissions[i])},${q(signups[i])},${q(emails[i])},'activated',${q(admin)},${q(u)},now())`).join(",\n  ")};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((u, i) => `(${q(guests[i])},${q(u)},${q(admissions[i])},'Vote${"ABCDEFG"[i]}','Surname${i}','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
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
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision) values
  ${paid.map((i) => `(${q(proposal)},${q(requests[i])},${q(guests[i])},1)`).join(",\n  ")};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  ${paid.map((i) => `(${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},${q(requests[i])},${q(proposal)},${q(admin)},'active')`).join(",\n  ")};
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  ${paid.map((i) => `(${q(attempts[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},1,1,${q(revision)},'consumed',now()-interval '1 hour',now()-interval '58 minutes','test','w084-key-${i}','cs_test_w084session${i}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  ${paid.map((i) => `(${q(payments[i])},${q(attempts[i])},'test','pi_w084_${i}',2500,'USD','verified_paid',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at) values
  ${paid.map((i) => `(${q(seats[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(payments[i])},'confirmed',now()-interval '1 hour')`).join(",\n  ")};
update public.app_table_runtime set state='proceeding' where table_id='${table}';
set local request.jwt.claims='{"role":"service_role"}';
do $w084$ declare v jsonb; items jsonb; n integer; nid uuid; lease uuid; msg text; begin
  -- seat confirmations were queued by the Seat inserts; dedupe keys make a second queue a no-op
  if (select count(*) from public.app_notice_outbox where kind='seat_confirmed')<>6 then raise exception 'seat notices wrong'; end if;
  perform app_private.queue_notice('seat_confirmed',${q(members[0])},'seat:${seats[0]}:confirmed','{}'::jsonb);
  if (select count(*) from public.app_notice_outbox where kind='seat_confirmed')<>6 then raise exception 'dedupe failed'; end if;

  -- T-48: the unpaid invitation holder (G) is reminded once, paid guests are not
  insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state)
    values(${q(id(700))},'${table}','${G}',${q(members[6])},'W10',current_date,'19:00','Inman Park','pending');
  insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision) values(${q(proposal)},${q(id(700))},'${G}',1);
  insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values(${q(id(701))},'${table}','${G}',${q(members[6])},${q(id(700))},${q(proposal)},${q(admin)},'active');
  perform pg_temp.shift(-60*60);
  if (public.enqueue_due_notices()->>'t48Queued')::integer<>0 then raise exception 'reminder queued 60 hours out'; end if;
  perform pg_temp.shift(-60*30);
  if (public.enqueue_due_notices()->>'t48Queued')::integer<>1 or (select recipient_user_id from public.app_notice_outbox where kind='t48_reminder')<>${q(members[6])} then raise exception 'T-48 reminder wrong'; end if;
  if (public.enqueue_due_notices()->>'t48Queued')::integer<>0 then raise exception 'T-48 reminder repeated'; end if;
  begin perform public.enqueue_due_notices(); perform public.claim_notices(0); raise exception 'bad limit accepted';
  exception when sqlstate '22023' then null; end;

  -- claim: leased, bounded, no tokens or ballots in the context
  items:=public.claim_notices(3);
  if jsonb_array_length(items)<>3 or exists(select 1 from jsonb_array_elements(items) i where i->>'to' is null or (i->>'gone')::boolean or i->'context'->>'tableTitle' is distinct from 'W09 Table') then raise exception 'claim wrong %',items; end if;
  if items::text ilike '%token_hash%' or items::text ilike '%ballot%' then raise exception 'claim leaks'; end if;
  if (select count(*) from public.app_notice_outbox where state='sending')<>3 then raise exception 'claimed rows not leased'; end if;
  if jsonb_array_length(public.claim_notices(20))<>4 then raise exception 'second claim should take the remaining four'; end if;
  if jsonb_array_length(public.claim_notices(20))<>0 then raise exception 'claimed rows handed out twice'; end if;

  -- finish: accepted, retry with backoff, exhausted, unknown, lost lease
  select (i->>'noticeId')::uuid,(i->>'leaseToken')::uuid into nid,lease from jsonb_array_elements(items) i limit 1;
  begin perform public.finish_notice(nid,${q(id(990))},'accepted',false,'abc',null); raise exception 'wrong lease accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'lease_lost' then raise; end if; end;
  perform public.finish_notice(nid,lease,'accepted',false,'msg_1',null);
  if (select state||':'||provider_message_id from public.app_notice_outbox where notice_id=nid)<>'accepted:msg_1' then raise exception 'accept not stored'; end if;
  begin perform public.finish_notice(nid,lease,'failed',true,null,null); raise exception 'finished twice';
  exception when sqlstate 'P0001' then null; end;
  select (i->>'noticeId')::uuid,(i->>'leaseToken')::uuid into nid,lease from jsonb_array_elements(items) i offset 1 limit 1;
  perform public.finish_notice(nid,lease,'failed',true,null,'provider_busy');
  if (select state from public.app_notice_outbox where notice_id=nid)<>'queued' or (select next_attempt_at from public.app_notice_outbox where notice_id=nid)<=clock_timestamp()+interval '30 seconds' then raise exception 'retry not backed off'; end if;
  if jsonb_array_length(public.claim_notices(20))<>0 then raise exception 'backed-off notice claimed early'; end if;
  update public.app_notice_outbox set next_attempt_at=clock_timestamp() where notice_id=nid;
  for n in 2..8 loop
    items:=public.claim_notices(20);
    select (i->>'leaseToken')::uuid into lease from jsonb_array_elements(items) i where (i->>'noticeId')::uuid=nid;
    perform public.finish_notice(nid,lease,'failed',true,null,'provider_busy');
    update public.app_notice_outbox set next_attempt_at=clock_timestamp() where notice_id=nid and state='queued';
  end loop;
  if (select state||':'||attempt_count from public.app_notice_outbox where notice_id=nid)<>'failed:8' then raise exception 'eight failures did not stop automatic retries: %',(select state||':'||attempt_count from public.app_notice_outbox where notice_id=nid); end if;
  select (i->>'noticeId')::uuid,(i->>'leaseToken')::uuid into nid,lease from jsonb_array_elements(items) i where false;
  update public.app_notice_outbox set state='queued',next_attempt_at=clock_timestamp() where kind='seat_confirmed' and state='accepted' and false;
  -- unknown stays unknown; an abandoned lease becomes unknown, never a silent resend
  update public.app_notice_outbox set state='queued',attempt_count=0,next_attempt_at=clock_timestamp() where notice_id in (select notice_id from public.app_notice_outbox where kind='seat_confirmed' and state<>'accepted' order by notice_id limit 2);
  items:=public.claim_notices(2);
  select (i->>'noticeId')::uuid,(i->>'leaseToken')::uuid into nid,lease from jsonb_array_elements(items) i limit 1;
  perform public.finish_notice(nid,lease,'unknown',false,null,'resend_outcome_unknown');
  update public.app_notice_outbox set lease_until=clock_timestamp()-interval '1 minute' where state='sending';
  if jsonb_array_length(public.claim_notices(20))<>0 then raise exception 'unknown or abandoned notice re-sent'; end if;
  if (select count(*) from public.app_notice_outbox where state='unknown')<2 or not exists(select 1 from public.app_notice_outbox where error_code='lease_expired') then raise exception 'abandoned lease not marked unknown'; end if;

  -- operator view: no recipient address, only actionable states, retry or dismiss
  v:=public.list_notice_problems(${q(admin)});
  if jsonb_array_length(v->'items')<3 or v::text like '%@%' then raise exception 'problem list wrong %',v; end if;
  begin perform public.list_notice_problems(${q(host)}); raise exception 'host read problems';
  exception when insufficient_privilege then null; end;
  begin perform public.resolve_notice(${q(members[0])},(select notice_id from public.app_notice_outbox where state='unknown' limit 1),'retry'); raise exception 'member resolved';
  exception when insufficient_privilege then null; end;
  nid:=(select notice_id from public.app_notice_outbox where state='unknown' order by notice_id limit 1);
  if public.resolve_notice(${q(admin)},nid,'retry')->>'state'<>'queued' then raise exception 'retry did not requeue'; end if;
  nid:=(select notice_id from public.app_notice_outbox where state='unknown' order by notice_id limit 1);
  if public.resolve_notice(${q(admin)},nid,'dismiss')->>'state'<>'dismissed' then raise exception 'dismiss failed'; end if;
  begin perform public.resolve_notice(${q(admin)},(select notice_id from public.app_notice_outbox where state='accepted' limit 1),'retry'); raise exception 'accepted notice resent';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'notice_not_actionable' then raise; end if; end;

  -- producers: cancellation decision, removal, Table cancellation (and no double mail for a resolved request)
  insert into public.app_seat_cancellation_requests(cancellation_request_id,seat_id,state,version,member_reason,decided_at,decided_by,guest_safe_reason,refund_cents)
    values(${q(id(710))},'${seats[2]}','approved',2,'x',now(),${q(admin)},'Staff approved this',1500);
  insert into public.app_seat_cancellation_notice_outbox(cancellation_request_id,notice_kind,state) values(${q(id(710))},'decision','queued');
  select into v i from (select jsonb_array_elements(public.claim_notices(20)) i) q where i->>'kind'='cancellation_decision';
  if v->'context'->>'decision'<>'approved' or v->'context'->>'reason'<>'Staff approved this' or (v->'context'->>'refundCents')::integer<>1500 then raise exception 'decision context wrong %',v; end if;
  perform public.remove_and_replace(${q(admin)},'${invitations[5]}',${q(ops[0])},1,500,null);
  if (select (payload->>'refundCents')::integer from public.app_notice_outbox where kind='member_removed' and recipient_user_id=${q(members[5])})<>500 then raise exception 'removal notice missing'; end if;
  insert into public.app_seat_cancellation_requests(cancellation_request_id,seat_id,state,version,member_reason) values(${q(id(711))},'${seats[3]}','pending',1,'y');
  perform public.cancel_table(${q(admin)},'${table}',${q(ops[1])},'Venue closed');
  select count(*) into n from public.app_notice_outbox where kind='table_cancelled';
  if n<>6 then raise exception 'table cancelled notices wrong: %',n; end if;
  if exists(select 1 from public.app_notice_outbox where kind='cancellation_decision' and dedupe_key='cancel-decision:${id(711)}') then raise exception 'resolved request mailed twice'; end if;
  if exists(select 1 from public.app_notice_outbox where kind='table_cancelled' and recipient_user_id=${q(members[5])}) then raise exception 'removed guest told about the Table'; end if;

  -- a deleted account is flagged so the worker never mails it
  update public.app_table_runtime set state='proceeding' where table_id='${table}';
  update public.app_table_runtime set state='open' where table_id='${table}';
  perform public.delete_member_account(${q(admin)},'${G}');
  insert into public.app_notice_outbox(kind,recipient_user_id,dedupe_key,payload) values('t48_reminder',${q(members[6])},'gone-test','{}'::jsonb);
  select into v i from (select jsonb_array_elements(public.claim_notices(20)) i) q where i->>'to' like 'deleted+%';
  if v is null or not (v->>'gone')::boolean then raise exception 'deleted recipient not flagged %',v; end if;
end $w084$;
rollback;`;
psql(sql);
assert.equal(psql(`select count(*) from public.app_notice_outbox where recipient_user_id in (${members.map(q).join(",")})`), "0", "rollback left rows");
console.log("w10-notices-db-test: queue dedupe, T-48 once, bounded leased claims, accept/retry-backoff/exhaust/unknown/lost-lease, abandoned lease never resent, operator retry/dismiss, producers for decision/removal/Table cancellation without double mail, deleted recipients flagged; rolled back.");
