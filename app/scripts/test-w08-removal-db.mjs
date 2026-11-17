#!/usr/bin/env node
// W08.2 rollback-only DB acceptance for removal (replacements now come from the placement queue). Targets only the isolated local test stack; never migrates or contacts Stripe.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const id = (n) => `e0810000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), host = id(2), host2 = id(7), restaurant = id(8), restaurant2 = id(9), members = [id(3), id(4), id(5), id(6), id(10), id(15)];
const signups = [id(11), id(12), id(13), id(14), id(16), id(17)], admissions = [id(21), id(22), id(23), id(24), id(25), id(26)], guests = [id(31), id(32), id(33), id(34), id(35), id(36)];
const table = id(41), revision = id(51);
const requests = [id(63), id(64), id(65), id(66), id(67), id(68)], proposal = id(71), invitations = [id(81), id(82), id(83), id(84)];
const attempts = [id(91), id(92), id(93)], payments = [id(101)], seats = [id(111)];
const cancelRequest = id(121), ops = [id(141), id(142), id(143), id(144)];
const venue = id(60), venue2 = id(61);
const emails = members.map((_, i) => `w081-${i + 1}@ops.example`);
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
assert.equal(psql("select count(*) from public.app_ops_operations").length > 0 && psql("select to_regprocedure('public.remove_and_replace(uuid,uuid,uuid,integer,integer,uuid)') is not null") === "t", true, "apply 20261114180000 first");
assert.equal(psql(`select count(*) from auth.users where id in (${[admin, host, host2, restaurant, restaurant2, ...members].map(q).join(",")})`), "0", "fixture collision");

const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (${q(admin)},'authenticated','authenticated','w081-admin@ops.example',now(),'','{}','{}',now(),now()),
  (${q(host)},'authenticated','authenticated','w081-host@ops.example',now(),'','{}','{}',now(),now()),
  ${members.map((u, i) => `(${q(u)},'authenticated','authenticated',${q(emails[i])},now(),'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values (${q(admin)},'admin'),(${q(host)},'host');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((_, i) => `(${q(signups[i])},${q(emails[i])},'Swap${i + 1}','Guest','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  ${members.map((u, i) => `(${q(admissions[i])},${q(signups[i])},${q(emails[i])},'activated',${q(admin)},${q(u)},now())`).join(",\n  ")};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((u, i) => `(${q(guests[i])},${q(u)},${q(admissions[i])},'Swap${i + 1}','Guest','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${q(table)},'published','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  (${q(revision)},${q(table)},1,'published',jsonb_build_object('title','W08.2 Table','localDate',to_char(current_date+30,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park',
    'stops',jsonb_build_array('{}','{}','{}')),${q(admin)});
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state,created_at) values
  ${members.map((u, i) => `(${q(requests[i])},${q(table)},${q(guests[i])},${q(u)},'W08.2 Table',current_date+30,'19:00','Inman Park','pending',now()-interval '${10 - i} days')`).join(",\n  ")};
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
  (${q(proposal)},${q(table)},1,'approved',${q(revision)},'{}'::jsonb,${q(admin)},${q(admin)},${q(admin)},${q(admin)},now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision) values
  ${[0, 1, 2, 3].map((i) => `(${q(proposal)},${q(requests[i])},${q(guests[i])},1)`).join(",\n  ")};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  ${[0, 1, 2, 3].map((i) => `(${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},${q(requests[i])},${q(proposal)},${q(admin)},'active')`).join(",\n  ")};
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  ${[0, 1, 2].map((i) => `(${q(attempts[i])},${q(invitations[i])},${q(table)},${q(guests[i])},${q(members[i])},1,1,${q(revision)},${i === 0 ? "'consumed'" : "'open'"},
    ${i === 0 ? "now()-interval '1 hour',now()-interval '58 minutes'" : "now()+interval '20 minutes',now()+interval '21 minutes'"},'test','w081-key-${i + 1}','cs_test_w081session${i + 1}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  (${q(payments[0])},${q(attempts[0])},'test','pi_w081_1',2500,'USD','verified_paid',now()-interval '1 hour');
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at) values
  (${q(seats[0])},${q(invitations[0])},${q(table)},${q(guests[0])},${q(payments[0])},'confirmed',now()-interval '1 hour');
set local request.jwt.claims='{"role":"service_role"}';
do $w081$ declare v jsonb; msg text; begin
  -- the removal dialog reads the expected revision; no candidate is ever suggested any more
  v:=public.suggest_replacement(${q(admin)},'${invitations[0]}');
  if v->'candidate' is distinct from 'null'::jsonb or not (v->>'remainingValid')::boolean or (v->>'expectedRevision')::integer<>1 then raise exception 'suggestion wrong %',v; end if;
  begin perform public.suggest_replacement(${q(host)},'${invitations[0]}'); raise exception 'host asked for a suggestion';
  exception when insufficient_privilege then null; end;
  begin perform public.remove_and_replace(${q(host)},'${invitations[0]}',${q(ops[0])},1,0,null); raise exception 'host removed a guest';
  exception when insufficient_privilege then null; end;

  -- guards before anything changes
  begin perform public.remove_and_replace(${q(admin)},'${invitations[0]}',${q(ops[0])},7,0,null); raise exception 'stale revision accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'revision_conflict' then raise; end if; end;
  begin perform public.remove_and_replace(${q(admin)},'${invitations[0]}',${q(ops[0])},1,2501,null); raise exception 'refund above price accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.remove_and_replace(${q(admin)},'${invitations[0]}',${q(ops[0])},1,0,'${requests[4]}'); raise exception 'replacement accepted';
  exception when sqlstate '22023' then null; end;

  -- paid guest removed with a partial refund; the three left still form a valid roster, so a new approved revision carries them
  v:=public.remove_and_replace(${q(admin)},'${invitations[0]}',${q(ops[0])},1,1500,null);
  if not (v->'removal'->>'seatCancelled')::boolean or (v->'removal'->>'refundCents')::integer<>1500 or v->'replacement'->>'state'<>'none'
    or (v->'roster'->>'revision')::integer<>2 or not (v->'roster'->>'valid')::boolean then raise exception 'removal result wrong %',v; end if;
  if (select state from public.app_table_invitations where invitation_id='${invitations[0]}')<>'revoked'
    or (select state from public.app_seats where seat_id='${seats[0]}')<>'cancelled'
    or (select state from public.app_table_requests where request_id='${requests[0]}')<>'declined' then raise exception 'removed guest state wrong'; end if;
  if (select amount_cents||':'||source from public.app_refund_obligations where payment_id='${payments[0]}')<>'1500:removal'
    or (select state from public.app_payments where payment_id='${payments[0]}')<>'refund_pending' then raise exception 'removal refund wrong'; end if;
  if (select count(*) from public.app_table_roster_proposals where table_id='${table}' and revision=2 and state='approved')<>1
    or (select count(*) from public.app_table_roster_proposal_members m join public.app_table_roster_proposals p on p.proposal_id=m.proposal_id where p.revision=2 and p.table_id='${table}')<>3
    or (select count(*) from public.app_table_invitations i join public.app_table_roster_proposals p on p.proposal_id=i.proposal_id where i.state='active' and p.revision=2 and i.table_id='${table}')<>3
    then raise exception 'new revision wrong'; end if;
  if (select proposal_revision from public.app_checkout_attempts where attempt_id='${attempts[2]}')<>2 then raise exception 'remaining open checkout not moved to the new revision'; end if;
  -- replay and changed body
  if public.remove_and_replace(${q(admin)},'${invitations[0]}',${q(ops[0])},1,1500,null)<>v then raise exception 'replay differed'; end if;
  begin perform public.remove_and_replace(${q(admin)},'${invitations[0]}',${q(ops[0])},1,0,null); raise exception 'changed body replayed';
  exception when unique_violation then get stacked diagnostics msg=message_text; if msg<>'operation_conflict' then raise; end if; end;
  if (select count(*) from public.app_audit_events where action='table.member.removed' and subject_id='${invitations[0]}')<>1
    or (select count(*) from public.app_refund_obligations where payment_id='${payments[0]}')<>1 then raise exception 'replay duplicated work'; end if;
  begin perform public.remove_and_replace(${q(admin)},'${invitations[0]}',${q(ops[1])},2,0,null); raise exception 'removed twice';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'invitation_not_removable' then raise; end if; end;

  -- removing below three still commits, but no new revision: the roster needs review
  v:=public.remove_and_replace(${q(admin)},'${invitations[1]}',${q(ops[1])},2,0,null);
  if (v->'roster'->>'valid')::boolean or not (v->'roster'->>'needsReview')::boolean or (v->'roster'->>'revision')::integer<>2 then raise exception 'short roster outcome wrong %',v; end if;
  if (select state from public.app_table_invitations where invitation_id='${invitations[1]}')<>'revoked'
    or (select state from public.app_checkout_attempts where attempt_id='${attempts[1]}')<>'released' then raise exception 'short roster removal state wrong'; end if;
  if (select count(*) from public.app_table_roster_proposals where table_id='${table}')<>2 then raise exception 'invalid roster still got a revision'; end if;
  -- unpaid removal cannot carry a refund
  begin perform public.remove_and_replace(${q(admin)},'${invitations[2]}',${q(ops[2])},2,100,null); raise exception 'refund on an unpaid removal';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'refund_amount_exceeds_balance' then raise; end if; end;
  -- a cancelled Table cannot be edited
  update public.app_table_runtime set state='cancelled' where table_id='${table}';
  begin perform public.remove_and_replace(${q(admin)},'${invitations[2]}',${q(ops[3])},2,0,null); raise exception 'removal on a cancelled Table';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'table_not_active' then raise; end if; end;
end $w081$;
rollback;`;
psql(sql);
assert.equal(psql(`select count(*) from public.app_ops_operations where operation_id in (${ops.map(q).join(",")})`), "0", "rollback left rows");
console.log("w08-removal-db-test: no suggested candidate, admin-only, revision/refund/replacement guards, paid removal + refund, new approved revision, replay/conflict, short roster needs review; rolled back.");
