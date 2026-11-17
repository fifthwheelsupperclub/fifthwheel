/** Server-only PostgREST/RPC repository for private member profile records. */

import type { ProfileRepository, StoredProfile } from "./profile.contract.server.ts";
import { ProfileRepositoryError } from "./profile.contract.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(row: JsonRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.length) throw new ProfileRepositoryError("invalid_data");
  return value;
}

function nullableString(row: JsonRecord, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ProfileRepositoryError("invalid_data");
  return value;
}

function numberValue(row: JsonRecord, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ProfileRepositoryError("invalid_data");
  return value;
}

function mapProfile(value: unknown): StoredProfile {
  if (!isRecord(value)) throw new ProfileRepositoryError("invalid_data");
  const openTo = value.open_to;
  const nights = value.nights;
  if (!Array.isArray(openTo) || !openTo.every((item) => ["woman", "man", "non_binary"].includes(String(item)))
      || !Array.isArray(nights) || !nights.every((item) => typeof item === "string")) {
    throw new ProfileRepositoryError("invalid_data");
  }
  const identity = requiredString(value, "identity");
  const lookingFor = requiredString(value, "looking_for");
  const surpriseGame = requiredString(value, "surprise_game");
  if (!["woman", "man", "non_binary"].includes(identity)
      || !["Casual", "Open", "Relationship"].includes(lookingFor)
      || !["Yes, surprise me", "I'd rather keep it conversational"].includes(surpriseGame)) {
    throw new ProfileRepositoryError("invalid_data");
  }
  return Object.freeze({
    guestId: requiredString(value, "guest_id"),
    authUserId: requiredString(value, "auth_user_id"),
    admissionId: requiredString(value, "admission_id"),
    profileRevision: numberValue(value, "profile_revision"),
    firstName: requiredString(value, "first_name"),
    lastName: requiredString(value, "last_name"),
    dateOfBirth: requiredString(value, "date_of_birth"),
    identity: identity as StoredProfile["identity"],
    openTo: [...openTo] as StoredProfile["openTo"],
    matchAgeMin: numberValue(value, "match_age_min"),
    matchAgeMax: numberValue(value, "match_age_max"),
    neighborhood: requiredString(value, "neighborhood"),
    nights: [...nights] as string[],
    lookingFor: lookingFor as StoredProfile["lookingFor"],
    surpriseGame: surpriseGame as StoredProfile["surpriseGame"],
    phone: nullableString(value, "phone"),
    oneLiner: nullableString(value, "one_liner"),
    updatedAt: requiredString(value, "updated_at"),
  });
}

function mapRpcError(status: number, body: unknown): ProfileRepositoryError {
  const message = isRecord(body) && typeof body.message === "string" ? body.message : "";
  if (status === 404 || message.includes("profile_not_found") || message.includes("member_not_admitted")) {
    return new ProfileRepositoryError("not_found");
  }
  if (status === 401 || status === 403 || message.includes("admin_required")) return new ProfileRepositoryError("forbidden");
  if (status === 409 || message.includes("conflict") || message.includes("stale")) return new ProfileRepositoryError("conflict");
  if (status === 400 || message.includes("invalid_") || message.includes("_required") || message.includes("_limit")) {
    return new ProfileRepositoryError("invalid_input");
  }
  return new ProfileRepositoryError("repository_unavailable");
}

export function createProfileRepository(
  config: SupabaseServerConfig,
  options: Readonly<{ fetcher?: typeof fetch }> = {},
): ProfileRepository {
  let base: URL;
  try {
    base = new URL(config.url);
  } catch {
    throw new ProfileRepositoryError("configuration_invalid");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if ((!localHosts.has(base.hostname) && base.protocol !== "https:")
      || (base.protocol === "http:" && !localHosts.has(base.hostname))
      || base.pathname !== "/" || base.username || base.password || base.search || base.hash
      || !config.secretKey.trim()) throw new ProfileRepositoryError("configuration_invalid");
  const fetcher = options.fetcher ?? globalThis.fetch;

  async function rpc(name: string, input: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new ProfileRepositoryError("repository_unavailable");
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw mapRpcError(response.status, payload);
    return payload;
  }

  return Object.freeze({
    async ensureProfile(authUserId) {
      return mapProfile(await rpc("ensure_member_profile", { p_auth_user_id: authUserId }));
    },

    async saveProfile(input) {
      const f = input.fields;
      return mapProfile(await rpc("save_member_profile", {
        p_auth_user_id: input.authUserId,
        p_expected_revision: input.expectedProfileRevision,
        p_operation_id: input.operationId,
        p_first_name: f.firstName,
        p_last_name: f.lastName,
        p_date_of_birth: f.dateOfBirth,
        p_identity: f.identity,
        p_open_to: f.openTo,
        p_match_age_min: f.matchAgeMin,
        p_match_age_max: f.matchAgeMax,
        p_neighborhood: f.neighborhood,
        p_nights: f.nights,
        p_looking_for: f.lookingFor,
        p_surprise_game: f.surpriseGame,
        p_phone: f.phone ?? null,
        p_one_liner: f.oneLiner ?? null,
      }));
    },
  } satisfies ProfileRepository);
}
