#!/usr/bin/env node

// Guarded W06 member browse/request browser acceptance. Uses only the isolated
// fifthwheel-rewrite-test project, run-scoped synthetic rows, and exact cleanup.
// It never resets the database or contacts hosted services/providers.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(root, "test-stack");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const appOrigin = "http://127.0.0.1:8086";
const mailpitUrl = "http://127.0.0.1:57424";
const migration = "20261113043146";
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");
const lockPath = join(tmpdir(), "fifthwheel-rewrite-test-w06-browser.lock");

function fail(message) { throw new Error(message); }
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  return values;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  if (result.error || result.status !== 0) fail(`${command} preflight failed`);
  return result.stdout ?? "";
}
function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function loadAndGuardEnvironment() {
  const primary = join(root, ".env.test.local");
  const fallback = join(testWorkdir, ".env.test.local");
  const values = parseEnvFile(existsSync(primary) ? primary : fallback);
  for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
  if (process.env.SUPABASE_PROJECT_REF) fail("refusing linked Supabase project for W06 browser run; no fixture was created");
  for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}; no fixture was created`);
  }
  if (process.env.MAILPIT_URL && process.env.MAILPIT_URL !== mailpitUrl) fail("refusing non-test MAILPIT_URL; no fixture was created");
  process.env.SUPABASE_URL = apiUrl;
  process.env.MAILPIT_URL = mailpitUrl;
  process.env.MAIL_FROM_EMAIL ??= "admissions@example.test";
  process.env.MAIL_FROM_NAME ??= "Fifth Wheel Local Test";
  process.env.APP_ORIGIN = appOrigin;
}

function verifyLocalTarget() {
  if (!existsSync(configPath) || !/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(readFileSync(configPath, "utf8")) || existsSync(linkedRefPath)) {
    fail("test config does not identify isolated fifthwheel-rewrite-test; no fixture was created");
  }
  run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  const statusText = run("supabase", ["status", "--workdir", testWorkdir, "-o", "json"], { env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" } });
  const start = statusText.indexOf("{"); const end = statusText.lastIndexOf("}");
  if (start < 0 || end < start) fail("isolated Supabase status is malformed; no fixture was created");
  const status = JSON.parse(statusText.slice(start, end + 1));
  if (status.API_URL !== apiUrl || status.DB_URL !== dbUrl) fail("active Supabase target is not fifthwheel-rewrite-test; no fixture was created");
  process.env.SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY === process.env.SUPABASE_SECRET_KEY) {
    fail("isolated local Supabase keys are unavailable; no fixture was created");
  }
  const mailpit = spawnSync(process.execPath, ["-e", `fetch(${JSON.stringify(mailpitUrl + "/api/v1/messages?limit=1")}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`], { encoding: "utf8" });
  if (mailpit.error || mailpit.status !== 0) fail("isolated local test Mailpit is unavailable; no fixture was created");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(process.env.MAIL_FROM_EMAIL)) fail("local test sender is invalid; no fixture was created");
  const history = run("supabase", ["migration", "list", "--local", "--workdir", testWorkdir]);
  if (!history.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                |"))) {
    fail(`W06 migration ${migration} is not applied to the isolated test project; no fixture was created`);
  }
  const port = spawnSync("lsof", ["-nP", "-iTCP:8086", "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (port.error) fail("lsof is required to verify port 8086; no fixture was created");
  if (port.status === 0 && port.stdout.trim()) fail("test app port 8086 is already occupied; no fixture was created");
  if (port.status !== 1) fail("could not verify test app port 8086; no fixture was created");
  return status;
}

async function createAuthUser(email) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST", headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: {} }), cache: "no-store", redirect: "error",
  });
  if (!response.ok) fail(`local W06 Auth fixture creation failed (HTTP ${response.status})`);
  const body = await response.json();
  if (typeof body.id !== "string" || body.email?.toLowerCase() !== email.toLowerCase()) fail("local W06 Auth identity response was invalid");
  return body.id;
}

async function deleteAuthUser(userId) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE", headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` },
    cache: "no-store", redirect: "error",
  });
  if (!response.ok && response.status !== 404) fail("exact W06 Auth fixture cleanup failed");
}

function tableContent(title, date, time, neighborhood, note) {
  return JSON.stringify({ title, localDate: date, startLocalTime: time, neighborhood, hostNotes: `Internal W06 host note: ${note}`, stops: [
    { role: "drinks", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", venueName: "Public Bar", venueAddress: "1 Test Way", minutesFromStart: 0, publicNotes: "First stop" },
    { role: "dinner", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", venueName: "Public Kitchen", venueAddress: "2 Test Way", minutesFromStart: 60, publicNotes: "Dinner notes" },
    { role: "dessert", venueId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", venueName: "Public Cafe", venueAddress: "3 Test Way", minutesFromStart: 120, publicNotes: "Dessert notes" },
  ] });
}

function fixtureSql(f) {
  const content = (title, date, time, neighborhood, note) => sql(tableContent(title, date, time, neighborhood, note));
  return `begin;
insert into public.app_user_roles(user_id,role) values (${sql(f.adminId)},'admin');
insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game,source)
values (${sql(f.memberSignup)},${sql(f.memberEmail)},'W06','Member','1990-04-14','Woman',array['Women','Non-binary people'],21,120,'Inman Park',array['Wednesday'],'W06 synthetic fixture','Open','Yes, surprise me','landing-page'),
       (${sql(f.otherSignup)},${sql(f.otherEmail)},'W06','Other','1990-04-14','Man',array['Women'],21,120,'Chamblee',array['Thursday'],'W06 synthetic fixture','Open','Yes, surprise me','landing-page'),
       (${sql(f.incompleteSignup)},${sql(f.incompleteEmail)},'W06','Incomplete','1990-04-14','Woman',array['Men'],21,120,'Decatur',array['Friday'],'W06 synthetic fixture','Open','Yes, surprise me','landing-page');
insert into public.app_admissions(id,waitlist_signup_id,email_normalized,state,approved_by,auth_user_id,activated_at)
values (${sql(f.memberAdmission)},${sql(f.memberSignup)},${sql(f.memberEmail)},'activated',${sql(f.adminId)},${sql(f.memberId)},now()),
       (${sql(f.otherAdmission)},${sql(f.otherSignup)},${sql(f.otherEmail)},'activated',${sql(f.adminId)},${sql(f.otherId)},now()),
       (${sql(f.incompleteAdmission)},${sql(f.incompleteSignup)},${sql(f.incompleteEmail)},'activated',${sql(f.adminId)},${sql(f.incompleteId)},now());
insert into public.app_member_profiles(guest_id,auth_user_id,admission_id,identity_status,reviewed_identity_version,critical_identity_version,first_name,last_name,date_of_birth,identity,open_to,match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game)
values (${sql(f.memberGuest)},${sql(f.memberId)},${sql(f.memberAdmission)},'approved',1,1,'W06','Member','1990-04-14','woman',array['woman','non_binary'],21,120,'Inman Park',array['Wednesday'],'Open','Yes, surprise me'),
       (${sql(f.otherGuest)},${sql(f.otherId)},${sql(f.otherAdmission)},'approved',1,1,'W06','Other','1990-04-14','man',array['woman'],21,120,'Chamblee',array['Thursday'],'Open','Yes, surprise me'),
       (${sql(f.incompleteGuest)},${sql(f.incompleteId)},${sql(f.incompleteAdmission)},'draft',null,1,'W06','Incomplete','1990-04-14','woman',array['man'],21,120,'Decatur',array['Friday'],'Open','Yes, surprise me');
insert into public.app_supply_table_heads(table_id,lifecycle,sync_state) values
(${sql(f.tableId)},'draft','current'),(${sql(f.otherTableId)},'draft','current'),(${sql(f.pastTableId)},'draft','current'),(${sql(f.draftTableId)},'draft','current');
insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,created_by) values
(${sql(f.tableRevision)},${sql(f.tableId)},1,'draft',${content("W06 Garden Table","2099-06-03","19:00","Inman Park","secret one")}::jsonb,${sql(f.adminId)}),
(${sql(f.otherTableRevision)},${sql(f.otherTableId)},1,'draft',${content("W06 Riverside Table","2099-06-10","19:30","Chamblee","secret two")}::jsonb,${sql(f.adminId)}),
(${sql(f.pastRevision)},${sql(f.pastTableId)},1,'draft',${content("W06 Past Table","2001-06-03","19:00","Inman Park","secret past")}::jsonb,${sql(f.adminId)}),
(${sql(f.draftRevision)},${sql(f.draftTableId)},1,'draft',${content("W06 Hidden Draft","2099-06-04","18:30","Inman Park","secret draft")}::jsonb,${sql(f.adminId)});
update public.app_supply_table_revisions set state='published' where revision_id in (${sql(f.tableRevision)},${sql(f.otherTableRevision)},${sql(f.pastRevision)});
update public.app_supply_table_heads set lifecycle='published',published_revision_id=${sql(f.tableRevision)} where table_id=${sql(f.tableId)};
update public.app_supply_table_heads set lifecycle='published',published_revision_id=${sql(f.otherTableRevision)} where table_id=${sql(f.otherTableId)};
update public.app_supply_table_heads set lifecycle='published',published_revision_id=${sql(f.pastRevision)} where table_id=${sql(f.pastTableId)};
update public.app_supply_table_heads set draft_revision_id=${sql(f.draftRevision)} where table_id=${sql(f.draftTableId)};
commit;`;
}

function cleanupSql(f) {
  const userIds = [f.memberId, f.otherId, f.incompleteId, f.unadmittedId, f.adminId].map(sql).join(",");
  const tableIds = [f.tableId, f.otherTableId, f.pastTableId, f.draftTableId].map(sql).join(",");
  const signupIds = [f.memberSignup, f.otherSignup, f.incompleteSignup].map(sql).join(",");
  return `begin;
delete from public.app_table_request_operations where actor_user_id in (${userIds});
delete from public.app_table_requests where auth_user_id in (${userIds}) or table_id in (${tableIds});
update public.app_supply_table_heads set draft_revision_id=null,accepted_revision_id=null,published_revision_id=null where table_id in (${tableIds});
delete from public.app_supply_table_revisions where table_id in (${tableIds});
delete from public.app_supply_table_heads where table_id in (${tableIds});
delete from public.app_member_profiles where auth_user_id in (${userIds});
delete from public.app_admissions where id in (${[f.memberAdmission,f.otherAdmission,f.incompleteAdmission].map(sql).join(",")});
delete from public.waitlist_signups where id in (${signupIds});
delete from public.app_user_roles where user_id=${sql(f.adminId)} and role='admin';
commit;`;
}

async function runPlaywright() {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w06.config.ts"], { cwd: root, env: process.env, stdio: "inherit" });
  return await new Promise((resolvePromise, reject) => {
    child.once("error", () => reject(new Error("Playwright could not start")));
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  loadAndGuardEnvironment();
  verifyLocalTarget();
  try { mkdirSync(lockPath); } catch { fail("another guarded W06 browser run is active; inspect the test project before retrying"); }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const f = {
    memberEmail: `w06-member-${suffix}@example.test`, otherEmail: `w06-other-${suffix}@example.test`,
    incompleteEmail: `w06-incomplete-${suffix}@example.test`, unadmittedEmail: `w06-unadmitted-${suffix}@example.test`,
    adminId: randomUUID(), memberId: null, otherId: null, incompleteId: null, unadmittedId: null,
    memberSignup: randomUUID(), otherSignup: randomUUID(), incompleteSignup: randomUUID(),
    memberAdmission: randomUUID(), otherAdmission: randomUUID(), incompleteAdmission: randomUUID(),
    memberGuest: randomUUID(), otherGuest: randomUUID(), incompleteGuest: randomUUID(),
    tableId: randomUUID(), otherTableId: randomUUID(), pastTableId: randomUUID(), draftTableId: randomUUID(),
    tableRevision: randomUUID(), otherTableRevision: randomUUID(), pastRevision: randomUUID(), draftRevision: randomUUID(),
  };
  const users = [];
  let fixtureSeeded = false;
  let code = 1;
  try {
    f.memberId = await createAuthUser(f.memberEmail); users.push(f.memberId);
    f.otherId = await createAuthUser(f.otherEmail); users.push(f.otherId);
    f.incompleteId = await createAuthUser(f.incompleteEmail); users.push(f.incompleteId);
    f.unadmittedId = await createAuthUser(f.unadmittedEmail); users.push(f.unadmittedId);
    f.adminId = await createAuthUser(`w06-admin-${suffix}@example.test`); users.push(f.adminId);
    const seed = spawnSync("psql", [dbUrl,"-X","-v","ON_ERROR_STOP=1"], { cwd: root, input: fixtureSql(f), encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } });
    if (seed.error || seed.status !== 0) fail("run-scoped W06 synthetic fixture insert failed");
    fixtureSeeded = true;
    Object.assign(process.env, {
      W06_MEMBER_EMAIL: f.memberEmail, W06_OTHER_MEMBER_EMAIL: f.otherEmail,
      W06_INCOMPLETE_MEMBER_EMAIL: f.incompleteEmail, W06_UNADMITTED_EMAIL: f.unadmittedEmail,
      W06_FUTURE_TABLE_ID: f.tableId, W06_SECOND_TABLE_ID: f.otherTableId,
      MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL,
    });
    code = await runPlaywright();
  } finally {
    let cleanupFailure = null;
    if (fixtureSeeded) {
      const cleanup = spawnSync("psql", [dbUrl,"-X","-v","ON_ERROR_STOP=1"], { cwd: root, input: cleanupSql(f), encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" } });
      if (cleanup.error || cleanup.status !== 0) cleanupFailure = new Error("exact W06 database fixture cleanup failed");
    }
    for (const userId of users.reverse()) {
      try { await deleteAuthUser(userId); } catch { cleanupFailure ??= new Error("exact W06 local Auth fixture cleanup failed"); }
    }
    try { rmSync(lockPath, { recursive: true, force: true }); } catch { cleanupFailure ??= new Error("W06 browser lock cleanup failed"); }
    if (cleanupFailure) throw cleanupFailure;
  }
  if (code !== 0) process.exitCode = code;
  else console.log("W06 guarded local browser journey passed. Synthetic Auth, admission, profile and supply rows were removed; PII-free append-only audit events remain by design.");
}

main().catch((error) => {
  try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
  process.stderr.write(`${error instanceof Error ? error.message : "W06 guarded browser run failed"}\n`);
  process.exitCode = 1;
});
