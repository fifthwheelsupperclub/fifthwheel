#!/usr/bin/env node

// Real local W06.5 invitation delivery + returning magic-link browser journey.
// Only the isolated fifthwheel-rewrite-test stack and Mailpit are allowed.
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
const migration = "20261113142334";
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");
const lockPath = join(tmpdir(), "fifthwheel-rewrite-test-w06-table-invitation.lock");
const screenshots = join(appRoot, "docs", "implementation", "screenshots");
const screenshotStems = ["w065-admin-failed-delivery", "w065-admin-accepted-delivery", "w065-member-invitation-detail", "w065-member-request-offer-overlay"];

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
  const history = run("supabase", ["migration", "list", "--local", "--workdir", testWorkdir]);
  if (!history.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                |"))) {
    fail(`required W06.5 migration ${migration} is not applied locally; no fixture was created`);
  }
  const procedures = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (to_regprocedure('public.read_member_table_invitation(uuid,uuid)') is not null)::text || '|' || (to_regprocedure('public.retry_failed_table_invitation_delivery(uuid,uuid,jsonb)') is not null)::text || '|' || (to_regprocedure('public.begin_next_table_invitation_delivery_attempt(uuid)') is not null)::text || '|' || (to_regprocedure('public.list_admin_table_invitations(uuid,text,integer)') is not null)::text"]);
  if (procedures.trim() !== "true|true|true|true") fail("required W06.5 delivery procedures are missing; no fixture was created");
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
  const tableContent = JSON.stringify({ title: f.tableTitle, localDate: f.tableDate, startLocalTime: "19:00", neighborhood: "Inman Park",
    hostNotes: `PRIVATE W06.5 run ${f.suffix}`, stops: [
      { role: "drinks", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", venueName: "Test Bar", venueAddress: "1 Test Way", minutesFromStart: 0, publicNotes: "Drinks" },
      { role: "dinner", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", venueName: "Test Kitchen", venueAddress: "2 Test Way", minutesFromStart: 60, publicNotes: "Dinner" },
      { role: "dessert", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", venueName: "Test Cafe", venueAddress: "3 Test Way", minutesFromStart: 120, publicNotes: "Dessert" },
    ] });
  const validation = sql(JSON.stringify({ valid: true, issues: [] }));
  return `begin;
insert into public.app_user_roles(user_id,role) values (${sql(f.adminId)},'admin');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game,source) values
  (${sql(f.adminSignup)},${sql(f.adminEmail)},'W06.5','Admin','1990-01-01','Woman',array['Women'],21,120,'Inman Park',array['Wednesday'],'synthetic W06.5 browser fixture','Open','Yes, surprise me','landing-page'),
  (${sql(f.memberSignup)},${sql(f.memberEmail)},'W06.5','Member','1990-01-01','Woman',array['Women','Non-binary people'],21,120,'Inman Park',array['Wednesday'],'synthetic W06.5 browser fixture','Open','Yes, surprise me','landing-page'),
  (${sql(f.otherSignup)},${sql(f.otherEmail)},'W06.5','Other','1990-01-01','Man',array['Women'],21,120,'Chamblee',array['Thursday'],'synthetic W06.5 browser fixture','Open','Yes, surprise me','landing-page');
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values
  (${sql(f.adminAdmission)},${sql(f.adminSignup)},${sql(f.adminEmail)},'activated',${sql(f.adminId)},${sql(f.adminId)},now()),
  (${sql(f.memberAdmission)},${sql(f.memberSignup)},${sql(f.memberEmail)},'activated',${sql(f.adminId)},${sql(f.memberId)},now()),
  (${sql(f.otherAdmission)},${sql(f.otherSignup)},${sql(f.otherEmail)},'activated',${sql(f.adminId)},${sql(f.otherId)},now());
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game) values
  (${sql(f.memberGuest)},${sql(f.memberId)},${sql(f.memberAdmission)},'approved',1,1,'W06.5','Member','1990-01-01','woman',array['woman','non_binary'],21,120,'Inman Park',array['Wednesday'],'Open','Yes, surprise me'),
  (${sql(f.otherGuest)},${sql(f.otherId)},${sql(f.otherAdmission)},'approved',1,1,'W06.5','Other','1990-01-01','man',array['woman'],21,120,'Chamblee',array['Thursday'],'Open','Yes, surprise me');
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${sql(f.tableId)},'draft','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
  (${sql(f.revisionId)},${sql(f.tableId)},1,'draft',${sql(tableContent)}::jsonb,${sql(f.adminId)});
update public.app_supply_table_revisions set state='published' where revision_id=${sql(f.revisionId)};
update public.app_supply_table_heads set lifecycle='published',published_revision_id=${sql(f.revisionId)} where table_id=${sql(f.tableId)};
insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state)
  values (${sql(f.requestId)},${sql(f.tableId)},${sql(f.memberGuest)},${sql(f.memberId)},${sql(f.tableTitle)},${sql(f.tableDate)},'19:00','Inman Park','pending');
insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at)
  values (${sql(f.proposalId)},${sql(f.tableId)},1,'approved',${sql(f.revisionId)},${validation}::jsonb,${sql(f.adminId)},${sql(f.adminId)},${sql(f.adminId)},${sql(f.adminId)},now(),now());
insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version)
  values (${sql(f.proposalId)},${sql(f.requestId)},${sql(f.memberGuest)},1,1,1);
insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state)
  values (${sql(f.invitationId)},${sql(f.tableId)},${sql(f.memberGuest)},${sql(f.memberId)},${sql(f.requestId)},${sql(f.proposalId)},${sql(f.adminId)},'active');
insert into public.app_table_invitation_outbox(outbox_id,invitation_id,operation_id,state,attempt_count,error_code,queued_at,next_attempt_at,attempted_at,message_kind)
  values (${sql(f.outboxId)},${sql(f.invitationId)},${sql(f.outboxOperation)},'failed',1,'synthetic_prior_failure',now(),now()-interval '1 minute',now(),'invitation');
insert into public.app_table_invitation_attempts(attempt_id,outbox_id,operation_id,attempt_number,state,error_code,started_at,finished_at)
  values (${sql(f.attemptId)},${sql(f.outboxId)},${sql(f.attemptOperation)},1,'failed','synthetic_prior_failure',now()-interval '1 minute',now());
commit;`;
}

function collisionSql(f) {
  const emails = [f.adminEmail, f.memberEmail, f.otherEmail].map(sql).join(",");
  const ids = [f.adminSignup,f.memberSignup,f.otherSignup,f.adminAdmission,f.memberAdmission,f.otherAdmission,f.memberGuest,f.otherGuest,
    f.tableId,f.revisionId,f.requestId,f.proposalId,f.invitationId,f.outboxId,f.outboxOperation,f.attemptId,f.attemptOperation].map(sql).join(",");
  return `select concat(
    (not exists(select 1 from auth.users where email in (${emails})))::text,'|',
    (not exists(select 1 from public.waitlist_signups where id in (${ids}) or email_normalized in (${emails})))::text,'|',
    (not exists(select 1 from public.app_admissions where id in (${ids})))::text,'|',
    (not exists(select 1 from public.app_member_profiles where guest_id in (${ids})))::text,'|',
    (not exists(select 1 from public.app_user_roles where user_id in (${ids})))::text,'|',
    (not exists(select 1 from public.app_supply_table_heads where table_id=${sql(f.tableId)}))::text,'|',
    (not exists(select 1 from public.app_supply_table_revisions where revision_id=${sql(f.revisionId)} or table_id=${sql(f.tableId)}))::text,'|',
    (not exists(select 1 from public.app_table_requests where request_id=${sql(f.requestId)} or table_id=${sql(f.tableId)}))::text,'|',
    (not exists(select 1 from public.app_table_roster_proposals where proposal_id=${sql(f.proposalId)} or table_id=${sql(f.tableId)}))::text,'|',
    (not exists(select 1 from public.app_table_roster_proposal_members where proposal_id=${sql(f.proposalId)} or request_id=${sql(f.requestId)}))::text,'|',
    (not exists(select 1 from public.app_table_invitations where invitation_id=${sql(f.invitationId)} or source_request_id=${sql(f.requestId)}))::text,'|',
    (not exists(select 1 from public.app_table_invitation_outbox where outbox_id=${sql(f.outboxId)} or invitation_id=${sql(f.invitationId)} or operation_id=${sql(f.outboxOperation)}))::text,'|',
    (not exists(select 1 from public.app_table_invitation_attempts where attempt_id=${sql(f.attemptId)} or operation_id=${sql(f.attemptOperation)}))::text,'|',
    (not exists(select 1 from public.app_table_invitation_operations where operation_id=${sql(f.retryOperation)}))::text)`;
}

function authIdCollisionSql(f) {
  const authIds = [f.adminId,f.memberId,f.otherId].map(sql).join(",");
  return `select concat(
    (not exists(select 1 from public.app_user_roles where user_id in (${authIds})))::text,'|',
    (not exists(select 1 from public.app_admissions where auth_user_id in (${authIds})))::text,'|',
    (not exists(select 1 from public.app_member_profiles where auth_user_id in (${authIds})))::text,'|',
    (not exists(select 1 from public.app_audit_events where actor_user_id in (${authIds})))::text)`;
}

function cleanupSql(f) {
  return `begin;
delete from public.app_audit_events where subject_id in (${[f.tableId,f.requestId,f.proposalId,f.invitationId,f.attemptId].map(sql).join(",")})
  or operation_id in (select operation_id from public.app_table_invitation_operations where result->>'invitationId'=${sql(f.invitationId)});
delete from public.app_table_invitation_operations where result->>'invitationId'=${sql(f.invitationId)};
delete from public.app_table_invitation_attempts where outbox_id=${sql(f.outboxId)};
delete from public.app_table_invitation_outbox where outbox_id=${sql(f.outboxId)};
delete from public.app_table_invitations where invitation_id=${sql(f.invitationId)};
delete from public.app_table_roster_proposal_members where proposal_id=${sql(f.proposalId)};
delete from public.app_table_roster_proposals where proposal_id=${sql(f.proposalId)};
delete from public.app_table_requests where request_id=${sql(f.requestId)};
update public.app_supply_table_heads set draft_revision_id=null,accepted_revision_id=null,published_revision_id=null where table_id=${sql(f.tableId)};
delete from public.app_supply_table_revisions where revision_id=${sql(f.revisionId)};
delete from public.app_table_runtime where table_id=${sql(f.tableId)};
delete from public.app_supply_table_heads where table_id=${sql(f.tableId)};
delete from public.app_member_profiles where guest_id in (${sql(f.memberGuest)},${sql(f.otherGuest)});
delete from public.app_member_link_cooldowns where admission_id in (${sql(f.adminAdmission)},${sql(f.memberAdmission)},${sql(f.otherAdmission)});
delete from public.app_admissions where id in (${sql(f.adminAdmission)},${sql(f.memberAdmission)},${sql(f.otherAdmission)});
delete from public.waitlist_signups where id in (${sql(f.adminSignup)},${sql(f.memberSignup)},${sql(f.otherSignup)});
delete from public.app_user_roles where user_id=${sql(f.adminId)} and role='admin';
commit;`;
}

async function mailpitSearch(email) {
  const url = new URL("/api/v1/search", mailpitUrl); url.searchParams.set("query", `to:${email}`); url.searchParams.set("limit", "50");
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) fail("local Mailpit search failed");
  const body = await response.json();
  if (!body || !Array.isArray(body.messages)) fail("local Mailpit returned an invalid message search response");
  return body.messages;
}
function messageAddresses(message) {
  return Array.isArray(message.To) ? message.To.map((row) => typeof row?.Address === "string" ? row.Address.toLowerCase() : "") : [];
}
async function captureOwnedMailpitMessageIds(f) {
  const ids = [];
  for (const email of [f.adminEmail,f.memberEmail,f.otherEmail]) {
    const summaries = await mailpitSearch(email);
    for (const summary of summaries) {
      if (typeof summary.ID !== "string") fail("Mailpit message search omitted its message ID");
      const response = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(summary.ID)}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) fail("could not verify a run-scoped Mailpit message during cleanup");
      const detail = await response.json();
      const addresses = messageAddresses(detail);
      if (!addresses.length || addresses.some((address) => address !== email.toLowerCase())) fail("Mailpit cleanup refused a message not addressed exclusively to this run's synthetic account");
      ids.push(summary.ID);
    }
  }
  return [...new Set(ids)];
}
async function deleteOwnedMailpitMessages(ids) {
  if (!ids.length) return;
  const response = await fetch(`${mailpitUrl}/api/v1/messages`, { method: "DELETE", headers: { "content-type": "application/json", accept: "text/plain" },
    body: JSON.stringify({ IDs: ids }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) fail("exact run-scoped Mailpit message cleanup failed");
  for (const id of ids) {
    const check = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(id)}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
    if (check.status !== 404) fail("a run-scoped Mailpit message remained after exact cleanup");
  }
}

async function runPlaywright() {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w065-table-invitation.config.ts"], {
    cwd: appRoot, env: process.env, stdio: "inherit",
  });
  return await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", () => rejectPromise(new Error("Playwright could not start")));
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function currentOutboxState(f) {
  const result = command("psql", [dbUrl,"-X","-At","-v","ON_ERROR_STOP=1","-c",`select state from public.app_table_invitation_outbox where outbox_id=${sql(f.outboxId)}`]);
  if (result.status !== 0) return "unverified";
  return result.stdout.trim() || "missing";
}

async function main() {
  await preflight();
  try { mkdirSync(lockPath); } catch { fail("another W06.5 browser run is active; inspect the local test project before retrying"); }
  mkdirSync(screenshots, { recursive: true });
  for (const stem of screenshotStems) for (const width of ["desktop", "390px"]) {
    try { unlinkSync(join(screenshots, `${stem}-${width}.png`)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const f = {
    suffix,
    adminEmail: `w065-admin-${suffix}@example.test`, memberEmail: `w065-member-${suffix}@example.test`, otherEmail: `w065-other-${suffix}@example.test`,
    adminId: null, memberId: null, otherId: null,
    adminSignup: randomUUID(), memberSignup: randomUUID(), otherSignup: randomUUID(),
    adminAdmission: randomUUID(), memberAdmission: randomUUID(), otherAdmission: randomUUID(),
    memberGuest: randomUUID(), otherGuest: randomUUID(), tableId: randomUUID(), revisionId: randomUUID(), requestId: randomUUID(),
    proposalId: randomUUID(), invitationId: randomUUID(), outboxId: randomUUID(), outboxOperation: randomUUID(), attemptId: randomUUID(),
    attemptOperation: randomUUID(), retryOperation: randomUUID(), tableTitle: "Friday Dinner in Inman Park", tableDate: "2026-12-11",
  };
  const createdUsers = [];
  let fixtureSeeded = false;
  let preservedForReconciliation = false;
  let testExit = 1;
  try {
    const collision = run("psql", [dbUrl,"-X","-At","-v","ON_ERROR_STOP=1","-c",collisionSql(f)]);
    if (collision.trim() !== "true|true|true|true|true|true|true|true|true|true|true|true|true|true") fail("synthetic W06.5 fixture collision detected; no fixture was created");
    for (const email of [f.adminEmail,f.memberEmail,f.otherEmail]) {
      if ((await mailpitSearch(email)).length !== 0) fail("run-scoped synthetic email already exists in local Mailpit; no fixture was created");
    }
    f.adminId = await createAuthUser(f.adminEmail); createdUsers.push({ id: f.adminId, email: f.adminEmail });
    f.memberId = await createAuthUser(f.memberEmail); createdUsers.push({ id: f.memberId, email: f.memberEmail });
    f.otherId = await createAuthUser(f.otherEmail); createdUsers.push({ id: f.otherId, email: f.otherEmail });
    if (run("psql", [dbUrl,"-X","-At","-v","ON_ERROR_STOP=1","-c",authIdCollisionSql(f)]).trim() !== "true|true|true|true") {
      fail("new Auth identities unexpectedly collide with existing app rows; fixture was not seeded");
    }
    const seed = command("psql", [dbUrl,"-X","-v","ON_ERROR_STOP=1"], { input: fixtureSql(f), env: { ...process.env, PGPASSWORD: "postgres" } });
    if (seed.status !== 0) {
      const cause = seed.stderr.split(/\r?\n/).filter((line) => /^(ERROR:|LINE\s+\d+:|DETAIL:)/.test(line)).join(" ")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[synthetic-email]").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[fixture-id]");
      fail(`run-scoped W06.5 database fixture seed failed${cause ? `: ${cause}` : ""}`);
    }
    fixtureSeeded = true;
    Object.assign(process.env, {
      W065_ADMIN_EMAIL: f.adminEmail, W065_MEMBER_EMAIL: f.memberEmail, W065_OTHER_EMAIL: f.otherEmail,
      W065_INVITATION_ID: f.invitationId, W065_OUTBOX_ID: f.outboxId, W065_TABLE_ID: f.tableId, W065_TABLE_TITLE: f.tableTitle,
      W065_MEMBER_ID: f.memberId, W065_OTHER_MEMBER_ID: f.otherId, W065_DB_URL: dbUrl,
    });
    testExit = await runPlaywright();
  } finally {
    if (fixtureSeeded) {
      const state = await currentOutboxState(f);
      if (state === "unknown" || state === "sending" || state === "unverified") {
        preservedForReconciliation = true;
        process.stderr.write(`W06.5 local delivery state '${state}' was left visible for reconciliation. Invitation ${f.invitationId}; admin ${f.adminEmail}; member ${f.memberEmail}. No resend or cleanup was attempted.\n`);
      } else {
        // Prove every message belongs only to one random synthetic recipient before deleting anything.
        const messageIds = await captureOwnedMailpitMessageIds(f);
        const cleanup = command("psql", [dbUrl,"-X","-v","ON_ERROR_STOP=1"], { input: cleanupSql(f), env: { ...process.env, PGPASSWORD: "postgres" } });
        if (cleanup.status !== 0) fail("exact run-scoped W06.5 database fixture cleanup failed; Auth and Mailpit state were retained for inspection");
        for (const user of createdUsers.reverse()) await deleteAuthUser(user.id, user.email);
        await deleteOwnedMailpitMessages(messageIds);
      }
    } else {
      for (const user of createdUsers.reverse()) await deleteAuthUser(user.id, user.email);
    }
    if (!preservedForReconciliation) { try { rmSync(lockPath, { recursive: true, force: true }); } catch { fail("W06.5 run lock cleanup failed"); } }
  }
  if (preservedForReconciliation) process.exitCode = 1;
  else if (testExit !== 0) process.exitCode = testExit;
  else console.log(`W06.5 guarded local browser journey passed; synthetic Auth, admission, profile, Table, request, proposal, invitation, outbox, attempts, audit and exact Mailpit messages were cleaned. Screenshots: ${join(screenshots, "w065-")}*.png`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "W06.5 local browser run failed"}\n`);
  // Preserve the lock if cleanup failed; it is a useful safeguard against a second run.
  process.exitCode = 1;
});
