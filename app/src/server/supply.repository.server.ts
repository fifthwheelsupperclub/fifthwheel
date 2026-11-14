/** Server-only PostgREST adapter for transactional supply sync RPCs. */

import type { SupplyLastGoodPublished, SupplySyncConflict, SupplySyncRunDTO } from "../supply.contract.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { SupplySyncCompletion, SupplySyncRepository } from "./supply.contract.server.ts";

export type SupplyRepositoryFetch = typeof fetch;
export type SupplyRepositoryErrorCode = "configuration_invalid" | "request_failed" | "response_invalid" | "operation_conflict" | "forbidden";

export class SupplyRepositoryError extends Error {
  readonly code: SupplyRepositoryErrorCode;
  constructor(code: SupplyRepositoryErrorCode) { super(code); this.name = "SupplyRepositoryError"; this.code = code; }
}

type Env = Readonly<Record<string, string | undefined>>;
type Config = SupabaseServerConfig & Readonly<{ fetch?: SupplyRepositoryFetch }>;

function validUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function validIso(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function parseConflict(value: unknown): SupplySyncConflict | null {
  if (!isRecord(value) || (value.entityKind !== "table" && value.entityKind !== "venue") || !Number.isInteger(value.recordOrdinal) || (value.recordOrdinal as number) < 1) return null;
  const fields = new Set(["source", "title", "schedule", "neighborhood", "stops", "venue"]);
  const codes = new Set(["duplicate_source_id", "invalid_source_record", "invalid_date", "invalid_time", "nonexistent_local_time", "ambiguous_local_time", "invalid_stop_set", "missing_venue", "invalid_venue"]);
  const roles = new Set(["drinks", "dinner", "dessert"]);
  if (!fields.has(String(value.field)) || !codes.has(String(value.code)) || typeof value.message !== "string" || value.message.length > 180) return null;
  if (value.stopRole !== undefined && !roles.has(String(value.stopRole))) return null;
  return value as unknown as SupplySyncConflict;
}

function parseRun(value: unknown): SupplySyncRunDTO {
  if (!isRecord(value) || !validUuid(value.run_id) || !validUuid(value.operation_id)
    || !["running", "staged", "no_change", "incomplete", "conflict", "failed"].includes(String(value.state))
    || !validIso(value.started_at) || (value.finished_at !== null && !validIso(value.finished_at))) {
    throw new SupplyRepositoryError("response_invalid");
  }
  const conflicts = Array.isArray(value.conflicts) ? value.conflicts.map(parseConflict) : null;
  if (!conflicts || conflicts.some((entry) => entry === null)) throw new SupplyRepositoryError("response_invalid");
  const counts = {
    tablePages: value.table_pages, venuePages: value.venue_pages, tables: value.table_count, venues: value.venue_count,
  };
  if (Object.values(counts).some((count) => !Number.isInteger(count) || Number(count) < 0)) throw new SupplyRepositoryError("response_invalid");
  if (value.candidate_revision_id !== null && !validUuid(value.candidate_revision_id)) throw new SupplyRepositoryError("response_invalid");
  if (value.candidate_source_hash !== null && (typeof value.candidate_source_hash !== "string" || !/^[a-f0-9]{64}$/.test(value.candidate_source_hash))) throw new SupplyRepositoryError("response_invalid");
  if (!["safe_to_retry", "new_operation_required", "blocked"].includes(String(value.retry_disposition))) throw new SupplyRepositoryError("response_invalid");
  return Object.freeze({
    runId: value.run_id, state: value.state as SupplySyncRunDTO["state"], startedAt: value.started_at,
    finishedAt: value.finished_at as string | null,
    counts: counts as SupplySyncRunDTO["counts"],
    candidateRevisionId: value.candidate_revision_id as string | null,
    candidateSourceHash: value.candidate_source_hash as string | null,
    conflictCount: Number(value.conflict_count), conflicts: conflicts as SupplySyncConflict[],
    retryDisposition: value.retry_disposition as SupplySyncRunDTO["retryDisposition"],
    safeMessage: typeof value.safe_message === "string" ? value.safe_message.slice(0, 180) : null,
  });
}

function parseSummary(value: unknown): Readonly<{ lastGoodPublished: SupplyLastGoodPublished | null; latestRun: SupplySyncRunDTO | null }> {
  if (!isRecord(value)) throw new SupplyRepositoryError("response_invalid");
  let lastGoodPublished: SupplyLastGoodPublished | null = null;
  if (value.lastGoodPublished !== null) {
    const published = value.lastGoodPublished;
    if (!isRecord(published) || !validUuid(published.revisionId) || !validIso(published.publishedAt)) throw new SupplyRepositoryError("response_invalid");
    lastGoodPublished = { revisionId: published.revisionId, publishedAt: published.publishedAt };
  }
  return {
    lastGoodPublished,
    latestRun: value.latestRun === null ? null : parseRun(value.latestRun),
  };
}

function validateConfig(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new SupplyRepositoryError("configuration_invalid"); }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (!(["https:", "http:"].includes(url.protocol)) || (url.protocol === "http:" && !localHosts.has(url.hostname))
    || !config.secretKey.trim() || !config.publishableKey.trim() || config.secretKey === config.publishableKey) {
    throw new SupplyRepositoryError("configuration_invalid");
  }
  return url;
}

export function createSupplySyncRepository(config: Config): SupplySyncRepository {
  const baseUrl = validateConfig(config);
  const fetchImpl = config.fetch ?? fetch;
  async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, baseUrl), {
        method: "POST", headers: {
          apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`,
          "content-type": "application/json", accept: "application/json",
        }, body: JSON.stringify(payload), cache: "no-store",
      });
    } catch { throw new SupplyRepositoryError("request_failed"); }
    if (!response.ok) {
      // Never propagate provider/database response bodies.
      if (response.status === 403) throw new SupplyRepositoryError("forbidden");
      if (response.status === 409) throw new SupplyRepositoryError("operation_conflict");
      throw new SupplyRepositoryError("request_failed");
    }
    try { return await response.json() as unknown; } catch { throw new SupplyRepositoryError("response_invalid"); }
  }
  return Object.freeze({
    async begin(operationId: string, actorUserId: string) {
      const value = await rpc("begin_supply_sync", { p_operation_id: operationId, p_actor_user_id: actorUserId });
      if (!isRecord(value) || typeof value.created !== "boolean") throw new SupplyRepositoryError("response_invalid");
      const run = parseRun(value.run);
      return { run, replay: !value.created };
    },
    async finish(runId: string, actorUserId: string, completion: SupplySyncCompletion, candidate?: Parameters<SupplySyncRepository["finish"]>[3]) {
      const value = await rpc("finish_supply_sync", {
        p_run_id: runId, p_actor_user_id: actorUserId, p_state: completion.state,
        p_counts: completion.counts, p_candidate_hash: candidate?.sourceHash ?? completion.candidateSourceHash ?? null,
        p_candidate: candidate?.normalized ?? null, p_mappings: candidate?.mappings ?? [],
        p_conflicts: completion.conflicts ?? [], p_retry_disposition: completion.retryDisposition,
        p_safe_message: completion.safeMessage ?? null, p_total_conflict_count: completion.totalConflictCount ?? null,
      });
      return parseRun(value);
    },
    async readSummary(actorUserId: string) {
      const value = await rpc("read_supply_sync_summary", { p_actor_user_id: actorUserId });
      return parseSummary(value);
    },
  });
}
