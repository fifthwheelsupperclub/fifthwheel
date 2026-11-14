/** Server-only adapter for the atomic waitlist-admission queue RPC. */

import type {
  AdmissionDeliveryOperation,
  AdmissionRepository,
  AdmitWaitlistMemberCommand,
  AppAdmissionRow,
  AppInvitationDeliveryAttemptRow,
  AppInvitationDeliveryRow,
  InvitationDeliveryContext,
} from "./admission.contracts.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

export type AdmissionRepositoryErrorCode =
  | "configuration_invalid"
  | "validation_failed"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "provider_failed"
  | "provider_outcome_unknown"
  | "provider_data_invalid";

/** Safe internal error: never include RPC response bodies or names/emails. */
export class AdmissionRepositoryError extends Error {
  readonly code: AdmissionRepositoryErrorCode;

  constructor(code: AdmissionRepositoryErrorCode) {
    super(code);
    this.name = "AdmissionRepositoryError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const admissionStates = new Set(["invited"]);
const deliveryStates = new Set(["queued", "sending", "accepted", "delivered", "failed", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function validateConfig(config: SupabaseServerConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new AdmissionRepositoryError("configuration_invalid");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    !["https:", "http:"].includes(url.protocol)
    || (url.protocol === "http:" && !loopbackHosts.has(url.hostname))
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || typeof config.publishableKey !== "string"
    || config.publishableKey.trim().length === 0
    || typeof config.secretKey !== "string"
    || config.secretKey.trim().length === 0
    || config.secretKey.trim() === config.publishableKey.trim()
  ) {
    throw new AdmissionRepositoryError("configuration_invalid");
  }
  return url;
}

function parseAdmission(
  value: unknown,
  command: AdmitWaitlistMemberCommand,
  admissionCreated: boolean,
): AppAdmissionRow {
  if (!isRecord(value)) throw new AdmissionRepositoryError("provider_data_invalid");
  if (
    !isUuid(value.id)
    || !isUuid(value.waitlist_signup_id)
    || value.waitlist_signup_id !== command.signupId
    || typeof value.email_normalized !== "string"
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email_normalized)
    || value.email_normalized !== value.email_normalized.trim().toLowerCase()
    || !admissionStates.has(String(value.state))
    || !isUuid(value.approved_by)
    || (admissionCreated && value.approved_by !== command.approvedByUserId)
    || !isTimestamp(value.approved_at)
    || (value.auth_user_id !== null && !isUuid(value.auth_user_id))
    || value.auth_user_id !== null
    || value.activated_at !== null
    || value.deleted_at !== null
    || !isTimestamp(value.created_at)
    || !isTimestamp(value.updated_at)
  ) {
    throw new AdmissionRepositoryError("provider_data_invalid");
  }
  return value as unknown as AppAdmissionRow;
}

function parseDelivery(
  value: unknown,
  command: AdmitWaitlistMemberCommand,
  admissionId: string,
  deliveryCreated: boolean,
): AppInvitationDeliveryRow {
  if (!isRecord(value)) throw new AdmissionRepositoryError("provider_data_invalid");
  if (
    !isUuid(value.id)
    || !isUuid(value.admission_id)
    || value.admission_id !== admissionId
    || !isUuid(value.operation_id)
    || value.operation_id !== command.operationId
    || !deliveryStates.has(String(value.state))
    || !Number.isInteger(value.attempt_count)
    || (value.attempt_count as number) < 0
    || (value.provider_message_id !== null && typeof value.provider_message_id !== "string")
    || (value.error_code !== null && typeof value.error_code !== "string")
    || !isTimestamp(value.queued_at)
    || !isTimestamp(value.next_attempt_at)
    || !isNullableTimestamp(value.lease_until)
    || !isNullableTimestamp(value.attempted_at)
    || !isNullableTimestamp(value.accepted_at)
    || !isNullableTimestamp(value.delivered_at)
    || !isUuid(value.created_by)
    || (deliveryCreated && value.created_by !== command.approvedByUserId)
    || !isTimestamp(value.created_at)
  ) {
    throw new AdmissionRepositoryError("provider_data_invalid");
  }
  const state = value.state;
  if (
    ((state === "accepted" || state === "delivered") !== (value.accepted_at !== null))
    || ((state === "delivered") !== (value.delivered_at !== null))
    || (value.delivered_at !== null && Date.parse(value.accepted_at as string) > Date.parse(value.delivered_at as string))
  ) {
    throw new AdmissionRepositoryError("provider_data_invalid");
  }
  return value as unknown as AppInvitationDeliveryRow;
}

function mapRpcError(status: number, body: unknown): AdmissionRepositoryErrorCode {
  const record = isRecord(body) ? body : null;
  const sqlState = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : "";
  if (sqlState === "42501" || status === 401 || status === 403) return "forbidden";
  if (sqlState === "P0002" || message === "waitlist_signup_not_found") return "not_found";
  if (sqlState === "23505" || sqlState === "23514" || status === 409) return "conflict";
  if (sqlState === "22023" || message === "invalid_input") return "validation_failed";
  if (status >= 500) return "provider_outcome_unknown";
  return "provider_failed";
}

/**
 * Implements only admitAndQueueInvitation; delivery workers and activation
 * methods remain owned by their later slices. Returned rows stay server-side.
 */
export function createAdmissionRepository(
  config: SupabaseServerConfig,
  fetcher: typeof fetch = globalThis.fetch,
): Pick<AdmissionRepository, "admitAndQueueInvitation" | "findActiveAdmissionByEmail" | "activateFromVerifiedIdentity" | "beginDeliveryAttempt" | "finishDeliveryAttempt" | "findInvitationDeliveryContext" | "getLatestDeliveryAttempt" | "reconcileUnknownDeliveryAttempt"> {
  const baseUrl = validateConfig(config);

  return Object.freeze({
    async findInvitationDeliveryContext(deliveryId: string): Promise<InvitationDeliveryContext | null> {
      if (!isUuid(deliveryId)) throw new AdmissionRepositoryError("validation_failed");
      const url = new URL("/rest/v1/app_invitation_deliveries", baseUrl);
      url.searchParams.set("select", "id,admission_id,admission:app_admissions!app_invitation_deliveries_admission_id_fkey(id,waitlist_signup_id,email_normalized,state)");
      url.searchParams.set("id", `eq.${deliveryId}`);
      url.searchParams.set("limit", "1");
      let response: Response;
      try { response = await fetcher(url, { method: "GET", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json" }, cache: "no-store", redirect: "error" }); }
      catch { throw new AdmissionRepositoryError("provider_outcome_unknown"); }
      if (!response.ok) throw new AdmissionRepositoryError(response.status >= 500 ? "provider_outcome_unknown" : "provider_failed");
      const body: unknown = await response.json().catch(() => null);
      if (!Array.isArray(body) || body.length > 1) throw new AdmissionRepositoryError("provider_data_invalid");
      if (!body.length) return null;
      const row = body[0];
      const admission = isRecord(row) ? row.admission : null;
      if (!isRecord(row) || !isRecord(admission) || row.id !== deliveryId || !isUuid(row.admission_id)
        || admission.id !== row.admission_id || !isUuid(admission.waitlist_signup_id)
        || typeof admission.email_normalized !== "string" || admission.email_normalized !== admission.email_normalized.trim().toLowerCase()
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admission.email_normalized)
        || !["invited", "activated", "deleted"].includes(String(admission.state))) throw new AdmissionRepositoryError("provider_data_invalid");
      return {
        deliveryId,
        admissionId: admission.id,
        signupId: admission.waitlist_signup_id,
        recipientEmail: admission.email_normalized,
        admissionState: admission.state as InvitationDeliveryContext["admissionState"],
      };
    },

    async beginDeliveryAttempt(input): Promise<Readonly<{ delivery: AppInvitationDeliveryRow; attempt: AppInvitationDeliveryAttemptRow; created: boolean }> | null> {
      if (![input.deliveryId, input.operationId, input.startedByUserId].every(isUuid)) throw new AdmissionRepositoryError("validation_failed");
      const url = new URL("/rest/v1/rpc/begin_invitation_delivery_attempt", baseUrl);
      let response: Response;
      try { response = await fetcher(url, { method: "POST", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ p_delivery_id: input.deliveryId, p_operation_id: input.operationId, p_started_by_user_id: input.startedByUserId }), cache: "no-store", redirect: "error" }); }
      catch { throw new AdmissionRepositoryError("provider_outcome_unknown"); }
      let body: unknown;
      try { body = await response.json() as unknown; } catch { throw new AdmissionRepositoryError(response.ok ? "provider_outcome_unknown" : mapRpcError(response.status, null)); }
      if (!response.ok) throw new AdmissionRepositoryError(mapRpcError(response.status, body));
      if (body === null) return null;
      if (!isRecord(body) || typeof body.created !== "boolean" || !isRecord(body.delivery) || !isRecord(body.attempt)) throw new AdmissionRepositoryError("provider_data_invalid");
      const delivery = body.delivery;
      const attempt = body.attempt;
      if (delivery.id !== input.deliveryId || !deliveryStates.has(String(delivery.state)) || !isUuid(delivery.admission_id)
        || !isUuid(delivery.operation_id) || !isInteger(delivery.attempt_count) || delivery.attempt_count < 1
        || !isNullableTimestamp(delivery.attempted_at) || !isNullableTimestamp(delivery.lease_until)
        || !isUuid(delivery.created_by) || !isTimestamp(delivery.queued_at) || !isTimestamp(delivery.next_attempt_at)
        || !isTimestamp(delivery.created_at) || attempt.delivery_id !== input.deliveryId
        || !isUuid(attempt.id) || attempt.operation_id !== input.operationId || attempt.started_by_user_id !== input.startedByUserId
        || !["sending", "accepted", "failed", "unknown"].includes(String(attempt.state))
        || attempt.attempt_number !== delivery.attempt_count || !isTimestamp(attempt.started_at)
        || !isNullableTimestamp(attempt.finished_at)) throw new AdmissionRepositoryError("provider_data_invalid");
      if (body.created && (delivery.state !== "sending" || attempt.state !== "sending")) throw new AdmissionRepositoryError("provider_data_invalid");
      return { delivery: delivery as unknown as AppInvitationDeliveryRow, attempt: attempt as unknown as AppInvitationDeliveryAttemptRow, created: body.created };
    },

    async getLatestDeliveryAttempt(deliveryId: string): Promise<AppInvitationDeliveryAttemptRow | null> {
      if (!isUuid(deliveryId)) throw new AdmissionRepositoryError("validation_failed");
      const url = new URL("/rest/v1/app_invitation_delivery_attempts", baseUrl);
      url.searchParams.set("select", "*");
      url.searchParams.set("delivery_id", `eq.${deliveryId}`);
      url.searchParams.set("order", "attempt_number.desc,id.desc");
      url.searchParams.set("limit", "1");
      let response: Response;
      try { response = await fetcher(url, { method: "GET", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json" }, cache: "no-store", redirect: "error" }); }
      catch { throw new AdmissionRepositoryError("provider_outcome_unknown"); }
      if (!response.ok) throw new AdmissionRepositoryError(response.status >= 500 ? "provider_outcome_unknown" : "provider_failed");
      const rows: unknown = await response.json().catch(() => null);
      if (!Array.isArray(rows) || rows.length > 1) throw new AdmissionRepositoryError("provider_data_invalid");
      if (rows.length === 0) return null;
      const row = rows[0];
      if (!isRecord(row) || row.delivery_id !== deliveryId || !isUuid(row.id)
        || !["sending", "accepted", "failed", "unknown"].includes(String(row.state))
        || !isInteger(row.attempt_number) || row.attempt_number < 1 || !isTimestamp(row.started_at)
        || !isNullableTimestamp(row.finished_at)
        || (row.provider_message_id !== null && typeof row.provider_message_id !== "string")
        || (row.error_code !== null && typeof row.error_code !== "string")) throw new AdmissionRepositoryError("provider_data_invalid");
      return row as unknown as AppInvitationDeliveryAttemptRow;
    },

    async reconcileUnknownDeliveryAttempt(input): Promise<void> {
      if (!isUuid(input.attemptId) || !["accepted", "failed", "unknown"].includes(input.state) || !isTimestamp(input.resolvedAt)
        || (input.providerMessageId !== undefined && (input.providerMessageId.length > 200 || /[\u0000-\u001f\u007f]/.test(input.providerMessageId)))) throw new AdmissionRepositoryError("validation_failed");
      const url = new URL("/rest/v1/rpc/reconcile_unknown_invitation_attempt", baseUrl);
      let response: Response;
      try { response = await fetcher(url, { method: "POST", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ p_attempt_id: input.attemptId, p_state: input.state, p_provider_message_id: input.providerMessageId ?? null, p_resolved_at: input.resolvedAt }), cache: "no-store", redirect: "error" }); }
      catch { throw new AdmissionRepositoryError("provider_outcome_unknown"); }
      let body: unknown;
      try { body = await response.json() as unknown; } catch { throw new AdmissionRepositoryError(response.ok ? "provider_outcome_unknown" : mapRpcError(response.status, null)); }
      if (!response.ok) throw new AdmissionRepositoryError(mapRpcError(response.status, body));
      if (!isRecord(body) || !isRecord(body.delivery) || !isRecord(body.attempt) || body.attempt.id !== input.attemptId
        || body.attempt.state !== input.state || typeof body.changed !== "boolean") throw new AdmissionRepositoryError("provider_outcome_unknown");
    },

    async finishDeliveryAttempt(input): Promise<void> {
      if (!isUuid(input.attemptId) || !["accepted", "failed", "unknown"].includes(input.state) || !isTimestamp(input.finishedAt)
        || (input.providerMessageId !== undefined && (input.providerMessageId.length > 200 || /[\u0000-\u001f\u007f]/.test(input.providerMessageId)))
        || (input.safeErrorCode !== undefined && !/^[a-z0-9_.-]{1,100}$/.test(input.safeErrorCode))) throw new AdmissionRepositoryError("validation_failed");
      const url = new URL("/rest/v1/rpc/finish_invitation_delivery_attempt", baseUrl);
      let response: Response;
      try { response = await fetcher(url, { method: "POST", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ p_attempt_id: input.attemptId, p_state: input.state, p_provider_message_id: input.providerMessageId ?? null, p_error_code: input.safeErrorCode ?? null, p_finished_at: input.finishedAt }), cache: "no-store", redirect: "error" }); }
      catch { throw new AdmissionRepositoryError("provider_outcome_unknown"); }
      let body: unknown;
      try { body = await response.json() as unknown; } catch { throw new AdmissionRepositoryError(response.ok ? "provider_outcome_unknown" : mapRpcError(response.status, null)); }
      if (!response.ok) throw new AdmissionRepositoryError(mapRpcError(response.status, body));
      if (!isRecord(body) || !isRecord(body.delivery) || !isRecord(body.attempt) || body.attempt.id !== input.attemptId || body.attempt.state !== input.state) throw new AdmissionRepositoryError("provider_outcome_unknown");
    },

    async findActiveAdmissionByEmail(emailNormalized: string): Promise<AppAdmissionRow | null> {
      if (typeof emailNormalized !== "string" || emailNormalized !== emailNormalized.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized)) {
        throw new AdmissionRepositoryError("validation_failed");
      }
      const url = new URL("/rest/v1/app_admissions", baseUrl);
      url.searchParams.set("select", "*");
      url.searchParams.set("email_normalized", `eq.${emailNormalized}`);
      url.searchParams.set("state", "eq.activated");
      url.searchParams.set("limit", "1");
      let response: Response;
      try {
        response = await fetcher(url, { method: "GET", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json" }, cache: "no-store", redirect: "error" });
      } catch { throw new AdmissionRepositoryError("provider_outcome_unknown"); }
      if (!response.ok) throw new AdmissionRepositoryError(response.status >= 500 ? "provider_outcome_unknown" : "provider_failed");
      let body: unknown;
      try { body = await response.json() as unknown; } catch { throw new AdmissionRepositoryError("provider_data_invalid"); }
      if (!Array.isArray(body) || body.length > 1) throw new AdmissionRepositoryError("provider_data_invalid");
      if (body.length === 0) return null;
      const row = body[0];
      if (!isRecord(row)
        || !isUuid(row.id)
        || !isUuid(row.waitlist_signup_id)
        || row.email_normalized !== emailNormalized
        || row.state !== "activated"
        || !isUuid(row.approved_by)
        || !isUuid(row.auth_user_id)
        || !isTimestamp(row.approved_at)
        || !isTimestamp(row.activated_at)
        || row.deleted_at !== null
        || !isTimestamp(row.created_at)
        || !isTimestamp(row.updated_at)) throw new AdmissionRepositoryError("provider_data_invalid");
      return row as unknown as AppAdmissionRow;
    },

    async activateFromVerifiedIdentity(input): Promise<Readonly<{ kind: "activated" | "already_active" | "not_admitted"; admission?: AppAdmissionRow }>> {
      if (!isUuid(input.authUserId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.emailNormalized) || input.emailNormalized !== input.emailNormalized.trim().toLowerCase() || !isTimestamp(input.activatedAt)) {
        throw new AdmissionRepositoryError("validation_failed");
      }
      const url = new URL("/rest/v1/rpc/activate_app_admission", baseUrl);
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ p_auth_user_id: input.authUserId, p_email_normalized: input.emailNormalized, p_activated_at: input.activatedAt }),
          cache: "no-store",
          redirect: "error",
        });
      } catch { throw new AdmissionRepositoryError("provider_outcome_unknown"); }
      let body: unknown;
      try { body = await response.json() as unknown; } catch { throw new AdmissionRepositoryError(response.ok ? "provider_outcome_unknown" : mapRpcError(response.status, null)); }
      if (!response.ok) throw new AdmissionRepositoryError(mapRpcError(response.status, body));
      if (!isRecord(body) || (body.kind !== "activated" && body.kind !== "already_active" && body.kind !== "not_admitted")) throw new AdmissionRepositoryError("provider_data_invalid");
      if (body.kind === "not_admitted") return { kind: "not_admitted" };
      const row = body.admission;
      if (!isRecord(row)
        || !isUuid(row.id)
        || !isUuid(row.waitlist_signup_id)
        || row.email_normalized !== input.emailNormalized
        || row.state !== "activated"
        || row.auth_user_id !== input.authUserId
        || !isUuid(row.approved_by)
        || !isTimestamp(row.approved_at)
        || !isTimestamp(row.activated_at)
        || row.deleted_at !== null
        || !isTimestamp(row.created_at)
        || !isTimestamp(row.updated_at)) throw new AdmissionRepositoryError("provider_data_invalid");
      return { kind: body.kind, admission: row as unknown as AppAdmissionRow };
    },

    async admitAndQueueInvitation(command: AdmitWaitlistMemberCommand): Promise<AdmissionDeliveryOperation> {
      if (!isUuid(command.signupId) || !isUuid(command.operationId) || !isUuid(command.approvedByUserId)) {
        throw new AdmissionRepositoryError("validation_failed");
      }
      const url = new URL("/rest/v1/rpc/admit_waitlist_signup", baseUrl);
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          headers: {
            apikey: config.secretKey,
            authorization: `Bearer ${config.secretKey}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            p_signup_id: command.signupId,
            p_operation_id: command.operationId,
            p_approved_by: command.approvedByUserId,
          }),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        // The request may have committed before transport failure. Retry only
        // with the same operation ID; the DB RPC is idempotent for that key.
        throw new AdmissionRepositoryError("provider_outcome_unknown");
      }

      let body: unknown;
      try {
        body = await response.json() as unknown;
      } catch {
        // A successful response with an unreadable body may follow a committed
        // transaction. Preserve the same operation ID for reconciliation.
        if (response.ok) throw new AdmissionRepositoryError("provider_outcome_unknown");
        throw new AdmissionRepositoryError(mapRpcError(response.status, null));
      }
      if (!response.ok) throw new AdmissionRepositoryError(mapRpcError(response.status, body));
      try {
        if (!isRecord(body) || typeof body.created !== "boolean" || typeof body.delivery_created !== "boolean") {
          throw new AdmissionRepositoryError("provider_data_invalid");
        }
        if (body.created && !body.delivery_created) throw new AdmissionRepositoryError("provider_data_invalid");

        const admission = parseAdmission(body.admission, command, body.created);
        const delivery = parseDelivery(body.delivery, command, admission.id, body.delivery_created);
        return { admission, delivery, created: body.created };
      } catch {
        // The RPC may already have committed even if its response is malformed
        // or inconsistent. Callers must reconcile/replay with this same key.
        throw new AdmissionRepositoryError("provider_outcome_unknown");
      }
    },
  });
}
