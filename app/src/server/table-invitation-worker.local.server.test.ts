import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalWorkerSupabaseUrl, runLocalTableInvitationWorker } from "./table-invitation-worker.local.server.ts";

test("one-shot worker rejects a hosted Supabase URL before runtime construction or RPC", async () => {
  let constructors = 0;
  let rpcCalls = 0;
  await assert.rejects(() => runLocalTableInvitationWorker({ SUPABASE_URL: "https://live-project.supabase.co" }, () => {
    constructors++;
    return { async deliverNext() { rpcCalls++; return { state: "idle" }; } };
  }), /local_worker_requires_loopback_supabase/);
  assert.equal(constructors, 0);
  assert.equal(rpcCalls, 0);
});

test("one-shot worker accepts only local HTTP Supabase endpoints", () => {
  assertLocalWorkerSupabaseUrl("http://127.0.0.1:56421");
  assertLocalWorkerSupabaseUrl("http://localhost:56421");
  for (const url of ["https://127.0.0.1:56421", "http://10.0.0.2:56421", "http://localhost:56421/rest", ""]) {
    assert.throws(() => assertLocalWorkerSupabaseUrl(url), /local_worker_requires_loopback_supabase/);
  }
});
