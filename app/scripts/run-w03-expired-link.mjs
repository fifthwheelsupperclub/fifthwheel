#!/usr/bin/env node

// Focused W03 acceptance for a returning magic link after Auth OTP expiry.
// This script only uses the guarded fifthwheel-rewrite-test Supabase project,
// real local Auth/Mailpit, and exact run-scoped synthetic fixtures.

import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(appRoot, "test-stack");
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");
const wrapperPath = join(appRoot, "scripts", "local-supabase.mjs");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const mailpitUrl = "http://127.0.0.1:57424";
const appOrigin = "http://127.0.0.1:8086";

function fail(message) { throw new Error(message); }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", ...options.env },
    ...options,
  });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  return result;
}

function guarded(action) {
  const result = run(process.execPath, [wrapperPath, "test", action]);
  if (result.status !== 0) fail(`guarded test-stack ${action} failed; no other project was targeted`);
  return result.stdout.trim();
}

function parseConfig(text) {
  let section = "";
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1]; continue; }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!assignment) continue;
    const [, key, raw] = assignment;
    if (section === "" && key === "project_id") values.projectId = raw.replace(/^"|"$/g, "");
    if (section === "api" && key === "port") values.apiPort = Number(raw);
    if (section === "db" && key === "port") values.dbPort = Number(raw);
    if (section === "auth.email" && key === "otp_expiry") values.otpExpiry = Number(raw);
  }
  return values;
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = rawLine.trim().match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  return values;
}

function checkEnvironmentTargets() {
  if (process.env.SUPABASE_PROJECT_REF) fail("refusing SUPABASE_PROJECT_REF");
  for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl], ["MAILPIT_URL", mailpitUrl]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}`);
  }
  for (const path of [
    join(appRoot, ".env"), join(appRoot, ".env.local"), join(appRoot, ".env.test"),
    join(testWorkdir, ".env"), join(testWorkdir, ".env.local"), join(testWorkdir, ".env.test"),
    join(appRoot, ".env.test.local"), join(testWorkdir, ".env.test.local"),
  ]) {
    const env = parseEnvFile(path);
    if (env.SUPABASE_PROJECT_REF) fail(`refusing project-ref target in ${path}`);
    for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["NEXT_PUBLIC_SUPABASE_URL", apiUrl], ["VITE_SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl]]) {
      if (env[key] && env[key] !== expected) fail(`refusing non-test ${key} in ${path}`);
    }
    if (env.MAILPIT_URL && env.MAILPIT_URL !== mailpitUrl) fail(`refusing non-test MAILPIT_URL in ${path}`);
  }
}

function checkPortsAndProject() {
  const docker = run("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"]);
  if (docker.status !== 0) fail("cannot verify Docker project/port ownership; no stack or config change attempted");
  const containers = docker.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    return { name: line.slice(0, tab), ports: line.slice(tab + 1) };
  });
  const rangeContainers = containers.filter((container) => /(?:^|:)(?:5742[0-9])(?:->|\/)/.test(container.ports));
  if (!rangeContainers.length || rangeContainers.some((container) => !container.name.endsWith("_fifthwheel-rewrite-test"))) {
    fail("a Supabase test-range port is foreign or project ownership is not provable; no mutation attempted");
  }
  for (const port of [57421, 57422, 57424]) {
    if (!rangeContainers.some((container) => container.ports.includes(`:${port}->`))) {
      fail(`isolated test service port ${port} is not mapped by its expected project`);
    }
  }
  const appPort = run("lsof", ["-nP", "-iTCP:8086", "-sTCP:LISTEN", "-t"]);
  if (appPort.error) fail("lsof is required to prove the browser-test app port is free");
  if (appPort.status === 0 && appPort.stdout.trim()) fail("browser-test app port 8086 is already occupied");
  if (appPort.status !== 1 && appPort.status !== 0) fail("could not verify browser-test app port 8086");
}

function supabaseStatus() {
  const result = run("supabase", ["status", "--workdir", testWorkdir, "-o", "json"]);
  if (result.status !== 0) fail("Supabase CLI could not confirm local test project identity");
  const first = result.stdout.indexOf("{");
  const last = result.stdout.lastIndexOf("}");
  if (first < 0 || last < first) fail("Supabase test status was malformed");
  const status = JSON.parse(result.stdout.slice(first, last + 1));
  if (status.API_URL !== apiUrl || status.DB_URL !== dbUrl) fail("running Supabase target is not fifthwheel-rewrite-test");
  if (!status.PUBLISHABLE_KEY && !status.ANON_KEY) fail("test Auth did not return a local publishable key");
  if (!status.SECRET_KEY && !status.SERVICE_ROLE_KEY) fail("test Auth did not return a local service key");
  return {
    publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
  };
}

function runSql(sql) {
  const result = run("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  });
  if (result.status !== 0) {
    const safeError = (result.stderr ?? "").split(/\r?\n/).find((line) => /^ERROR:/i.test(line))
      ?.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
      ?.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[redacted-id]")
      ?.slice(0, 300);
    fail(`run-scoped SQL fixture operation failed against the verified local test database${safeError ? `: ${safeError}` : ""}`);
  }
}

function sqlLiteral(value) { return `'${value.replaceAll("'", "''")}'`; }

function fixtureSql(fixture) {
  return `begin;
do $guard$ begin
  if (select count(*) from auth.users where id = '${fixture.authUserId}' and lower(email) = ${sqlLiteral(fixture.email)}) <> 1
    or exists (select 1 from public.waitlist_signups where id = '${fixture.signupId}' or email_normalized = ${sqlLiteral(fixture.email)})
    or exists (select 1 from public.app_admissions where id = '${fixture.admissionId}' or email_normalized = ${sqlLiteral(fixture.email)})
  then raise exception 'run-scoped expired-link fixture collision'; end if;
end; $guard$;
insert into public.waitlist_signups (
  id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,
  neighborhood,nights,referral,looking_for,surprise_game,source
) values (
  '${fixture.signupId}',${sqlLiteral(fixture.email)},'Expired','Link','1990-01-01','Woman',array['Women'],21,120,
  'Inman Park',array['Wednesday']::text[],'synthetic expired-link acceptance fixture','Open','Yes, surprise me','landing-page'
);
insert into public.app_admissions (
  id,waitlist_signup_id,email_normalized,state,approved_by,approved_at,auth_user_id,activated_at
) values (
  '${fixture.admissionId}','${fixture.signupId}',${sqlLiteral(fixture.email)},'activated',
  '${fixture.authUserId}',now(),'${fixture.authUserId}',now()
);
commit;`;
}

function cleanupSql(fixture) {
  if (!fixture?.email) return;
  return `begin;
delete from public.app_member_link_cooldowns where admission_id = '${fixture.admissionId}';
delete from public.app_admissions where id = '${fixture.admissionId}' and email_normalized = ${sqlLiteral(fixture.email)};
delete from public.waitlist_signups where id = '${fixture.signupId}' and email_normalized = ${sqlLiteral(fixture.email)};
commit;`;
}

async function createAuthUser(email, secretKey) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: {} }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`local Auth fixture creation failed (HTTP ${response.status})`);
  const body = await response.json();
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || body.email?.toLowerCase() !== email) fail("local Auth returned a mismatched synthetic fixture identity");
  return body.id;
}

async function removeAuthUser(userId, secretKey) {
  if (!userId) return;
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 404) fail(`exact synthetic Auth fixture cleanup failed (HTTP ${response.status})`);
}

function setOtpExpiry(text, seconds) {
  let section = "";
  let changes = 0;
  const updated = text.split(/(?<=\n)/).map((line) => {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) section = header[1];
    if (section === "auth.email" && /^\s*otp_expiry\s*=\s*\d+\s*(?:#.*)?(?:\r?\n)?$/.test(line)) {
      changes += 1;
      return line.replace(/(^\s*otp_expiry\s*=\s*)\d+/, `$1${seconds}`);
    }
    return line;
  }).join("");
  if (changes !== 1) fail("expected one active [auth.email].otp_expiry setting");
  return updated;
}

function assertGuardedStatus() {
  const output = guarded("status");
  if (!output.includes("fifthwheel-rewrite-test") || !output.includes("57421") || !output.includes("57422")) fail("guarded status did not confirm expected local test identity");
}

async function main() {
  checkEnvironmentTargets();
  if (!existsSync(configPath) || existsSync(linkedRefPath)) fail("isolated test config is missing or linked project metadata exists");
  const originalConfig = readFileSync(configPath);
  const configText = originalConfig.toString("utf8");
  const before = parseConfig(configText);
  if (before.projectId !== "fifthwheel-rewrite-test" || before.apiPort !== 57421 || before.dbPort !== 57422 || before.otpExpiry !== 3600) {
    fail("active local test TOML identity, ports or expected original OTP expiry do not match; no mutation attempted");
  }
  checkPortsAndProject();
  assertGuardedStatus();
  supabaseStatus();
  const initialHash = createHash("sha256").update(originalConfig).digest("hex");
  const fixture = {
    email: `w03-expired-${randomUUID().replaceAll("-", "").slice(0, 18)}@example.test`,
    signupId: randomUUID(),
    admissionId: randomUUID(),
    authUserId: null,
  };
  let credentials;
  let configChanged = false;
  let stackStopped = false;
  let fixtureSqlCommitted = false;
  let primaryError = null;
  let restoreError = null;

  try {
    guarded("stop");
    stackStopped = true;
    writeFileSync(configPath, setOtpExpiry(configText, 2), { mode: 0o600 });
    configChanged = true;
    if (parseConfig(readFileSync(configPath, "utf8")).otpExpiry !== 2) fail("temporary OTP expiry did not persist exactly");
    guarded("start");
    stackStopped = false;
    assertGuardedStatus();
    credentials = supabaseStatus();
    const mailpit = await fetch(`${mailpitUrl}/api/v1/messages?limit=1`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!mailpit.ok) fail("isolated local test Mailpit did not respond");

    fixture.authUserId = await createAuthUser(fixture.email, credentials.secretKey);
    runSql(fixtureSql(fixture));
    fixtureSqlCommitted = true;
    const browser = run(process.execPath, [
      "node_modules/@playwright/test/cli.js", "test", "--config", "playwright.w03-expired.config.ts",
    ], {
      env: {
        ...process.env,
        APP_ENV: "test",
        APP_ORIGIN: appOrigin,
        SUPABASE_URL: apiUrl,
        SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
        SUPABASE_SECRET_KEY: credentials.secretKey,
        MAILPIT_URL: mailpitUrl,
        MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL ?? "admissions@example.test",
        W03_EXPIRED_EMAIL: fixture.email,
      },
    });
    if (browser.status !== 0) fail("expired returning-link browser acceptance failed");
    console.log(browser.stdout.trim());
    console.log("Expired-link acceptance passed against the actual local Auth/Mailpit link; member session was not created.");
  } catch (error) {
    primaryError = error;
  } finally {
    if (fixtureSqlCommitted) {
      try { runSql(cleanupSql(fixture)); }
      catch (error) { restoreError ??= error; }
    }
    if (credentials?.secretKey && fixture.authUserId) {
      try { await removeAuthUser(fixture.authUserId, credentials.secretKey); }
      catch (error) { restoreError ??= error; }
    }
    if (configChanged || stackStopped) {
      try {
        if (!stackStopped) {
          guarded("stop");
          stackStopped = true;
        }
        writeFileSync(configPath, originalConfig, { mode: 0o600 });
        if (createHash("sha256").update(readFileSync(configPath)).digest("hex") !== initialHash) fail("original test config bytes were not restored");
        stackStopped = false;
        guarded("start");
        assertGuardedStatus();
        const restored = parseConfig(readFileSync(configPath, "utf8"));
        if (restored.projectId !== "fifthwheel-rewrite-test" || restored.apiPort !== 57421 || restored.dbPort !== 57422 || restored.otpExpiry !== 3600) fail("restored test config values differ from original");
      } catch (error) {
        restoreError ??= error;
      }
    }
  }

  if (primaryError || restoreError) {
    const details = [primaryError?.message, restoreError ? `restore/cleanup: ${restoreError.message}` : null].filter(Boolean).join("; ");
    console.error(`W03 expired-link verification stopped: ${details}`);
    process.exitCode = 1;
  } else {
    console.log("Test stack restored and restarted with the exact original config (OTP expiry 3600); only the run-scoped fixture was removed.");
  }
}

main().catch((error) => {
  console.error(`W03 expired-link verification preflight failed safely: ${error.message}`);
  process.exitCode = 1;
});
