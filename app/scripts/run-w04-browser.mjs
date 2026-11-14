#!/usr/bin/env node

// Run W04 browser acceptance against only fifthwheel-rewrite-test. This script
// creates and removes exact run-scoped Auth, waitlist, admission, profile,
// review, and file fixtures. It never applies migrations or resets a stack.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testWorkdir = join(appRoot, "test-stack");
const apiUrl = "http://127.0.0.1:57421";
const dbUrl = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const appOrigin = "http://127.0.0.1:8086";
const configPath = join(testWorkdir, "supabase", "config.toml");
const linkedRefPath = join(testWorkdir, "supabase", ".temp", "project-ref");
const migrationPath = join(appRoot, "supabase", "migrations", "20261112171256_member_profile_identity_foundation.sql");

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
  const result = spawnSync(command, args, { cwd: appRoot, encoding: "utf8", ...options });
  if (result.error || result.status !== 0) fail(`${command} preflight failed`);
  return result.stdout ?? "";
}

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function guardEnvironment() {
  const envFile = join(appRoot, ".env.test.local");
  const fallback = join(testWorkdir, ".env.test.local");
  const values = parseEnvFile(existsSync(envFile) ? envFile : fallback);
  for (const [key, value] of Object.entries(values)) process.env[key] ??= value;
  if (process.env.SUPABASE_PROJECT_REF) fail("refusing linked Supabase project for W04 local browser run");
  for (const [key, expected] of [["SUPABASE_URL", apiUrl], ["SUPABASE_DB_URL", dbUrl], ["DATABASE_URL", dbUrl]]) {
    if (process.env[key] && process.env[key] !== expected) fail(`refusing non-test ${key}`);
  }
  process.env.SUPABASE_URL = apiUrl;
  process.env.APP_ORIGIN = appOrigin;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_ANON_KEY) process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_ANON_KEY;
  if (!process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function localStatus() {
  const guarded = spawnSync("node", [join(appRoot, "scripts", "local-supabase.mjs"), "test", "status"], {
    cwd: appRoot, encoding: "utf8", env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (guarded.error || guarded.status !== 0) fail("guarded local test status failed; no fixture was created");
  if (!existsSync(configPath) || !/^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m.test(readFileSync(configPath, "utf8")) || existsSync(linkedRefPath)) {
    fail("test Supabase config does not identify the isolated local project");
  }
  const raw = run("supabase", ["status", "--workdir", testWorkdir, "-o", "json"], {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  const open = raw.indexOf("{"); const close = raw.lastIndexOf("}");
  if (open < 0 || close < open) fail("local test Supabase status is unavailable or malformed");
  const status = JSON.parse(raw.slice(open, close + 1));
  if (status.API_URL !== apiUrl || status.DB_URL !== dbUrl) fail("running Supabase target is not fifthwheel-rewrite-test");
  // Bind every credential to the verified local test project. In CLI v2.105,
  // `SECRET_KEY` is an opaque sb_secret_* key; these RPCs inspect the legacy
  // service-role JWT claim, so use SERVICE_ROLE_KEY explicitly.
  process.env.SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SECRET_KEY = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
  if (!process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY === process.env.SUPABASE_SECRET_KEY) {
    fail("local test API keys are unavailable or invalid");
  }
  const portCheck = spawnSync("lsof", ["-nP", "-iTCP:8086", "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (portCheck.error) fail("lsof is required to confirm the test app port is free; no fixture was created");
  if (portCheck.status === 0 && portCheck.stdout.trim()) fail("test app port 8086 is already occupied; no fixture was created");
  if (portCheck.status !== 0 && portCheck.status !== 1) fail("could not verify test app port 8086; no fixture was created");
  return status;
}

function assertMigrationAndRoutes() {
  if (!existsSync(migrationPath)) fail("W04 migration source is missing");
  const hasTables = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (to_regclass('public.app_member_profiles') is not null)::text || '|' || (to_regclass('public.app_identity_reviews') is not null)::text || '|' || (to_regclass('public.app_profile_files') is not null)::text"], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  }).trim();
  if (hasTables !== "true|true|true") fail("W04 tables are not applied to fifthwheel-rewrite-test; no fixture was created");
  const access = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.app_member_profiles'::regclass,'public.app_identity_reviews'::regclass,'public.app_profile_files'::regclass))::text || '|' || (has_table_privilege('anon','public.app_member_profiles','select') or has_table_privilege('authenticated','public.app_member_profiles','select') or has_table_privilege('anon','public.app_profile_files','select') or has_table_privilege('authenticated','public.app_profile_files','select'))::text || '|' || (select (not b.public and b.file_size_limit=8388608 and b.allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[] and cardinality(b.allowed_mime_types)=3)::text from storage.buckets b where b.id='identity-evidence')"], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  }).trim();
  if (access !== "true|false|true") fail("W04 RLS, direct metadata denial, or private bucket configuration is not ready; no fixture was created");
  const functions = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select (to_regprocedure('public.ensure_member_profile(uuid)') is not null)::text || '|' || (to_regprocedure('public.save_member_profile(uuid,integer,uuid,text,text,date,text,text[],smallint,smallint,text,text[],text,text,text,text)') is not null)::text || '|' || (to_regprocedure('public.create_profile_upload_intent(uuid,integer,integer,uuid,uuid,text,text,integer,text,text,timestamp with time zone)') is not null)::text || '|' || (to_regprocedure('public.prepare_identity_review_read(uuid,uuid,uuid,integer,uuid)') is not null)::text || '|' || (to_regprocedure('public.confirm_identity_review_read_set(uuid,uuid,uuid,integer,uuid,uuid[])') is not null)::text"], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  }).trim();
  if (functions !== "true|true|true|true|true") fail("required W04 RPCs are not applied; no fixture was created");
}

async function createAuthUser(email) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: {} }),
    cache: "no-store", redirect: "error",
  });
  if (!response.ok) fail(`local Auth fixture creation failed (HTTP ${response.status})`);
  const body = await response.json();
  if (typeof body.id !== "string" || body.email?.toLowerCase() !== email.toLowerCase()) fail("local Auth fixture identity response was invalid");
  return body.id;
}

function setupSql(fixture) {
  const signup = (id, email, first, last, openTo) => `insert into public.waitlist_signups (
  id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,
  neighborhood,nights,referral,looking_for,surprise_game,source
) values (${sqlLiteral(id)},${sqlLiteral(email)},${sqlLiteral(first)},'Synthetic','1990-04-14','Woman',${openTo},21,120,
  'Inman Park',array['Wednesday']::text[],'synthetic W04 fixture','Open','Yes, surprise me','landing-page');`;
  const admission = (id, signupId, email, authId) => `insert into public.app_admissions (
  id,waitlist_signup_id,email_normalized,state,approved_by,approved_at,auth_user_id,activated_at
) values (${sqlLiteral(id)},${sqlLiteral(signupId)},${sqlLiteral(email)},'activated',${sqlLiteral(fixture.adminId)},now(),${sqlLiteral(authId)},now());`;
  return `begin;
${signup(fixture.ownerSignupId, fixture.ownerEmail, "W04", "Owner", "array['Women','Non-binary people']")}
${signup(fixture.otherSignupId, fixture.otherEmail, "W04", "Other", "array['Men']")}
insert into public.app_user_roles(user_id,role) values (${sqlLiteral(fixture.adminId)},'admin');
${admission(fixture.ownerAdmissionId, fixture.ownerSignupId, fixture.ownerEmail, fixture.ownerId)}
${admission(fixture.otherAdmissionId, fixture.otherSignupId, fixture.otherEmail, fixture.otherId)}
commit;`;
}

function fixtureEmails(fixture) { return [fixture.ownerEmail, fixture.otherEmail, fixture.adminEmail]; }

async function removeStorageObjects(fixture) {
  const ids = [fixture.ownerId, fixture.otherId].map(sqlLiteral).join(",");
  const output = run("psql", [dbUrl, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    `select coalesce(quarantine_key,'') || E'\\t' || coalesce(normalized_key,'') from public.app_profile_files where auth_user_id in (${ids})`], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  });
  const keys = output.split(/\r?\n/).flatMap((line) => line.split("\t")).map((key) => key.trim()).filter(Boolean);
  if (!keys.length) return;
  const response = await fetch(`${apiUrl}/storage/v1/object/identity-evidence`, {
    method: "DELETE",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: [...new Set(keys)] }), cache: "no-store", redirect: "error",
  });
  if (!response.ok && response.status !== 404) fail("exact W04 fixture storage cleanup failed");
}

function cleanupSql(fixture) {
  const ids = [fixture.ownerId, fixture.otherId].map(sqlLiteral).join(",");
  return `begin;
delete from public.app_identity_reviews where guest_id in (select guest_id from public.app_member_profiles where auth_user_id in (${ids}));
delete from public.app_profile_files where auth_user_id in (${ids});
delete from public.app_member_profiles where auth_user_id in (${ids});
delete from public.app_admissions where id in (${sqlLiteral(fixture.ownerAdmissionId)},${sqlLiteral(fixture.otherAdmissionId)});
delete from public.waitlist_signups where id in (${sqlLiteral(fixture.ownerSignupId)},${sqlLiteral(fixture.otherSignupId)});
delete from public.app_user_roles where user_id=${sqlLiteral(fixture.adminId)} and role='admin';
commit;`;
}

async function deleteAuthUser(userId) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` },
    cache: "no-store", redirect: "error",
  });
  if (!response.ok && response.status !== 404) fail("exact W04 Auth fixture cleanup failed");
}

async function runPlaywright() {
  const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.w04.config.ts"], {
    cwd: appRoot, env: process.env, stdio: "inherit",
  });
  return await new Promise((resolvePromise, reject) => {
    child.once("error", () => reject(new Error("Playwright could not start")));
    child.once("exit", (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  guardEnvironment();
  localStatus();
  assertMigrationAndRoutes();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const fixture = {
    ownerEmail: `w04-owner-${suffix}@example.test`,
    otherEmail: `w04-other-${suffix}@example.test`,
    adminEmail: `w04-admin-${suffix}@example.test`,
    ownerSignupId: randomUUID(), otherSignupId: randomUUID(),
    ownerAdmissionId: randomUUID(), otherAdmissionId: randomUUID(),
    ownerId: null, otherId: null, adminId: null,
  };
  const users = [];
  let seeded = false;
  let result = 1;
  try {
    fixture.ownerId = await createAuthUser(fixture.ownerEmail); users.push(fixture.ownerId);
    fixture.otherId = await createAuthUser(fixture.otherEmail); users.push(fixture.otherId);
    fixture.adminId = await createAuthUser(fixture.adminEmail); users.push(fixture.adminId);
    const seed = spawnSync("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], {
      cwd: appRoot, input: setupSql(fixture), encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" },
    });
    if (seed.error || seed.status !== 0) fail("exact W04 local fixture insert failed");
    seeded = true;
    process.env.W04_OWNER_EMAIL = fixture.ownerEmail;
    process.env.W04_OWNER_ID = fixture.ownerId;
    process.env.W04_OTHER_EMAIL = fixture.otherEmail;
    process.env.W04_OTHER_ID = fixture.otherId;
    process.env.W04_ADMIN_EMAIL = fixture.adminEmail;
    process.env.W04_ADMIN_ID = fixture.adminId;
    result = await runPlaywright();
  } finally {
    let cleanupFailure = null;
    if (seeded) {
      try { await removeStorageObjects(fixture); }
      catch { cleanupFailure = new Error("exact W04 fixture storage cleanup failed"); }
      try {
        const cleanup = spawnSync("psql", [dbUrl, "-X", "-v", "ON_ERROR_STOP=1"], {
          cwd: appRoot, input: cleanupSql(fixture), encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" },
        });
        if (cleanup.error || cleanup.status !== 0) throw new Error("exact W04 database fixture cleanup failed");
      } catch { cleanupFailure ??= new Error("exact W04 database fixture cleanup failed"); }
    }
    for (const userId of users.reverse()) {
      try { await deleteAuthUser(userId); }
      catch { cleanupFailure ??= new Error("exact W04 Auth fixture cleanup failed"); }
    }
    if (cleanupFailure) throw cleanupFailure;
  }
  if (result !== 0) process.exitCode = result;
  else console.log("W04 guarded local browser run passed; exact synthetic rows and Auth users cleaned. PII-free audit events remain by design.");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "W04 local browser run failed"}\n`);
  process.exitCode = 1;
});
