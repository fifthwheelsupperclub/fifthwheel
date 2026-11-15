/** Server-only PostgREST adapter for the W06.5 Table-invitation RPCs. */

import type {
  AdminTableInvitationAttemptDTO, AdminTableInvitationDTO, AdminTableInvitationListDTO,
  MemberTableInvitationDetailDTO, RetryTableInvitationDeliveryRequest, RetryTableInvitationDeliveryResultDTO,
  TableInvitationAttemptState, TableInvitationDeliveryState, TableInvitationState,
} from "../table-invitations.contract.ts";
import type { TableStopDTO } from "../tables.contract.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { TableInvitationDeliveryWorkerRepository, TableInvitationRepository, TableInvitationWorkerResult } from "./table-invitations.contract.server.ts";

type Config = SupabaseServerConfig & Readonly<{ fetch?: typeof fetch }>;
export type TableInvitationRepositoryErrorCode = "configuration_invalid" | "request_failed" | "response_invalid" | "forbidden"
  | "not_found" | "invalid_input" | "operation_conflict" | "attempt_not_retryable"
  | "attempt_reconciliation_required" | "attempt_busy";

export class TableInvitationRepositoryError extends Error {
  readonly code: TableInvitationRepositoryErrorCode;
  constructor(code: TableInvitationRepositoryErrorCode) { super(code); this.name = "TableInvitationRepositoryError"; this.code = code; }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const invitationStates = new Set<TableInvitationState>(["active", "revoked", "closed"]);
const deliveryStates = new Set<TableInvitationDeliveryState>(["queued", "sending", "accepted", "delivered", "failed", "unknown"]);
const attemptStates = new Set<TableInvitationAttemptState>(["sending", "accepted", "delivered", "failed", "unknown"]);
const stopRoles = ["drinks", "dinner", "dessert"] as const;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function isInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isText(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }

function parseStop(value: unknown, index: number): TableStopDTO {
  if (!isRecord(value) || value.role !== stopRoles[index] || !isText(value.venueName, 180) || !isText(value.venueAddress, 400)
    || !Number.isSafeInteger(value.minutesFromStart) || Number(value.minutesFromStart) < 0 || Number(value.minutesFromStart) > 720
    || !isText(value.publicNotes, 500)) throw new TableInvitationRepositoryError("response_invalid");
  return Object.freeze({ role: value.role as TableStopDTO["role"], venueName: value.venueName, venueAddress: value.venueAddress,
    minutesFromStart: Number(value.minutesFromStart), publicNotes: value.publicNotes });
}

function parseMemberDetail(value: unknown): MemberTableInvitationDetailDTO {
  if (!isRecord(value) || !isUuid(value.invitationId) || !invitationStates.has(value.state as TableInvitationState) || !isInstant(value.createdAt)
    || !isRecord(value.delivery) || !deliveryStates.has(value.delivery.state as TableInvitationDeliveryState)
    || !Number.isSafeInteger(value.delivery.attemptCount) || Number(value.delivery.attemptCount) < 0
    || !(value.delivery.lastAttemptAt === null || isInstant(value.delivery.lastAttemptAt)) || !isRecord(value.table)
    || !isUuid(value.table.tableId) || !isText(value.table.title, 180) || typeof value.table.localDate !== "string" || !datePattern.test(value.table.localDate)
    || typeof value.table.startLocalTime !== "string" || !timePattern.test(value.table.startLocalTime)
    || !isText(value.table.neighborhood, 120) || value.table.seatPriceCents !== 2500 || value.table.currency !== "USD"
    || !Array.isArray(value.table.stops) || typeof value.table.itineraryAvailable !== "boolean"
    || value.table.itineraryAvailable && value.table.stops.length !== 3 || !value.table.itineraryAvailable && value.table.stops.length !== 0) {
    throw new TableInvitationRepositoryError("response_invalid");
  }
  return Object.freeze({ invitationId: value.invitationId, state: value.state as TableInvitationState, createdAt: value.createdAt,
    delivery: Object.freeze({ state: value.delivery.state as TableInvitationDeliveryState, attemptCount: Number(value.delivery.attemptCount),
      lastAttemptAt: value.delivery.lastAttemptAt as string | null }),
    table: Object.freeze({ tableId: value.table.tableId, title: value.table.title, localDate: value.table.localDate,
      startLocalTime: value.table.startLocalTime, neighborhood: value.table.neighborhood, seatPriceCents: 2500, currency: "USD",
      stops: Object.freeze(value.table.stops.map(parseStop)), itineraryAvailable: value.table.itineraryAvailable }) });
}

function parseAdminItem(value: unknown): AdminTableInvitationDTO {
  if (!isRecord(value) || !isUuid(value.invitationId) || !invitationStates.has(value.invitationState as TableInvitationState)
    || !isInstant(value.createdAt) || !isRecord(value.guest) || !isUuid(value.guest.guestId) || !isText(value.guest.displayName, 201)
    || !isRecord(value.table) || !isUuid(value.table.tableId) || !isText(value.table.title, 180)
    || typeof value.table.localDate !== "string" || !datePattern.test(value.table.localDate)
    || typeof value.table.startLocalTime !== "string" || !timePattern.test(value.table.startLocalTime)
    || !isText(value.table.neighborhood, 120) || !isRecord(value.delivery) || !isUuid(value.delivery.outboxId)
    || !deliveryStates.has(value.delivery.state as TableInvitationDeliveryState)
    || !Number.isSafeInteger(value.delivery.attemptCount) || Number(value.delivery.attemptCount) < 0
    || !isInstant(value.delivery.queuedAt) || !isInstant(value.delivery.nextAttemptAt)
    || !(value.delivery.lastAttemptAt === null || isInstant(value.delivery.lastAttemptAt))
    || !(value.delivery.safeErrorCode === null || typeof value.delivery.safeErrorCode === "string" && /^[a-z0-9_.-]{1,100}$/.test(value.delivery.safeErrorCode))
    || !Array.isArray(value.attempts) || value.attempts.length > 3) throw new TableInvitationRepositoryError("response_invalid");
  const attempts: AdminTableInvitationAttemptDTO[] = value.attempts.map((raw) => {
    if (!isRecord(raw) || !Number.isSafeInteger(raw.attemptNumber) || Number(raw.attemptNumber) < 1
      || !attemptStates.has(raw.state as TableInvitationAttemptState) || !isInstant(raw.startedAt)
      || !(raw.finishedAt === null || isInstant(raw.finishedAt))
      || !(raw.safeErrorCode === null || typeof raw.safeErrorCode === "string" && /^[a-z0-9_.-]{1,100}$/.test(raw.safeErrorCode))) {
      throw new TableInvitationRepositoryError("response_invalid");
    }
    return Object.freeze({ attemptNumber: Number(raw.attemptNumber), state: raw.state as TableInvitationAttemptState,
      startedAt: raw.startedAt, finishedAt: raw.finishedAt as string | null, safeErrorCode: raw.safeErrorCode as string | null });
  });
  return Object.freeze({ invitationId: value.invitationId, invitationState: value.invitationState as TableInvitationState, createdAt: value.createdAt,
    guest: Object.freeze({ guestId: value.guest.guestId, displayName: value.guest.displayName }),
    table: Object.freeze({ tableId: value.table.tableId, title: value.table.title, localDate: value.table.localDate,
      startLocalTime: value.table.startLocalTime, neighborhood: value.table.neighborhood }),
    delivery: Object.freeze({ outboxId: value.delivery.outboxId, state: value.delivery.state as TableInvitationDeliveryState,
      attemptCount: Number(value.delivery.attemptCount), queuedAt: value.delivery.queuedAt, nextAttemptAt: value.delivery.nextAttemptAt,
      lastAttemptAt: value.delivery.lastAttemptAt as string | null, safeErrorCode: value.delivery.safeErrorCode as string | null }),
    attempts: Object.freeze(attempts) });
}

function parseList(value: unknown): AdminTableInvitationListDTO {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 50
    || !(value.nextCursor === null || typeof value.nextCursor === "string" && value.nextCursor.length <= 150)) {
    throw new TableInvitationRepositoryError("response_invalid");
  }
  return Object.freeze({ items: Object.freeze(value.items.map(parseAdminItem)), nextCursor: value.nextCursor as string | null });
}

function parseRetry(value: unknown, invitationId: string): RetryTableInvitationDeliveryResultDTO {
  if (!isRecord(value) || value.invitationId !== invitationId || value.deliveryState !== "queued"
    || !Number.isSafeInteger(value.attemptCount) || Number(value.attemptCount) < 1 || !isInstant(value.queuedAt) || !isInstant(value.nextAttemptAt)) {
    throw new TableInvitationRepositoryError("response_invalid");
  }
  return Object.freeze({ invitationId, deliveryState: "queued", attemptCount: Number(value.attemptCount), queuedAt: value.queuedAt, nextAttemptAt: value.nextAttemptAt });
}

function validateConfig(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new TableInvitationRepositoryError("configuration_invalid"); }
  if (!((url.protocol === "https:") || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    || url.pathname !== "/" || url.search || url.hash || url.username || url.password
    || !config.secretKey.trim() || !config.publishableKey.trim() || config.secretKey === config.publishableKey) {
    throw new TableInvitationRepositoryError("configuration_invalid");
  }
  return url;
}

export function createTableInvitationRepository(config: Config): TableInvitationRepository {
  const baseUrl = validateConfig(config); const fetchImpl = config.fetch ?? fetch;
  async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try { response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, baseUrl), { method: "POST", headers: {
      apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
    }, body: JSON.stringify(payload), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new TableInvitationRepositoryError("request_failed"); }
    if (!response.ok) {
      let message = "";
      try { const body: unknown = await response.clone().json(); if (isRecord(body) && typeof body.message === "string") message = body.message; } catch { /* safe code only */ }
      if (message === "not_found" || message === "PGRST116") throw new TableInvitationRepositoryError("not_found");
      if (message === "invalid_input") throw new TableInvitationRepositoryError("invalid_input");
      if (message === "operation_conflict") throw new TableInvitationRepositoryError("operation_conflict");
      if (message === "attempt_not_retryable") throw new TableInvitationRepositoryError("attempt_not_retryable");
      if (message === "attempt_not_unknown") throw new TableInvitationRepositoryError("attempt_not_retryable");
      if (message === "attempt_reconciliation_required") throw new TableInvitationRepositoryError("attempt_reconciliation_required");
      if (message === "attempt_busy") throw new TableInvitationRepositoryError("attempt_busy");
      if (response.status === 401 || response.status === 403) throw new TableInvitationRepositoryError("forbidden");
      throw new TableInvitationRepositoryError("request_failed");
    }
    try { return await response.json() as unknown; } catch { throw new TableInvitationRepositoryError("response_invalid"); }
  }
  return Object.freeze({
    async readMemberInvitation(actorUserId: string, invitationId: string) {
      return parseMemberDetail(await rpc("read_member_table_invitation", { p_auth_user_id: actorUserId, p_invitation_id: invitationId }));
    },
    async listAdminInvitations(actorUserId: string, input: Readonly<{ cursor?: string; limit: number }>) {
      return parseList(await rpc("list_admin_table_invitations", { p_actor_user_id: actorUserId, p_cursor: input.cursor ?? null, p_limit: input.limit }));
    },
    async retryFailedDelivery(actorUserId: string, invitationId: string, request: RetryTableInvitationDeliveryRequest) {
      return parseRetry(await rpc("retry_failed_table_invitation_delivery", { p_actor_user_id: actorUserId,
        p_invitation_id: invitationId, p_request: request }), invitationId);
    },
  });
}

/** Service-role-only persistence adapter for an independently scheduled worker. It deliberately has no mail-provider dependency. */
export function createTableInvitationDeliveryWorkerRepository(config: Config): TableInvitationDeliveryWorkerRepository {
  const baseUrl = validateConfig(config); const fetchImpl = config.fetch ?? fetch;
  async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try { response = await fetchImpl(new URL(`/rest/v1/rpc/${name}`, baseUrl), { method: "POST", headers: {
      apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, "content-type": "application/json", accept: "application/json",
    }, body: JSON.stringify(payload), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new TableInvitationRepositoryError("request_failed"); }
    let body: unknown = null;
    try { body = await response.json() as unknown; } catch { if (response.ok) throw new TableInvitationRepositoryError("response_invalid"); }
    if (!response.ok) {
      const message = isRecord(body) && typeof body.message === "string" ? body.message : "";
      if (message === "not_found") throw new TableInvitationRepositoryError("not_found");
      if (message === "invalid_input") throw new TableInvitationRepositoryError("invalid_input");
      if (message === "operation_conflict") throw new TableInvitationRepositoryError("operation_conflict");
      if (message === "attempt_not_retryable" || message === "attempt_already_finished" || message === "attempt_not_unknown"
        || message === "attempt_not_accepted") throw new TableInvitationRepositoryError("attempt_not_retryable");
      if (message === "attempt_reconciliation_required") throw new TableInvitationRepositoryError("attempt_reconciliation_required");
      if (message === "attempt_busy") throw new TableInvitationRepositoryError("attempt_busy");
      if (response.status === 401 || response.status === 403) throw new TableInvitationRepositoryError("forbidden");
      throw new TableInvitationRepositoryError("request_failed");
    }
    return body;
  }
  function parseWorkerResult(value: unknown): TableInvitationWorkerResult {
    if (!isRecord(value) || !isRecord(value.outbox) || !isRecord(value.attempt)
      || !deliveryStates.has(value.outbox.state as TableInvitationDeliveryState)
      || !Number.isSafeInteger(value.attempt.attempt_number) || Number(value.attempt.attempt_number) < 1
      || typeof value.changed !== "boolean") throw new TableInvitationRepositoryError("response_invalid");
    return Object.freeze({ deliveryState: value.outbox.state as TableInvitationDeliveryState,
      attemptNumber: Number(value.attempt.attempt_number), changed: value.changed });
  }
  function parseDeliveryContext(value: unknown): import("./table-invitations.contract.server.ts").TableInvitationDeliveryContext {
    if (!isRecord(value) || !isUuid(value.invitationId) || typeof value.recipientEmail !== "string"
      || value.recipientEmail !== value.recipientEmail.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.recipientEmail)
      || !isRecord(value.table) || !isText(value.table.title, 180) || typeof value.table.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.table.localDate)
      || typeof value.table.startLocalTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.table.startLocalTime)
      || !isText(value.table.neighborhood, 120)) throw new TableInvitationRepositoryError("response_invalid");
    return Object.freeze({ invitationId: value.invitationId, recipientEmail: value.recipientEmail,
      table: Object.freeze({ title: value.table.title, localDate: value.table.localDate,
        startLocalTime: value.table.startLocalTime, neighborhood: value.table.neighborhood }) });
  }
  return Object.freeze({
    async beginNextAttempt(operationId: string) {
      if (!isUuid(operationId)) throw new TableInvitationRepositoryError("invalid_input");
      const value = await rpc("begin_next_table_invitation_delivery_attempt", { p_operation_id: operationId });
      if (value === null) return null;
      if (!isRecord(value) || typeof value.created !== "boolean" || !isRecord(value.outbox) || !isRecord(value.attempt)
        || !isUuid(value.outbox.outbox_id) || !isUuid(value.outbox.invitation_id) || !isUuid(value.attempt.attempt_id)
        || value.attempt.outbox_id !== value.outbox.outbox_id || !Number.isSafeInteger(value.attempt.attempt_number)
        || Number(value.attempt.attempt_number) < 1 || !attemptStates.has(value.attempt.state as TableInvitationAttemptState)) {
        throw new TableInvitationRepositoryError("response_invalid");
      }
      return Object.freeze({ outboxId: value.outbox.outbox_id, invitationId: value.outbox.invitation_id,
        attemptId: value.attempt.attempt_id, attemptNumber: Number(value.attempt.attempt_number), created: value.created });
    },
    async readDeliveryContext(invitationId: string) {
      if (!isUuid(invitationId)) throw new TableInvitationRepositoryError("invalid_input");
      try { return parseDeliveryContext(await rpc("read_table_invitation_delivery_context", { p_invitation_id: invitationId })); }
      catch (error) { if (error instanceof TableInvitationRepositoryError && error.code === "not_found") return null; throw error; }
    },
    async readUnknownContext(invitationId: string, expectedAttemptCount: number) {
      if (!isUuid(invitationId) || !Number.isSafeInteger(expectedAttemptCount) || expectedAttemptCount < 1) throw new TableInvitationRepositoryError("invalid_input");
      const value = await rpc("read_unknown_table_invitation_delivery_context", { p_invitation_id: invitationId, p_expected_attempt_count: expectedAttemptCount });
      if (value === null) return null;
      if (!isRecord(value) || !isUuid(value.attemptId) || value.attemptNumber !== expectedAttemptCount
        || !(value.providerMessageId === null || typeof value.providerMessageId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.providerMessageId))) {
        throw new TableInvitationRepositoryError("response_invalid");
      }
      const context = parseDeliveryContext(value);
      return Object.freeze({ ...context, attemptId: value.attemptId, attemptNumber: expectedAttemptCount,
        providerMessageId: value.providerMessageId as string | null });
    },
    async beginAttempt(outboxId: string, operationId: string) {
      if (!isUuid(outboxId) || !isUuid(operationId)) throw new TableInvitationRepositoryError("invalid_input");
      const value = await rpc("begin_table_invitation_delivery_attempt", { p_outbox_id: outboxId, p_operation_id: operationId });
      if (!isRecord(value) || typeof value.created !== "boolean" || !isRecord(value.attempt)
        || !isUuid(value.attempt.attempt_id) || !Number.isSafeInteger(value.attempt.attempt_number)
        || Number(value.attempt.attempt_number) < 1 || !attemptStates.has(value.attempt.state as TableInvitationAttemptState)) {
        throw new TableInvitationRepositoryError("response_invalid");
      }
      return Object.freeze({ attemptId: value.attempt.attempt_id, attemptNumber: Number(value.attempt.attempt_number), created: value.created });
    },
    async finishAttempt(input: Readonly<{ attemptId: string; state: "accepted" | "delivered" | "failed" | "unknown";
      providerMessageId?: string; safeErrorCode?: string }>) {
      if (!isUuid(input.attemptId) || !["accepted", "delivered", "failed", "unknown"].includes(input.state)
        || input.providerMessageId !== undefined && (input.providerMessageId.length > 200 || /[\u0000-\u001f\u007f]/.test(input.providerMessageId))
        || input.safeErrorCode !== undefined && !/^[a-z0-9_.-]{1,100}$/.test(input.safeErrorCode)
        || input.state === "delivered" && !input.providerMessageId) throw new TableInvitationRepositoryError("invalid_input");
      return parseWorkerResult(await rpc("finish_table_invitation_delivery_attempt", { p_attempt_id: input.attemptId,
        p_state: input.state, p_provider_message_id: input.providerMessageId ?? null, p_error_code: input.safeErrorCode ?? null }));
    },
    async markDelivered(attemptId: string, providerMessageId: string) {
      if (!isUuid(attemptId) || providerMessageId.length < 1 || providerMessageId.length > 200 || /[\u0000-\u001f\u007f]/.test(providerMessageId)) {
        throw new TableInvitationRepositoryError("invalid_input");
      }
      return parseWorkerResult(await rpc("mark_table_invitation_delivery_delivered", {
        p_attempt_id: attemptId, p_provider_message_id: providerMessageId,
      }));
    },
    async expireLeases() {
      const value = await rpc("expire_table_invitation_delivery_leases", {});
      if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TableInvitationRepositoryError("response_invalid");
      return Number(value);
    },
    async reconcileUnknown(input: Readonly<{ attemptId: string; state: "accepted" | "delivered" | "failed"; providerMessageId?: string }>) {
      if (!isUuid(input.attemptId) || !["accepted", "delivered", "failed"].includes(input.state)
        || input.providerMessageId !== undefined && (input.providerMessageId.length > 200 || /[\u0000-\u001f\u007f]/.test(input.providerMessageId))
        || input.state === "delivered" && !input.providerMessageId) throw new TableInvitationRepositoryError("invalid_input");
      return parseWorkerResult(await rpc("reconcile_unknown_table_invitation_attempt", { p_attempt_id: input.attemptId,
        p_state: input.state, p_provider_message_id: input.providerMessageId ?? null }));
    },
    async reconcileUnknownAttempt(attemptId: string, state: "accepted" | "failed", providerMessageId?: string) {
      if (!isUuid(attemptId) || !["accepted", "failed"].includes(state)
        || providerMessageId !== undefined && (providerMessageId.length > 200 || /[\u0000-\u001f\u007f]/.test(providerMessageId))) {
        throw new TableInvitationRepositoryError("invalid_input");
      }
      return parseWorkerResult(await rpc("reconcile_unknown_table_invitation_attempt", { p_attempt_id: attemptId,
        p_state: state, p_provider_message_id: providerMessageId ?? null }));
    },
  });
}
