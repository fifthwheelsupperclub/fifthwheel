/** Server-only adapter for app admission sign-in lookup and activation. */

import type {
  AdmissionRepository,
  AppAdmissionRow,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
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

/** Sign-in lookups and activation for admissions created by Table placement. Returned rows stay server-side. */
export function createAdmissionRepository(
  config: SupabaseServerConfig,
  fetcher: typeof fetch = globalThis.fetch,
): Pick<AdmissionRepository, "findActiveAdmissionByEmail" | "activateFromVerifiedIdentity"> {
  const baseUrl = validateConfig(config);

  return Object.freeze({
    async findActiveAdmissionByEmail(emailNormalized: string): Promise<AppAdmissionRow | null> {
      if (typeof emailNormalized !== "string" || emailNormalized !== emailNormalized.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized)) {
        throw new AdmissionRepositoryError("validation_failed");
      }
      const url = new URL("/rest/v1/app_admissions", baseUrl);
      url.searchParams.set("select", "*");
      url.searchParams.set("email_normalized", `eq.${emailNormalized}`);
      url.searchParams.set("state", "in.(invited,activated)");
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
        || !(row.state === "activated"
          ? isUuid(row.auth_user_id) && isTimestamp(row.activated_at)
          : row.state === "invited" && row.auth_user_id === null && row.activated_at === null)
        || !isUuid(row.approved_by)
        || !isTimestamp(row.approved_at)
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
  });
}
