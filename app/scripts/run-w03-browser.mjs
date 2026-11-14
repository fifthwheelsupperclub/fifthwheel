#!/usr/bin/env node

// Run the W03 browser journey against only fifthwheel-rewrite-test and local Mailpit.
// This runner creates and removes only its random, run-scoped synthetic fixtures.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "..");
const testWorkdir = join(appRoot, "test-stack");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const mailpitUrl = "http://127.0.0.1:57424";
const mailpitProxyUrl = "http://127.0.0.1:57428";
const mailpitProxyScript = join(appRoot, "scripts", "w03-mailpit-proxy.mjs");
const appOrigin = "http://127.0.0.1:8086";
const marketingOrigin = "http://127.0.0.1:4322";
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");

function fail(message) {
  throw new Error(message);
}

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
  const result = spawnSync(command, args, { cwd: appRoot, encoding: "utf8", ...options });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} preflight failed`);
  return result.stdout ?? "";
}

function loadAndGuardEnvironment() {
  const envFile = join(appRoot, ".env.test.local");
  const fallbackEnvFile = join(testWorkdir, ".env.test.local");
  const fileValues = parseEnvFile(existsSync(envFile) ? envFile : fallbackEnvFile);
  for (const [key, value] of Object.entries(fileValues)) process.env[key] ??= value;

  const forbiddenTarget = process.env.SUPABASE_PROJECT_REF;
  if (forbiddenTarget) fail("refusing SUPABASE_PROJECT_REF for local browser run");
  for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl], ["MAILPIT_URL", mailpitUrl]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}`);
  }
  process.env.SUPABASE_URL = apiUrl;
  process.env.MAILPIT_URL = mailpitUrl;
  process.env.MAIL_FROM_EMAIL ??= "admissions@example.test";
  process.env.MAIL_FROM_NAME ??= "Fifth Wheel Local Test";
  process.env.APP_ORIGIN = appOrigin;
  process.env.MARKETING_ORIGIN = marketingOrigin;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_ANON_KEY) process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY;
  if (!process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function preflight() {
  if (!existsSync(configPath)) fail("isolated test Supabase config is missing");
  const config = readFileSync(configPath, "utf8");
  if (!/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(config)
    || !/^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m.test(config)
    || !/^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m.test(config)
    || existsSync(linkedRefPath)) fail("test Supabase config does not identify the isolated local project");

  const guardedStatus = spawnSync("node", [join(appRoot, "scripts", "local-supabase.mjs"), "test", "status"], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (guardedStatus.error || guardedStatus.status !== 0) fail("guarded local test status failed; no fixture was created");

  for (const [label, port] of [["marketing test", 4322], ["W03 Mailpit proxy", 57428]]) {
    const portCheck = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    if (portCheck.error) fail(`lsof is required to confirm the ${label} port is free; no fixture was created`);
    if (portCheck.status === 0 && portCheck.stdout.trim()) fail(`${label} port ${port} is already occupied; no fixture was created`);
    if (portCheck.status !== 0 && portCheck.status !== 1) fail(`could not verify ${label} port ${port}; no fixture was created`);
  }

  const rawStatus = run("supabase", ["status", "--workdir", testWorkdir, "-o", "json"], {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  const open = rawStatus.indexOf("{");
  const close = rawStatus.lastIndexOf("}");
  if (open < 0 || close < open) fail("test Supabase status response is malformed");
  const status = JSON.parse(rawStatus.slice(open, close + 1));
  if (status.API_URL !== apiUrl || status.DB_URL !== dbUrl) fail("running Supabase target is not fifthwheel-rewrite-test");

  // Local Supabase CLI status is the source of local-only keys when no
  // ignored env file is configured. Keep them in memory; never print them.
  process.env.SUPABASE_PUBLISHABLE_KEY ??= status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SECRET_KEY ??= status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY) fail("test Supabase status did not provide local API keys");
  if (process.env.SUPABASE_SECRET_KEY === process.env.SUPABASE_PUBLISHABLE_KEY) fail("test publishable and secret keys must differ");

  const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=1`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) fail("local test Mailpit is unavailable");
  const procedures = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (to_regprocedure('public.admit_waitlist_signup(uuid,uuid,uuid)') is not null)::text || '|' || (to_regprocedure('public.begin_invitation_delivery_attempt(uuid,uuid,uuid)') is not null)::text || '|' || (to_regprocedure('public.finish_invitation_delivery_attempt(uuid,text,text,text,timestamp with time zone)') is not null)::text || '|' || (to_regprocedure('public.activate_app_admission(uuid,text,timestamp with time zone)') is not null)::text || '|' || (to_regprocedure('public.claim_member_link_cooldown(uuid,timestamp with time zone,integer)') is not null)::text"], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  });
  if (procedures.trim() !== "true|true|true|true|true") fail("required W03 test migrations are not applied; no fixture was created");
}

async function createAuthUser(email, password) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: {}, ...(password ? { password } : {}) }),
    cache: "no-store",
    redirect: "error",
  });
  if (!response.ok) fail("could not create synthetic test admin in local Auth");
  const body = await response.json();
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || body.email?.toLowerCase() !== email) {
    fail("local Auth returned an invalid synthetic admin identity");
  }
  return body.id;
}

async function startMailpitProxy(memberEmail) {
  const child = spawn(process.execPath, [mailpitProxyScript], {
    cwd: appRoot,
    env: { ...process.env, W03_MEMBER_EMAIL: memberEmail },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let exited = false;
  child.once("exit", () => { exited = true; });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (exited || child.exitCode !== null) fail("local W03 Mailpit proxy exited before becoming ready");
    try {
      const response = await fetch(`${mailpitProxyUrl}/__health`, { cache: "no-store", signal: AbortSignal.timeout(500) });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok === true && body?.target === "local-mailpit") return child;
    } catch { /* wait briefly for the loopback listener to bind */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  child.kill("SIGTERM");
  fail("local W03 Mailpit proxy did not become ready");
}

async function stopMailpitProxy(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolvePromise();
    }, 2_000);
    child.once("exit", () => { clearTimeout(timeout); resolvePromise(); });
  });
}

async function runPlaywright(env) {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w03.config.ts"], {
    cwd: appRoot,
    env,
    stdio: "inherit",
  });
  const code = await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", () => rejectPromise(new Error("Playwright could not start")));
    child.once("exit", (exitCode) => resolvePromise(exitCode ?? 1));
  });
  return code;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function setupSql(fixture) {
  return `begin;
insert into public.waitlist_signups (
  id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,
  neighborhood,nights,referral,looking_for,surprise_game,source
) values (
  '${fixture.adminSignupId}',${sqlLiteral(fixture.adminEmail)},'W03','Admin','1990-01-01','Woman',array['Women'],21,120,
  'Inman Park',array['Wednesday']::text[],'synthetic W03 browser fixture','Open','Yes, surprise me','landing-page'
);
insert into public.waitlist_signups (
  id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,
  neighborhood,nights,referral,looking_for,surprise_game,source
) values (
  '${fixture.deletedSignupId}',${sqlLiteral(fixture.deletedEmail)},'W03','Deleted','1990-01-01','Woman',array['Women'],21,120,
  'Inman Park',array['Wednesday']::text[],'synthetic W03 deleted-admission fixture','Open','Yes, surprise me','landing-page'
);
insert into public.app_user_roles (user_id,role) values ('${fixture.adminUserId}','admin');
insert into public.app_user_roles (user_id,role) values ('${fixture.hostUserId}','host');
insert into public.app_user_roles (user_id,role) values ('${fixture.restaurantUserId}','restaurant');
insert into public.app_admissions (
  id,waitlist_signup_id,email_normalized,state,approved_by,approved_at,auth_user_id,activated_at
) values (
  '${fixture.adminAdmissionId}','${fixture.adminSignupId}',${sqlLiteral(fixture.adminEmail)},'activated',
  '${fixture.adminUserId}',now(),'${fixture.adminUserId}',now()
);
insert into public.app_admissions (
  id,waitlist_signup_id,email_normalized,state,approved_by,approved_at,deleted_at
) values (
  '${fixture.deletedAdmissionId}','${fixture.deletedSignupId}',${sqlLiteral(fixture.deletedEmail)},'deleted',
  '${fixture.adminUserId}',now(),now()
);
commit;`;
}

function cleanupSql(fixture) {
  const adminUserId = fixture.adminUserId ? `'${fixture.adminUserId}'::uuid` : "null::uuid";
  const hostUserId = fixture.hostUserId ? `'${fixture.hostUserId}'::uuid` : "null::uuid";
  const restaurantUserId = fixture.restaurantUserId ? `'${fixture.restaurantUserId}'::uuid` : "null::uuid";
  const uninvitedUserId = fixture.uninvitedUserId ? `'${fixture.uninvitedUserId}'::uuid` : "null::uuid";
  const runEmails = [fixture.adminEmail, fixture.memberEmail, fixture.deletedEmail, fixture.honeypotEmail, fixture.underageEmail, fixture.invalidAgeEmail]
    .map(sqlLiteral)
    .join(",");
  return `begin;
delete from public.app_audit_events
where actor_user_id = ${adminUserId}
   or subject_id in (
     select admission.id from public.app_admissions admission
     where admission.email_normalized in (${runEmails})
     union
     select delivery.id from public.app_invitation_deliveries delivery
     join public.app_admissions admission on admission.id = delivery.admission_id
     where admission.email_normalized in (${runEmails})
     union
     select attempt.id from public.app_invitation_delivery_attempts attempt
     join public.app_invitation_deliveries delivery on delivery.id = attempt.delivery_id
     join public.app_admissions admission on admission.id = delivery.admission_id
     where admission.email_normalized in (${runEmails})
   );
delete from public.app_invitation_delivery_attempts attempt
using public.app_invitation_deliveries delivery, public.app_admissions admission
where attempt.delivery_id = delivery.id and delivery.admission_id = admission.id
  and admission.email_normalized in (${runEmails});
delete from public.app_invitation_deliveries delivery
using public.app_admissions admission
where delivery.admission_id = admission.id
  and admission.email_normalized in (${runEmails});
delete from public.app_admissions where email_normalized in (${runEmails});
delete from public.app_user_roles where user_id in (
  ${adminUserId}, ${hostUserId}, ${restaurantUserId}, ${uninvitedUserId}
);
delete from public.waitlist_signups where email_normalized in (${runEmails});
delete from auth.users where email in (${sqlLiteral(fixture.adminEmail)},${sqlLiteral(fixture.memberEmail)},${sqlLiteral(fixture.hostEmail)},${sqlLiteral(fixture.restaurantEmail)},${sqlLiteral(fixture.uninvitedEmail)});
commit;`;
}

function runSql(sql) {
  run("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  });
}

async function main() {
  loadAndGuardEnvironment();
  await preflight();
  const runId = randomUUID().replaceAll("-", "").slice(0, 16);
  const fixture = {
    adminEmail: `w03-admin-${runId}@example.test`,
    memberEmail: `w03-member-${runId}@example.test`,
    deletedEmail: `w03-deleted-${runId}@example.test`,
    honeypotEmail: `w03-honeypot-${runId}@example.test`,
    underageEmail: `w03-underage-${runId}@example.test`,
    invalidAgeEmail: `w03-invalid-age-${runId}@example.test`,
    hostEmail: `w03-host-${runId}@example.test`,
    restaurantEmail: `w03-restaurant-${runId}@example.test`,
    uninvitedEmail: `w03-uninvited-${runId}@example.test`,
    hostPassword: `w03-host-${runId}-fixture`,
    restaurantPassword: `w03-restaurant-${runId}-fixture`,
    uninvitedPassword: `w03-uninvited-${runId}-fixture`,
    adminUserId: null,
    adminSignupId: randomUUID(),
    adminAdmissionId: randomUUID(),
    deletedSignupId: randomUUID(),
    deletedAdmissionId: randomUUID(),
  };
  let mailpitProxy;
  try {
    fixture.adminUserId = await createAuthUser(fixture.adminEmail);
    fixture.hostUserId = await createAuthUser(fixture.hostEmail, fixture.hostPassword);
    fixture.restaurantUserId = await createAuthUser(fixture.restaurantEmail, fixture.restaurantPassword);
    fixture.uninvitedUserId = await createAuthUser(fixture.uninvitedEmail, fixture.uninvitedPassword);
    runSql(setupSql(fixture));
    mailpitProxy = await startMailpitProxy(fixture.memberEmail);
    process.env.MAILPIT_URL = mailpitProxyUrl;
    const childExitCode = await runPlaywright({
      ...process.env,
      APP_ORIGIN: appOrigin,
      SUPABASE_URL: apiUrl,
      MAILPIT_URL: mailpitProxyUrl,
      W03_ADMIN_EMAIL: fixture.adminEmail,
      W03_MEMBER_EMAIL: fixture.memberEmail,
      W03_DELETED_EMAIL: fixture.deletedEmail,
      W03_RUN_ID: runId,
      W03_TEST_DB_URL: dbUrl,
      W03_HONEYPOT_EMAIL: fixture.honeypotEmail,
      W03_UNDERAGE_EMAIL: fixture.underageEmail,
      W03_INVALID_AGE_EMAIL: fixture.invalidAgeEmail,
      W03_HOST_EMAIL: fixture.hostEmail,
      W03_HOST_PASSWORD: fixture.hostPassword,
      W03_RESTAURANT_EMAIL: fixture.restaurantEmail,
      W03_RESTAURANT_PASSWORD: fixture.restaurantPassword,
      W03_UNINVITED_EMAIL: fixture.uninvitedEmail,
      W03_UNINVITED_PASSWORD: fixture.uninvitedPassword,
    });
    if (childExitCode !== 0) process.exitCode = childExitCode;
  } finally {
    if (mailpitProxy) await stopMailpitProxy(mailpitProxy);
    process.env.MAILPIT_URL = mailpitUrl;
    runSql(cleanupSql(fixture));
  }
  console.log("W03 browser journey finished; exact synthetic database fixtures cleaned. Local Mailpit messages remain intercepted locally.");
}

main().catch((error) => {
  console.error(`W03 browser runner stopped safely: ${error.message}`);
  process.exitCode = 1;
});
