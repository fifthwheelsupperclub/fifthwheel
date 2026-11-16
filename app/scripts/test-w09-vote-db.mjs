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
const id = (n) => `e0820000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
assert.equal(psql("select to_regprocedure('public.submit_ballot(uuid,uuid,uuid)') is not null"), "t", "apply 20261114210000 first");

const N = 7; // guests 0..5 hold paid Seats; guest 6 is admitted but never invited
const range = (base) => Array.from({ length: N }, (_, i) => id(base + i));
const admin = id(1), host = id(2), members = range(100), signups = range(120), admissions = range(140), guests = range(160), requests = range(180), invitations = range(200), attempts = range(220), payments = range(240), seats = range(260);
const table = id(41), revision = id(51), proposal = id(71), emails = members.map((_, i) => `w082-${i + 1}@vote.example`), venueIds = [id(300), id(301), id(302)];
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
-- second-granularity clock: start = now - s seconds (clock only moves forward, so elapsed >= s by microseconds)
create function pg_temp.shift_s(s numeric) returns void language plpgsql as $f$
begin
  update public.app_supply_table_revisions set content = content || jsonb_build_object(
    'localDate', to_char((clock_timestamp() - s * interval '1 second') at time zone 'America/New_York','YYYY-MM-DD'),
    'startLocalTime', to_char((clock_timestamp() - s * interval '1 second') at time zone 'America/New_York','HH24:MI:SS.US')) where revision_id='${revision}';
  update public.app_vote_periods set opens_at=app_private.table_start('${table}')+interval '90 minutes',closes_at=app_private.table_start('${table}')+interval '120 minutes';
  update public.app_mutual_results set expires_at=app_private.table_start('${table}')+interval '90 days';
  update public.app_table_attendance a set checked_in_at=app_private.table_start('${table}')+(case when a.guest_id='${E}' then 95 else 10 end)*interval '1 minute';
end $f$;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (${q(admin)},'authenticated','authenticated','w082-admin@vote.example',now(),'','{}','{}',now(),now()),
  (${q(host)},'authenticated','authenticated','w082-host@vote.example',now(),'','{}','{}',now(),now()),
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
  ${paid.map((i) => `(${q(attempts[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},1,1,${q(revision)},'consumed',now()-interval '1 hour',now()-interval '58 minutes','test','w082-key-${i}','cs_test_w082session${i}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  ${paid.map((i) => `(${q(payments[i])},${q(attempts[i])},'test','pi_w082_${i}',2500,'USD','verified_paid',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at) values
  ${paid.map((i) => `(${q(seats[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(payments[i])},'confirmed',now()-interval '1 hour')`).join(",\n  ")};
update public.app_table_runtime set state='proceeding' where table_id='${table}';
set local request.jwt.claims='{"role":"service_role"}';
do $w082$ declare v jsonb; msg text; elig uuid[]; elig2 uuid[]; t1 timestamptz; n integer; begin
  -- 100 minutes after start: on-time check-ins at start+10m for A-D, E late at start+95m, F never checked in
  perform pg_temp.shift(100);
  insert into public.app_table_attendance(table_id,seat_id,guest_id,checked_in_at,checked_in_by) values
    ${[0, 1, 2, 3].map((i) => `('${table}','${seats[i]}','${guests[i]}',(select ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York'+interval '10 minutes' from public.app_supply_table_revisions r where r.revision_id='${revision}'),${q(admin)})`).join(",\n    ")},
    ('${table}','${seats[4]}','${E}',(select ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York'+interval '95 minutes' from public.app_supply_table_revisions r where r.revision_id='${revision}'),${q(admin)});

  -- before open (start+30m): wait state, no ballots, no snapshot yet; non-seat holders and staff get nothing
  perform pg_temp.shift(30);
  v:=public.read_tonight(${q(members[0])},'${table}');
  if v->'vote'->>'state'<>'wait' or jsonb_array_length(v->'vote'->'candidates')<>0 or v->'vote'->'eligible' is distinct from 'null'::jsonb or v->'attendance'->>'checkedInAt' is null then raise exception 'wait view wrong %',v; end if;
  begin perform public.submit_ballot(${q(members[0])},'${table}',null); raise exception 'ballot before open';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'voting_not_open' then raise; end if; end;
  if exists(select 1 from public.app_vote_periods) then raise exception 'snapshot materialised before open'; end if;
  begin perform public.read_tonight(${q(members[6])},'${table}'); raise exception 'unseated member read Tonight';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.read_tonight(${q(host)},'${table}'); raise exception 'host read Tonight';
  exception when insufficient_privilege then null; end;
  begin perform public.submit_ballot(${q(host)},'${table}',null); raise exception 'host voted';
  exception when insufficient_privilege then null; end;
  perform pg_temp.shift(89);
  begin perform public.submit_ballot(${q(members[0])},'${table}',null); raise exception 'ballot at 89 minutes';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'voting_not_open' then raise; end if; end;
  -- second granularity: 89:59 refused, 90:00 accepted (half-open window); probe with a replay-safe null ballot on a voter checked in on time
  perform pg_temp.shift_s(5399);
  begin perform public.submit_ballot(${q(members[0])},'${table}',null); raise exception 'ballot at 89:59';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'voting_not_open' then raise; end if; end;
  if exists(select 1 from public.app_ballots) or exists(select 1 from public.app_vote_periods) then raise exception 'refused 89:59 ballot left state'; end if;
  perform pg_temp.shift_s(5400);
  if public.read_tonight(${q(members[0])},'${table}')->'vote'->>'state'<>'open' then raise exception 'not open at 90:00'; end if;
  perform pg_temp.shift_s(5400);
  perform public.submit_ballot(${q(members[3])},'${table}',null);
  delete from public.app_ballots; delete from public.app_ballot_eligibility where table_id='${table}'; delete from public.app_vote_periods where table_id='${table}';

  -- open at 90: snapshot holds exactly the on-time checked-in guests; delayed materialisation gives the identical set
  perform pg_temp.shift(90);
  v:=public.read_tonight(${q(members[0])},'${table}');
  if v->'vote'->>'state'<>'open' or not (v->'vote'->>'eligible')::boolean or jsonb_array_length(v->'vote'->'candidates')<>3 then raise exception 'open view wrong %',v; end if;
  if v::text like '%Surname%' or v::text like '%@vote.example%' or v::text like '%VoteE%' or v::text like '%VoteF%' then raise exception 'open view leaks or lists ineligible guests %',v; end if;
  select array_agg(guest_id order by guest_id) into elig from public.app_ballot_eligibility where table_id='${table}';
  if elig is distinct from array['${A}','${B}','${C}','${D}']::uuid[] then raise exception 'snapshot wrong %',elig; end if;
  delete from public.app_ballot_eligibility where table_id='${table}'; delete from public.app_vote_periods where table_id='${table}';
  perform pg_temp.shift(115);
  perform public.read_tonight(${q(members[0])},'${table}');
  select array_agg(guest_id order by guest_id) into elig2 from public.app_ballot_eligibility where table_id='${table}';
  if elig2 is distinct from elig then raise exception 'delayed snapshot differs from on-time snapshot'; end if;

  -- ineligible: late arrival E, never checked in F, unseated G
  begin perform public.submit_ballot(${q(members[4])},'${table}',null); raise exception 'late arrival voted';
  exception when insufficient_privilege then null; end;
  begin perform public.submit_ballot(${q(members[5])},'${table}',null); raise exception 'unchecked guest voted';
  exception when insufficient_privilege then null; end;
  v:=public.read_tonight(${q(members[4])},'${table}');
  if (v->'vote'->>'eligible')::boolean or jsonb_array_length(v->'vote'->'candidates')<>0 then raise exception 'late arrival sees a ballot'; end if;

  -- ballots: validity, immutability, replay
  begin perform public.submit_ballot(${q(members[0])},'${table}','${A}'); raise exception 'self vote';
  exception when sqlstate '22023' then null; end;
  begin perform public.submit_ballot(${q(members[0])},'${table}','${E}'); raise exception 'vote for late arrival';
  exception when sqlstate '22023' then null; end;
  begin perform public.submit_ballot(${q(members[0])},'${table}','${G}'); raise exception 'vote for unseated member';
  exception when sqlstate '22023' then null; end;
  v:=public.submit_ballot(${q(members[0])},'${table}','${B}'); t1:=(v->>'submittedAt')::timestamptz;
  if v::text like '%${B}%' then raise exception 'receipt reveals the choice'; end if;
  if (public.submit_ballot(${q(members[0])},'${table}','${B}')->>'submittedAt')::timestamptz<>t1 then raise exception 'replay moved submittedAt'; end if;
  begin perform public.submit_ballot(${q(members[0])},'${table}','${C}'); raise exception 'changed ballot accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'ballot_conflict' then raise; end if; end;
  begin perform public.submit_ballot(${q(members[0])},'${table}',null); raise exception 'changed to Nobody accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'ballot_conflict' then raise; end if; end;
  perform public.submit_ballot(${q(members[1])},'${table}','${A}');
  perform public.submit_ballot(${q(members[2])},'${table}',null);
  if (select count(*) from public.app_ballots where table_id='${table}')<>3 then raise exception 'ballot rows wrong'; end if;
  -- no reveal while the window is open
  if public.read_my_reveal(${q(members[0])},'${table}')->>'state'<>'pending' then raise exception 'reveal before close'; end if;
  if exists(select 1 from public.app_mutual_results) then raise exception 'results materialised before close'; end if;
  -- 119 minutes: still accepted; D votes for A (one-way)
  perform pg_temp.shift(119);
  perform public.submit_ballot(${q(members[3])},'${table}','${A}');
  -- 119:59 still accepted (replay of an existing ballot proves the window check passed), 120:00 refused
  perform pg_temp.shift_s(7199);
  perform public.submit_ballot(${q(members[3])},'${table}','${A}');
  perform pg_temp.shift_s(7200);
  begin perform public.submit_ballot(${q(members[3])},'${table}','${A}'); raise exception 'ballot at 120:00';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'voting_closed' then raise; end if; end;
  -- 120 minutes: closed
  perform pg_temp.shift(120);
  begin perform public.submit_ballot(${q(members[1])},'${table}','${A}'); raise exception 'ballot at close';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'voting_closed' then raise; end if; end;
  if public.read_tonight(${q(members[0])},'${table}')->'vote'->>'state'<>'closed' then raise exception 'closed state wrong'; end if;

  -- finalisation interrupted midway (aborted subtransaction) leaves nothing; the retry and a repeat call give one result set
  begin
    perform app_private.finalize_vote_period('${table}');
    if (select count(*) from public.app_mutual_results)<>4 then raise exception 'finalizer wrote % rows',(select count(*) from public.app_mutual_results); end if;
    raise exception using errcode='57014',message='simulated_crash';
  exception when sqlstate '57014' then null; end;
  if exists(select 1 from public.app_mutual_results) or (select finalized_at from public.app_vote_periods) is not null then raise exception 'aborted finalisation left partial state'; end if;
  perform app_private.finalize_vote_period('${table}');
  select finalized_at into t1 from public.app_vote_periods;
  perform app_private.finalize_vote_period('${table}');
  if t1 is null or (select finalized_at from public.app_vote_periods)<>t1 or (select count(*) from public.app_mutual_results)<>4
     or (select count(distinct guest_id) from public.app_mutual_results)<>4
     or (select count(*) from public.app_mutual_results where guest_id='${A}' and counterpart_guest_id='${B}')<>1
     or (select count(*) from public.app_mutual_results where guest_id='${B}' and counterpart_guest_id='${A}')<>1 then raise exception 'finalisation not single-result after retry'; end if;

  -- reveal: own mutual pair only; Nobody, one-way and no-ballot look identical; ineligible people are refused
  v:=public.read_my_reveal(${q(members[0])},'${table}');
  if v->>'state' is distinct from 'revealed' or v->'match'->>'guestId' is distinct from '${B}' or v->'match'->>'firstName' is distinct from 'VoteB' or v::text like '%Surname%' or v::text like '%${D}%' or v::text like '%${C}%' then raise exception 'A reveal wrong %',v; end if;
  if public.read_my_reveal(${q(members[1])},'${table}')->'match'->>'guestId' is distinct from '${A}' then raise exception 'B reveal wrong'; end if;
  if public.read_my_reveal(${q(members[2])},'${table}') is distinct from jsonb_build_object('state','revealed','match',null) then raise exception 'Nobody reveal wrong'; end if;
  if public.read_my_reveal(${q(members[3])},'${table}') is distinct from jsonb_build_object('state','revealed','match',null) then raise exception 'one-way reveal differs from empty'; end if;
  begin perform public.read_my_reveal(${q(members[4])},'${table}'); raise exception 'late arrival read reveal';
  exception when insufficient_privilege then null; end;
  begin perform public.read_my_reveal(${q(members[5])},'${table}'); raise exception 'unchecked guest read reveal';
  exception when insufficient_privilege then null; end;
  begin perform public.read_my_reveal(${q(members[6])},'${table}'); raise exception 'unseated member read reveal';
  exception when insufficient_privilege then null; end;
  begin perform public.read_my_reveal(${q(host)},'${table}'); raise exception 'host read reveal';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.app_mutual_results;
  perform public.read_my_reveal(${q(members[0])},'${table}');
  if n<>4 or (select count(*) from public.app_mutual_results)<>4 or (select finalized_at from public.app_vote_periods) is null then raise exception 'finalisation not idempotent or incomplete n=% rows=% fin=%',n,(select count(*) from public.app_mutual_results),(select finalized_at from public.app_vote_periods); end if;
  -- table privileges: the database exposes nothing to client roles
  if exists(select 1 from unnest(array['app_vote_periods','app_ballot_eligibility','app_ballots','app_mutual_results','app_ratings','app_conduct_reports']) t
      where has_table_privilege('anon','public.'||t,'select') or has_table_privilege('authenticated','public.'||t,'select')) then raise exception 'client role can read vote/feedback tables'; end if;

  -- ratings and recap (after close): attended guests only, editable, validated, no duplicates
  begin perform public.save_rating(${q(members[5])},'${table}',4,'{}'::jsonb,null); raise exception 'unattended guest rated';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'feedback_not_open' then raise; end if; end;
  begin perform public.save_rating(${q(members[6])},'${table}',4,'{}'::jsonb,null); raise exception 'unseated member rated';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.save_rating(${q(members[0])},'${table}',6,'{}'::jsonb,null); raise exception 'score 6 accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_rating(${q(members[0])},'${table}',4,jsonb_build_object('${id(999)}',3),null); raise exception 'unknown venue accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_rating(${q(members[0])},'${table}',4,jsonb_build_object('${venueIds[0]}',0),null); raise exception 'venue score 0 accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_rating(${q(members[0])},'${table}',4,'{}'::jsonb,repeat('x',2001)); raise exception 'long note accepted';
  exception when sqlstate '22023' then null; end;
  perform public.save_rating(${q(members[0])},'${table}',4,jsonb_build_object('${venueIds[0]}',5,'${venueIds[1]}',3),'Lovely evening');
  v:=public.save_rating(${q(members[0])},'${table}',5,jsonb_build_object('${venueIds[0]}',5),'Edited');
  if (select count(*) from public.app_ratings where table_id='${table}' and guest_id='${A}')<>1 or v->>'note'<>'Edited' or (v->>'overall')::integer<>5 then raise exception 'rating not editable in place'; end if;
  perform public.save_rating(${q(members[4])},'${table}',3,'{}'::jsonb,null);  -- E attended late and may still rate
  v:=public.read_my_recap(${q(members[0])},'${table}');
  if not (v->>'canSubmit')::boolean or jsonb_array_length(v->'attendees')<>4 or v->'rating'->>'note'<>'Edited' or jsonb_array_length(v->'venues')<>3 or v::text like '%Surname%' then raise exception 'recap wrong %',v; end if;
  -- aggregates suppress small groups and never carry free text
  v:=public.read_rating_aggregates(${q(admin)});
  if v->'tables'->0->'overallAverage' is distinct from 'null'::jsonb or v::text like '%Edited%' or v::text like '%Lovely%' then raise exception 'small-group aggregate not suppressed %',v; end if;
  perform public.save_rating(${q(members[1])},'${table}',3,'{}'::jsonb,'private note');
  v:=public.read_rating_aggregates(${q(admin)});
  if (v->'tables'->0->>'overallAverage')::numeric<>3.67 or v::text like '%private note%' then raise exception 'aggregate wrong %',v; end if;
  begin perform public.read_rating_aggregates(${q(host)}); raise exception 'host read aggregates';
  exception when insufficient_privilege then null; end;

  -- conduct reports: separate, private, idempotent, admin-only triage, nothing in audit
  v:=public.submit_conduct_report(${q(members[0])},'${table}','${B}','Said something harassing at dinner',${q(ops[0])});
  if public.submit_conduct_report(${q(members[0])},'${table}','${B}','Said something harassing at dinner',${q(ops[0])})<>v then raise exception 'report replay differed'; end if;
  begin perform public.submit_conduct_report(${q(members[0])},'${table}','${B}','A different body',${q(ops[0])}); raise exception 'changed report body replayed';
  exception when unique_violation then get stacked diagnostics msg=message_text; if msg<>'operation_conflict' then raise; end if; end;
  begin perform public.submit_conduct_report(${q(members[0])},'${table}','${F}','x',${q(ops[1])}); raise exception 'report about a non-attendee';
  exception when sqlstate '22023' then null; end;
  begin perform public.submit_conduct_report(${q(members[0])},'${table}','${A}','x',${q(ops[1])}); raise exception 'report about self';
  exception when sqlstate '22023' then null; end;
  begin perform public.submit_conduct_report(${q(members[5])},'${table}',null,'x',${q(ops[1])}); raise exception 'unattended guest reported';
  exception when sqlstate 'P0001' then null; end;
  perform public.submit_conduct_report(${q(members[4])},'${table}',null,'General concern',${q(ops[2])});
  if (select count(*) from public.app_conduct_reports)<>2 then raise exception 'report rows wrong'; end if;
  v:=public.read_my_recap(${q(members[0])},'${table}');
  if jsonb_array_length(v->'reports')<>1 or v::text like '%harassing%' or v->'reports'->0 ? 'body' or v->'reports'->0 ? 'subject' then raise exception 'recap exposes report content %',v; end if;
  v:=public.list_conduct_reports(${q(admin)});
  if jsonb_array_length(v->'items')<>2 or v::text not like '%harassing%' then raise exception 'admin cannot read reports'; end if;
  begin perform public.list_conduct_reports(${q(host)}); raise exception 'host read reports';
  exception when insufficient_privilege then null; end;
  begin perform public.list_conduct_reports(${q(members[0])}); raise exception 'member read reports';
  exception when insufficient_privilege then null; end;
  begin perform public.update_conduct_report(${q(host)},(select report_id from public.app_conduct_reports limit 1),'reviewing',false); raise exception 'host triaged';
  exception when insufficient_privilege then null; end;
  perform public.update_conduct_report(${q(admin)},(select report_id from public.app_conduct_reports order by created_at limit 1),'reviewing',true);
  if (select count(*) from public.app_conduct_reports where status='reviewing' and held)<>1 then raise exception 'triage not stored'; end if;
  if exists(select 1 from public.app_audit_events where metadata::text ilike '%harass%' or metadata::text ilike '%General concern%' or (action like 'conduct.%' and actor_user_id in (${q(members[0])},${q(members[4])}))) then raise exception 'report text or reporter present in audit'; end if;

  -- removal invalidates both sides of a mutual result
  update public.app_seats set state='cancelled',cancelled_at=now() where seat_id='${seats[1]}';
  if public.read_my_reveal(${q(members[0])},'${table}') is distinct from jsonb_build_object('state','revealed','match',null) then raise exception 'removed guest still exposed as a match'; end if;
  if (select count(*) from public.app_mutual_results where invalidated_at is not null)<2 then raise exception 'both sides not invalidated'; end if;
  begin perform public.submit_ballot(${q(members[1])},'${table}',null); raise exception 'removed guest voted';
  exception when sqlstate 'P0002' then null; end;

  -- retention: ballots purged after 30 days, results unavailable (not "no match") after 90 days
  perform pg_temp.shift(60*24*31);
  v:=public.purge_vote_data();
  if (v->>'ballotsDeleted')::integer<>4 or (v->>'resultsDeleted')::integer<>0 or exists(select 1 from public.app_ballots) or not exists(select 1 from public.app_mutual_results) then raise exception 'ballot purge wrong %',v; end if;
  if public.read_my_reveal(${q(members[2])},'${table}')->>'state'<>'revealed' then raise exception 'result lost before expiry'; end if;
  perform pg_temp.shift(60*24*91);
  if public.read_my_reveal(${q(members[2])},'${table}')->>'state'<>'results_unavailable' then raise exception 'expired result not reported unavailable'; end if;
  v:=public.purge_vote_data();
  if (v->>'resultsDeleted')::integer<>4 then raise exception 'result purge wrong %',v; end if;
end $w082$;
rollback;`;
psql(sql);
assert.equal(psql(`select count(*) from public.app_conduct_reports`), "0", "rollback left rows");
console.log("w09-vote-db-test: wait/open/closed windows, frozen on-time and delayed snapshots, late/unchecked/unseated/staff refusal, immutable ballots and replay, own-only reveal with indistinguishable empty results, removal invalidation, retention, ratings, aggregates, private conduct reports; rolled back.");
