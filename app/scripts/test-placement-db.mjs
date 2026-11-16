#!/usr/bin/env node
// Rollback-only DB acceptance for staff placement and the waitlist confirmation email. Targets only the isolated local test stack.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const id = (n) => `e0850000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (x) => `'${x}'`;
const admin = id(1), host = id(2), table = id(41), revision = id(51);
// S0..S5 are real signups; S6 is a marketing test submission. S1 is a man open only to women, so S0 (open only to women) and S1 are not mutual.
const N = 7, signups = Array.from({ length: N }, (_, i) => id(100 + i)), users = Array.from({ length: N }, (_, i) => id(120 + i));
const emails = signups.map((_, i) => `w13-place-${i}@place.example`);
const ops = Array.from({ length: 12 }, (_, i) => id(200 + i));

function psql(sql) {
  const r = spawnSync("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}
const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m, "wrong local project");
assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "linked/hosted target forbidden");
assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "hosted project ref forbidden");
assert.equal(psql("select to_regprocedure('public.place_guest_at_table(uuid,uuid,uuid,uuid,uuid,boolean)') is not null"), "t", "apply 20261117100000 first");
assert.equal(psql(`select count(*) from auth.users where id in (${[admin, host, ...users].map(q).join(",")})`), "0", "fixture collision");

const place = (i, op, ack, user = users[i]) => `public.place_guest_at_table(${q(admin)},${q(signups[i])},${q(table)},${q(user)},${q(ops[op])},${ack})`;
const sql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (${q(admin)},'authenticated','authenticated','w13-admin@place.example',now(),'','{}','{}',now(),now()),
  (${q(host)},'authenticated','authenticated','w13-host@place.example',now(),'','{}','{}',now(),now()),
  ${users.map((u, i) => `(${q(u)},'authenticated','authenticated',${q(emails[i])},null,'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values (${q(admin)},'admin'),(${q(host)},'host');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game,is_test,received_at) values
  ${signups.map((s, i) => `(${q(s)},${q(emails[i])},'Place${i}','Guest','1990-01-01',${i === 1 ? "'Man'" : "'Woman'"},array['Women'],21,120,'Inman Park','Open','Yes, surprise me',${i === 6},now()-interval '${30 - i} days')`).join(",\n  ")};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${q(table)},'published','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  (${q(revision)},${q(table)},1,'published',jsonb_build_object('title','W13 Placement Table','localDate',to_char(current_date+30,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park',
    'stops',jsonb_build_array('{}','{}','{}')),${q(admin)});
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
set local request.jwt.claims='{"role":"service_role"}';
do $w13$ declare v jsonb; v2 jsonb; msg text; detail text; inv uuid; adm uuid; begin
  -- waitlist confirmation: one queued email per real signup; test signups and the legacy import queue nothing
  if (select count(*) from public.app_notice_outbox where kind='waitlist_confirmed' and payload->>'signupId' in (${signups.map(q).join(",")}))<>6 then raise exception 'confirmation emails not queued'; end if;
  if exists(select 1 from public.app_notice_outbox where payload->>'signupId'='${signups[6]}') then raise exception 'test signup got a confirmation'; end if;
  if (select recipient_email||':'||(recipient_user_id is null)::text from public.app_notice_outbox where payload->>'signupId'='${signups[0]}')<>'${emails[0]}:true' then raise exception 'confirmation not addressed to the email'; end if;
  perform set_config('app.skip_waitlist_confirmation','on',true);
  insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game)
    values(${q(id(150))},'w13-imported@place.example','Imported','Guest','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me');
  perform set_config('app.skip_waitlist_confirmation','',true);
  if exists(select 1 from public.app_notice_outbox where payload->>'signupId'='${id(150)}') then raise exception 'import queued a confirmation'; end if;
  update public.app_notice_outbox set next_attempt_at=clock_timestamp()+interval '1 year' where kind<>'waitlist_confirmed' or payload->>'signupId' not in (${signups.map(q).join(",")});
  v:=public.claim_notices(20);
  if not exists(select 1 from jsonb_array_elements(v) n where n->>'to'='${emails[0]}' and n->>'kind'='waitlist_confirmed' and not (n->>'gone')::boolean and n->'context'->>'firstName'='Place0') then raise exception 'confirmation claim wrong %',v; end if;

  -- queue: real signups only, oldest first; admin only
  v:=public.list_placement_queue(${q(admin)});
  if (select count(*) from jsonb_array_elements(v->'people') p where p->>'signupId' in (${signups.map(q).join(",")}))<>6
    or exists(select 1 from jsonb_array_elements(v->'people') p where p->>'signupId'='${signups[6]}') then raise exception 'queue membership wrong'; end if;
  if not exists(select 1 from jsonb_array_elements(v->'tables') t where t->>'tableId'='${table}' and (t->>'invitedCount')::integer=0) then raise exception 'table missing from queue'; end if;
  begin perform public.list_placement_queue(${q(host)}); raise exception 'host read the queue';
  exception when insufficient_privilege then null; end;
  begin perform ${place(0, 0, false).replace(q(admin), q(host))}; raise exception 'host placed a guest';
  exception when insufficient_privilege then null; end;

  -- first placement creates the admission, profile, request, roster revision 1, invitation and its email
  v:=${place(0, 0, false)};
  inv:=(v->>'invitationId')::uuid;
  if (v->>'rosterRevision')::integer<>1 or jsonb_array_length(v->'warnings')<>0 then raise exception 'first placement result wrong %',v; end if;
  select a.id into adm from public.app_admissions a where a.waitlist_signup_id='${signups[0]}' and a.state='invited' and a.approved_by=${q(admin)} and a.auth_user_id is null;
  if adm is null then raise exception 'admission not created as invited'; end if;
  if (select identity||':'||array_to_string(open_to,',')||':'||auth_user_id from public.app_member_profiles where admission_id=adm)<>'woman:woman:${users[0]}' then raise exception 'profile not mapped from the signup'; end if;
  if (select q.state||':'||q.placed_by from public.app_table_requests q join public.app_table_invitations i on i.source_request_id=q.request_id where i.invitation_id=inv)<>'pending:${admin}' then raise exception 'placement request wrong'; end if;
  if not exists(select 1 from public.app_table_invitation_outbox where invitation_id=inv and state='queued')
    or not (select protected_by_activity from public.app_supply_table_heads where table_id='${table}')
    or (select count(*) from public.app_audit_events where action='table.invitation.queued' and subject_id=inv)<>1 then raise exception 'invitation side effects wrong'; end if;
  if exists(select 1 from jsonb_array_elements(public.list_placement_queue(${q(admin)})->'people') p where p->>'signupId'='${signups[0]}') then raise exception 'placed guest still queued'; end if;
  -- the invitation email can be built before the guest ever signs in
  if public.read_table_invitation_delivery_context(inv)->>'recipientEmail'<>'${emails[0]}' then raise exception 'delivery context wrong'; end if;
  -- an invited (never signed in) guest may request a sign-in link
  if not public.claim_member_link_cooldown(adm,now(),300) then raise exception 'invited guest cannot get a sign-in link'; end if;

  -- replay, changed body, duplicate
  if ${place(0, 0, false)}<>v then raise exception 'replay differed'; end if;
  begin perform ${place(0, 0, true)}; raise exception 'changed body replayed';
  exception when unique_violation then get stacked diagnostics msg=message_text; if msg<>'operation_conflict' then raise; end if; end;
  begin perform ${place(0, 1, false)}; raise exception 'placed twice';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'already_invited' then raise; end if; end;

  -- preference rules warn until acknowledged; nothing is written by the refused call
  begin perform ${place(1, 2, false)}; raise exception 'warning not raised';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text, detail=pg_exception_detail;
    if msg<>'placement_warnings' or not (detail::jsonb->'issues') ? 'missing_mutual_open_connection' then raise exception 'warning wrong % %',msg,detail; end if; end;
  if exists(select 1 from public.app_admissions where waitlist_signup_id='${signups[1]}') then raise exception 'refused placement wrote rows'; end if;
  v:=${place(1, 3, true)};
  if (v->>'rosterRevision')::integer<>2 or not (v->'warnings') ? 'missing_mutual_open_connection' then raise exception 'acknowledged placement wrong %',v; end if;
  if (select count(*) from public.app_table_invitations i join public.app_table_roster_proposals p on p.proposal_id=i.proposal_id where i.table_id='${table}' and i.state='active' and p.revision=2)<>2
    or (select count(*) from public.app_table_roster_proposal_members m join public.app_table_roster_proposals p on p.proposal_id=m.proposal_id where p.table_id='${table}' and p.revision=2)<>2
    then raise exception 'earlier guest not carried to the new roster revision'; end if;

  -- identity checks, test signups, and the five-seat cap
  begin perform ${place(2, 4, true, users[3])}; raise exception 'mismatched Auth user accepted';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'auth_user_mismatch' then raise; end if; end;
  begin perform ${place(6, 5, true)}; raise exception 'test signup placed';
  exception when sqlstate 'P0002' then null; end;
  perform ${place(2, 6, true)}; perform ${place(3, 7, true)}; perform ${place(4, 8, true)};
  begin perform ${place(5, 9, true)}; raise exception 'sixth guest placed';
  exception when sqlstate 'P0001' then get stacked diagnostics msg=message_text; if msg<>'table_full' then raise; end if; end;

  -- after first sign-in the guest can check out on the current roster revision
  update auth.users set email_confirmed_at=now() where id='${users[0]}';
  if public.activate_app_admission(${q(users[0])},'${emails[0]}',now())->>'kind'<>'activated' then raise exception 'activation failed'; end if;
  v2:=app_private.checkout_invitation_context(${q(users[0])},inv);
  if (v2->>'proposalRevision')::integer<>5 or (v2->>'age')::integer<30 then raise exception 'checkout context wrong %',v2; end if;

  -- hosts see their assigned Tables
  insert into public.app_supply_table_assignments(table_id,user_id,assigned_by) values ('${table}',${q(host)},${q(admin)});
  if not exists(select 1 from jsonb_array_elements(public.list_host_tables(${q(host)})->'items') t where t->>'tableId'='${table}' and (t->>'invitedCount')::integer=5) then raise exception 'host table list wrong'; end if;
end $w13$;
rollback;`;
psql(sql);
assert.equal(psql(`select count(*) from public.app_ops_operations where operation_id in (${ops.map(q).join(",")})`), "0", "rollback left rows");
console.log("placement-db-test: confirmation email per real signup, queue, admin-only, first placement side effects, invited sign-in, replay/conflict/duplicate, warnings + acknowledge, roster carry-over, auth mismatch, test signup, five-seat cap, checkout after activation, host list; rolled back.");
