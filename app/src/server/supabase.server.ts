/** Server-only Supabase Auth and service-role reader. Never import into a browser module. */

import { env as processEnv } from "node:process";
import type { AdmissionState, StaffRole } from "./authorization.server.ts";
import type { VerifiedAuthIdentity } from "./admission.contracts.server.ts";

export type SupabaseServerConfig = Readonly<{
  url: string;
  publishableKey: string;
  secretKey: string;
}>;

export type Environment = Readonly<Record<string, string | undefined>>;

export type TrustedAuthorizationFacts = Readonly<{
  staffRoles: readonly StaffRole[];
  admission: Readonly<{
    state: AdmissionState;
    authUserId: string | null;
    emailNormalized: string | null;
  }>;
}>;

export type SupabaseServerErrorCode =
  | "configuration_invalid"
  | "auth_unavailable"
  | "trusted_read_failed"
  | "trusted_data_invalid";

export class SupabaseServerError extends Error {
  readonly code: SupabaseServerErrorCode;

  constructor(code: SupabaseServerErrorCode) {
    super(code);
    this.name = "SupabaseServerError";
    this.code = code;
  }
}

export interface SupabaseServerClient {
  verifyAccessToken(accessToken: string): Promise<VerifiedAuthIdentity | null>;
  readTrustedAuthorizationFacts(authUserId: string): Promise<TrustedAuthorizationFacts>;
}

const staffRoles = new Set<StaffRole>(["admin", "host", "restaurant"]);
const admissionStates = new Set<AdmissionState>(["invited", "activated", "deleted", "none"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateConfig(config: SupabaseServerConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new SupabaseServerError("configuration_invalid");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    !["https:", "http:"].includes(url.protocol)
    || (url.protocol === "http:" && !localHosts.has(url.hostname))
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || !requireString(config.publishableKey)
    || !requireString(config.secretKey)
    || config.publishableKey.trim() === config.secretKey.trim()
  ) {
    throw new SupabaseServerError("configuration_invalid");
  }
  return url;
}

function readEnvironmentConfig(environment: Environment): SupabaseServerConfig {
  const url = environment.SUPABASE_URL;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY;
  const secretKey = environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!requireString(url) || !requireString(publishableKey) || !requireString(secretKey)) {
    throw new SupabaseServerError("configuration_invalid");
  }
  return { url: url.trim(), publishableKey: publishableKey.trim(), secretKey: secretKey.trim() };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeRoleRows(value: unknown, authUserId: string): readonly StaffRole[] {
  if (!Array.isArray(value)) throw new SupabaseServerError("trusted_data_invalid");
  const roles = new Set<StaffRole>();
  for (const item of value) {
    const row = object(item);
    if (
      !row
      || row.user_id !== authUserId
      || typeof row.role !== "string"
      || !staffRoles.has(row.role as StaffRole)
    ) {
      throw new SupabaseServerError("trusted_data_invalid");
    }
    roles.add(row.role as StaffRole);
  }
  return [...roles];
}

function normalizeAdmission(value: unknown, authUserId: string): TrustedAuthorizationFacts["admission"] {
  if (!Array.isArray(value) || value.length > 1) throw new SupabaseServerError("trusted_data_invalid");
  if (value.length === 0) return { state: "none", authUserId: null, emailNormalized: null };
  const row = object(value[0]);
  if (!row || typeof row.state !== "string" || !admissionStates.has(row.state as AdmissionState)) {
    throw new SupabaseServerError("trusted_data_invalid");
  }
  if (row.auth_user_id !== authUserId || !requireString(row.email_normalized)) {
    throw new SupabaseServerError("trusted_data_invalid");
  }
  return {
    state: row.state as AdmissionState,
    authUserId: row.auth_user_id,
    emailNormalized: normalizeEmail(row.email_normalized),
  };
}

async function parseJson(response: Response, code: SupabaseServerErrorCode): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new SupabaseServerError(code);
  }
}

export function createSupabaseServerClient(
  config: SupabaseServerConfig,
  fetcher: typeof fetch = globalThis.fetch,
): SupabaseServerClient {
  const baseUrl = validateConfig(config);

  async function getJson(path: string, headers: HeadersInit, code: SupabaseServerErrorCode): Promise<unknown> {
    try {
      const response = await fetcher(new URL(path, baseUrl), {
        method: "GET",
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new SupabaseServerError(code);
      return await parseJson(response, code);
    } catch (error) {
      if (error instanceof SupabaseServerError) throw error;
      throw new SupabaseServerError(code);
    }
  }

  async function readTable(path: string): Promise<unknown> {
    return getJson(
      path,
      {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        accept: "application/json",
      },
      "trusted_read_failed",
    );
  }

  return Object.freeze({
    async verifyAccessToken(accessToken: string): Promise<VerifiedAuthIdentity | null> {
      if (!requireString(accessToken) || accessToken.length > 16_384) return null;
      let response: Response;
      try {
        response = await fetcher(new URL("/auth/v1/user", baseUrl), {
          method: "GET",
          headers: {
            apikey: config.publishableKey,
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new SupabaseServerError("auth_unavailable");
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new SupabaseServerError("auth_unavailable");

      const user = object(await parseJson(response, "auth_unavailable"));
      if (!user || typeof user.id !== "string" || !uuidPattern.test(user.id)) {
        throw new SupabaseServerError("auth_unavailable");
      }
      const email = typeof user.email === "string" ? normalizeEmail(user.email) : "";
      return {
        authUserId: user.id,
        emailNormalized: email,
        emailVerified: email.length > 0 && typeof user.email_confirmed_at === "string",
      };
    },

    async readTrustedAuthorizationFacts(authUserId: string): Promise<TrustedAuthorizationFacts> {
      if (!uuidPattern.test(authUserId)) throw new SupabaseServerError("trusted_data_invalid");
      const rolesUrl = new URL("/rest/v1/app_user_roles", baseUrl);
      rolesUrl.searchParams.set("select", "user_id,role");
      rolesUrl.searchParams.set("user_id", `eq.${authUserId}`);

      const admissionsUrl = new URL("/rest/v1/app_admissions", baseUrl);
      admissionsUrl.searchParams.set("select", "state,auth_user_id,email_normalized");
      admissionsUrl.searchParams.set("auth_user_id", `eq.${authUserId}`);

      const [roleRows, admissionRows] = await Promise.all([
        readTable(`${rolesUrl.pathname}${rolesUrl.search}`),
        readTable(`${admissionsUrl.pathname}${admissionsUrl.search}`),
      ]);
      return {
        staffRoles: normalizeRoleRows(roleRows, authUserId),
        admission: normalizeAdmission(admissionRows, authUserId),
      };
    },
  });
}

export function createSupabaseServerClientFromEnvironment(
  environment: Environment = processEnv,
  fetcher: typeof fetch = globalThis.fetch,
): SupabaseServerClient {
  return createSupabaseServerClient(readEnvironmentConfig(environment), fetcher);
}
