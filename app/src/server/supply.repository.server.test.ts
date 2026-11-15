import assert from "node:assert/strict";
import test from "node:test";
import { createSupplySyncRepository, SupplyRepositoryError } from "./supply.repository.server.ts";

const config = { url: "http://127.0.0.1:57421", publishableKey: "publishable-test", secretKey: "server-secret-test" };
const runRow = {
  run_id: "c4c59d7b-c557-440e-b48a-59ff46316805", operation_id: "c4c59d7b-c557-440e-b48a-59ff46316803",
  actor_user_id: "c4c59d7b-c557-440e-b48a-59ff46316801", state: "running",
  started_at: "2026-11-12T20:00:00.000Z", finished_at: null,
  table_pages: 0, venue_pages: 0, table_count: 0, venue_count: 0,
  candidate_revision_id: null, candidate_source_hash: null, conflict_count: 0, conflicts: [],
  retry_disposition: "blocked", safe_message: null,
};

test("begin sends operation and actor only to the server RPC and parses idempotency marker", async () => {
  const capture: { request?: { url: string; init: RequestInit } } = {};
  const repository = createSupplySyncRepository({
    ...config,
    fetch: async (input, init) => {
      capture.request = { url: String(input), init: init ?? {} };
      return Response.json({ run: runRow, created: true });
    },
  });
  const result = await repository.begin(runRow.operation_id, runRow.actor_user_id);
  assert.equal(result.replay, false);
  assert.equal(result.run.runId, runRow.run_id);
  assert.equal(capture.request?.url, "http://127.0.0.1:57421/rest/v1/rpc/begin_supply_sync");
  const headers = new Headers(capture.request?.init.headers);
  assert.equal(headers.get("apikey"), config.secretKey);
  assert.equal(headers.get("authorization"), `Bearer ${config.secretKey}`);
  assert.equal(String(capture.request?.init.body).includes(config.secretKey), false);
  assert.deepEqual(JSON.parse(String(capture.request?.init.body)), {
    p_operation_id: runRow.operation_id, p_actor_user_id: runRow.actor_user_id,
  });
});

test("finish maps candidate/conflict totals to the atomic RPC and summary parses published pointer", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const repository = createSupplySyncRepository({
    ...config,
    fetch: async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith("finish_supply_sync")) return Response.json({ ...runRow, state: "conflict", finished_at: "2026-11-12T20:01:00.000Z", conflict_count: 101 });
      return Response.json({
        latestRun: { ...runRow, state: "conflict", finished_at: "2026-11-12T20:01:00.000Z", conflict_count: 101 },
        lastGoodPublished: { revisionId: "c4c59d7b-c557-440e-b48a-59ff46316806", publishedAt: "2026-11-01T12:00:00.000Z" },
      });
    },
  });
  const result = await repository.finish(runRow.run_id, runRow.actor_user_id, {
    state: "conflict", counts: { tablePages: 1, venuePages: 1, tables: 1, venues: 1 },
    totalConflictCount: 101, conflicts: [], retryDisposition: "blocked",
  });
  assert.equal(result.conflictCount, 101);
  assert.equal(requests[0]?.body.p_total_conflict_count, 101);
  const summary = await repository.readSummary(runRow.actor_user_id);
  assert.equal(summary.latestRun?.state, "conflict");
  assert.equal(summary.lastGoodPublished?.revisionId, "c4c59d7b-c557-440e-b48a-59ff46316806");
  assert.equal(requests[1]?.url.endsWith("read_supply_sync_summary"), true);
});

test("malformed RPC rows and unsuccessful provider responses become safe repository errors", async () => {
  const malformed = createSupplySyncRepository({ ...config, fetch: async () => Response.json({ run: {}, created: true }) });
  await assert.rejects(() => malformed.begin(runRow.operation_id, runRow.actor_user_id), (error: unknown) => error instanceof SupplyRepositoryError && error.code === "response_invalid");
  const rejected = createSupplySyncRepository({ ...config, fetch: async () => new Response("raw db detail", { status: 400 }) });
  await assert.rejects(() => rejected.begin(runRow.operation_id, runRow.actor_user_id), (error: unknown) => error instanceof SupplyRepositoryError && error.code === "request_failed");
});
