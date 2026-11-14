/** Server-only PostgREST adapter for durable W05.3 clone manifests. */

import type { SupabaseServerConfig } from "./supabase.server.ts";
import type {
  WeeklyCloneOperationDTO, WeeklyCloneOperationListDTO,
} from "../supply.weekly-clone.contract.ts";
import type {
  WeeklyCloneItemWork, WeeklyClonePlan, WeeklyClonePlanItem, WeeklyCloneRepository,
} from "./supply.weekly-clone.contract.server.ts";

type Config = SupabaseServerConfig & Readonly<{ fetch?: typeof fetch }>;
type Json = Record<string, unknown>;

export class WeeklyCloneRepositoryError extends Error {
  readonly code: "configuration_invalid" | "request_failed" | "response_invalid" | "forbidden" | "not_found" | "revision_conflict" | "operation_conflict" | "operation_unresolved" | "undo_refused";

  constructor(code: WeeklyCloneRepositoryError["code"]) {
    super(code); this.name = "WeeklyCloneRepositoryError";
    this.code = code;
  }
}

function record(value: unknown): value is Json { return typeof value === "object" && value !== null && !Array.isArray(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(0); parsed.setUTCFullYear(year!, month! - 1, day!); parsed.setUTCHours(0, 0, 0, 0);
  return parsed.toISOString().slice(0, 10) === value;
}
function iso(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{32}$/.test(value); }

const operationStates = ["running", "partial", "outcome_unknown", "completed", "undoing", "undo_unknown", "undone", "undo_refused"] as const;
const itemStates = ["pending", "creating", "created", "failed", "outcome_unknown", "undoing", "undone", "undo_unknown", "undo_refused"] as const;
const retryStates = ["reconcile_first", "same_operation_after_no_write", "new_operation_required", "blocked"] as const;
const undoRetryStates = ["reconcile_first", "same_operation_after_no_delete", "blocked"] as const;

function internalItem(value: unknown): WeeklyCloneItemWork {
  if (!record(value) || !uuid(value.operation_id) || !uuid(value.source_table_id) || !uuid(value.source_revision_id)
    || (value.source_record_id !== null && (typeof value.source_record_id !== "string" || value.source_record_id.length > 200))
    || !uuid(value.target_table_id) || !uuid(value.marker_id) || !record(value.target_content) || !hash(value.target_hash)
    || !itemStates.includes(String(value.state) as typeof itemStates[number])
    || (value.provider_record_id !== null && typeof value.provider_record_id !== "string")) throw new WeeklyCloneRepositoryError("response_invalid");
  return Object.freeze({
    operationId: value.operation_id, sourceTableId: value.source_table_id, sourceRevisionId: value.source_revision_id,
    sourceRecordId: value.source_record_id, targetTableId: value.target_table_id, markerId: value.marker_id,
    content: value.target_content as unknown as WeeklyCloneItemWork["content"], contentHash: value.target_hash,
    state: value.state as WeeklyCloneItemWork["state"], providerRecordId: value.provider_record_id,
  });
}

function blockedCode(items: readonly Json[]): WeeklyCloneOperationDTO["undoBlockedCode"] {
  for (const item of items) {
    if (item.safe_code === "target_changed") return "target_changed";
    if (item.safe_code === "active_activity") return "active_activity";
    if (item.safe_code === "provider_unavailable") return "provider_unavailable";
    if (["write_unknown", "delete_unknown", "provider_conflict"].includes(String(item.safe_code))) return "operation_unresolved";
  }
  return null;
}

function parseOperation(value: unknown): WeeklyCloneOperationDTO {
  if (!record(value) || !record(value.operation) || !Array.isArray(value.items)) throw new WeeklyCloneRepositoryError("response_invalid");
  const op = value.operation;
  if (!uuid(op.operation_id) || !date(op.source_week_start) || !date(op.target_week_start)
    || !operationStates.includes(String(op.state) as typeof operationStates[number])
    || !Number.isInteger(op.manifest_revision) || Number(op.manifest_revision) < 1
    || !hash(op.plan_hash) || !iso(op.started_at) || !iso(op.updated_at)
    || (op.finished_at !== null && !iso(op.finished_at))
    || !retryStates.includes(String(op.retry_disposition) as typeof retryStates[number])
    || (op.undo_retry_disposition !== null && !undoRetryStates.includes(String(op.undo_retry_disposition) as typeof undoRetryStates[number]))
    || (op.undo_operation_id !== null && !uuid(op.undo_operation_id))
    || (op.undo_expected_manifest_revision !== null && (!Number.isInteger(op.undo_expected_manifest_revision) || Number(op.undo_expected_manifest_revision) < 1))) throw new WeeklyCloneRepositoryError("response_invalid");
  const rawItems = value.items.filter(record);
  if (rawItems.length !== value.items.length) throw new WeeklyCloneRepositoryError("response_invalid");
  const items = rawItems.map((item) => {
    const work = internalItem(item);
    if (work.operationId !== op.operation_id) throw new WeeklyCloneRepositoryError("response_invalid");
    const ordinal = item.ordinal;
    if (!Number.isInteger(ordinal) || !uuid(item.source_table_id) || !uuid(item.source_revision_id)) throw new WeeklyCloneRepositoryError("response_invalid");
    const safeCode = typeof item.safe_code === "string" ? item.safe_code : null;
    return Object.freeze({
      sourceTableId: work.sourceTableId,
      sourceRevisionId: work.sourceRevisionId,
      targetTableId: work.state === "created" || work.state === "undoing" || work.state === "undo_unknown" ? work.targetTableId : null,
      targetRevisionId: work.state === "created" || work.state === "undoing" || work.state === "undo_unknown" ? String(item.target_revision_id) : null,
      state: work.state,
      safeCode: safeCode as WeeklyCloneOperationDTO["items"][number]["safeCode"],
    });
  });
  const state = op.state as WeeklyCloneOperationDTO["state"];
  const undoState: WeeklyCloneOperationDTO["undoState"] = state === "undone" ? "undone"
    : state === "undoing" || state === "undo_unknown" ? "unknown"
    : state === "completed" ? "available"
    : state === "partial" || state === "outcome_unknown" ? "blocked" : "not_started";
  const retryDisposition = op.retry_disposition as WeeklyCloneOperationDTO["retryDisposition"];
  const undoRetryDisposition = op.undo_retry_disposition as WeeklyCloneOperationDTO["undoRetryDisposition"];
  return Object.freeze({
    providerState: "disabled_unmapped",
    mutationsEnabled: false,
    operationId: op.operation_id,
    state,
    manifestRevision: Number(op.manifest_revision),
    sourceWeekStart: op.source_week_start,
    targetWeekStart: op.target_week_start,
    planHash: op.plan_hash,
    startedAt: op.started_at,
    updatedAt: op.updated_at,
    finishedAt: op.finished_at,
    retryDisposition,
    undoOperationId: op.undo_operation_id,
    undoExpectedManifestRevision: op.undo_expected_manifest_revision === null ? null : Number(op.undo_expected_manifest_revision),
    undoRetryDisposition,
    undoState,
    undoBlockedCode: blockedCode(rawItems),
    items: Object.freeze(items),
  });
}

function parsePlan(value: unknown): WeeklyClonePlan {
  if (!record(value) || !hash(value.planHash) || !Number.isInteger(value.weekDelta) || !Array.isArray(value.items)) throw new WeeklyCloneRepositoryError("response_invalid");
  const items: WeeklyClonePlanItem[] = value.items.map((raw) => {
    if (!record(raw) || !uuid(raw.sourceTableId) || !uuid(raw.sourceRevisionId) || !Number.isInteger(raw.sourceRevision)
      || !hash(raw.sourceHash) || !record(raw.content) || !record(raw.targetContent)
      || !date(raw.sourceLocalDate) || !date(raw.targetLocalDate) || typeof raw.title !== "string"
      || (raw.eligibility !== "eligible" && raw.eligibility !== "conflict")
      || (raw.conflictCode !== null && typeof raw.conflictCode !== "string")) throw new WeeklyCloneRepositoryError("response_invalid");
    return Object.freeze({
      sourceTableId: raw.sourceTableId, sourceRevisionId: raw.sourceRevisionId, sourceRevision: Number(raw.sourceRevision),
      sourceHash: raw.sourceHash, content: raw.content as unknown as WeeklyClonePlanItem["content"],
      targetContent: raw.targetContent as unknown as WeeklyClonePlanItem["targetContent"], title: raw.title,
      sourceLocalDate: raw.sourceLocalDate, targetLocalDate: raw.targetLocalDate,
      eligibility: raw.eligibility, conflictCode: raw.conflictCode,
    });
  });
  return Object.freeze({ planHash: value.planHash, weekDelta: Number(value.weekDelta), items: Object.freeze(items) });
}

function rpcCode(value: unknown): string {
  return record(value) && typeof value.message === "string" ? value.message : "";
}

export function createWeeklyCloneRepository(config: Config): WeeklyCloneRepository & Readonly<{ list(actorUserId: string, cursor: string | null, limit: number): Promise<WeeklyCloneOperationListDTO> }> {
  let base: URL;
  try { base = new URL(config.url); } catch { throw new WeeklyCloneRepositoryError("configuration_invalid"); }
  if (!(base.protocol === "https:" || (base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))
    || !config.secretKey.trim() || !config.publishableKey.trim() || config.secretKey === config.publishableKey) throw new WeeklyCloneRepositoryError("configuration_invalid");
  const fetcher = config.fetch ?? fetch;
  async function call(name: string, payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try { response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), {
      method: "POST", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload), cache: "no-store",
    }); } catch { throw new WeeklyCloneRepositoryError("request_failed"); }
    if (!response.ok) {
      const code = rpcCode(await response.clone().json().catch(() => null));
      if (code === "forbidden" || response.status === 401 || response.status === 403) throw new WeeklyCloneRepositoryError("forbidden");
      if (code === "not_found" || code === "P0002") throw new WeeklyCloneRepositoryError("not_found");
      if (code === "revision_conflict" || code === "stale_worker") throw new WeeklyCloneRepositoryError("revision_conflict");
      if (code === "operation_conflict" || code === "marker_conflict") throw new WeeklyCloneRepositoryError("operation_conflict");
      if (code === "operation_unresolved") throw new WeeklyCloneRepositoryError("operation_unresolved");
      if (code === "undo_refused") throw new WeeklyCloneRepositoryError("undo_refused");
      if (code === "invalid_input" || code === "no_eligible_sources") throw new WeeklyCloneRepositoryError("response_invalid");
      throw new WeeklyCloneRepositoryError("request_failed");
    }
    try { return await response.json() as unknown; } catch { throw new WeeklyCloneRepositoryError("response_invalid"); }
  }
  const run = async (name: string, params: Record<string, unknown>) => parseOperation(await call(name, params));
  return Object.freeze({
    async preview(actorUserId: string, request: Readonly<{ sourceWeekStart: string; targetWeekStart: string }>) {
      return parsePlan(await call("preview_weekly_supply_clone", { p_actor_user_id: actorUserId, p_source_week_start: request.sourceWeekStart, p_target_week_start: request.targetWeekStart }));
    },
    async begin(actorUserId: string, request: import("../supply.weekly-clone.contract.ts").WeeklyCloneStartRequest, _plan: WeeklyClonePlan) {
      return parseOperation(await call("begin_weekly_supply_clone", { p_actor_user_id: actorUserId, p_operation_id: request.operationId,
        p_source_week_start: request.sourceWeekStart, p_target_week_start: request.targetWeekStart, p_expected_plan_hash: request.expectedPlanHash }));
    },
    async claimNext(actorUserId: string, operationId: string) {
      const value = await call("claim_weekly_supply_clone_item", { p_actor_user_id: actorUserId, p_operation_id: operationId });
      return value === null ? null : internalWork(value);
    },
    async finishCreate(actorUserId: string, work: WeeklyCloneItemWork, result: Readonly<{ state: "created" | "failed" | "outcome_unknown" | "conflict"; providerRecordId?: string }>) {
      return run("finish_weekly_supply_clone_item", { p_actor_user_id: actorUserId, p_operation_id: work.operationId, p_source_table_id: work.sourceTableId, p_state: result.state, p_provider_record_id: result.providerRecordId ?? null });
    },
    async read(actorUserId: string, operationId: string) {
      const result = await call("read_weekly_supply_clone_operation", { p_actor_user_id: actorUserId, p_operation_id: operationId });
      return result === null ? null : parseOperation(result);
    },
    async list(actorUserId: string, cursor: string | null, limit: number) {
      const value = await call("list_weekly_supply_clone_operations", { p_actor_user_id: actorUserId, p_cursor: cursor, p_limit: limit });
      if (!record(value) || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) throw new WeeklyCloneRepositoryError("response_invalid");
      const items = value.items.map((raw) => {
        const counts = record(raw) ? raw.counts : null;
        if (!record(raw) || !uuid(raw.operationId) || !date(raw.sourceWeekStart) || !date(raw.targetWeekStart)
          || !operationStates.includes(String(raw.state) as typeof operationStates[number])
          || !Number.isInteger(raw.manifestRevision) || !iso(raw.startedAt) || !iso(raw.updatedAt)
          || (raw.finishedAt !== null && !iso(raw.finishedAt)) || !retryStates.includes(String(raw.retryDisposition) as typeof retryStates[number])
          || !["available", "blocked", "not_started", "unknown", "undone"].includes(String(raw.undoState))
          || (raw.undoBlockedCode !== null && !["target_changed", "active_activity", "provider_unavailable", "operation_unresolved"].includes(String(raw.undoBlockedCode)))
          || !record(counts) || !["total", "created", "unresolved", "failed", "undone"].every((key) => Number.isInteger(counts[key]))) {
          throw new WeeklyCloneRepositoryError("response_invalid");
        }
        return raw as unknown as WeeklyCloneOperationListDTO["items"][number];
      });
      return Object.freeze({ providerState: "disabled_unmapped", mutationsEnabled: false, items: Object.freeze(items), nextCursor: value.nextCursor as string | null });
    },
    async readUnresolved(actorUserId: string, operationId: string) {
      const result = await call("read_weekly_supply_clone_operation", { p_actor_user_id: actorUserId, p_operation_id: operationId });
      if (!record(result) || !Array.isArray(result.items)) throw new WeeklyCloneRepositoryError("response_invalid");
      return result.items.filter((item): item is Json => record(item) && ["creating", "outcome_unknown", "undoing", "undo_unknown"].includes(String(item.state)))
        .map(internalItem);
    },
    async beginUndo(actorUserId: string, operationId: string, request: import("../supply.weekly-clone.contract.ts").WeeklyCloneUndoRequest) {
      const result = await call("begin_weekly_supply_clone_undo", { p_actor_user_id: actorUserId, p_operation_id: operationId, p_undo_operation_id: request.undoOperationId, p_expected_manifest_revision: request.expectedManifestRevision });
      if (!record(result) || !Array.isArray(result.items)) throw new WeeklyCloneRepositoryError("response_invalid");
      const operation = parseOperation(result);
      return { operation, items: result.items.filter((item): item is Json => record(item) && ["undoing", "undo_unknown"].includes(String(item.state))).map(internalItem) };
    },
    async finishUndo(actorUserId: string, work: WeeklyCloneItemWork, result: Readonly<{ state: "undone" | "undo_refused" | "undo_unknown" }>) {
      const resolution = result.state === "undone" ? "deleted" : result.state === "undo_unknown" ? "outcome_unknown" : "refused";
      return run("finish_weekly_supply_clone_undo_item", { p_actor_user_id: actorUserId, p_operation_id: work.operationId, p_source_table_id: work.sourceTableId, p_resolution: resolution });
    },
    async reconcileCreate(actorUserId: string, work: WeeklyCloneItemWork, lookup: import("./supply.weekly-clone.contract.server.ts").WeeklyCloneProviderLookup) {
      const resolution = lookup.state === "found" ? "found" : lookup.state === "absent" ? "absent" : lookup.state === "conflict" ? "conflict" : "unknown";
      return run("reconcile_weekly_supply_clone_item", { p_actor_user_id: actorUserId, p_operation_id: work.operationId, p_source_table_id: work.sourceTableId, p_resolution: resolution, p_provider_record_id: lookup.state === "found" ? lookup.providerRecordId : null });
    },
    async reconcileDelete(actorUserId: string, work: WeeklyCloneItemWork, lookup: import("./supply.weekly-clone.contract.server.ts").WeeklyCloneProviderLookup) {
      const resolution = lookup.state === "absent" ? "deleted" : lookup.state === "found" ? "present" : lookup.state === "unknown" ? "outcome_unknown" : "refused";
      return run("finish_weekly_supply_clone_undo_item", { p_actor_user_id: actorUserId, p_operation_id: work.operationId, p_source_table_id: work.sourceTableId, p_resolution: resolution });
    },
  });
}

function internalWork(value: unknown): WeeklyCloneItemWork {
  if (!record(value) || !uuid(value.operationId) || !uuid(value.sourceTableId) || !uuid(value.sourceRevisionId)
    || (value.sourceRecordId !== null && typeof value.sourceRecordId !== "string") || !uuid(value.targetTableId)
    || !uuid(value.markerId) || !record(value.content) || !hash(value.contentHash) || !itemStates.includes(String(value.state) as typeof itemStates[number])
    || (value.providerRecordId !== null && typeof value.providerRecordId !== "string")) throw new WeeklyCloneRepositoryError("response_invalid");
  return value as unknown as WeeklyCloneItemWork;
}
