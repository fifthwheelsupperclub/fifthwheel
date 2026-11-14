#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const [target, action, ...extra] = args;

function fail(message) {
  console.error(`local-supabase: ${message}`);
  process.exit(1);
}

function stripTomlComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === "#" && !quoted) return line.slice(0, index);
  }
  return line;
}

function parseActiveConfig(text) {
  const parsed = { projectId: undefined, apiPort: undefined, dbPort: undefined };
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!assignment) continue;
    const [, key, value] = assignment;
    let field;
    if (section === "" && key === "project_id") field = "projectId";
    if (section === "api" && key === "port") field = "apiPort";
    if (section === "db" && key === "port") field = "dbPort";
    if (!field) continue;
    if (parsed[field] !== undefined) throw new Error(`duplicate active TOML setting: ${field}`);
    if (field === "projectId") {
      if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) throw new Error("project_id must be a quoted TOML string");
      parsed[field] = JSON.parse(value);
    } else {
      if (!/^\d+$/.test(value)) throw new Error(`${field} must be an integer`);
      parsed[field] = Number(value);
    }
  }
  if (!parsed.projectId || !parsed.apiPort || !parsed.dbPort) throw new Error("missing active project_id/api.port/db.port setting");
  return parsed;
}

function supabasePorts(isTest) {
  return isTest
    ? [57420, 57421, 57422, 57423, 57424, 57425, 57426, 57427, 57428, 57429]
    : [56420, 56421, 56422, 56423, 56424, 56425, 56426, 56427, 56428, 56429];
}

function guardedEnvFiles(root, workdir, includeTestLocal) {
  const files = [
    join(root, ".env"), join(root, ".env.local"), join(root, ".env.test"),
    join(workdir, ".env"), join(workdir, ".env.local"), join(workdir, ".env.test"),
  ];
  if (includeTestLocal) files.push(join(root, ".env.test.local"), join(root, "test-stack", ".env.test.local"));
  return [...new Set(files)];
}

function targetViolation(key, rawValue, source, expectedApi, expectedDb) {
  const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
  if (!value) return null;
  if (key === "SUPABASE_PROJECT_REF") return `${source} sets ${key}; local operations refuse project-ref targets`;
  if (key === "SUPABASE_DB_URL" || key === "DATABASE_URL") {
    return value === expectedDb ? null : `${source} sets ${key} to a non-target database; unset it before local operations`;
  }
  return value.replace(/\/$/, "") === expectedApi
    ? null
    : `${source} sets ${key} to a non-target API; unset it before local operations`;
}

function selfCheck() {
  const fixture = `
# project_id = "commented-hosted-project"
project_id = "fifthwheel-rewrite-test"
[api]
# port = 54321
port = 57421
[api.tls]
port = 54323
[db]
port = 57422
`;
  const parsed = parseActiveConfig(fixture);
  if (parsed.projectId !== "fifthwheel-rewrite-test" || parsed.apiPort !== 57421 || parsed.dbPort !== 57422) {
    throw new Error("active TOML parser fixture failed");
  }
  if (supabasePorts(true).includes(8086)) throw new Error("test app port is in the Supabase collision set");
  const files = guardedEnvFiles("/fixture/app", "/fixture/app/test-stack", true);
  for (const path of ["/fixture/app/.env.test.local", "/fixture/app/test-stack/.env.test.local"]) {
    if (!files.includes(path)) throw new Error(`missing .env.test.local guard: ${path}`);
  }
  const hosted = targetViolation("SUPABASE_URL", "https://hosted.example.invalid", "/fixture/app/.env.test.local", "http://127.0.0.1:57421", "postgresql://postgres:postgres@127.0.0.1:57422/postgres");
  if (!hosted?.includes("non-target API")) throw new Error("hosted-like env fixture was not rejected");
  console.log("local-supabase self-check passed: active TOML, Supabase ports, both .env.test.local guards");
}

if (args.length === 1 && args[0] === "self-check") {
  try {
    selfCheck();
    process.exit(0);
  } catch (error) {
    fail(error.message);
  }
}

if (!(["dev", "test"].includes(target) && ["start", "status", "reset", "seed", "test", "stop"].includes(action)) || extra.length) {
  fail("usage: node scripts/local-supabase.mjs <dev|test> <start|status|reset|seed|test|stop> | self-check");
}

const isTest = target === "test";
const projectId = isTest ? "fifthwheel-rewrite-test" : "fifthwheel-rewrite-dev";
const workdir = isTest ? join(appRoot, "test-stack") : appRoot;
const configPath = join(workdir, "supabase", "config.toml");
const apiPort = isTest ? 57421 : 56421;
const dbPort = isTest ? 57422 : 56422;
const ports = supabasePorts(isTest);
const expectedApi = `http://127.0.0.1:${apiPort}`;
const expectedDb = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;

if (!existsSync(configPath)) fail(`missing isolated config: ${configPath}`);

let activeConfig;
try {
  activeConfig = parseActiveConfig(readFileSync(configPath, "utf8"));
} catch (error) {
  fail(`cannot verify active Supabase config: ${error.message}`);
}
if (activeConfig.projectId !== projectId || activeConfig.apiPort !== apiPort || activeConfig.dbPort !== dbPort) {
  fail(`active TOML identity/config mismatch; expected ${projectId} with API/database ${apiPort}/${dbPort}`);
}
if (isTest) {
  const source = realpathSync(join(appRoot, "supabase", "migrations"));
  const linked = realpathSync(join(workdir, "supabase", "migrations"));
  if (source !== linked) fail("test migrations must resolve to the canonical app/supabase/migrations directory");
}

const linkRefPath = join(workdir, "supabase", ".temp", "project-ref");
if (existsSync(linkRefPath)) fail("linked project metadata exists; unlink/inspect this workdir before local operations");

const guardedKeys = new Set([
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "VITE_SUPABASE_URL",
]);

function validateTargetValue(key, rawValue, source) {
  const violation = targetViolation(key, rawValue, source, expectedApi, expectedDb);
  if (violation) fail(violation);
}

for (const key of guardedKeys) {
  if (process.env[key]) validateTargetValue(key, process.env[key], "environment");
}

const envFiles = guardedEnvFiles(appRoot, workdir, ["reset", "seed", "test"].includes(action));
for (const path of envFiles) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL|SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL|VITE_SUPABASE_URL)\s*=\s*(.*?)\s*$/);
    if (match) validateTargetValue(match[1], match[2].replace(/\s+#.*$/, ""), path);
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", ...options });
  if (result.error) fail(`could not run ${command}: ${result.error.message}`);
  return result;
}

function checkPortCollisions() {
  for (const port of ports) {
    const listeners = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    if (listeners.error) fail("lsof is required to verify local port ownership before startup");
    const pids = listeners.stdout.trim().split(/\s+/).filter(Boolean);
    if (!pids.length) continue;

    const containers = run("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"]);
    if (containers.error || containers.status !== 0) fail("cannot verify whether a busy port belongs to this local Docker project");
    const names = containers.stdout.trim().split(/\s+/).filter(Boolean);
    if (!names.length || names.some((name) => !name.endsWith(`_${projectId}`))) {
      fail(`port collision on ${port}; an unrelated process or Supabase project is listening`);
    }
  }
}

function readLocalStatus() {
  const result = run("supabase", ["status", "--workdir", workdir, "-o", "json"], {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
  });
  if (result.status !== 0) fail(`${projectId} is not running or its local status could not be verified`);
  let status;
  try {
    const firstBrace = result.stdout.indexOf("{");
    const lastBrace = result.stdout.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace < firstBrace) throw new Error("JSON not found");
    status = JSON.parse(result.stdout.slice(firstBrace, lastBrace + 1));
  } catch {
    fail("Supabase status did not return valid JSON; no operation was attempted");
  }
  if (status.API_URL !== expectedApi || status.DB_URL !== expectedDb) {
    fail(`${projectId} status points at unexpected API/database addresses; no operation was attempted`);
  }
  return status;
}

function startLocal() {
  checkPortCollisions();
  const result = run("supabase", ["start", "--workdir", workdir], {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
  });
  if (result.status !== 0) fail(`Supabase start failed for ${projectId}; check Docker health and the reserved ports`);
  readLocalStatus();
  console.log(`Started ${projectId}: API ${expectedApi}, database 127.0.0.1:${dbPort}`);
}

if (action === "start") {
  startLocal();
} else if (action === "status") {
  readLocalStatus();
  console.log(`${projectId}: API ${expectedApi}, database 127.0.0.1:${dbPort}`);
} else if (action === "reset" || action === "seed") {
  const seedPath = join(workdir, "supabase", "seed.sql");
  if (action === "seed" && !existsSync(seedPath)) fail(`no isolated seed file exists at ${seedPath}`);
  readLocalStatus();
  const resetArgs = ["db", "reset", "--local", "--workdir", workdir, "--yes"];
  if (action === "reset") resetArgs.push("--no-seed");
  const result = run("supabase", resetArgs, { env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } });
  if (result.status !== 0) fail(`local ${action} failed for ${projectId}; no linked or database-URL target was used`);
  readLocalStatus();
  console.log(`Completed local ${action} for ${projectId} only`);
} else if (action === "test") {
  checkPortCollisions();
  const pkg = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
  if (!pkg.scripts?.test) fail("no package test script is configured yet; target and port guards passed");
  startLocal();
  const status = readLocalStatus();
  const result = run("pnpm", ["--dir", appRoot, "test"], {
    env: {
      ...process.env,
      APP_ENV: "test",
      DO_NOT_TRACK: "1",
      SUPABASE_URL: status.API_URL,
      SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
      DATABASE_URL: status.DB_URL,
      SUPABASE_PROJECT_REF: "",
      SUPABASE_DB_URL: "",
    },
    stdio: "inherit",
  });
  if (result.status !== 0) fail("local test command failed");
} else if (action === "stop") {
  const result = run("supabase", ["stop", "--project-id", projectId, "--workdir", workdir, "--yes"], {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
  });
  if (result.status !== 0) fail(`could not stop only ${projectId}`);
  console.log(`Stopped ${projectId} only`);
}
