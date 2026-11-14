#!/usr/bin/env node

// W07.4 rollback-by-exact-cleanup DB acceptance. Do not run until the coordinator
// explicitly authorizes it after migration review. Never resets, seeds, migrates,
// or contacts a provider. Synthetic fixture emails use the reserved .example domain.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migration = "20261113195200";
const runLock = join(workdir, ".seat-cancellations-db-test.lock");
const id = (n) => `e0740000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), host = id(2);
const members = [id(3), id(4), id(5), id(6)];
const signups = [id(11), id(12), id(13), id(14)];
const admissions = [id(21), id(22), id(23), id(24)];
const guests = [id(31), id(32), id(33), id(34)];
const tables = [id(41), id(42), id(43), id(44)];
const revisions = [id(51), id(52), id(53), id(54)];
const tableRequests = [id(61), id(62), id(63), id(64)];
const proposals = [id(71), id(72), id(73), id(74)];
const invitations = [id(81), id(82), id(83), id(84)];
const attempts = [id(91), id(92), id(93), id(94)];
const paymentIds = [id(101), id(102), id(103), id(104)];
const seats = [id(111), id(112), id(113), id(114)];
const memberOps = [id(121), id(122), id(123), id(124), id(125)];
const decisionOps = [id(131), id(132), id(133), id(134)];
const emails = members.map((_, i) => `w074-cancellation-member-${i + 1}@cancellation.example`);
const adminEmail = "w074-cancellation-admin@cancellation.example";
const hostEmail = "w074-cancellation-host@cancellation.example";
const allIds = [admin, host, ...members, ...signups, ...admissions, ...guests, ...tables, ...revisions,
  ...tableRequests, ...proposals, ...invitations, ...attempts, ...paymentIds, ...seats, ...memberOps, ...decisionOps];
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const list = (values) => values.map(quote).join(",");

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, input, encoding: "utf8", env: {
    ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
  } });
  if (result.error) throw result.error;
  return result;
}
function runAsync(command, args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}
function psql(sql) {
  const result = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
function assertTarget() {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m, "wrong local test project");
  assert.match(config, /^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m, "wrong local test API port");
  assert.match(config, /^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m, "wrong local test database port");
  assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "linked/hosted target forbidden");
  for (const [name, expected] of [["SUPABASE_URL", api], ["SUPABASE_DB_URL", db], ["DATABASE_URL", db]]) {
    if (process.env[name]) assert.equal(process.env[name], expected, `mismatched ${name}`);
  }
  assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "hosted project reference forbidden");
  for (const file of [join(root, ".env.test.local"), join(workdir, ".env.test.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL|SUPABASE_URL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, name, raw] = match;
      const value = raw.replace(/^['"]|['"]$/g, "").replace(/\s+#.*$/, "");
      assert.notEqual(name, "SUPABASE_PROJECT_REF", `hosted project ref forbidden in ${file}`);
      assert.equal(value, name === "SUPABASE_URL" ? api : db, `mismatched ${name} in ${file}`);
    }
  }
  const local = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(local.status, 0, local.stderr || local.stdout);
  const status = run("supabase", ["status", "--workdir", workdir, "-o", "json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const parsed = JSON.parse(status.stdout.slice(status.stdout.indexOf("{"), status.stdout.lastIndexOf("}") + 1));
  assert.equal(parsed.API_URL, api); assert.equal(parsed.DB_URL, db);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr || history.stdout);
  assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                ")),
    `W07.4 migration ${migration} must be coordinator-applied before this harness is authorized; this script never applies it`);
}

function collisionCheck() {
  const outputs = psql(`select concat(
    (not exists(select 1 from auth.users where id in (${list(allIds)}) or email in (${list([adminEmail, hostEmail, ...emails])})))::text,'|',
    (not exists(select 1 from public.waitlist_signups where id in (${list(signups)}) or email_normalized in (${list(emails)})))::text,'|',
    (not exists(select 1 from public.app_admissions where id in (${list(admissions)}) or auth_user_id in (${list(members)})))::text,'|',
    (not exists(select 1 from public.app_member_profiles where guest_id in (${list(guests)}) or auth_user_id in (${list(members)})))::text,'|',
    (not exists(select 1 from public.app_user_roles where user_id in (${list([admin, host])})))::text,'|',
    (not exists(select 1 from public.app_supply_table_heads where table_id in (${list(tables)})))::text,'|',
    (not exists(select 1 from public.app_supply_table_revisions where revision_id in (${list(revisions)}) or table_id in (${list(tables)})))::text,'|',
    (not exists(select 1 from public.app_table_requests where request_id in (${list(tableRequests)}) or table_id in (${list(tables)})))::text,'|',
    (not exists(select 1 from public.app_table_roster_proposals where proposal_id in (${list(proposals)})))::text,'|',
    (not exists(select 1 from public.app_table_roster_proposal_members where proposal_id in (${list(proposals)})))::text,'|',
    (not exists(select 1 from public.app_table_invitations where invitation_id in (${list(invitations)})))::text,'|',
    (not exists(select 1 from public.app_table_invitation_outbox where invitation_id in (${list(invitations)})))::text,'|',
    (not exists(select 1 from public.app_checkout_attempts where attempt_id in (${list(attempts)}) or provider_session_id like 'cs_test_w074%'))::text,'|',
    (not exists(select 1 from public.app_payments where payment_id in (${list(paymentIds)}) or attempt_id in (${list(attempts)})))::text,'|',
    (not exists(select 1 from public.app_seats where seat_id in (${list(seats)}) or invitation_id in (${list(invitations)})))::text,'|',
    (not exists(select 1 from public.app_seat_cancellation_requests where seat_id in (${list(seats)})))::text,'|',
    (not exists(select 1 from public.app_seat_cancellation_operations where operation_id in (${list([...memberOps, ...decisionOps])})))::text,'|',
    (not exists(select 1 from public.app_seat_cancellation_notice_outbox where cancellation_request_id in
      (select cancellation_request_id from public.app_seat_cancellation_requests where seat_id in (${list(seats)}))))::text,'|',
    (not exists(select 1 from public.app_refund_obligations where payment_id in (${list(paymentIds)})))::text,'|',
    (not exists(select 1 from public.app_audit_events where operation_id in (${list([...memberOps, ...decisionOps])}) or subject_id in (${list(allIds)})))::text)`);
  assert.equal(outputs, Array(20).fill("true").join("|"), "refusing W07.4 synthetic fixture collision");
}

const setupSql = `begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (${quote(admin)},'authenticated','authenticated',${quote(adminEmail)},now(),'','{}','{}',now(),now()),
  (${quote(host)},'authenticated','authenticated',${quote(hostEmail)},now(),'','{}','{}',now(),now()),
  ${members.map((user, i) => `(${quote(user)},'authenticated','authenticated',${quote(emails[i])},now(),'','{}','{}',now(),now())`).join(",\n  ")};
insert into public.app_user_roles(user_id,role) values (${quote(admin)},'admin'),(${quote(host)},'host');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((_, i) => `(${quote(signups[i])},${quote(emails[i])},'W07','Guest ${i + 1}','1990-01-01','Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  ${members.map((user, i) => `(${quote(admissions[i])},${quote(signups[i])},${quote(emails[i])},'activated',${quote(admin)},${quote(user)},now())`).join(",\n  ")};
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  ${members.map((user, i) => `(${quote(guests[i])},${quote(user)},${quote(admissions[i])},'approved',1,1,'W07','Guest ${i + 1}','1990-01-01','woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me')`).join(",\n  ")};
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values
  ${tables.map((table) => `(${quote(table)},'published','current')`).join(",\n  ")};
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  ${tables.map((table, i) => `(${quote(revisions[i])},${quote(table)},1,'published',jsonb_build_object('title','W07.4 Table ${i + 1}','localDate',to_char(current_date+60,'YYYY-MM-DD'),'startLocalTime','19:00','neighborhood','Inman Park','stops',jsonb_build_array('{}','{}','{}')),${quote(admin)})`).join(",\n  ")};
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id;
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values
  ${tables.map((table, i) => `(${quote(tableRequests[i])},${quote(table)},${quote(guests[i])},${quote(members[i])},'W07.4 Table ${i + 1}',current_date+60,'19:00','Inman Park','pending')`).join(",\n  ")};
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
  ${tables.map((table, i) => `(${quote(proposals[i])},${quote(table)},1,'approved',${quote(revisions[i])},'{"valid":true,"issues":[]}'::jsonb,${quote(admin)},${quote(admin)},${quote(admin)},${quote(admin)},now(),now())`).join(",\n  ")};
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version) values
  ${tables.map((_, i) => `(${quote(proposals[i])},${quote(tableRequests[i])},${quote(guests[i])},1,1,1)`).join(",\n  ")};
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  ${tables.map((table, i) => `(${quote(invitations[i])},${quote(table)},${quote(guests[i])},${quote(members[i])},${quote(tableRequests[i])},${quote(proposals[i])},${quote(admin)},'active')`).join(",\n  ")};
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  ${tables.map((table, i) => `(${quote(attempts[i])},${quote(invitations[i])},${quote(table)},${quote(guests[i])},${quote(members[i])},1,1,${quote(revisions[i])},'consumed',now()-interval '1 hour',now()-interval '58 minutes','test','w074-key-${i + 1}','cs_test_w074session${i + 1}','seat-checkout-v1',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  ${tables.map((_, i) => `(${quote(paymentIds[i])},${quote(attempts[i])},'test','pi_w074_${i + 1}',2500,'USD','verified_paid',now()-interval '1 hour')`).join(",\n  ")};
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at) values
  ${tables.map((table, i) => `(${quote(seats[i])},${quote(invitations[i])},${quote(table)},${quote(guests[i])},${quote(paymentIds[i])},'confirmed',now()-interval '1 hour')`).join(",\n  ")};
commit;`;

const cleanupSql = `begin;
delete from public.app_seat_cancellation_notice_outbox where cancellation_request_id in
  (select cancellation_request_id from public.app_seat_cancellation_requests where seat_id in (${list(seats)}));
delete from public.app_seat_cancellation_operations where operation_id in (${list([...memberOps, ...decisionOps])});
delete from public.app_audit_events where operation_id in (${list([...memberOps, ...decisionOps])})
  or subject_id in (${list([...seats, ...invitations, ...tableRequests])});
delete from public.app_seat_cancellation_requests where seat_id in (${list(seats)});
delete from public.app_refund_obligations where payment_id in (${list(paymentIds)});
delete from public.app_seats where seat_id in (${list(seats)});
delete from public.app_payments where payment_id in (${list(paymentIds)});
delete from public.app_checkout_attempts where attempt_id in (${list(attempts)});
delete from public.app_table_invitation_outbox where invitation_id in (${list(invitations)});
delete from public.app_table_invitations where invitation_id in (${list(invitations)});
delete from public.app_table_roster_proposal_members where proposal_id in (${list(proposals)});
delete from public.app_table_roster_proposals where proposal_id in (${list(proposals)});
delete from public.app_table_requests where request_id in (${list(tableRequests)});
delete from public.app_table_runtime where table_id in (${list(tables)});
update public.app_supply_table_heads set published_revision_id=null where table_id in (${list(tables)});
delete from public.app_supply_table_revisions where revision_id in (${list(revisions)});
delete from public.app_supply_table_heads where table_id in (${list(tables)});
delete from public.app_user_roles where user_id in (${list([admin, host])});
delete from public.app_member_profiles where guest_id in (${list(guests)});
delete from public.app_admissions where id in (${list(admissions)});
delete from public.waitlist_signups where id in (${list(signups)});
delete from auth.users where id in (${list([admin, host, ...members])});
commit;`;

function cleanup() {
  const result = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", cleanupSql]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function main() {
  assertTarget();
  if (process.argv.includes("--cleanup-only")) { cleanup(); return; }
  try { writeFileSync(runLock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
  catch { throw new Error("W07.4 DB harness already running or lock file exists; inspect the isolated test stack first"); }
  let fixturesCommitted = false;
  try {
    collisionCheck();
    const privileges = psql(`select concat(
      (not has_function_privilege('anon','public.request_seat_cancellation(uuid,uuid,uuid,text)','EXECUTE'))::text,'|',
      (not has_function_privilege('authenticated','public.request_seat_cancellation(uuid,uuid,uuid,text)','EXECUTE'))::text,'|',
      has_function_privilege('service_role','public.request_seat_cancellation(uuid,uuid,uuid,text)','EXECUTE')::text,'|',
      (not has_table_privilege('anon','public.app_seat_cancellation_requests','SELECT'))::text,'|',
      (not has_table_privilege('authenticated','public.app_seat_cancellation_requests','SELECT'))::text)`);
    assert.equal(privileges, "true|true|true|true|true", "cancellation functions/tables must be service-only");
    const setup = run("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", setupSql]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout); fixturesCommitted = true;

    // Two independent transactions race to request the same Seat. The Table row
    // lock serializes them; one creates the request and the other sees pending.
    const concurrent = (op, reason, label) => `begin;
      set local request.jwt.claims='{"role":"service_role"}';
      do $w074$ declare v jsonb; v_message text; begin
        begin
          v:=public.request_seat_cancellation(${quote(members[0])},${quote(seats[0])},${quote(op)},${quote(reason)});
          raise notice 'W074_CREATED_${label}:%',v->>'requestId'; perform pg_sleep(0.75);
        exception when sqlstate 'P0001' then get stacked diagnostics v_message=message_text;
          if v_message<>'request_pending' then raise; end if;
          raise notice 'W074_PENDING_${label}';
        end;
      end $w074$;
      commit;`;
    const raceA = runAsync("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", concurrent(memberOps[0], "race A", "A")], "");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    const raceB = runAsync("psql", [db, "-X", "-v", "ON_ERROR_STOP=1", "-c", concurrent(memberOps[1], "race B", "B")], "");
    const [a, b] = await Promise.all([raceA, raceB]);
    assert.equal(a.status, 0, a.stderr || a.stdout); assert.equal(b.status, 0, b.stderr || b.stdout);
    const raceOutput = `${a.stdout}\n${a.stderr}\n${b.stdout}\n${b.stderr}`;
    assert.equal((raceOutput.match(/W074_CREATED_[AB]:/g) ?? []).length, 1, raceOutput);
    assert.equal((raceOutput.match(/W074_PENDING_[AB]/g) ?? []).length, 1, raceOutput);

    const winningOp = psql(`select operation_id::text from public.app_seat_cancellation_operations
      where action='member_request' and actor_user_id=${quote(members[0])}
        and cancellation_request_id=(select cancellation_request_id from public.app_seat_cancellation_requests where seat_id=${quote(seats[0])})
        and operation_id in (${list(memberOps)}) limit 1`);
    assert.ok(memberOps.includes(winningOp), `unexpected request operation ${winningOp}`);
    const winningReason = winningOp === memberOps[0] ? "race A" : "race B";
    const serviceClaims = `set local request.jwt.claims='{"role":"service_role"}';`;
    const calls = psql(`begin; ${serviceClaims}
      do $w074$ declare v jsonb; rid uuid; msg text; begin
        v:=public.request_seat_cancellation(${quote(members[0])},${quote(seats[0])},${quote(winningOp)},${quote(winningReason)});
        if v->>'seatId'<>'${seats[0]}' then raise exception 'wrong idempotent replay result'; end if;
        rid:=(v->>'requestId')::uuid;
        begin perform public.request_seat_cancellation(${quote(members[0])},${quote(seats[0])},${quote(winningOp)},'changed body');
          raise exception 'changed request body reused operation';
        exception when unique_violation then get stacked diagnostics msg=message_text; if msg<>'operation_conflict' then raise; end if; end;
        begin perform public.read_my_seat_cancellation_requests(${quote(members[1])},${quote(seats[0])});
          raise exception 'cross-member history was visible';
        exception when sqlstate 'P0002' then get stacked diagnostics msg=message_text; if msg<>'not_found' then raise; end if; end;
        begin perform public.request_seat_cancellation('${host}','${seats[0]}','${memberOps[0]}',null);
          raise exception 'host acted as admitted member';
        exception when insufficient_privilege then get stacked diagnostics msg=message_text; if msg<>'member_not_admitted' then raise; end if; end;
        begin perform public.list_admin_seat_cancellations(${quote(host)},null,null,10); raise exception 'host used admin cancellation queue';
        exception when insufficient_privilege then get stacked diagnostics msg=message_text; if msg<>'admin_required' then raise; end if; end;
        begin perform public.list_admin_seat_cancellations(${quote(members[1])},null,null,10); raise exception 'member used admin cancellation queue';
        exception when insufficient_privilege then get stacked diagnostics msg=message_text; if msg<>'admin_required' then raise; end if; end;
        v:=public.list_admin_seat_cancellations(${quote(admin)},null,null,10);
        if jsonb_array_length(v->'items')<>1 then raise exception 'admin queue missing pending request'; end if;
        if (select state from public.app_seats where seat_id='${seats[0]}')<>'cancellation_requested'
          or (select state from public.app_table_invitations where invitation_id='${invitations[0]}')<>'active'
          or public.read_invitation_seat_status('${invitations[0]}')->>'status'<>'confirmed_seat' then
          raise exception 'pending request removed paid Seat/offer eligibility'; end if;
        if (select count(*) from public.app_seat_cancellation_operations where action='member_request' and cancellation_request_id=rid)<>1
          or (select count(*) from public.app_audit_events where action='seat.cancellation.requested' and subject_id=rid)<>1 then
          raise exception 'request replay duplicated operation or audit'; end if;
      end $w074$;
      commit`);
    assert.ok(calls.includes("COMMIT") || calls.includes("commit"), calls);

    // A pending request survives Table completion in history/admin DTOs even if
    // the later Seat lifecycle writer has not updated app_seats yet.
    psql(`begin; ${serviceClaims}
      update public.app_table_runtime set state='completed' where table_id='${tables[0]}';
      do $w074$ declare member_json jsonb; admin_json jsonb; begin
        member_json:=public.read_my_seat_cancellation_requests('${members[0]}','${seats[0]}');
        admin_json:=public.read_admin_seat_cancellation('${admin}',(member_json->'items'->0->>'requestId')::uuid);
        if member_json->>'seatState'<>'completed' or member_json->'requestAvailability'->>'reason'<>'request_pending'
          or admin_json->'seat'->>'state'<>'completed' then raise exception 'terminal Table state not projected for pending cancellation'; end if;
      end $w074$;
      update public.app_table_runtime set state='open' where table_id='${tables[0]}'; commit`);

    // Create independent requests for denial, full refund, and zero refund.
    psql(`begin; ${serviceClaims}
      select public.request_seat_cancellation('${members[1]}','${seats[1]}','${memberOps[2]}','member explanation');
      select public.request_seat_cancellation('${members[2]}','${seats[2]}','${memberOps[3]}',null);
      select public.request_seat_cancellation('${members[3]}','${seats[3]}','${memberOps[4]}',null);
      commit`);

    const decisionSql = `begin; ${serviceClaims}
      do $w074$ declare req uuid; r jsonb; msg text; before_count integer; begin
        select cancellation_request_id into req from public.app_seat_cancellation_requests where seat_id='${seats[1]}' and state='pending';
        r:=public.decide_seat_cancellation('${admin}',req,'${decisionOps[0]}',1,'deny',0,'We reviewed your request.');
        if r->'request'->>'state'<>'denied' or r->'request'->>'version'<>'2'
          or (select state from public.app_seats where seat_id='${seats[1]}')<>'confirmed'
          or (select state from public.app_table_invitations where invitation_id='${invitations[1]}')<>'active'
          or exists(select 1 from public.app_refund_obligations where payment_id='${paymentIds[1]}') then raise exception 'denial changed Seat/offer or created refund'; end if;
        select count(*) into before_count from public.app_audit_events where subject_id=req and action='seat.cancellation.denied';
        if before_count<>1 or (select count(*) from public.app_seat_cancellation_notice_outbox where cancellation_request_id=req and notice_kind='decision')<>1 then
          raise exception 'denial missing unique audit/notice intent'; end if;
        r:=public.decide_seat_cancellation('${admin}',req,'${decisionOps[0]}',1,'deny',0,'We reviewed your request.');
        if r->'request'->>'state'<>'denied' or (select count(*) from public.app_audit_events where subject_id=req and action='seat.cancellation.denied')<>1
          or (select count(*) from public.app_seat_cancellation_notice_outbox where cancellation_request_id=req and notice_kind='decision')<>1 then raise exception 'denial replay duplicated side effect'; end if;
        begin perform public.decide_seat_cancellation('${admin}',req,'${decisionOps[0]}',1,'deny',0,'different reason'); raise exception 'changed decision body reused operation';
        exception when unique_violation then get stacked diagnostics msg=message_text; if msg<>'operation_conflict' then raise; end if; end;

        select cancellation_request_id into req from public.app_seat_cancellation_requests where seat_id='${seats[0]}' and state='pending';
        r:=public.decide_seat_cancellation('${admin}',req,'${decisionOps[1]}',1,'approve',500,'A partial refund is approved.');
        if r->'request'->>'state'<>'approved' or r->'request'->>'refundCents'<>'500'
          or (r->'refundBalance'->>'refundAvailableCents')::integer<>2000
          or (select state from public.app_seats where seat_id='${seats[0]}')<>'cancelled'
          or (select state from public.app_table_invitations where invitation_id='${invitations[0]}')<>'revoked'
          or (select sum(amount_cents) from public.app_refund_obligations where payment_id='${paymentIds[0]}' and source='cancellation')<>500 then
          raise exception 'partial approval did not atomically remove Seat/revoke offer/bound refund'; end if;
        r:=public.decide_seat_cancellation('${admin}',req,'${decisionOps[1]}',1,'approve',500,'A partial refund is approved.');
        if (select count(*) from public.app_refund_obligations where payment_id='${paymentIds[0]}' and source='cancellation')<>1
          or (select count(*) from public.app_audit_events where subject_id=req and action='seat.cancellation.approved')<>1
          or (select count(*) from public.app_seat_cancellation_notice_outbox where cancellation_request_id=req and notice_kind='decision')<>1 then
          raise exception 'partial approval replay duplicated obligation/audit/notice'; end if;

        select cancellation_request_id into req from public.app_seat_cancellation_requests where seat_id='${seats[2]}' and state='pending';
        r:=public.decide_seat_cancellation('${admin}',req,'${decisionOps[2]}',1,'approve',2500,'A full refund is approved.');
        if (r->'refundBalance'->>'refundAvailableCents')::integer<>0
          or (select sum(amount_cents) from public.app_refund_obligations where payment_id='${paymentIds[2]}' and source='cancellation')<>2500
          or (select state from public.app_payments where payment_id='${paymentIds[2]}')<>'refund_pending'
          or (select state from public.app_table_invitations where invitation_id='${invitations[2]}')<>'revoked' then raise exception 'full refund exceeded or missed verified payment balance'; end if;

        select cancellation_request_id into req from public.app_seat_cancellation_requests where seat_id='${seats[3]}' and state='pending';
        r:=public.decide_seat_cancellation('${admin}',req,'${decisionOps[3]}',1,'approve',0,'No refund is approved.');
        if r->'request'->>'refundCents'<>'0'
          or exists(select 1 from public.app_refund_obligations where payment_id='${paymentIds[3]}')
          or (select state from public.app_payments where payment_id='${paymentIds[3]}')<>'verified_paid'
          or (select state from public.app_table_invitations where invitation_id='${invitations[3]}')<>'revoked' then raise exception 'zero-refund approval created liability or kept offer active'; end if;
      end $w074$;
      commit`;
    psql(decisionSql);

    const counts = psql(`select concat(
      (select count(*) from public.app_seat_cancellation_requests where seat_id in (${list(seats)}))::text,'|',
      (select count(*) from public.app_seat_cancellation_operations where operation_id in (${list([...memberOps, ...decisionOps])}))::text,'|',
      (select count(*) from public.app_seat_cancellation_notice_outbox where cancellation_request_id in
        (select cancellation_request_id from public.app_seat_cancellation_requests where seat_id in (${list(seats)})))::text,'|',
      (select count(*) from public.app_audit_events where operation_id in (${list([...memberOps, ...decisionOps])}))::text)`);
    assert.equal(counts, "4|8|4|8", "expected one request/decision operation, notice intent and audit per actual change; replays must not duplicate");
  } finally {
    try { if (fixturesCommitted) cleanup(); }
    finally { if (existsSync(runLock)) unlinkSync(runLock); }
  }
  collisionCheck();
  console.log(`seat-cancellations-db-test: guarded fifthwheel-rewrite-test; migration ${migration}; service-only grants, owner/role gates, concurrent request serialization, replay, terminal state, deny/partial/full/zero refund, invitation revoke, notice/audit idempotency passed; exact fixtures removed; no provider contacted`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "seat cancellation DB harness failed"); process.exitCode = 1; });
