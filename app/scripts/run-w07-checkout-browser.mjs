#!/usr/bin/env node

// Real local W07 checkout journey: Stripe TEST mode (embedded Checkout) + signed webhook via `stripe listen` + Seat.
// Only the isolated fifthwheel-rewrite-test stack is allowed; Stripe must be sk_test_/pk_test_.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(appRoot, "test-stack");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const mailpitUrl = "http://127.0.0.1:57424";
const appUrl = "http://127.0.0.1:8086";
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");
const lockPath = join(tmpdir(), "fifthwheel-rewrite-test-w07-checkout.lock");
const screenshots = join(appRoot, "docs", "implementation", "screenshots");
const screenshotStems = ["w07-real-checkout-seat-confirmed","w07-real-my-seats"];

function fail(message) { throw new Error(message); }
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    result[match[1]] = value;
  }
  return result;
}
function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, { cwd: appRoot, encoding: "utf8", ...options,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", ...options.env } });
  if (result.error) fail(`could not run ${commandName}: ${result.error.message}`);
  return result;
}
function run(commandName, args, options = {}) {
  const result = command(commandName, args, options);
  if (result.status !== 0) fail(`${commandName} preflight failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  return result.stdout ?? "";
}
function parseStatus(output) {
  const start = output.indexOf("{"); const end = output.lastIndexOf("}");
  if (start < 0 || end < start) fail("local Supabase status is malformed; no fixture was created");
  return JSON.parse(output.slice(start, end + 1));
}
function isLoopback(value, expected) {
  try { const url = new URL(value); return url.origin === expected && url.protocol === "http:" && url.hostname === "127.0.0.1"
    && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password; }
  catch { return false; }
}
function verifyPortFree(port, label) {
  const result = command("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (result.error) fail(`lsof is required to verify ${label} port ${port}; no fixture was created`);
  if (result.status === 0 && result.stdout.trim()) fail(`${label} port ${port} is already occupied; no fixture was created`);
  if (result.status !== 1) fail(`could not verify ${label} port ${port}; no fixture was created`);
}
function loadAndGuardEnvironment() {
  const fallback = join(testWorkdir, ".env.test.local");
  const envPath = join(appRoot, ".env.test.local");
  const fileValues = parseEnvFile(existsSync(envPath) ? envPath : fallback);
  for (const [key, value] of Object.entries(fileValues)) process.env[key] ??= value;
  if (process.env.SUPABASE_PROJECT_REF) fail("refusing linked Supabase project; no fixture was created");
  for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl], ["MAILPIT_URL", mailpitUrl], ["APP_ORIGIN", appUrl]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}; no fixture was created`);
  }
  process.env.SUPABASE_URL = apiUrl;
  process.env.SUPABASE_DB_URL = dbUrl;
  process.env.MAILPIT_URL = mailpitUrl;
  process.env.APP_ORIGIN = appUrl;
  for (const [key, expected] of [["MAIL_FROM_EMAIL", "fifthwheel@example.test"], ["MAIL_FROM_NAME", "Fifth Wheel Local Test"],
    ["EMAIL_FROM", "fifthwheel@example.test"], ["EMAIL_FROM_NAME", "Fifth Wheel Local Test"]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}; no fixture was created`);
    process.env[key] = expected;
  }
  if (process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_ANON_KEY
    && process.env.SUPABASE_PUBLISHABLE_KEY !== process.env.SUPABASE_ANON_KEY) fail("local publishable-key variables disagree; no fixture was created");
  if (process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY
    && process.env.SUPABASE_SECRET_KEY !== process.env.SUPABASE_SERVICE_ROLE_KEY) fail("local service-key variables disagree; no fixture was created");
}

async function preflight() {
  loadAndGuardEnvironment();
  if (!existsSync(configPath)) fail("local test Supabase config is missing; no fixture was created");
  const config = readFileSync(configPath, "utf8");
  if (!/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(config)
    || !/^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m.test(config)
    || !/^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m.test(config) || existsSync(linkedRefPath)) {
    fail("test config does not identify the isolated fifthwheel-rewrite-test stack; no fixture was created");
  }
  run(process.execPath, [join(appRoot, "scripts", "local-supabase.mjs"), "test", "status"]);
  const status = parseStatus(run("supabase", ["status", "--workdir", testWorkdir, "-o", "json"]));
  if (status.API_URL !== apiUrl || status.DB_URL !== dbUrl) fail("active Supabase target/ports do not match fifthwheel-rewrite-test; no fixture was created");
  const localPublishable = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const localSecret = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  for (const key of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]) {
    if (process.env[key] && process.env[key] !== localPublishable) fail(`refusing non-local ${key}; no fixture was created`);
  }
  for (const key of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (process.env[key] && process.env[key] !== localSecret) fail(`refusing non-local ${key}; no fixture was created`);
  }
  process.env.SUPABASE_PUBLISHABLE_KEY = localPublishable;
  process.env.SUPABASE_SECRET_KEY = localSecret;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY === process.env.SUPABASE_SECRET_KEY) fail("local Supabase keys are unavailable or invalid; no fixture was created");
  if (!isLoopback(process.env.SUPABASE_URL, apiUrl) || !isLoopback(process.env.MAILPIT_URL, mailpitUrl) || !isLoopback(process.env.APP_ORIGIN, appUrl)) {
    fail("all test provider and app origins must be exact loopback URLs; no fixture was created");
  }
  verifyPortFree(8086, "rewrite test app");
  const mailpit = await fetch(`${mailpitUrl}/api/v1/info`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!mailpit.ok) fail("local Mailpit is unavailable; no fixture was created");
  const stripeSecret = process.env.STRIPE_SECRET_KEY ?? "", stripePub = process.env.STRIPE_PUBLISHABLE_KEY ?? "";
  if (process.env.STRIPE_MODE !== "test" || !stripeSecret.startsWith("sk_test_") || !stripePub.startsWith("pk_test_")
    || process.env.VITE_STRIPE_PUBLISHABLE_KEY !== stripePub || !(process.env.STRIPE_WEBHOOK_SECRET ?? "").startsWith("whsec_")
    || process.env.CHECKOUT_FULFILLMENT_READY !== "true") fail("Stripe TEST keys, matching VITE_ publishable key, webhook secret and CHECKOUT_FULFILLMENT_READY=true are required in .env.test.local; no fixture was created");
  const listener = command("pgrep", ["-f", "stripe listen.*127.0.0.1:8086/api/webhooks/stripe"]);
  if (listener.status !== 0) fail("start `stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed --forward-to http://127.0.0.1:8086/api/webhooks/stripe` first (its whsec_ must equal STRIPE_WEBHOOK_SECRET); no fixture was created");
}

async function createAuthUser(email) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: "POST", headers: {
    apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json", accept: "application/json",
  }, body: JSON.stringify({ email, email_confirm: true, user_metadata: {} }), cache: "no-store", redirect: "error" });
  if (!response.ok) fail(`could not create run-scoped local Auth identity (${response.status})`);
  const body = await response.json();
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || body.email?.toLowerCase() !== email.toLowerCase()) fail("local Auth returned an unexpected identity");
  return body.id;
}
async function getAuthUser(userId) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: {
    apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, accept: "application/json",
  }, cache: "no-store", redirect: "error" });
  if (response.status === 404) return null;
  if (!response.ok) fail("could not verify ownership of local Auth fixture during cleanup");
  return await response.json();
}
async function deleteAuthUser(userId, email) {
  const user = await getAuthUser(userId);
  if (!user) return;
  if (user.id !== userId || user.email?.toLowerCase() !== email.toLowerCase()) fail("Auth cleanup refused an identity whose ownership did not match this run");
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: {
    apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
  }, cache: "no-store", redirect: "error" });
  if (!response.ok && response.status !== 404) fail("exact local Auth fixture cleanup failed");
  if (await getAuthUser(userId)) fail("local Auth fixture remained after cleanup");
}

function fixtureSql(f) {
  const content = JSON.stringify({ title: f.tableTitle, localDate: f.tableDate, startLocalTime: "19:00", neighborhood: "Inman Park",
    hostNotes: `PRIVATE W07 run ${f.suffix}`, stops: [
      { role: "drinks", venueId: f.v1, venueName: "Test Bar", venueAddress: "1 Test Way", minutesFromStart: 0, publicNotes: "Drinks" },
      { role: "dinner", venueId: f.v2, venueName: "Test Kitchen", venueAddress: "2 Test Way", minutesFromStart: 60, publicNotes: "Dinner" },
      { role: "dessert", venueId: f.v3, venueName: "Test Cafe", venueAddress: "3 Test Way", minutesFromStart: 120, publicNotes: "Dessert" },
    ] });
  const validation = sql(JSON.stringify({ valid: true, issues: [] }));
  return `begin;
insert into public.app_user_roles(user_id,role) values (${sql(f.adminId)},'admin');
select set_config('app.skip_waitlist_confirmation','on',true);
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game,source) values
  (${sql(f.adminSignup)},${sql(f.adminEmail)},'W07','Admin','1990-01-01','Woman',array['Women'],21,120,'Inman Park',array['Wednesday'],'synthetic W07 browser fixture','Open','Yes, surprise me','landing-page'),
  (${sql(f.memberSignup)},${sql(f.memberEmail)},'W07','Member','1990-01-01','Woman',array['Women','Non-binary people'],21,120,'Inman Park',array['Wednesday'],'synthetic W07 browser fixture','Open','Yes, surprise me','landing-page');
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  (${sql(f.adminAdmission)},${sql(f.adminSignup)},${sql(f.adminEmail)},'activated',${sql(f.adminId)},${sql(f.adminId)},now()),
  (${sql(f.memberAdmission)},${sql(f.memberSignup)},${sql(f.memberEmail)},'activated',${sql(f.adminId)},${sql(f.memberId)},now());
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game) values
  (${sql(f.memberGuest)},${sql(f.memberId)},${sql(f.memberAdmission)},'W07','Member','1990-01-01','woman',array['woman','non_binary'],21,120,'Inman Park',array['Wednesday'],'Open','Yes, surprise me');
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${sql(f.tableId)},'draft','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  (${sql(f.revisionId)},${sql(f.tableId)},1,'draft',${sql(content)}::jsonb,${sql(f.adminId)});
update public.app_supply_table_revisions set state='published' where revision_id=${sql(f.revisionId)};
update public.app_supply_table_heads set lifecycle='published',published_revision_id=${sql(f.revisionId)} where table_id=${sql(f.tableId)};
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state)
  values (${sql(f.requestId)},${sql(f.tableId)},${sql(f.memberGuest)},${sql(f.memberId)},${sql(f.tableTitle)},${sql(f.tableDate)},'19:00','Inman Park','pending');
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at)
  values (${sql(f.proposalId)},${sql(f.tableId)},1,'approved',${sql(f.revisionId)},${validation}::jsonb,${sql(f.adminId)},${sql(f.adminId)},${sql(f.adminId)},${sql(f.adminId)},now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision)
  values (${sql(f.proposalId)},${sql(f.requestId)},${sql(f.memberGuest)},1);
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state)
  values (${sql(f.invitationId)},${sql(f.tableId)},${sql(f.memberGuest)},${sql(f.memberId)},${sql(f.requestId)},${sql(f.proposalId)},${sql(f.adminId)},'active');
insert into public.app_table_invitation_outbox(outbox_id,invitation_id,operation_id,state,attempt_count,queued_at,next_attempt_at,attempted_at,accepted_at,message_kind)
  values (${sql(f.outboxId)},${sql(f.invitationId)},${sql(f.outboxOp)},'accepted',1,now(),now(),now(),now(),'invitation');
commit;`;
}

function cleanupSql(f) {
  const inv = sql(f.invitationId);
  return `begin;
create temp table w07_ids on commit drop as select
  array(select attempt_id from public.app_checkout_attempts where invitation_id=${inv}) attempts,
  array(select payment_id from public.app_payments where attempt_id in (select attempt_id from public.app_checkout_attempts where invitation_id=${inv})) payments,
  array(select seat_id from public.app_seats where invitation_id=${inv}) seats,
  array(select provider_session_id from public.app_checkout_attempts where invitation_id=${inv} and provider_session_id is not null) sessions;
delete from public.app_audit_events where subject_id in (select unnest(attempts||payments||seats) from w07_ids)
  or subject_id in (${[f.tableId,f.requestId,f.proposalId,f.invitationId].map(sql).join(",")}) or actor_user_id in (${[f.adminId,f.memberId].map(sql).join(",")});
delete from public.app_seat_cancellation_notice_outbox where cancellation_request_id in (select cancellation_request_id from public.app_seat_cancellation_requests where seat_id in (select unnest(seats) from w07_ids));
delete from public.app_seat_cancellation_operations where cancellation_request_id in (select cancellation_request_id from public.app_seat_cancellation_requests where seat_id in (select unnest(seats) from w07_ids));
delete from public.app_seat_cancellation_requests where seat_id in (select unnest(seats) from w07_ids);
delete from public.app_refund_work_items where operation_id in (select operation_id from public.app_refund_operations where payment_id in (select unnest(payments) from w07_ids));
delete from public.app_refund_action_operations where refund_operation_id in (select operation_id from public.app_refund_operations where payment_id in (select unnest(payments) from w07_ids));
delete from public.app_refund_operations where payment_id in (select unnest(payments) from w07_ids);
delete from public.app_refund_obligations where payment_id in (select unnest(payments) from w07_ids);
delete from public.app_seats where seat_id in (select unnest(seats) from w07_ids);
delete from public.app_payments where payment_id in (select unnest(payments) from w07_ids);
delete from public.app_checkout_operations where attempt_id in (select unnest(attempts) from w07_ids);
delete from public.app_checkout_attempts where attempt_id in (select unnest(attempts) from w07_ids);
delete from public.app_stripe_checkout_events where session_id in (select unnest(sessions) from w07_ids);
delete from public.app_notice_outbox where recipient_user_id in (${[f.adminId,f.memberId].map(sql).join(",")});
delete from public.app_table_invitation_operations where result->>'invitationId'=${inv};
delete from public.app_table_invitation_outbox where invitation_id=${inv};
delete from public.app_table_invitations where invitation_id=${inv};
delete from public.app_table_roster_proposal_members where proposal_id=${sql(f.proposalId)};
delete from public.app_table_roster_proposals where proposal_id=${sql(f.proposalId)};
delete from public.app_table_requests where request_id=${sql(f.requestId)};
update public.app_supply_table_heads set draft_revision_id=null,accepted_revision_id=null,published_revision_id=null where table_id=${sql(f.tableId)};
delete from public.app_supply_table_revisions where revision_id=${sql(f.revisionId)};
delete from public.app_table_runtime where table_id=${sql(f.tableId)};
delete from public.app_supply_table_heads where table_id=${sql(f.tableId)};
delete from public.app_member_profiles where guest_id=${sql(f.memberGuest)};
delete from public.app_member_link_cooldowns where admission_id in (${sql(f.adminAdmission)},${sql(f.memberAdmission)});
delete from public.app_admissions where id in (${sql(f.adminAdmission)},${sql(f.memberAdmission)});
delete from public.waitlist_signups where id in (${sql(f.adminSignup)},${sql(f.memberSignup)});
delete from public.app_user_roles where user_id=${sql(f.adminId)} and role='admin';
commit;`;
}

async function runPlaywright() {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w07-checkout.config.ts"], { cwd: appRoot, env: process.env, stdio: "inherit" });
  return await new Promise((res, rej) => { child.once("error", () => rej(new Error("Playwright could not start"))); child.once("exit", (code) => res(code ?? 1)); });
}

async function main() {
  await preflight();
  try { mkdirSync(lockPath); } catch { fail("another W07 browser run is active (or left a lock); inspect before retrying"); }
  mkdirSync(screenshots, { recursive: true });
  process.env.JOB_SECRET = randomUUID() + randomUUID(); // per-run secrets, never persisted
  process.env.REFUND_WORKER_SECRET = randomUUID() + randomUUID(); process.env.REFUND_WORKER_ID = randomUUID();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const f = {
    suffix, adminEmail: `w07-admin-${suffix}@example.test`, memberEmail: `w07-member-${suffix}@example.test`, adminId: null, memberId: null,
    adminSignup: randomUUID(), memberSignup: randomUUID(), adminAdmission: randomUUID(), memberAdmission: randomUUID(), memberGuest: randomUUID(),
    tableId: randomUUID(), revisionId: randomUUID(), requestId: randomUUID(), proposalId: randomUUID(), invitationId: randomUUID(),
    outboxId: randomUUID(), outboxOp: randomUUID(), v1: randomUUID(), v2: randomUUID(), v3: randomUUID(), tableTitle: "W07 Checkout Dinner", tableDate: "2026-12-11",
  };
  const createdUsers = []; let seeded = false; let testExit = 1;
  try {
    f.adminId = await createAuthUser(f.adminEmail); createdUsers.push({ id: f.adminId, email: f.adminEmail });
    f.memberId = await createAuthUser(f.memberEmail); createdUsers.push({ id: f.memberId, email: f.memberEmail });
    const seed = command("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], { input: fixtureSql(f), env: { ...process.env, PGPASSWORD: "postgres" } });
    if (seed.status !== 0) fail(`W07 fixture seed failed: ${seed.stderr.split(/\r?\n/).filter((l) => /^ERROR:|DETAIL:/.test(l)).join(" ")}`);
    seeded = true;
    Object.assign(process.env, { W07_ADMIN_EMAIL: f.adminEmail, W07_MEMBER_EMAIL: f.memberEmail, W07_INVITATION_ID: f.invitationId, W07_TABLE_ID: f.tableId, W07_DB_URL: dbUrl });
    testExit = await runPlaywright();
  } finally {
    let cleanupOk = true;
    if (seeded) {
      const cleanup = command("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], { input: cleanupSql(f), env: { ...process.env, PGPASSWORD: "postgres" } });
      if (cleanup.status !== 0) { cleanupOk = false; process.stderr.write(`W07 fixture cleanup failed (Auth users retained): ${cleanup.stderr.split(/\r?\n/).filter((l) => /^ERROR:|DETAIL:/.test(l)).join(" ")}\n`); }
    }
    if (cleanupOk) for (const user of createdUsers.reverse()) await deleteAuthUser(user.id, user.email);
    if (cleanupOk) { try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* lock stays */ } }
    else process.exitCode = 1;
  }
  if (testExit !== 0) process.exitCode = testExit;
  else if (!process.exitCode) console.log("W07 guarded real-stack checkout journey passed; synthetic fixtures cleaned (Stripe TEST-mode session/customer objects remain in the Stripe sandbox).");
}
main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : "W07 run failed"}\n`); process.exitCode = 1; });
