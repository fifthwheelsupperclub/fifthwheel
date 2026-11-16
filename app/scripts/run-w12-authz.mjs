#!/usr/bin/env node

// W12 real-stack permission + direct-route sweep (P0-2 / P1-9). Only the isolated
// fifthwheel-rewrite-test stack and app port 8087 are allowed. Creates run-scoped
// Auth users, role/assignment rows, two members' full resource chains and a ready
// identity photo, runs tests/browser/w12-authz.spec.ts, then removes exactly those
// rows. Never resets or migrates a database; never calls Stripe or the worker with a valid secret.

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(appRoot, "test-stack");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const appPort = 8087;
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");
const resultsPath = join(appRoot, "test-results", "w12-authz-results.json");

function fail(message) { throw new Error(message); }
const q = (v) => `'${String(v).replaceAll("'", "''")}'`;
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = raw.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || raw.trim().startsWith("#")) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    values[m[1]] = v;
  }
  return values;
}
function run(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: appRoot, encoding: "utf8", ...options });
  if (r.error || r.status !== 0) fail(`${command} preflight failed`);
  return r.stdout ?? "";
}
const psqlEnv = () => ({ ...process.env, PGPASSWORD: "postgres" });
function psql(sql, { quiet = false } = {}) {
  const r = spawnSync("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1", ...(quiet ? ["-q"] : [])], { cwd: appRoot, input: sql, encoding: "utf8", env: psqlEnv() });
  if (r.error || r.status !== 0) fail(`psql failed: ${(r.stderr || "").slice(0, 400)}`);
  return r.stdout;
}

function guardEnvironment() {
  const values = parseEnvFile(existsSync(join(appRoot, ".env.test.local")) ? join(appRoot, ".env.test.local") : join(testWorkdir, ".env.test.local"));
  for (const [k, v] of Object.entries(values)) process.env[k] ??= v;
  if (process.env.SUPABASE_PROJECT_REF) fail("refusing linked Supabase project for W12 local run");
  for (const [k, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl]]) {
    if (process.env[k] && process.env[k] !== expected) fail(`refusing non-test ${k}`);
  }
  if (process.env.STRIPE_MODE === "live" || /^sk_live_/.test(process.env.STRIPE_SECRET_KEY ?? "")) fail("refusing live Stripe configuration");
  process.env.SUPABASE_URL = apiUrl;
  process.env.APP_ORIGIN = `http://127.0.0.1:${appPort}`;
  process.env.MAILPIT_URL = "http://127.0.0.1:57424";
}
function localStatus() {
  const guarded = spawnSync("node", [join(appRoot, "scripts", "local-supabase.mjs"), "test", "status"], { cwd: appRoot, encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } });
  if (guarded.error || guarded.status !== 0) fail("guarded local test status failed; no fixture was created");
  if (!existsSync(configPath) || !/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(readFileSync(configPath, "utf8")) || existsSync(linkedRefPath)) fail("test Supabase config does not identify the isolated local project");
  const raw = run("supabase", ["status", "--workdir", testWorkdir, "-o", "json"], { env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } });
  const status = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  if (status.API_URL !== apiUrl || status.DB_URL !== dbUrl) fail("running Supabase target is not fifthwheel-rewrite-test");
  process.env.SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY) fail("local test API keys are unavailable");
  const port = spawnSync("lsof", ["-nP", `-iTCP:${appPort}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (port.error) fail("lsof is required to confirm the app port is free");
  if (port.status === 0 && port.stdout.trim()) fail(`app port ${appPort} is already occupied; no fixture was created`);
}
function assertSchema() {
  const out = run("psql", [dbUrl, "-X", "-At", "-c", "select (to_regclass('public.app_ops_operations') is not null)::text||'|'||(to_regclass('public.app_vote_periods') is not null)::text||'|'||(to_regclass('public.app_notice_outbox') is not null)::text"], { env: psqlEnv() }).trim();
  if (out !== "true|true|true") fail("W08-W10 tables are not applied to fifthwheel-rewrite-test; no fixture was created");
}

const svcHeaders = () => ({ apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` });
async function createAuthUser(email) {
  const r = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: "POST", headers: { ...svcHeaders(), "content-type": "application/json" }, body: JSON.stringify({ email, email_confirm: true, user_metadata: {} }), cache: "no-store", redirect: "error" });
  if (!r.ok) fail(`Auth fixture creation failed (HTTP ${r.status})`);
  const b = await r.json();
  if (typeof b.id !== "string") fail("Auth fixture response invalid");
  return b.id;
}
async function deleteAuthUser(id) {
  const r = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: svcHeaders(), cache: "no-store", redirect: "error" });
  if (!r.ok && r.status !== 404) fail("Auth fixture cleanup failed");
}
// 1x1 PNG
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
async function putEvidence(key) {
  const r = await fetch(`${apiUrl}/storage/v1/object/identity-evidence/${key}`, { method: "POST", headers: { ...svcHeaders(), "content-type": "image/png" }, body: png, cache: "no-store", redirect: "error" });
  if (!r.ok) fail(`evidence object upload failed (HTTP ${r.status})`);
}
async function removeEvidence(keys) {
  if (!keys.length) return;
  const r = await fetch(`${apiUrl}/storage/v1/object/identity-evidence`, { method: "DELETE", headers: { ...svcHeaders(), "content-type": "application/json" }, body: JSON.stringify({ prefixes: keys }), cache: "no-store", redirect: "error" });
  if (!r.ok && r.status !== 404) fail("evidence object cleanup failed");
}

function buildFixture(prefix) {
  const p = prefix ?? randomBytes(4).toString("hex");
  const sfx = p;
  const id = (n) => `${p}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const side = (k, n, dob) => ({
    email: `w12-${k}-${sfx}@example.test`, first: `Wtwelve${k.toUpperCase()}${sfx}`, last: `Surname${k.toUpperCase()}${sfx}`, dob,
    signup: id(n + 1), admission: id(n + 2), guest: id(n + 3), table: id(n + 4), revision: id(n + 5), request: id(n + 6), proposal: id(n + 7),
    invitation: id(n + 8), attempt: id(n + 9), payment: id(n + 10), seat: id(n + 11), cancel: id(n + 12), obligation: id(n + 13), file: id(n + 14),
    venue: id(n + 15), venue2: id(n + 16), session: `cs_test_w12${k}${sfx}`, pi: `pi_w12${k}${sfx}`, userId: null,
  });
  return { prefix: p, a: side("a", 100, "1987-03-09"), b: side("b", 200, "1991-07-21"), unmappedVenue: id(999), users: {}, emails: {},
    jobSecret: randomBytes(24).toString("hex") };
}

function seedSql(f) {
  const u = f.users;
  const members = [["a", f.a], ["b", f.b]];
  const staff = [["admin", u.admin], ["hostA", u.hostA], ["hostB", u.hostB], ["hostRev", u.hostRev], ["restA", u.restA], ["restB", u.restB], ["restRev", u.restRev]];
  const role = (k) => (k === "admin" ? "admin" : k.startsWith("host") ? "host" : "restaurant");
  const per = ([k, m]) => `
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  (${q(m.signup)},${q(m.email)},${q(m.first)},${q(m.last)},${q(m.dob)},'Woman',array['Women'],21,120,'Inman Park','Open','Yes, surprise me');
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  (${q(m.admission)},${q(m.signup)},${q(m.email)},'activated',${q(u.admin)},${q(m.userId)},now());
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,
  first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,looking_for,surprise_game) values
  (${q(m.guest)},${q(m.userId)},${q(m.admission)},'approved',1,1,${q(m.first)},${q(m.last)},${q(m.dob)},'woman',array['woman'],21,120,'Inman Park','Open','Yes, surprise me');
insert into public.app_supply_venues(venue_id,name,address,neighborhood,created_by) values
  (${q(m.venue)},'Test Bar','1 Main St','Inman Park',${q(u.admin)}),(${q(m.venue2)},'Test Grill','2 Main St','Inman Park',${q(u.admin)});
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${q(m.table)},'published','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  (${q(m.revision)},${q(m.table)},1,'published',jsonb_build_object('title','W12 Table ${k.toUpperCase()}','localDate',to_char((now()+interval '12 hours') at time zone 'America/New_York','YYYY-MM-DD'),
    'startLocalTime',to_char((now()+interval '12 hours') at time zone 'America/New_York','HH24:MI'),'neighborhood','Inman Park','stops',jsonb_build_array(
      jsonb_build_object('role','drinks','venueId',${q(m.venue)},'venueName','Test Bar','venueAddress','1 Main St','minutesFromStart',0,'publicNotes','Reserve the back table','privateNotes','W12SECRETNOTE'),
      jsonb_build_object('role','dinner','venueId',${q(m.venue2)},'venueName','Test Grill','venueAddress','2 Main St','minutesFromStart',60,'publicNotes','Quiet corner'),
      jsonb_build_object('role','dessert','venueId',${q(f.unmappedVenue)},'venueName','Test Sweets','venueAddress','3 Main St','minutesFromStart',120,'publicNotes','x'))),${q(u.admin)});
update public.app_supply_table_heads h set published_revision_id=r.revision_id from public.app_supply_table_revisions r where h.table_id=r.table_id and h.table_id=${q(m.table)};
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state) values
  (${q(m.request)},${q(m.table)},${q(m.guest)},${q(m.userId)},'W12 Table ${k.toUpperCase()}',current_date+1,'19:00','Inman Park','pending');
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values
  (${q(m.proposal)},${q(m.table)},1,'approved',${q(m.revision)},'{}'::jsonb,${q(u.admin)},${q(u.admin)},${q(u.admin)},${q(u.admin)},now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version) values
  (${q(m.proposal)},${q(m.request)},${q(m.guest)},1,1,1);
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values
  (${q(m.invitation)},${q(m.table)},${q(m.guest)},${q(m.userId)},${q(m.request)},${q(m.proposal)},${q(u.admin)},'active');
insert into public.app_checkout_attempts(attempt_id,invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,supply_revision_id,state,
  hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,provider_session_id,disclosure_version,disclosure_accepted_at) values
  (${q(m.attempt)},${q(m.invitation)},${q(m.table)},${q(m.guest)},${q(m.userId)},1,1,${q(m.revision)},'consumed',now()-interval '1 hour',now()-interval '58 minutes','test',${q(`w12-key-${k}-${f.prefix}`)},${q(m.session)},'seat-checkout-v1',now()-interval '1 hour');
insert into public.app_payments(payment_id,attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at) values
  (${q(m.payment)},${q(m.attempt)},'test',${q(m.pi)},2500,'USD','verified_paid',now()-interval '1 hour');
insert into public.app_seats(seat_id,invitation_id,table_id,guest_id,payment_id,state,created_at) values
  (${q(m.seat)},${q(m.invitation)},${q(m.table)},${q(m.guest)},${q(m.payment)},'cancellation_requested',now()-interval '1 hour');
insert into public.app_seat_cancellation_requests(cancellation_request_id,seat_id,state,version,member_reason) values (${q(m.cancel)},${q(m.seat)},'pending',1,'W12 probe');
insert into public.app_refund_obligations(obligation_id,payment_id,source,amount_cents,state) values (${q(m.obligation)},${q(m.payment)},'late_checkout_ineligible',2500,'open');
insert into public.app_profile_files(file_id,guest_id,auth_user_id,kind,state,content_type,declared_byte_size,actual_byte_size,normalized_byte_size,width,height,
  profile_revision_at_intent,critical_identity_version,normalized_key,received_at,upload_consumed_at) values
  (${q(m.file)},${q(m.guest)},${q(m.userId)},'photo','ready','image/png',${png.length},${png.length},${png.length},1,1,1,1,${q(`${m.guest}/${m.file}`)},now(),now());`;
  return `begin;
set local request.jwt.claims='{"role":"service_role"}';
insert into public.app_user_roles(user_id,role) values ${staff.map(([k, id]) => `(${q(id)},'${role(k)}')`).join(",")};
${members.map(per).join("\n")}
select public.set_host_assignment(${q(u.admin)},${q(f.a.table)},${q(u.hostA)},true);
select public.set_host_assignment(${q(u.admin)},${q(f.b.table)},${q(u.hostB)},true);
select public.set_host_assignment(${q(u.admin)},${q(f.a.table)},${q(u.hostRev)},true);
select public.set_host_assignment(${q(u.admin)},${q(f.a.table)},${q(u.hostRev)},false);
select public.set_venue_membership(${q(u.admin)},${q(f.a.venue)},${q(u.restA)},true);
select public.set_venue_membership(${q(u.admin)},${q(f.b.venue)},${q(u.restB)},true);
select public.set_venue_membership(${q(u.admin)},${q(f.a.venue)},${q(u.restRev)},true);
select public.set_venue_membership(${q(u.admin)},${q(f.a.venue)},${q(u.restRev)},false);
select public.set_staff_contact(${q(u.admin)},${q(u.hostA)},'Hannah Host','w12-hostcontact@host.example');
commit;`;
}

function cleanupSql(f) {
  const u = f.users;
  const ids = (k) => [f.a, f.b].map((m) => q(m[k])).join(",");
  const userIds = Object.values(u).filter(Boolean).map(q).join(",");
  return `begin;
set local request.jwt.claims='{"role":"service_role"}';
-- Probe side effects (operations, outbox rows, requests created through legitimate member routes) are keyed by this run's
-- fixture users or by ids carrying this run's prefix; purge exactly those, children first, retrying over FK order.
do $purge$ declare r record; pass int; begin
  for pass in 1..10 loop
    for r in select c.conrelid::regclass::text as t, a.attname as col, (c.confrelid='auth.users'::regclass) as byuser
      from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] join pg_class k on k.oid=c.conrelid join pg_namespace n on n.oid=k.relnamespace
      where c.contype='f' and n.nspname='public' and c.confdeltype in ('r','a') loop
      begin
        if r.byuser then execute format($f$delete from %s where %I in (${userIds})$f$, r.t, r.col);
        else execute format('delete from %s where %I::text like %L', r.t, r.col, '${f.prefix}-%'); end if;
      exception when others then null; end;
    end loop;
  end loop;
end $purge$;
delete from public.app_table_attendance where table_id in (${ids("table")});
delete from public.app_seat_cancellation_requests where cancellation_request_id in (${ids("cancel")});
delete from public.app_refund_obligations where obligation_id in (${ids("obligation")});
delete from public.app_seats where seat_id in (${ids("seat")});
delete from public.app_payments where payment_id in (${ids("payment")});
delete from public.app_checkout_attempts where attempt_id in (${ids("attempt")});
delete from public.app_table_invitations where invitation_id in (${ids("invitation")});
delete from public.app_table_roster_proposal_members where proposal_id in (${ids("proposal")});
delete from public.app_table_roster_proposals where proposal_id in (${ids("proposal")});
delete from public.app_table_requests where request_id in (${ids("request")});
delete from public.app_supply_table_assignments where table_id in (${ids("table")});
delete from public.app_venue_memberships where venue_id in (${ids("venue")}) or user_id in (${userIds});
delete from public.app_staff_contacts where user_id in (${userIds});
update public.app_supply_table_heads set published_revision_id=null where table_id in (${ids("table")});
delete from public.app_supply_table_revisions where table_id in (${ids("table")});
delete from public.app_supply_table_heads where table_id in (${ids("table")});
delete from public.app_supply_venues where venue_id in (${ids("venue")},${ids("venue2")}) or created_by in (${userIds});
delete from public.app_profile_files where file_id in (${ids("file")});
delete from public.app_member_profiles where guest_id in (${ids("guest")});
delete from public.app_admissions where id in (${ids("admission")});
delete from public.waitlist_signups where id in (${ids("signup")});
delete from public.app_user_roles where user_id in (${userIds});
commit;`;
}

function printTable(results) {
  const rows = results.rows ?? [];
  const bad = rows.filter((r) => r.status === "fail");
  const count = (s) => rows.filter((r) => r.status === s).length;
  process.stdout.write(`\nW12 authz sweep: ${count("pass")} pass, ${bad.length} FAIL, ${count("unverified")} unverified, ${count("skip")} could-not-run (${rows.length} checks)\n`);
  process.stdout.write(`${"STATUS".padEnd(10)}${"CHECK".padEnd(8)}${"ROLE".padEnd(9)}${"ROUTE".padEnd(78)}RESULT\n`);
  for (const r of rows.filter((x) => x.status !== "pass")) {
    process.stdout.write(`${r.status.toUpperCase().padEnd(10)}${String(r.kind).padEnd(8)}${String(r.role).padEnd(9)}${String(r.route).slice(0, 77).padEnd(78)}${r.detail}\n`);
  }
  process.stdout.write(`Full machine-readable result table: ${resultsPath}\n`);
  return bad.length;
}

async function runPlaywright() {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w12-authz.config.ts"], { cwd: appRoot, env: process.env, stdio: "inherit" });
  return await new Promise((res, rej) => { child.once("error", () => rej(new Error("Playwright could not start"))); child.once("exit", (c) => res(c ?? 1)); });
}

async function cleanupOnly(prefix) {
  if (!/^[0-9a-f]{8}$/.test(prefix)) fail("usage: --cleanup <8-hex fixture prefix>");
  guardEnvironment();
  localStatus();
  const f = buildFixture(prefix);
  const out = run("psql", [dbUrl, "-X", "-At", "-c", `select id from auth.users where email like 'w12-%-${prefix}@example.test'`], { env: psqlEnv() }).trim();
  out.split(/\s+/).filter(Boolean).forEach((id, i) => { f.users[`u${i}`] = id; });
  if (!Object.keys(f.users).length) fail("no Auth users found for that prefix");
  const evidence = [f.a, f.b].map((m) => `${m.guest}/${m.file}`);
  await removeEvidence(evidence).catch(() => undefined);
  psql(cleanupSql(f), { quiet: true });
  for (const id of Object.values(f.users)) await deleteAuthUser(id);
  process.stdout.write(`Fixture ${prefix} cleaned.\n`);
}

async function main() {
  if (process.argv[2] === "--cleanup") return cleanupOnly(process.argv[3] ?? "");
  guardEnvironment();
  localStatus();
  assertSchema();
  const f = buildFixture();
  const authIds = [];
  let seeded = false, evidence = [], result = 1;
  try {
    const mk = async (name, email) => { const id = await createAuthUser(email); authIds.push(id); return id; };
    const staffNames = ["admin", "hostA", "hostB", "hostRev", "restA", "restB", "restRev"];
    for (const n of staffNames) { f.emails[n] = `w12-${n.toLowerCase()}-${f.prefix}@example.test`; f.users[n] = await mk(n, f.emails[n]); }
    f.emails.memberA = f.a.email; f.emails.memberB = f.b.email;
    f.a.userId = await mk("a", f.a.email); f.b.userId = await mk("b", f.b.email);
    f.users.memberA = f.a.userId; f.users.memberB = f.b.userId;
    psql(seedSql(f), { quiet: true });
    seeded = true;
    for (const m of [f.a, f.b]) { const key = `${m.guest}/${m.file}`; await putEvidence(key); evidence.push(key); m.fileKey = key; }
    mkdirSync(dirname(resultsPath), { recursive: true });
    rmSync(resultsPath, { force: true });
    process.env.W12_FIXTURE = JSON.stringify(f);
    process.env.W12_RESULTS = resultsPath;
    process.env.JOB_SECRET = f.jobSecret; // never presented by any probe
    result = await runPlaywright();
  } finally {
    let cleanupFailure = null;
    try { await removeEvidence(evidence); } catch (e) { cleanupFailure = e; }
    if (seeded) { try { psql(cleanupSql(f), { quiet: true }); } catch (e) { cleanupFailure ??= e; } }
    for (const id of authIds.reverse()) { try { await deleteAuthUser(id); } catch (e) { cleanupFailure ??= e; } }
    if (cleanupFailure) process.stderr.write(`CLEANUP FAILED (fixture prefix ${f.prefix}): ${cleanupFailure.message}\n`);
    else process.stdout.write(`Fixture ${f.prefix} cleaned (exact rows, evidence objects and Auth users removed; PII-free audit events remain by design).\n`);
    if (cleanupFailure) process.exitCode = 1;
  }
  let failures = 0;
  if (existsSync(resultsPath)) failures = printTable(JSON.parse(readFileSync(resultsPath, "utf8")));
  else process.stdout.write("No results file was produced (the run could not complete).\n");
  if (result !== 0 || failures > 0) process.exitCode = process.exitCode || 1;
  else process.stdout.write("W12 authz sweep passed.\n");
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : "W12 run failed"}\n`); process.exitCode = 1; });
