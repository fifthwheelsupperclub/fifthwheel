#!/usr/bin/env node
// Rollback-only DB acceptance for the nightly Stripe reconciliation RPCs. Isolated local test stack only; never contacts Stripe.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = join(root, "test-stack");
const db = "postgresql://postgres:postgres@127.0.0.1:57422/postgres";
function psql(sql) {
  const r = spawnSync("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout.trim();
}
assert.match(readFileSync(join(workdir, "supabase", "config.toml"), "utf8"), /^project_id\s*=\s*"fifthwheel-rewrite-test"\s*$/m, "wrong local project");
assert.equal(existsSync(join(workdir, "supabase", ".temp", "project-ref")), false, "linked/hosted target forbidden");
assert.equal(psql("select to_regprocedure('public.claim_reconciliation_run()') is not null"), "t", "apply 20261115170000 first");
const admin = "e0840000-0000-4000-8000-000000000001";
assert.equal(psql(`select count(*) from public.app_reconciliation_state`) , "0", "state not empty: run against a clean test stack");

psql(`begin;
set local request.jwt.claims='{"role":"service_role"}';
do $t$
declare v jsonb; n integer;
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ('${admin}','authenticated','authenticated','w10rec-admin@vote.example',now(),'','{}','{}',now(),now());
  insert into public.app_user_roles(user_id,role) values ('${admin}','admin');
  -- first claim is due; an immediate second one is skipped (attempt backoff)
  if (public.claim_reconciliation_run()->>'due')::boolean is not true then raise exception 'first claim not due'; end if;
  if (public.claim_reconciliation_run()->>'due')::boolean is not false then raise exception 'claim not exclusive'; end if;
  -- a complete run records findings and counts them on the overview
  n:=public.record_reconciliation_findings('[{"kind":"paid_not_recorded","ref":"pi_a","detail":{"amountCents":2500}},{"kind":"refund_outside_app","ref":"re_b","detail":{}}]'::jsonb,true);
  if n<>2 then raise exception 'open count % <> 2',n; end if;
  v:=public.read_admin_overview('${admin}');
  if (v->'counts'->>'reconciliationOpen')::int<>2 or jsonb_array_length(v->'reconciliation')<>2 or v->>'reconciliationLastOkAt' is null then raise exception 'overview missing findings %',v; end if;
  -- an incomplete run adds but resolves nothing; a complete run that no longer sees a finding resolves it
  n:=public.record_reconciliation_findings('[{"kind":"reconciliation_incomplete","ref":"stripe","detail":{}}]'::jsonb,false);
  if n<>3 then raise exception 'incomplete run resolved or lost findings (%)',n; end if;
  n:=public.record_reconciliation_findings('[{"kind":"refund_outside_app","ref":"re_b","detail":{}}]'::jsonb,true);
  if n<>1 then raise exception 'complete run did not resolve (%)',n; end if;
  -- a resolved finding that comes back reopens
  n:=public.record_reconciliation_findings('[{"kind":"refund_outside_app","ref":"re_b","detail":{}},{"kind":"paid_not_recorded","ref":"pi_a","detail":{}}]'::jsonb,true);
  if n<>2 then raise exception 'reopen failed (%)',n; end if;
  -- stale check counts as one more problem
  update public.app_reconciliation_state set last_ok_at=clock_timestamp()-interval '40 hours';
  if (public.read_admin_overview('${admin}')->'counts'->>'reconciliationOpen')::int<>3 then raise exception 'stale not flagged'; end if;
  -- bad input and non-service callers are refused
  begin perform public.record_reconciliation_findings('{}'::jsonb,true); raise exception 'object accepted'; exception when sqlstate 'P0001' then null; end;
  begin perform public.record_reconciliation_findings('[{"kind":"made_up","ref":"x"}]'::jsonb,true); raise exception 'unknown kind accepted'; exception when check_violation then null; end;
  set local request.jwt.claims='{"role":"authenticated"}';
  begin perform public.claim_reconciliation_run(); raise exception 'non-service claim allowed'; exception when insufficient_privilege then null; end;
end $t$;
rollback;`);
assert.equal(psql("select count(*) from public.app_reconciliation_state"), "0", "rollback left rows");
console.log("reconciliation-db-test: exclusive claim with backoff, findings recorded/resolved/reopened, incomplete run resolves nothing, overview count and list, stale flag, input and caller guards; rolled back.");
