#!/usr/bin/env node

// W12 real-stack end-to-end journey: roster -> Stripe TEST payment -> Seat email -> proceed/check-in -> vote/reveal -> feedback/report
// -> partial refund + Table cancel -> removal/replacement -> T-48 reminder -> browser edge cases -> evidence cleanup.
// Only the isolated fifthwheel-rewrite-test stack is allowed; Stripe must be sk_test_/pk_test_; mail goes to loopback Mailpit only.
// Bootstrap (env guards, lock, fixtures, cleanup) follows scripts/run-w077-money-browser.mjs.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
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
const lockPath = join(tmpdir(), "fifthwheel-rewrite-test-w12-journey.lock");
const stripeEvents = "checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed";

function fail(message) { throw new Error(message); }
function sql(value) { return value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`; }
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
  if (result.status === 0 && result.stdout.trim()) fail(`${label} port ${port} is already occupied; no fixture was created`);
  if (result.status !== 1) fail(`could not verify ${label} port ${port}; no fixture was created`);
}
function loadAndGuardEnvironment() {
  const envPath = join(appRoot, ".env.test.local");
  const fileValues = parseEnvFile(existsSync(envPath) ? envPath : join(testWorkdir, ".env.test.local"));
  for (const [key, value] of Object.entries(fileValues)) process.env[key] ??= value;
  if (process.env.SUPABASE_PROJECT_REF) fail("refusing linked Supabase project; no fixture was created");
  // Never send real email: the notice and invitation senders use Resend whenever this key is present.
  if (process.env.RESEND_API_KEY) fail("refusing RESEND_API_KEY: this runner only delivers to loopback Mailpit; no fixture was created");
  for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl], ["MAILPIT_URL", mailpitUrl], ["APP_ORIGIN", appUrl]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}; no fixture was created`);
  }
  process.env.SUPABASE_URL = apiUrl; process.env.SUPABASE_DB_URL = dbUrl; process.env.MAILPIT_URL = mailpitUrl; process.env.APP_ORIGIN = appUrl;
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
  for (const key of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]) if (process.env[key] && process.env[key] !== localPublishable) fail(`refusing non-local ${key}; no fixture was created`);
  for (const key of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) if (process.env[key] && process.env[key] !== localSecret) fail(`refusing non-local ${key}; no fixture was created`);
  process.env.SUPABASE_PUBLISHABLE_KEY = localPublishable; process.env.SUPABASE_SECRET_KEY = localSecret;
  if (!localPublishable || !localSecret || localPublishable === localSecret) fail("local Supabase keys are unavailable or invalid; no fixture was created");
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
}

// Starts `stripe listen` with the TEST key unless one already forwards to this app. Its signing secret must equal STRIPE_WEBHOOK_SECRET.
function startStripeListener() {
  if (command("pgrep", ["-f", "stripe listen.*127.0.0.1:8086/api/webhooks/stripe"]).status === 0) return null;
  const env = { ...process.env, STRIPE_API_KEY: process.env.STRIPE_SECRET_KEY }; // via env, so the key is not visible in the process list
  const secret = command("stripe", ["listen", "--print-secret"], { env }).stdout?.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (secret !== process.env.STRIPE_WEBHOOK_SECRET) fail("`stripe listen` signing secret does not match STRIPE_WEBHOOK_SECRET; no fixture was created");
  const child = spawn("stripe", ["listen", "--events", stripeEvents, "--forward-to", `${appUrl}/api/webhooks/stripe`], { stdio: "ignore", env });
  return child;
}

const authHeaders = () => ({ apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` });
async function createAuthUser(email) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: "POST", headers: { ...authHeaders(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: {} }), cache: "no-store", redirect: "error" });
  if (!response.ok) fail(`could not create run-scoped local Auth identity (${response.status})`);
  const body = await response.json();
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || body.email?.toLowerCase() !== email.toLowerCase()) fail("local Auth returned an unexpected identity");
  return body.id;
}
async function getAuthUser(userId) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: { ...authHeaders(), accept: "application/json" }, cache: "no-store", redirect: "error" });
  if (response.status === 404) return null;
  if (!response.ok) fail("could not verify ownership of local Auth fixture during cleanup");
  return await response.json();
}
async function deleteAuthUser(userId, email) {
  const user = await getAuthUser(userId);
  if (!user) return;
  if (user.id !== userId || user.email?.toLowerCase() !== email.toLowerCase()) fail("Auth cleanup refused an identity whose ownership did not match this run");
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: authHeaders(), cache: "no-store", redirect: "error" });
  if (!response.ok && response.status !== 404) fail("exact local Auth fixture cleanup failed");
  if (await getAuthUser(userId)) fail("local Auth fixture remained after cleanup");
}

// ---- Fixture ---------------------------------------------------------------------------------------------------------
// T1 journey: A-D request; the roster is curated in the browser. T2 cancel: E-G invited. T3 removal: I-L invited, M/N applicants.
// T4 retention: Q-S invited; Q's approval is 31 days old and her photo's retention has elapsed (W04.4 + evidence cleanup).
const ROSTER = { 0: ["A", "B", "C", "D"], 1: ["E", "F", "G"], 2: ["I", "J", "K", "L"], 3: ["Q", "R", "S"] };
const APPLICANTS = { 0: ["A", "B", "C", "D"], 1: [], 2: ["M", "N"], 3: [] };
const FIRST = { A: "Avery", B: "Blair", C: "Casey", D: "Drew", E: "Emery", F: "Finley", G: "Gray", I: "Indy", J: "Jules", K: "Kai", L: "Lane", M: "Morgan", N: "Noel", Q: "Quinn", R: "Rory", S: "Sky" };
const localDate = (daysAhead) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() + daysAhead * 86_400_000));

function buildFixture(suffix) {
  const tag = suffix.slice(0, 6);
  const person = (key, table) => ({ key, table, first: FIRST[key], last: `W12${tag}`, email: `w12-${key.toLowerCase()}-${suffix}@example.test`, id: null,
    signup: randomUUID(), admission: randomUUID(), guest: randomUUID(), request: randomUUID(), invitation: randomUUID(), outbox: randomUUID(), outboxOp: randomUUID() });
  const members = [];
  for (const [k, keys] of Object.entries(ROSTER)) for (const key of keys) members.push(person(key, Number(k)));
  members.push(person("M", 2), person("N", 2));
  const tables = [0, 1, 2, 3].map((k) => ({ k, id: randomUUID(), revision: randomUUID(), proposal: randomUUID(),
    title: `W12 ${["Journey", "Cancel", "Removal", "Retention"][k]} ${tag}`, date: localDate(7 + k), venues: [randomUUID(), randomUUID(), randomUUID()] }));
  return { suffix, tag, admin: { email: `w12-admin-${suffix}@example.test`, id: null, signup: randomUUID(), admission: randomUUID() },
    host: { email: `w12-host-${suffix}@example.test`, id: null }, members, tables,
    evidence: { file: randomUUID(), key: `w12/${suffix}/quinn-photo.jpg` } };
}
const list = (xs) => xs.map(sql).join(",");

function fixtureSql(f) {
  const out = ["begin;", `insert into public.app_user_roles(user_id,role) values (${sql(f.admin.id)},'admin'),(${sql(f.host.id)},'host');`];
  const people = [{ ...f.admin, first: "Admin", last: `W12${f.tag}` }, ...f.members];
  for (const p of people) {
    out.push(`insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game,source) values (${sql(p.signup)},${sql(p.email)},${sql(p.first)},${sql(p.last)},'1990-01-01','Woman',array['Women','Non-binary people'],21,120,'Inman Park',array['Wednesday'],'synthetic W12 fixture','Open','Yes, surprise me','landing-page');`);
    out.push(`insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at) values (${sql(p.admission)},${sql(p.signup)},${sql(p.email)},'activated',${sql(f.admin.id)},${sql(p.id)},now());`);
  }
  for (const m of f.members) {
    out.push(`insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game,evidence_received_at) values (${sql(m.guest)},${sql(m.id)},${sql(m.admission)},'approved',1,1,${sql(m.first)},${sql(m.last)},'1990-01-01','woman',array['woman','non_binary'],21,120,'Inman Park',array['Wednesday'],'Open','Yes, surprise me',now()-interval '32 days');`);
  }
  // Quinn: approved 31 days ago. Her photo's retention (30 days after review) is held in the future until stage 9c moves it due,
  // so earlier worker passes cannot delete it before the stage observes the object.
  const q = f.members.find((m) => m.key === "Q");
  out.push(`insert into public.app_identity_reviews(guest_id,attempt_number,profile_revision,critical_identity_version,state,submitted_at,reviewed_at,reviewed_by,evidence_received_at) values (${sql(q.guest)},1,1,1,'approved',now()-interval '32 days',now()-interval '31 days',${sql(f.admin.id)},now()-interval '32 days');`);
  out.push(`insert into public.app_profile_files(file_id,guest_id,auth_user_id,kind,state,content_type,declared_byte_size,actual_byte_size,normalized_byte_size,width,height,profile_revision_at_intent,critical_identity_version,normalized_key,received_at,upload_consumed_at,retention_due_at,created_at) values (${sql(f.evidence.file)},${sql(q.guest)},${sql(q.id)},'photo','ready','image/jpeg',4,4,4,1,1,1,1,${sql(f.evidence.key)},now()-interval '32 days',now()-interval '32 days',now()+interval '1 day',now()-interval '32 days');`);
  const validation = sql(JSON.stringify({ valid: true, issues: [] }));
  for (const t of f.tables) {
    const content = JSON.stringify({ title: t.title, localDate: t.date, startLocalTime: "19:00", neighborhood: "Inman Park", hostNotes: `PRIVATE W12 ${f.suffix}`, stops: ["drinks", "dinner", "dessert"].map((role, j) => ({ role, venueId: t.venues[j], venueName: `W12 ${role} ${f.tag}`, venueAddress: `${j + 1} Test Way`, minutesFromStart: j * 60, publicNotes: role })) });
    out.push(`insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values (${sql(t.id)},'draft','current');`);
    out.push(`insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values (${sql(t.revision)},${sql(t.id)},1,'draft',${sql(content)}::jsonb,${sql(f.admin.id)});`);
    out.push(`update public.app_supply_table_revisions set state='published' where revision_id=${sql(t.revision)};`);
    // As the draft->accept->publish flow leaves it; seeded rosters also mark the Table protected, as roster approval does.
    out.push(`update public.app_supply_table_heads set lifecycle='published',draft_revision_id=${sql(t.revision)},accepted_revision_id=${sql(t.revision)},published_revision_id=${sql(t.revision)},protected_by_activity=${t.k === 0 ? "false" : "true"} where table_id=${sql(t.id)};`);
    t.venues.forEach((v, j) => out.push(`insert into public.app_supply_external_mappings(entity_kind,source_record_id,core_id) values ('venue',${sql(`w12-${f.suffix}-${t.k}-${j}`)},${sql(v)});`));
    const requesters = f.members.filter((m) => m.table === t.k);
    requesters.forEach((m, i) => out.push(`insert into public.app_table_requests(request_id,table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state,created_at) values (${sql(m.request)},${sql(t.id)},${sql(m.guest)},${sql(m.id)},${sql(t.title)},${sql(t.date)},'19:00','Inman Park','pending',now()-interval '${10 - i} hours');`));
    if (t.k === 0) continue; // T1's roster is curated in the browser
    out.push(`insert into public.app_table_roster_proposals(proposal_id,table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at) values (${sql(t.proposal)},${sql(t.id)},1,'approved',${sql(t.revision)},${validation}::jsonb,${sql(f.admin.id)},${sql(f.admin.id)},${sql(f.admin.id)},${sql(f.admin.id)},now(),now());`);
    for (const m of requesters.filter((x) => ROSTER[t.k].includes(x.key))) {
      out.push(`insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version) values (${sql(t.proposal)},${sql(m.request)},${sql(m.guest)},1,1,1);`);
      out.push(`insert into public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by,state) values (${sql(m.invitation)},${sql(t.id)},${sql(m.guest)},${sql(m.id)},${sql(m.request)},${sql(t.proposal)},${sql(f.admin.id)},'active');`);
      out.push(`insert into public.app_table_invitation_outbox(outbox_id,invitation_id,operation_id,state,attempt_count,queued_at,next_attempt_at,attempted_at,accepted_at,message_kind) values (${sql(m.outbox)},${sql(m.invitation)},${sql(m.outboxOp)},'accepted',1,now(),now(),now(),now(),'invitation');`);
    }
  }
  out.push("commit;");
  return out.join("\n");
}

// Deletes everything this run created, keyed by its exact Table, guest and user ids. Rows other runs own are never selected.
function cleanupSql(f) {
  const tabs = list(f.tables.map((t) => t.id)), guests = list(f.members.map((m) => m.guest));
  const users = list([f.admin.id, f.host.id, ...f.members.map((m) => m.id)].filter(Boolean));
  const adm = list([f.admin.admission, ...f.members.map((m) => m.admission)]), sig = list([f.admin.signup, ...f.members.map((m) => m.signup)]);
  return `begin;
create temp table w_inv on commit drop as select invitation_id from public.app_table_invitations where table_id in (${tabs});
create temp table w_att on commit drop as select attempt_id,provider_session_id from public.app_checkout_attempts where table_id in (${tabs}) or invitation_id in (select invitation_id from w_inv);
create temp table w_pay on commit drop as select payment_id from public.app_payments where attempt_id in (select attempt_id from w_att);
create temp table w_seat on commit drop as select seat_id from public.app_seats where table_id in (${tabs});
create temp table w_cr on commit drop as select cancellation_request_id from public.app_seat_cancellation_requests where seat_id in (select seat_id from w_seat);
create temp table w_ob on commit drop as select obligation_id from public.app_refund_obligations where payment_id in (select payment_id from w_pay);
create temp table w_rop on commit drop as select operation_id from public.app_refund_operations where payment_id in (select payment_id from w_pay);
create temp table w_prop on commit drop as select proposal_id from public.app_table_roster_proposals where table_id in (${tabs});
create temp table w_req on commit drop as select request_id from public.app_table_requests where table_id in (${tabs});
create temp table w_out on commit drop as select outbox_id,operation_id from public.app_table_invitation_outbox where invitation_id in (select invitation_id from w_inv);
delete from public.app_audit_events where actor_user_id in (${users}) or subject_id in (${tabs},${guests}) or subject_id in (select invitation_id from w_inv)
  or subject_id in (select attempt_id from w_att) or subject_id in (select payment_id from w_pay) or subject_id in (select seat_id from w_seat)
  or subject_id in (select proposal_id from w_prop) or subject_id in (select request_id from w_req) or subject_id in (select obligation_id from w_ob)
  or subject_id in (select operation_id from w_rop) or subject_id in (select cancellation_request_id from w_cr) or metadata->>'tableId' in (${tabs});
delete from public.app_mutual_results where table_id in (${tabs});
delete from public.app_ballots where table_id in (${tabs});
delete from public.app_ballot_eligibility where table_id in (${tabs});
delete from public.app_vote_periods where table_id in (${tabs});
delete from public.app_ratings where table_id in (${tabs});
delete from public.app_conduct_reports where table_id in (${tabs});
delete from public.app_table_attendance where table_id in (${tabs});
delete from public.app_seat_cancellation_notice_outbox where cancellation_request_id in (select cancellation_request_id from w_cr);
delete from public.app_seat_cancellation_operations where cancellation_request_id in (select cancellation_request_id from w_cr);
delete from public.app_seat_cancellation_requests where cancellation_request_id in (select cancellation_request_id from w_cr);
delete from public.app_refund_work_items where operation_id in (select operation_id from w_rop);
delete from public.app_refund_action_operations where refund_operation_id in (select operation_id from w_rop);
delete from public.app_refund_operations where operation_id in (select operation_id from w_rop);
delete from public.app_refund_obligations where obligation_id in (select obligation_id from w_ob);
delete from public.app_seats where seat_id in (select seat_id from w_seat);
delete from public.app_payments where payment_id in (select payment_id from w_pay);
delete from public.app_checkout_operations where attempt_id in (select attempt_id from w_att);
delete from public.app_checkout_attempts where attempt_id in (select attempt_id from w_att);
delete from public.app_stripe_checkout_events where session_id in (select provider_session_id from w_att where provider_session_id is not null);
delete from public.app_notice_outbox where recipient_user_id in (${users});
delete from public.app_ops_operations where actor_user_id in (${users});
delete from public.app_table_cancel_operations where table_id in (${tabs});
delete from public.app_table_invitation_attempts where outbox_id in (select outbox_id from w_out);
delete from public.app_table_invitation_operations where actor_user_id in (${users}) or result->>'invitationId' in (select invitation_id::text from w_inv);
delete from public.app_table_invitation_outbox where outbox_id in (select outbox_id from w_out);
delete from public.app_table_invitations where invitation_id in (select invitation_id from w_inv);
delete from public.app_table_roster_operations where actor_user_id in (${users});
delete from public.app_table_roster_proposal_members where proposal_id in (select proposal_id from w_prop);
delete from public.app_table_roster_proposals where proposal_id in (select proposal_id from w_prop);
delete from public.app_table_request_operations where actor_user_id in (${users}) or request_id in (select request_id from w_req);
delete from public.app_table_requests where request_id in (select request_id from w_req);
delete from public.app_supply_table_assignments where table_id in (${tabs}) or user_id in (${users});
delete from public.app_staff_contacts where user_id in (${users});
delete from public.app_supply_table_operations where actor_user_id in (${users});
update public.app_supply_table_heads set draft_revision_id=null,accepted_revision_id=null,published_revision_id=null where table_id in (${tabs});
delete from public.app_supply_table_revisions where table_id in (${tabs});
delete from public.app_table_runtime where table_id in (${tabs});
delete from public.app_supply_table_heads where table_id in (${tabs});
delete from public.app_supply_external_mappings where entity_kind='venue' and left(source_record_id,17)=${sql(`w12-${f.suffix}-`)};
delete from public.app_profile_files where guest_id in (${guests});
delete from public.app_identity_reviews where guest_id in (${guests});
delete from public.app_member_profiles where guest_id in (${guests});
delete from public.app_member_link_cooldowns where admission_id in (${adm});
delete from public.app_admissions where id in (${adm});
delete from public.waitlist_signups where id in (${sig});
delete from public.app_user_roles where user_id in (${users});
commit;`;
}

async function expireOpenStripeSessions(f) {
  // Sandbox hygiene: expire sessions this run left open. Never touches a session not recorded for a fixture Table.
  const rows = run("psql", [dbUrl, "-X", "-At", "-c", `select provider_session_id from public.app_checkout_attempts where table_id in (${list(f.tables.map((t) => t.id))}) and provider_session_id is not null`]).split(/\r?\n/).filter(Boolean);
  for (const id of rows) {
    if (!/^cs_test_[A-Za-z0-9]+$/.test(id)) continue;
    try { await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}/expire`, { method: "POST", headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(10_000) }); } catch { /* best effort; already-complete sessions refuse */ }
  }
}
async function uploadEvidence(f) {
  const r = await fetch(`${apiUrl}/storage/v1/object/identity-evidence/${f.evidence.key}`, { method: "POST", headers: { ...authHeaders(), "content-type": "image/jpeg", "x-upsert": "true" }, body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) });
  if (!r.ok) fail(`could not upload the synthetic evidence object (${r.status})`);
}
async function removeEvidence(f) {
  await fetch(`${apiUrl}/storage/v1/object/identity-evidence`, { method: "DELETE", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({ prefixes: [f.evidence.key] }) }).catch(() => undefined);
}
async function deleteMailpitMessages(f) {
  const r = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${f.suffix}"`)}&limit=500`).catch(() => null);
  const ids = r?.ok ? ((await r.json()).messages ?? []).map((m) => m.ID) : [];
  if (ids.length) await fetch(`${mailpitUrl}/api/v1/messages`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ IDs: ids }) }).catch(() => undefined);
}

async function runPlaywright() {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w12-journey.config.ts", ...process.argv.slice(2)], { cwd: appRoot, env: process.env, stdio: "inherit" });
  return await new Promise((res, rej) => { child.once("error", () => rej(new Error("Playwright could not start"))); child.once("exit", (code) => res(code ?? 1)); });
}

// `--recover <suffix>`: rebuilds a failed run's fixture ids from the database (exact suffix, no wildcards beyond it) and cleans it.
async function recover(suffix) {
  if (!/^[0-9a-f]{12}$/.test(suffix)) fail("recover needs the 12-hex-character run suffix");
  const q = (s) => run("psql", [dbUrl, "-X", "-At", "-F", "|", "-c", s]).split(/\r?\n/).filter(Boolean);
  const users = q(`select id,email from auth.users where email ~ '^w12-[a-z]+-${suffix}@example\\.test$'`).map((l) => { const [id, email] = l.split("|"); return { id, email }; });
  const byEmail = (email) => q(`select a.id,a.waitlist_signup_id,coalesce(p.guest_id::text,'') from public.app_admissions a left join public.app_member_profiles p on p.admission_id=a.id where a.email_normalized=${sql(email)}`)[0]?.split("|") ?? [];
  const people = users.map((u) => { const [admission, signup, guest] = byEmail(u.email); return { ...u, admission, signup, guest }; });
  const admin = people.find((p) => p.email.startsWith("w12-admin-")), host = people.find((p) => p.email.startsWith("w12-host-"));
  const members = people.filter((p) => p !== admin && p !== host && p.guest);
  const tables = q(`select h.table_id from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.table_id=h.table_id where r.content->>'hostNotes'=${sql(`PRIVATE W12 ${suffix}`)} group by h.table_id`).map((id) => ({ id }));
  const f = { suffix, tables, members, admin: admin ?? { id: null, admission: randomUUID(), signup: randomUUID() }, host: host ?? { id: null },
    evidence: { key: `w12/${suffix}/quinn-photo.jpg` } };
  if (!f.admin.admission) { f.admin.admission = randomUUID(); f.admin.signup = randomUUID(); }
  if (tables.length && members.length) { // seeded: remove rows first (Auth users are referenced by them)
    await expireOpenStripeSessions(f); await removeEvidence(f);
    const c = command("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], { input: cleanupSql(f) });
    if (c.status !== 0) fail(`recover cleanup failed: ${c.stderr.split(/\r?\n/).filter((l) => /^ERROR:|DETAIL:/.test(l)).join(" ")}`);
  }
  await deleteMailpitMessages(f);
  for (const u of users) await deleteAuthUser(u.id, u.email);
  rmSync(lockPath, { recursive: true, force: true });
  console.log(`recovered run ${suffix}: ${tables.length} Tables, ${users.length} Auth users removed`);
}

async function main() {
  await preflight();
  if (process.argv[2] === "--recover") return await recover(process.argv[3] ?? "");
  try { mkdirSync(lockPath); } catch { fail(`another W12 journey run is active (or left a lock at ${lockPath}); if it failed, run with --recover <its suffix>`); }
  let listener = null;
  process.env.JOB_SECRET = randomUUID() + randomUUID();
  process.env.REFUND_WORKER_SECRET = randomUUID() + randomUUID(); process.env.REFUND_WORKER_ID = randomUUID(); process.env.REFUND_WORKER_READY = "true";
  // Local synthetic supply mode, so the W05.4 edit refusal is exercised through the real editor (never Airtable).
  process.env.SUPPLY_PROVIDER_MODE = "fixture";
  const f = buildFixture(randomUUID().replaceAll("-", "").slice(0, 12));
  process.env.SUPPLY_FIXTURE_RUN_ID = f.suffix;
  console.log(`W12 journey run ${f.suffix} (after a failed cleanup: node scripts/run-w12-journey-browser.mjs --recover ${f.suffix})`);
  const created = []; let seeded = false; let testExit = 1;
  try {
    listener = startStripeListener();
    f.admin.id = await createAuthUser(f.admin.email); created.push({ id: f.admin.id, email: f.admin.email });
    f.host.id = await createAuthUser(f.host.email); created.push({ id: f.host.id, email: f.host.email });
    for (const m of f.members) { m.id = await createAuthUser(m.email); created.push({ id: m.id, email: m.email }); }
    const seed = command("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], { input: fixtureSql(f) });
    if (seed.status !== 0) fail(`W12 fixture seed failed: ${seed.stderr.split(/\r?\n/).filter((l) => /^ERROR:|DETAIL:/.test(l)).join(" ")}`);
    seeded = true;
    await uploadEvidence(f);
    process.env.W12_FIXTURE = JSON.stringify({ db: dbUrl, mailpit: mailpitUrl, suffix: f.suffix, tag: f.tag, adminEmail: f.admin.email, hostEmail: f.host.email, hostId: f.host.id,
      evidence: f.evidence, members: f.members.map((m) => ({ key: m.key, first: m.first, last: m.last, email: m.email, guest: m.guest, request: m.request, invitation: m.invitation, table: m.table })),
      tables: f.tables.map((t) => ({ id: t.id, title: t.title, date: t.date, revision: t.revision, venues: t.venues })) });
    if (listener) await new Promise((r) => setTimeout(r, 4_000)); // let the listener connect before the first checkout
    testExit = await runPlaywright();
  } finally {
    listener?.kill();
    let ok = true;
    if (seeded) {
      await expireOpenStripeSessions(f);
      await removeEvidence(f);
      const c = command("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], { input: cleanupSql(f) });
      if (c.status !== 0) { ok = false; process.stderr.write(`W12 cleanup failed (Auth users retained): ${c.stderr.split(/\r?\n/).filter((l) => /^ERROR:|DETAIL:/.test(l)).join(" ")}\n`); }
      await deleteMailpitMessages(f);
    }
    if (ok) { for (const u of created.reverse()) await deleteAuthUser(u.id, u.email); try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* lock stays */ } }
    else process.exitCode = 1;
  }
  if (testExit !== 0) process.exitCode = testExit;
  else if (!process.exitCode) console.log("W12 journey passed; synthetic fixtures cleaned (Stripe TEST-mode objects remain in the sandbox).");
}
main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : "W12 journey run failed"}\n`); process.exitCode = 1; });
