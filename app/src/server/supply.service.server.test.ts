import assert from "node:assert/strict";
import test from "node:test";
import type { SupplySyncRunDTO } from "../supply.contract.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import { createSupplySyncService } from "./supply.service.server.ts";
import type { SupplyProvider, SupplySyncCompletion, SupplySyncRepository, SupplyTableSource, SupplyVenueSource } from "./supply.contract.server.ts";
import { atlantaLocalDateTime } from "./supply.time.server.ts";
import { fixtureModeAllowed } from "./supply-runtime.server.ts";

const adminId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e";
const operationA = "a80394c5-23d2-4c3f-b84d-eec48222ad62";
const operationB = "b80394c5-23d2-4c3f-b84d-eec48222ad62";
const published = { revisionId: "a6b401a5-181f-40c9-a80e-4644955db523", publishedAt: "2026-11-01T12:00:00.000Z" };

function principal(): ServerVerifiedPrincipal {
  return {
    userId: adminId, emailNormalized: "admin@example.test", emailVerified: true,
    staffRoles: new Set(["admin"]), admission: { state: "none", authUserId: null, emailNormalized: null },
    assignedTableIds: new Set(), assignedVenueIds: new Set(),
  };
}

const venue = { sourceRecordId: "venue-1", name: "Example Room", address: "1 Main St", neighborhood: "Inman Park" };
const table = {
  sourceRecordId: "table-1", title: "Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00",
  neighborhood: "Inman Park", publicationIntent: "candidate" as const,
  stops: [
    { role: "drinks" as const, venueSourceRecordId: "venue-1", minutesFromStart: 0 },
    { role: "dinner" as const, venueSourceRecordId: "venue-1", minutesFromStart: 45 },
    { role: "dessert" as const, venueSourceRecordId: "venue-1", minutesFromStart: 120 },
  ] as const,
};

function run(id: string, state: SupplySyncRunDTO["state"] = "running"): SupplySyncRunDTO {
  return {
    runId: id, state, startedAt: "2026-11-12T15:00:00.000Z", finishedAt: null,
    counts: { tablePages: 0, venuePages: 0, tables: 0, venues: 0 },
    candidateRevisionId: null, candidateSourceHash: null, conflictCount: 0, conflicts: [],
    retryDisposition: "safe_to_retry", safeMessage: null,
  };
}

function fixture(overrides: Readonly<{
  tablePages?: readonly Readonly<{ records: unknown; nextCursor: unknown }>[];
  venuePages?: readonly Readonly<{ records: unknown; nextCursor: unknown }>[];
  failTableCursor?: string | null;
  failVenueCursor?: string | null;
  providerState?: SupplyProvider["state"];
}> = {}) {
  const calls = { table: 0, venue: 0, begin: 0, finish: 0, reads: 0 };
  const candidates: unknown[] = [];
  const priorPointer = { ...published };
  const runs = new Map<string, SupplySyncRunDTO>();
  let tablePages = overrides.tablePages;
  let venuePages = overrides.venuePages;
  let failTableCursor = overrides.failTableCursor;
  let failVenueCursor = overrides.failVenueCursor;
  const provider: SupplyProvider = {
    state: overrides.providerState ?? "fixture",
    async listTables(cursor) {
      calls.table += 1;
      if (failTableCursor === cursor) throw new Error("provider_failure");
      const page = tablePages?.[cursor === null ? 0 : 1] ?? { records: cursor === null ? [table] : [], nextCursor: null };
      return page as { records: readonly SupplyTableSource[]; nextCursor: string | null };
    },
    async listVenues(cursor) {
      calls.venue += 1;
      if (failVenueCursor === cursor) throw new Error("provider_failure");
      const page = venuePages?.[cursor === null ? 0 : 1] ?? { records: cursor === null ? [venue] : [], nextCursor: null };
      return page as { records: readonly SupplyVenueSource[]; nextCursor: string | null };
    },
  };
  const repository: SupplySyncRepository = {
    async begin(operationId) {
      calls.begin += 1;
      const prior = runs.get(operationId);
      if (prior) return { run: prior, replay: true };
      const created = run(operationId);
      runs.set(operationId, created);
      return { run: created, replay: false };
    },
    async finish(runId, _actor, completion: SupplySyncCompletion, candidate) {
      calls.finish += 1;
      if (candidate) candidates.push(candidate);
      const priorRun = runs.get(runId)!;
      const result: SupplySyncRunDTO = {
        ...priorRun, state: completion.state, finishedAt: "2026-11-12T15:01:00.000Z",
        counts: completion.counts, candidateRevisionId: candidate ? "b6b401a5-181f-40c9-a80e-4644955db523" : null,
        candidateSourceHash: completion.candidateSourceHash ?? null,
        conflictCount: completion.conflicts?.length ?? 0, conflicts: completion.conflicts ?? [],
        retryDisposition: completion.retryDisposition, safeMessage: completion.safeMessage ?? null,
      };
      runs.set(runId, result);
      return result;
    },
    async readSummary() { calls.reads += 1; return { lastGoodPublished: priorPointer, latestRun: [...runs.values()].at(-1) ?? null }; },
  };
  const service = createSupplySyncService({
    resolvePrincipal: async (token) => token === "admin" ? principal() : token === "member"
      ? { ...principal(), staffRoles: new Set(), admission: { state: "activated", authUserId: adminId, emailNormalized: "admin@example.test" } }
      : token === "host" ? { ...principal(), staffRoles: new Set(["host"]) } : null,
    provider, repository, now: () => new Date("2026-11-12T15:00:00.000Z"),
  });
  return {
    service, calls, candidates, priorPointer, runs,
    setProviderPages(update: Readonly<{
      tablePages?: readonly Readonly<{ records: unknown; nextCursor: unknown }>[];
      venuePages?: readonly Readonly<{ records: unknown; nextCursor: unknown }>[];
      failTableCursor?: string | null | undefined;
      failVenueCursor?: string | null | undefined;
    }>) {
      if ("tablePages" in update) tablePages = update.tablePages;
      if ("venuePages" in update) venuePages = update.venuePages;
      if ("failTableCursor" in update) failTableCursor = update.failTableCursor;
      if ("failVenueCursor" in update) failVenueCursor = update.failVenueCursor;
    },
  };
}

test("sync paginates both entity collections and replay of operation ID does not call provider again", async () => {
  const env = fixture({
    tablePages: [{ records: [], nextCursor: "tables-page-2" }, { records: [table], nextCursor: null }],
    venuePages: [{ records: [], nextCursor: "venues-page-2" }, { records: [venue], nextCursor: null }],
  });
  const first = await env.service.synchronize({ accessToken: "admin", operationId: operationA });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.state, "staged");
  assert.deepEqual(first.value.counts, { tablePages: 2, venuePages: 2, tables: 1, venues: 1 });
  assert.equal(env.candidates.length, 1);
  const second = await env.service.synchronize({ accessToken: "admin", operationId: operationA });
  assert.equal(second.ok, true);
  assert.equal(env.calls.table, 2);
  assert.equal(env.calls.venue, 2);
  assert.equal(env.calls.finish, 1);
});

test("a partial page failure records incomplete while preserving published pointer and staging nothing", async () => {
  const env = fixture({
    tablePages: [{ records: [], nextCursor: "tables-page-2" }],
    failTableCursor: "tables-page-2",
  });
  const result = await env.service.synchronize({ accessToken: "admin", operationId: operationB });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.state, "incomplete");
  assert.equal(result.value.counts.tablePages, 1);
  assert.equal(env.candidates.length, 0);
  const summary = await env.service.readSummary({ accessToken: "admin" });
  assert.equal(summary.ok, true);
  if (summary.ok) assert.deepEqual(summary.value.lastGoodPublished, published);
});

test("a malformed Table page envelope is incomplete and cannot infer absence", async () => {
  const env = fixture({ tablePages: [{ records: null, nextCursor: null }] });
  const result = await env.service.synchronize({ accessToken: "admin", operationId: operationA });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.state, "incomplete");
  assert.deepEqual(result.value.counts, { tablePages: 1, venuePages: 1, tables: 0, venues: 1 });
  assert.equal(env.candidates.length, 0);
  assert.deepEqual(env.priorPointer, published);
});

test("a malformed Venue page envelope is incomplete and cannot infer absence", async () => {
  const env = fixture({ venuePages: [{ records: {}, nextCursor: null }] });
  const result = await env.service.synchronize({ accessToken: "admin", operationId: operationA });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.state, "incomplete");
  assert.deepEqual(result.value.counts, { tablePages: 1, venuePages: 1, tables: 1, venues: 0 });
  assert.equal(env.candidates.length, 0);
  assert.deepEqual(env.priorPointer, published);
});

test("Venue-page failure remains incomplete, then a fresh operation ID recovers with stable mappings", async () => {
  const env = fixture({
    venuePages: [{ records: [], nextCursor: "venues-page-2" }],
    failVenueCursor: "venues-page-2",
  });
  const failed = await env.service.synchronize({ accessToken: "admin", operationId: operationA });
  assert.equal(failed.ok, true);
  if (!failed.ok) return;
  assert.equal(failed.value.state, "incomplete");
  assert.deepEqual(failed.value.counts, { tablePages: 1, venuePages: 1, tables: 1, venues: 0 });
  assert.equal(env.candidates.length, 0);

  env.setProviderPages({ venuePages: [{ records: [venue], nextCursor: null }], failVenueCursor: undefined });
  const recovered = await env.service.synchronize({ accessToken: "admin", operationId: operationB });
  assert.equal(recovered.ok, true);
  if (!recovered.ok) return;
  assert.equal(recovered.value.state, "staged");
  assert.notEqual(failed.value.runId, recovered.value.runId);
  assert.deepEqual(recovered.value.counts, { tablePages: 1, venuePages: 1, tables: 1, venues: 1 });
  assert.equal(env.candidates.length, 1);
  const mappings = (env.candidates[0] as { mappings: { entityKind: string; sourceRecordId: string; coreId: string }[] }).mappings;
  assert.deepEqual(mappings.map((mapping) => [mapping.entityKind, mapping.sourceRecordId]), [
    ["venue", "venue-1"], ["table", "table-1"],
  ]);
  const summary = await env.service.readSummary({ accessToken: "admin" });
  assert.equal(summary.ok, true);
  if (summary.ok) assert.deepEqual(summary.value.lastGoodPublished, published);
});

test("stable source IDs yield stable UUID mappings regardless of input ordering", async () => {
  const first = fixture();
  const second = fixture({ tablePages: [{ records: [{ ...table, title: "Updated title" }], nextCursor: null }] });
  const resultOne = await first.service.synchronize({ accessToken: "admin", operationId: operationA });
  const resultTwo = await second.service.synchronize({ accessToken: "admin", operationId: operationB });
  assert.equal(resultOne.ok && resultTwo.ok, true);
  const mappings = (first.candidates[0] as { mappings: { sourceRecordId: string; coreId: string }[] }).mappings;
  const nextMappings = (second.candidates[0] as { mappings: { sourceRecordId: string; coreId: string }[] }).mappings;
  assert.deepEqual(mappings.map((row) => row.coreId), nextMappings.map((row) => row.coreId));
  assert.notEqual((first.candidates[0] as { sourceHash: string }).sourceHash, (second.candidates[0] as { sourceHash: string }).sourceHash);
});

test("missing venue is an actionable conflict and does not stage a candidate", async () => {
  const badTable: SupplyTableSource = { ...table, stops: table.stops.map((stop, index) => index === 1 ? { ...stop, venueSourceRecordId: "missing" } : stop) as unknown as SupplyTableSource["stops"] };
  const env = fixture({ tablePages: [{ records: [badTable], nextCursor: null }] });
  const result = await env.service.synchronize({ accessToken: "admin", operationId: operationA });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.state, "conflict");
  assert.equal(result.value.conflicts[0]?.code, "missing_venue");
  assert.equal(result.value.conflicts[0]?.stopRole, "dinner");
  assert.equal(env.candidates.length, 0);
  assert.deepEqual(env.priorPointer, published);
});

test("unmapped publication intent blocks staging", async () => {
  const env = fixture({ tablePages: [{ records: [{ ...table, publicationIntent: "unmapped" as const }], nextCursor: null }] });
  const result = await env.service.synchronize({ accessToken: "admin", operationId: operationB });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.state, "conflict");
  assert.equal(result.value.conflicts[0]?.code, "invalid_source_record");
  assert.equal(env.candidates.length, 0);
});

test("unauthorized callers do not read the provider or repository", async () => {
  const env = fixture();
  const result = await env.service.synchronize({ accessToken: null, operationId: operationA });
  assert.equal(result.ok, false);
  assert.deepEqual(env.calls, { table: 0, venue: 0, begin: 0, finish: 0, reads: 0 });
});

test("authenticated non-admin callers cannot read or run supply sync", async () => {
  const env = fixture();
  const summary = await env.service.readSummary({ accessToken: "member" });
  const sync = await env.service.synchronize({ accessToken: "host", operationId: operationA });
  assert.equal(summary.ok, false);
  if (!summary.ok) assert.equal(summary.error.code, "forbidden");
  assert.equal(sync.ok, false);
  if (!sync.ok) assert.equal(sync.error.code, "forbidden");
  assert.deepEqual(env.calls, { table: 0, venue: 0, begin: 0, finish: 0, reads: 0 });
});

test("Atlanta local time rejects DST gaps/folds and accepts valid dates", () => {
  assert.deepEqual(atlantaLocalDateTime("2026-03-08", "02:30"), { ok: false, code: "nonexistent_local_time" });
  assert.deepEqual(atlantaLocalDateTime("2026-11-01", "01:30"), { ok: false, code: "ambiguous_local_time" });
  assert.equal(atlantaLocalDateTime("2026-11-19", "19:00").ok, true);
  assert.equal(atlantaLocalDateTime("0001-02-28", "19:00").ok, true);
  assert.deepEqual(atlantaLocalDateTime("2026-02-30", "19:00"), { ok: false, code: "invalid_date" });
});

test("fixture provider is enabled only for explicit loopback non-production configuration", () => {
  const base = { SUPPLY_PROVIDER_MODE: "fixture", SUPPLY_FIXTURE_RUN_ID: "c0ffee123456", NODE_ENV: "development", APP_ORIGIN: "http://127.0.0.1:8086", SUPABASE_URL: "http://127.0.0.1:57421" };
  assert.equal(fixtureModeAllowed(base), true);
  assert.equal(fixtureModeAllowed({ ...base, NODE_ENV: "production" }), false);
  assert.equal(fixtureModeAllowed({ ...base, APP_ORIGIN: "https://app.example.com" }), false);
  assert.equal(fixtureModeAllowed({ ...base, SUPABASE_URL: "https://project.supabase.co" }), false);
  assert.equal(fixtureModeAllowed({ ...base, SUPPLY_PROVIDER_MODE: "airtable" }), false);
  assert.equal(fixtureModeAllowed({ ...base, SUPPLY_FIXTURE_RUN_ID: "unsafe" }), false);
});
