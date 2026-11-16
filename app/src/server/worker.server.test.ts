import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWorkerRequest } from "./worker.server.ts";

const secret = "s".repeat(40);
const req = (auth?: string) => new Request("https://x.test/api/internal/worker", { method: "POST", headers: auth ? { authorization: auth } : {} });
const queue = (states: string[]) => ({ deliverInvitation: async () => ({ state: states.shift() ?? "idle" }), runRefunds: async () => ({ completed: 1 }) });

test("rejects missing, wrong and short secrets before touching any queue", async () => {
  let touched = false;
  const deps = { deliverInvitation: async () => { touched = true; return { state: "idle" }; }, runRefunds: async () => { touched = true; } };
  for (const [auth, env] of [[undefined, { JOB_SECRET: secret }], ["Bearer nope", { JOB_SECRET: secret }], [`Bearer ${"s".repeat(10)}`, { JOB_SECRET: "s".repeat(10) }], [`Bearer ${secret}`, {}]] as const) {
    assert.equal((await handleWorkerRequest(req(auth), env, deps)).status, 401);
  }
  assert.equal(touched, false);
});

test("drains invitations until idle and skips refunds unless ready", async () => {
  const res = await handleWorkerRequest(req(`Bearer ${secret}`), { JOB_SECRET: secret }, queue(["accepted", "accepted", "failed"]));
  assert.deepEqual(await res.json(), { invitations: { delivered: 2, other: 1 }, refunds: "disabled", ok: true });
});

test("runs refunds when ready and reports 500 when a queue throws", async () => {
  const ok = await handleWorkerRequest(req(`Bearer ${secret}`), { JOB_SECRET: secret, REFUND_WORKER_READY: "true" }, queue([]));
  assert.deepEqual((await ok.json()).refunds, { completed: 1 });
  const bad = await handleWorkerRequest(req(`Bearer ${secret}`), { JOB_SECRET: secret }, { deliverInvitation: async () => { throw new Error("x"); }, runRefunds: async () => ({}) });
  assert.equal(bad.status, 500);
});

test("each pass records a heartbeat with compact outcomes and runs retention and purge; a failing step fails the pass but still reports in", async () => {
  const beats: Array<[boolean, Record<string, unknown>]> = [];
  const deps = { deliverInvitation: async () => ({ state: "idle" }), runRefunds: async () => ({}), purgeVotes: async () => ({ ballotsDeleted: 2 }), runRetention: async () => ({ ratingsAnonymized: 1 }),
    recordHeartbeat: async (ok: boolean, summary: Record<string, unknown>) => { beats.push([ok, summary]); } };
  const ok = await handleWorkerRequest(req(`Bearer ${secret}`), { JOB_SECRET: secret }, deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(beats[0], [true, { invitations: "ran", refunds: "disabled", votePurge: "ran", retention: "ran" }]);
  const bad = await handleWorkerRequest(req(`Bearer ${secret}`), { JOB_SECRET: secret }, { ...deps, runRetention: async () => { throw new Error("boom"); } });
  assert.equal(bad.status, 500);
  assert.deepEqual(beats[1], [false, { invitations: "ran", refunds: "disabled", votePurge: "ran", retention: "error" }]);
  const noBeat = await handleWorkerRequest(req(`Bearer ${secret}`), { JOB_SECRET: secret }, { ...deps, recordHeartbeat: async () => { throw new Error("db down"); } });
  assert.equal(noBeat.status, 500);
});

test("reconciliation is reported but never fails the pass or the heartbeat", async () => {
  const beats: Array<[boolean, Record<string, unknown>]> = [];
  const deps = { deliverInvitation: async () => ({ state: "idle" }), runRefunds: async () => ({}), recordHeartbeat: async (ok: boolean, s: Record<string, unknown>) => { beats.push([ok, s]); },
    reconcile: async (): Promise<unknown> => { throw new Error("stripe down"); } };
  const res = await handleWorkerRequest(req(`Bearer ${secret}`), { JOB_SECRET: secret }, deps);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reconciliation, "error");
  assert.deepEqual(beats[0], [true, { invitations: "ran", refunds: "disabled", reconciliation: "error" }]);
});
