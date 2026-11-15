#!/usr/bin/env node

// W07.1 read-only DB schema/permission acceptance. Never migrates, resets, or
// writes fixtures. Coordinator must apply the reviewed migration locally first.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const api = "http://127.0.0.1:57421";
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
const migration = "20261113161438";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: {
    ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
  } });
  if (result.error) throw result.error;
  return result;
}
function guardedTarget() {
  const config = readFileSync(join(workdir, "supabase", "config.toml"), "utf8");
  assert.match(config, /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m);
  assert.match(config, /^\[api\][\s\S]*?^port\s*=\s*57421\s*$/m);
  assert.match(config, /^\[db\][\s\S]*?^port\s*=\s*57422\s*$/m);
  assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "hosted linked ref is forbidden");
  for (const [name, expected] of [["SUPABASE_URL", api], ["SUPABASE_DB_URL", db], ["DATABASE_URL", db]]) {
    if (process.env[name]) assert.equal(process.env[name], expected, `refusing mismatched ${name}`);
  }
  assert.equal(process.env.SUPABASE_PROJECT_REF, undefined, "hosted project ref is forbidden");
  for (const file of [join(root, ".env"), join(root, ".env.local"), join(root, ".env.test"), join(root, ".env.test.local"),
    join(workdir, ".env"), join(workdir, ".env.local"), join(workdir, ".env.test"), join(workdir, ".env.test.local")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(SUPABASE_PROJECT_REF|SUPABASE_DB_URL|DATABASE_URL|SUPABASE_URL)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, name, raw] = match;
      const value = raw.replace(/^['"]|['"]$/g, "").replace(/\s+#.*$/, "");
      assert.notEqual(name, "SUPABASE_PROJECT_REF", `hosted project ref in ${file}`);
      assert.equal(value, name === "SUPABASE_URL" ? api : db, `refusing mismatched ${name} in ${file}`);
    }
  }
  const status = run(process.execPath, [join(root, "scripts/local-supabase.mjs"), "test", "status"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const history = run("supabase", ["migration", "list", "--local", "--workdir", workdir]);
  assert.equal(history.status, 0, history.stderr);
  assert.ok(history.stdout.split(/\r?\n/).some((line) => line.includes(migration) && !line.includes("|                |")),
    `W07.1 migration ${migration} must be applied by the coordinator after review; this script never migrates`);
}

guardedTarget();
const query = `select concat(
  (select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('app_table_runtime','app_checkout_attempts','app_checkout_operations','app_payments','app_seats'))::text,'|',
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('app_table_runtime','app_checkout_attempts','app_checkout_operations','app_payments','app_seats'))::text,'|',
  (not has_function_privilege('anon','public.read_checkout_eligibility(uuid,uuid,text,text,boolean)','EXECUTE'))::text,'|',
  (not has_function_privilege('authenticated','public.reserve_table_checkout_attempt(uuid,uuid,uuid,integer,integer,text,timestamp with time zone,text)','EXECUTE'))::text,'|',
  has_function_privilege('service_role','public.read_checkout_eligibility(uuid,uuid,text,text,boolean)','EXECUTE')::text,'|',
  has_function_privilege('service_role','public.reserve_table_checkout_attempt(uuid,uuid,uuid,integer,integer,text,timestamp with time zone,text)','EXECUTE')::text,'|',
  (not has_table_privilege('anon','public.app_checkout_attempts','SELECT') and not has_table_privilege('authenticated','public.app_checkout_attempts','SELECT'))::text,'|',
  (not has_table_privilege('anon','public.app_payments','SELECT') and not has_table_privilege('authenticated','public.app_payments','SELECT'))::text,'|',
  (select count(*)=1 from pg_indexes where schemaname='public' and indexname='app_checkout_attempts_one_unresolved_per_invitation')::text,'|',
  (select count(*)=1 from pg_indexes where schemaname='public' and indexname='app_checkout_attempts_provider_session_mode_uq')::text
)`;
const result = run("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", query]);
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stdout.trim(), "true|true|true|true|true|true|true|true|true|true",
  "W07 schema must be RLS protected, service-only and unique by invitation/provider session");
console.log(`checkout-holds-db-test: guarded fifthwheel-rewrite-test; migration ${migration}; RLS, service-only RPC/table grants and hold/session uniqueness passed; read-only, no fixture writes`);
