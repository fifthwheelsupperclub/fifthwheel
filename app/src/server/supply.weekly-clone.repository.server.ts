/** Server-only PostgREST adapter for the weekly clone RPCs. */

import type { SupabaseServerConfig } from "./supabase.server.ts";
import type {
  WeeklyCloneOperationDTO, WeeklyCloneOperationListDTO, WeeklyCloneOperationListItemDTO, WeeklyClonePreviewItemDTO,
} from "../supply.weekly-clone.contract.ts";
import type { WeeklyClonePlan, WeeklyCloneRepository } from "./supply.weekly-clone.contract.server.ts";

type Config = SupabaseServerConfig & Readonly<{ fetch?: typeof fetch }>;
type Json = Record<string, unknown>;

export class WeeklyCloneRepositoryError extends Error {
  readonly code: "configuration_invalid" | "request_failed" | "response_invalid" | "invalid_input" | "no_eligible_sources" | "forbidden" | "not_found" | "operation_conflict" | "undo_refused";

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

function parseSummary(raw: unknown): WeeklyCloneOperationListItemDTO {
  if (!record(raw) || !uuid(raw.operationId) || !date(raw.sourceWeekStart) || !date(raw.targetWeekStart)
    || (raw.state !== "completed" && raw.state !== "undone") || !iso(raw.startedAt) || !iso(raw.updatedAt)
    || !["available", "blocked", "undone"].includes(String(raw.undoState)) || !Number.isInteger(raw.draftCount)) {
    throw new WeeklyCloneRepositoryError("response_invalid");
  }
  return Object.freeze({
    operationId: raw.operationId, sourceWeekStart: raw.sourceWeekStart, targetWeekStart: raw.targetWeekStart, state: raw.state,
    startedAt: raw.startedAt, updatedAt: raw.updatedAt, undoState: raw.undoState as WeeklyCloneOperationListItemDTO["undoState"],
    draftCount: Number(raw.draftCount),
  });
}

function parseOperation(raw: unknown): WeeklyCloneOperationDTO {
  const summary = parseSummary(raw);
  const items = (raw as Json).items;
  if (!Array.isArray(items)) throw new WeeklyCloneRepositoryError("response_invalid");
  return Object.freeze({ ...summary, items: Object.freeze(items.map((item) => {
    if (!record(item) || !uuid(item.sourceTableId) || !uuid(item.targetTableId) || typeof item.title !== "string"
      || !date(item.targetLocalDate) || (item.state !== "created" && item.state !== "undone")) throw new WeeklyCloneRepositoryError("response_invalid");
    return Object.freeze({ sourceTableId: item.sourceTableId, targetTableId: item.targetTableId, title: item.title, targetLocalDate: item.targetLocalDate, state: item.state });
  })) });
}

function parsePlan(value: unknown): WeeklyClonePlan {
  if (!record(value) || !Number.isInteger(value.weekDelta) || !Array.isArray(value.items)) throw new WeeklyCloneRepositoryError("response_invalid");
  const items = value.items.map((raw): WeeklyClonePreviewItemDTO => {
    if (!record(raw) || !uuid(raw.sourceTableId) || !date(raw.sourceLocalDate) || !date(raw.targetLocalDate) || typeof raw.title !== "string"
      || (raw.eligibility !== "eligible" && raw.eligibility !== "conflict")
      || (raw.conflictCode !== null && !["source_not_draft", "source_changed", "protected_change"].includes(String(raw.conflictCode)))) {
      throw new WeeklyCloneRepositoryError("response_invalid");
    }
    return Object.freeze({
      sourceTableId: raw.sourceTableId, title: raw.title, sourceLocalDate: raw.sourceLocalDate, targetLocalDate: raw.targetLocalDate,
      eligibility: raw.eligibility, conflictCode: raw.conflictCode as WeeklyClonePreviewItemDTO["conflictCode"],
    });
  });
  return Object.freeze({ weekDelta: Number(value.weekDelta), items: Object.freeze(items) });
}

function rpcCode(value: unknown): string {
  return record(value) && typeof value.message === "string" ? value.message : "";
}

export function createWeeklyCloneRepository(config: Config): WeeklyCloneRepository {
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
      if (code === "not_found") throw new WeeklyCloneRepositoryError("not_found");
      if (code === "operation_conflict") throw new WeeklyCloneRepositoryError("operation_conflict");
      if (code === "undo_refused") throw new WeeklyCloneRepositoryError("undo_refused");
      if (code === "no_eligible_sources") throw new WeeklyCloneRepositoryError("no_eligible_sources");
      if (code === "invalid_input" || code === "too_many_sources") throw new WeeklyCloneRepositoryError("invalid_input");
      throw new WeeklyCloneRepositoryError("request_failed");
    }
    try { return await response.json() as unknown; } catch { throw new WeeklyCloneRepositoryError("response_invalid"); }
  }
  return Object.freeze({
    async preview(actorUserId, request) {
      return parsePlan(await call("preview_weekly_supply_clone", { p_actor_user_id: actorUserId, p_source_week_start: request.sourceWeekStart, p_target_week_start: request.targetWeekStart }));
    },
    async clone(actorUserId, request) {
      return parseOperation(await call("clone_weekly_supply", { p_actor_user_id: actorUserId, p_operation_id: request.operationId,
        p_source_week: request.sourceWeekStart, p_target_week: request.targetWeekStart }));
    },
    async read(actorUserId, operationId) {
      const result = await call("read_weekly_supply_clone_operation", { p_actor_user_id: actorUserId, p_operation_id: operationId });
      return result === null ? null : parseOperation(result);
    },
    async list(actorUserId, cursor, limit): Promise<WeeklyCloneOperationListDTO> {
      const value = await call("list_weekly_supply_clone_operations", { p_actor_user_id: actorUserId, p_cursor: cursor, p_limit: limit });
      if (!record(value) || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) throw new WeeklyCloneRepositoryError("response_invalid");
      return Object.freeze({ items: Object.freeze(value.items.map(parseSummary)), nextCursor: value.nextCursor as string | null });
    },
    async undo(actorUserId, operationId) {
      return parseOperation(await call("undo_weekly_supply_clone", { p_actor_user_id: actorUserId, p_operation_id: operationId }));
    },
  } satisfies WeeklyCloneRepository);
}
