/** Synthetic-only local clone provider. It calls only the loopback test database RPCs. */

import type { SupplyDraftContent } from "../supply.management.contract.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { WeeklyCloneProvider, WeeklyCloneProviderCreateResult, WeeklyCloneProviderDeleteResult, WeeklyCloneProviderLookup } from "./supply.weekly-clone.contract.server.ts";

type Config = SupabaseServerConfig & Readonly<{ fetch?: typeof fetch }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const runPattern = /^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const hashPattern = /^[a-f0-9]{32}$/;

function parseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createWeeklyCloneFixtureProvider(config: Config, runId: string): WeeklyCloneProvider {
  let api: URL;
  try { api = new URL(config.url); } catch { throw new Error("fixture_config_invalid"); }
  if (api.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(api.hostname)
    || !runPattern.test(runId) || !config.secretKey || !config.publishableKey || config.secretKey === config.publishableKey) {
    throw new Error("fixture_config_invalid");
  }
  const fetcher = config.fetch ?? fetch;
  const normalizedRun = runId.toLowerCase();
  async function rpc(name: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await fetcher(new URL(`/rest/v1/rpc/${name}`, api), {
      method: "POST", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload), cache: "no-store",
    }); } catch { throw new Error("fixture_provider_unreachable"); }
    if (!response.ok) throw new Error("fixture_provider_unavailable");
    const parsed = parseRecord(await response.json().catch(() => null));
    if (!parsed || typeof parsed.state !== "string") throw new Error("fixture_provider_response_invalid");
    return parsed;
  }
  return Object.freeze({
    state: "fixture" as const,
    async create(input: Parameters<WeeklyCloneProvider["create"]>[0]): Promise<WeeklyCloneProviderCreateResult> {
      if (!uuidPattern.test(input.actorUserId) || !uuidPattern.test(input.markerId) || !hashPattern.test(input.contentHash)) return { state: "failed" };
      try {
        const result = await rpc("fixture_create_weekly_clone_record", {
          p_actor_user_id: input.actorUserId, p_run_id: normalizedRun, p_marker_id: input.markerId,
          p_source_record_id: input.sourceRecordId, p_content: input.content, p_content_hash: input.contentHash,
        });
        if (result.state === "created" && typeof result.providerRecordId === "string" && result.providerRecordId.length <= 200) {
          return { state: "created", providerRecordId: result.providerRecordId };
        }
        if (result.state === "conflict" || result.state === "deleted") return { state: "conflict" };
        return { state: "failed" };
      } catch { return { state: "outcome_unknown" }; }
    },
    async reconcileCreate(input: Parameters<WeeklyCloneProvider["reconcileCreate"]>[0]): Promise<WeeklyCloneProviderLookup> {
      if (!uuidPattern.test(input.actorUserId) || !uuidPattern.test(input.markerId) || !hashPattern.test(input.contentHash)) return { state: "conflict" };
      try {
        const result = await rpc("fixture_reconcile_weekly_clone_create", {
          p_actor_user_id: input.actorUserId, p_run_id: normalizedRun, p_marker_id: input.markerId,
          p_source_record_id: input.sourceRecordId, p_content_hash: input.contentHash,
        });
        if (result.state === "found" && typeof result.providerRecordId === "string" && result.providerRecordId.length <= 200 && result.contentHash === input.contentHash) {
          return { state: "found", providerRecordId: result.providerRecordId, contentHash: input.contentHash };
        }
        if (result.state === "absent") return { state: "absent" };
        if (result.state === "conflict") return { state: "conflict" };
        return { state: "unknown" };
      } catch { return { state: "unknown" }; }
    },
    async delete(input: Parameters<WeeklyCloneProvider["delete"]>[0]): Promise<WeeklyCloneProviderDeleteResult> {
      if (!uuidPattern.test(input.actorUserId) || !uuidPattern.test(input.markerId) || !hashPattern.test(input.contentHash)
        || !input.providerRecordId || input.providerRecordId.length > 200) return "failed";
      try {
        const result = await rpc("fixture_delete_weekly_clone_record", {
          p_actor_user_id: input.actorUserId, p_run_id: normalizedRun, p_marker_id: input.markerId,
          p_provider_record_id: input.providerRecordId, p_content_hash: input.contentHash,
        });
        if (result.state === "deleted" || result.state === "absent") return "deleted";
        return result.state === "conflict" ? "failed" : "outcome_unknown";
      } catch { return "outcome_unknown"; }
    },
    async reconcileDelete(input: Parameters<WeeklyCloneProvider["reconcileDelete"]>[0]): Promise<WeeklyCloneProviderLookup> {
      if (!uuidPattern.test(input.actorUserId) || !uuidPattern.test(input.markerId) || !hashPattern.test(input.contentHash)
        || !input.providerRecordId || input.providerRecordId.length > 200) return { state: "conflict" };
      try {
        const result = await rpc("fixture_reconcile_weekly_clone_delete", {
          p_actor_user_id: input.actorUserId, p_run_id: normalizedRun, p_marker_id: input.markerId,
          p_provider_record_id: input.providerRecordId, p_content_hash: input.contentHash,
        });
        if (result.state === "absent") return { state: "absent" };
        if (result.state === "found" && result.providerRecordId === input.providerRecordId && result.contentHash === input.contentHash) {
          return { state: "found", providerRecordId: input.providerRecordId, contentHash: input.contentHash };
        }
        if (result.state === "conflict") return { state: "conflict" };
        return { state: "unknown" };
      } catch { return { state: "unknown" }; }
    },
  });
}

export const disabledWeeklyCloneProvider: WeeklyCloneProvider = Object.freeze({
  state: "disabled_unmapped",
  async create() { return { state: "failed" as const }; },
  async reconcileCreate() { return { state: "unknown" as const }; },
  async delete() { return "failed" as const; },
  async reconcileDelete() { return { state: "unknown" as const }; },
});

// Keeps the content interface visible to provider-focused compile tests.
export type WeeklyCloneFixtureContent = SupplyDraftContent;
