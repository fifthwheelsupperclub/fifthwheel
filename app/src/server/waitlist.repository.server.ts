/** Server-only PostgREST repository for validated marketing waitlist intake. */

import type {
  ValidatedWaitlistIntake,
  WaitlistInsertResult,
  WaitlistRepository,
  WaitlistSignupRow,
} from "./admission.contracts.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

export type WaitlistRepositoryErrorCode =
  | "configuration_invalid"
  | "provider_failed"
  | "provider_data_invalid"
  | "existing_row_unavailable";

export class WaitlistRepositoryError extends Error {
  readonly code: WaitlistRepositoryErrorCode;

  constructor(code: WaitlistRepositoryErrorCode) {
    super(code);
    this.name = "WaitlistRepositoryError";
    this.code = code;
  }
}

const rowColumns = [
  "id", "first_name", "last_name", "email_normalized", "birthdate", "identity", "open_to",
  "match_age_min", "match_age_max", "neighborhood", "nights", "looking_for", "surprise_game",
  "referral", "source", "received_at", "created_at",
] as const;
const rowSelect = rowColumns.join(",");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown): value is string {
  return typeof value === "string";
}

function parseSignupRow(value: unknown, expectedEmail: string): WaitlistSignupRow {
  if (!isRecord(value)) throw new WaitlistRepositoryError("provider_data_invalid");
  const stringFields = [
    "id", "first_name", "last_name", "email_normalized", "birthdate", "identity", "neighborhood",
    "looking_for", "surprise_game", "referral", "source", "received_at", "created_at",
  ] as const;
  if (
    stringFields.some((field) => !requireString(value[field]))
    || value.email_normalized !== expectedEmail
    || !Array.isArray(value.open_to)
    || value.open_to.some((item) => !requireString(item))
    || !Array.isArray(value.nights)
    || value.nights.some((item) => !requireString(item))
    || !Number.isInteger(value.match_age_min)
    || !Number.isInteger(value.match_age_max)
  ) {
    throw new WaitlistRepositoryError("provider_data_invalid");
  }
  return value as unknown as WaitlistSignupRow;
}

function toInsertRow(intake: ValidatedWaitlistIntake): Record<string, unknown> {
  return {
    first_name: intake.firstName,
    last_name: intake.lastName,
    email_normalized: intake.emailNormalized,
    birthdate: intake.birthdate,
    identity: intake.identity,
    open_to: [...intake.openTo],
    match_age_min: intake.matchAgeMin,
    match_age_max: intake.matchAgeMax,
    neighborhood: intake.neighborhood,
    nights: [...intake.nights],
    looking_for: intake.lookingFor,
    surprise_game: intake.surpriseGame,
    referral: intake.referral,
    source: intake.source,
  };
}

function validateConfig(config: SupabaseServerConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new WaitlistRepositoryError("configuration_invalid");
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
    throw new WaitlistRepositoryError("configuration_invalid");
  }
  return url;
}

async function parseRows(response: Response): Promise<unknown[]> {
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new WaitlistRepositoryError("provider_data_invalid");
  }
  if (!Array.isArray(body)) throw new WaitlistRepositoryError("provider_data_invalid");
  return body;
}

/**
 * Implements the intake insertion method only. Other WaitlistRepository methods
 * are owned by later admin-search slices.
 */
export function createWaitlistRepository(
  config: SupabaseServerConfig,
  fetcher: typeof fetch = globalThis.fetch,
): Pick<WaitlistRepository, "insertIfAbsent"> {
  const baseUrl = validateConfig(config);

  async function request(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetcher(url, {
        ...init,
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          accept: "application/json",
          ...init.headers,
        },
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new WaitlistRepositoryError("provider_failed");
    }
  }

  async function fetchExisting(emailNormalized: string): Promise<WaitlistSignupRow> {
    const url = new URL("/rest/v1/waitlist_signups", baseUrl);
    url.searchParams.set("select", rowSelect);
    url.searchParams.set("email_normalized", `eq.${emailNormalized}`);
    url.searchParams.set("limit", "2");
    const response = await request(url, { method: "GET" });
    if (!response.ok) throw new WaitlistRepositoryError("existing_row_unavailable");
    const rows = await parseRows(response);
    if (rows.length !== 1) throw new WaitlistRepositoryError("existing_row_unavailable");
    return parseSignupRow(rows[0], emailNormalized);
  }

  return Object.freeze({
    async insertIfAbsent(intake: ValidatedWaitlistIntake): Promise<WaitlistInsertResult> {
      const url = new URL("/rest/v1/waitlist_signups", baseUrl);
      url.searchParams.set("on_conflict", "email_normalized");
      const response = await request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify(toInsertRow(intake)),
      });
      if (!response.ok) throw new WaitlistRepositoryError("provider_failed");

      const rows = await parseRows(response);
      if (rows.length === 1) {
        return { kind: "created", signup: parseSignupRow(rows[0], intake.emailNormalized) };
      }
      if (rows.length > 1) throw new WaitlistRepositoryError("provider_data_invalid");

      // PostgREST's ignore-duplicates resolution returns no representation when
      // the normalized email already exists. Read it without issuing any update.
      return { kind: "existing", signup: await fetchExisting(intake.emailNormalized) };
    },
  });
}
