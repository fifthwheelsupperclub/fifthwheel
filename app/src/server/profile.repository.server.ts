/** Server-only PostgREST/RPC repository for private W04 profile records. */

import type {
  IdentityReviewDecisionRequest,
  IdentityReviewQueueItem,
  UploadIntentRequest,
} from "../profile.contract.ts";
import type {
  CreateUploadIntentInput,
  ProfileRepository,
  StoredProfile,
  StoredProfileFile,
} from "./profile.contract.server.ts";
import { ProfileRepositoryError } from "./profile.contract.server.ts";
import type { NormalizedImage } from "./image-normalizer.server.ts";
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

function nullableNumber(row: JsonRecord, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
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
  const identityStatus = requiredString(value, "identity_status");
  const lookingFor = requiredString(value, "looking_for");
  const surpriseGame = requiredString(value, "surprise_game");
  if (!["woman", "man", "non_binary"].includes(identity)
      || !["draft", "submitted", "approved", "resubmission_required"].includes(identityStatus)
      || !["Casual", "Open", "Relationship"].includes(lookingFor)
      || !["Yes, surprise me", "I'd rather keep it conversational"].includes(surpriseGame)) {
    throw new ProfileRepositoryError("invalid_data");
  }
  return Object.freeze({
    guestId: requiredString(value, "guest_id"),
    authUserId: requiredString(value, "auth_user_id"),
    admissionId: requiredString(value, "admission_id"),
    profileRevision: numberValue(value, "profile_revision"),
    criticalIdentityVersion: numberValue(value, "critical_identity_version"),
    reviewedIdentityVersion: nullableNumber(value, "reviewed_identity_version"),
    identityStatus: identityStatus as StoredProfile["identityStatus"],
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
    latestCorrectionReason: nullableString(value, "latest_correction_reason"),
    evidenceReceivedAt: nullableString(value, "evidence_received_at"),
    evidenceDeletedAt: nullableString(value, "evidence_deleted_at"),
    updatedAt: requiredString(value, "updated_at"),
  });
}

function mapFile(value: unknown): StoredProfileFile {
  if (!isRecord(value)) throw new ProfileRepositoryError("invalid_data");
  const kind = requiredString(value, "kind");
  const state = requiredString(value, "state");
  const contentType = requiredString(value, "content_type");
  if (!["photo", "selfie"].includes(kind)
      || !["pending_upload", "quarantined", "normalizing", "ready", "rejected", "superseded", "deleted"].includes(state)
      || !["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new ProfileRepositoryError("invalid_data");
  }
  return Object.freeze({
    fileId: requiredString(value, "file_id"),
    guestId: requiredString(value, "guest_id"),
    authUserId: requiredString(value, "auth_user_id"),
    kind: kind as StoredProfileFile["kind"],
    state: state as StoredProfileFile["state"],
    contentType: contentType as StoredProfileFile["contentType"],
    declaredByteSize: numberValue(value, "declared_byte_size"),
    actualByteSize: nullableNumber(value, "actual_byte_size"),
    normalizedByteSize: nullableNumber(value, "normalized_byte_size"),
    profileRevisionAtIntent: numberValue(value, "profile_revision_at_intent"),
    criticalIdentityVersion: numberValue(value, "critical_identity_version"),
    quarantineKey: nullableString(value, "quarantine_key"),
    normalizedKey: nullableString(value, "normalized_key"),
    uploadTokenHash: nullableString(value, "upload_token_hash"),
    uploadExpiresAt: nullableString(value, "upload_expires_at"),
    uploadConsumedAt: nullableString(value, "upload_consumed_at"),
    receivedAt: nullableString(value, "received_at"),
    retentionDueAt: nullableString(value, "retention_due_at"),
    deletedAt: nullableString(value, "deleted_at"),
  });
}

function mapRpcError(status: number, body: unknown): ProfileRepositoryError {
  const message = isRecord(body) && typeof body.message === "string" ? body.message : "";
  if (status === 404 || message.includes("profile_not_found") || message.includes("file_not_found") || message.includes("upload_not_quarantined") || message.includes("member_not_admitted")) {
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

  async function send(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          accept: "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new ProfileRepositoryError("repository_unavailable");
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw mapRpcError(response.status, payload);
    return payload;
  }

  async function rpc(name: string, input: Record<string, unknown>): Promise<unknown> {
    return send(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  async function rows(path: string): Promise<JsonRecord[]> {
    const payload = await send(path);
    if (!Array.isArray(payload) || !payload.every(isRecord)) throw new ProfileRepositoryError("invalid_data");
    return payload;
  }

  const repo: ProfileRepository = {
    async ensureProfile(authUserId) {
      return mapProfile(await rpc("ensure_member_profile", { p_auth_user_id: authUserId }));
    },

    async readProfile(authUserId) {
      const profile = await repo.ensureProfile(authUserId);
      const params = new URLSearchParams({
        select: "file_id,guest_id,auth_user_id,kind,state,content_type,declared_byte_size,actual_byte_size,normalized_byte_size,profile_revision_at_intent,critical_identity_version,quarantine_key,normalized_key,upload_token_hash,upload_expires_at,upload_consumed_at,received_at,retention_due_at,deleted_at",
        guest_id: `eq.${profile.guestId}`,
        order: "created_at.asc,file_id.asc",
      });
      const files = await rows(`/rest/v1/app_profile_files?${params}`);
      return { profile, files: files.map(mapFile) };
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

    async createUploadIntent(input: CreateUploadIntentInput) {
      const r = await rpc("create_profile_upload_intent", {
        p_auth_user_id: input.authUserId,
        p_expected_revision: input.request.expectedProfileRevision,
        p_expected_identity_version: input.request.expectedCriticalIdentityVersion,
        p_operation_id: input.request.operationId,
        p_file_id: input.fileId,
        p_kind: input.request.kind,
        p_content_type: input.request.contentType,
        p_byte_size: input.request.byteSize,
        p_quarantine_key: input.quarantineKey,
        p_token_hash: input.uploadTokenHash,
        p_expires_at: input.expiresAt,
      });
      if (!isRecord(r)) throw new ProfileRepositoryError("invalid_data");
      return {
        fileId: requiredString(r, "file_id"),
        guestId: requiredString(r, "guest_id"),
        criticalIdentityVersion: numberValue(r, "critical_identity_version"),
        expiresAt: requiredString(r, "expires_at"),
      };
    },

    async consumeUploadGrant(input) {
      return mapFile(await rpc("consume_profile_upload_grant", {
        p_auth_user_id: input.authUserId,
        p_file_id: input.fileId,
        p_token_hash: input.uploadTokenHash,
        p_received_size: input.byteSize,
      }));
    },

    async beginNormalization(input) {
      return mapFile(await rpc("begin_profile_normalization", {
        p_auth_user_id: input.authUserId,
        p_file_id: input.fileId,
        p_expected_revision: input.expectedProfileRevision,
        p_expected_identity_version: input.expectedCriticalIdentityVersion,
      }));
    },

    async failUpload(input) {
      await rpc("fail_profile_upload", { p_auth_user_id: input.authUserId, p_file_id: input.fileId, p_safe_reason: input.safeReason });
    },

    async finalizeUpload(input) {
      const r = await rpc("finalize_profile_upload", {
        p_auth_user_id: input.authUserId,
        p_file_id: input.fileId,
        p_expected_revision: input.expectedProfileRevision,
        p_expected_identity_version: input.expectedCriticalIdentityVersion,
        p_normalized_key: input.normalizedKey,
        p_normalized_type: input.image.contentType,
        p_normalized_size: input.image.bytes.byteLength,
        p_width: input.image.width,
        p_height: input.image.height,
      });
      if (!isRecord(r)) throw new ProfileRepositoryError("invalid_data");
      return { profile: mapProfile(r.profile), file: mapFile(r.file) };
    },

    async deleteFile(input) {
      const r = await rpc("delete_member_profile_file", {
        p_auth_user_id: input.authUserId,
        p_file_id: input.fileId,
        p_expected_revision: input.expectedProfileRevision,
        p_operation_id: input.operationId,
      });
      if (!isRecord(r)) throw new ProfileRepositoryError("invalid_data");
      return { profile: mapProfile(r.profile), file: mapFile(r.file) };
    },

    async getOwnerReadFile(input) {
      const r = await rpc("get_owner_profile_file_read", {
        p_auth_user_id: input.authUserId,
        p_file_id: input.fileId,
        p_expected_revision: input.expectedProfileRevision,
        p_expected_identity_version: input.expectedCriticalIdentityVersion,
      });
      if (!isRecord(r)) throw new ProfileRepositoryError("invalid_data");
      return { normalizedKey: requiredString(r, "normalized_key"), contentType: requiredString(r, "content_type") };
    },

    async submitProfile(input) {
      const r = await rpc("submit_member_profile", {
        p_auth_user_id: input.authUserId,
        p_expected_revision: input.expectedProfileRevision,
        p_operation_id: input.operationId,
      });
      if (!isRecord(r) || !isRecord(r.review)) throw new ProfileRepositoryError("invalid_data");
      return { profile: mapProfile(r.profile), review: r.review };
    },

    async listIdentityReviews(input) {
      const params = new URLSearchParams({
        select: "review_id,guest_id,attempt_number,profile_revision,critical_identity_version,submitted_at,state,app_member_profiles!inner(first_name,last_name,identity_status)",
        order: "submitted_at.asc,review_id.asc",
        limit: String(Math.max(1, Math.min(100, Math.trunc(input.limit)))),
      });
      if (input.status === "submitted") params.set("state", "eq.submitted");
      if (input.cursor) params.set("submitted_at", `gt.${input.cursor}`);
      const items = await rows(`/rest/v1/app_identity_reviews?${params}`);
      const mapped: IdentityReviewQueueItem[] = items.map((row) => {
        if (!isRecord(row.app_member_profiles)) throw new ProfileRepositoryError("invalid_data");
        return {
          reviewId: requiredString(row, "review_id"),
          guestId: requiredString(row, "guest_id"),
          firstName: requiredString(row.app_member_profiles, "first_name"),
          lastName: requiredString(row.app_member_profiles, "last_name"),
          submittedAt: requiredString(row, "submitted_at"),
          profileRevision: numberValue(row, "profile_revision"),
          criticalIdentityVersion: numberValue(row, "critical_identity_version"),
          attemptNumber: numberValue(row, "attempt_number"),
        };
      });
      const nextCursor = mapped.length === input.limit && mapped.length > 0 ? mapped[mapped.length - 1]?.submittedAt ?? null : null;
      return { items: mapped, nextCursor };
    },

    async findCurrentIdentityReview(guestId) {
      const params = new URLSearchParams({
        select: "review_id,critical_identity_version",
        guest_id: `eq.${guestId}`,
        state: "eq.submitted",
        order: "submitted_at.desc,review_id.desc",
        limit: "1",
      });
      const found = await rows(`/rest/v1/app_identity_reviews?${params}`);
      if (found.length !== 1) throw new ProfileRepositoryError("not_found");
      return {
        reviewId: requiredString(found[0]!, "review_id"),
        criticalIdentityVersion: numberValue(found[0]!, "critical_identity_version"),
      };
    },

    async prepareIdentityReviewRead(input) {
      const r = await rpc("prepare_identity_review_read", {
        p_actor_user_id: input.actorUserId,
        p_guest_id: input.guestId,
        p_review_id: input.reviewId,
        p_expected_identity_version: input.expectedCriticalIdentityVersion,
        p_request_id: input.requestId,
      });
      if (!isRecord(r) || !Array.isArray(r.files) || !r.files.every(isRecord)) throw new ProfileRepositoryError("invalid_data");
      const files = r.files.map((file) => {
        const kind = requiredString(file, "kind");
        if (kind !== "photo" && kind !== "selfie") throw new ProfileRepositoryError("invalid_data");
        return { fileId: requiredString(file, "file_id"), kind: kind as "photo" | "selfie", normalizedKey: requiredString(file, "normalized_key") };
      });
      return { profile: mapProfile(r.profile), review: isRecord(r.review) ? r.review : {}, files };
    },

    async confirmIdentityReviewReadSet(input) {
      const r = await rpc("confirm_identity_review_read_set", {
        p_actor_user_id: input.actorUserId,
        p_guest_id: input.guestId,
        p_review_id: input.reviewId,
        p_expected_identity_version: input.expectedCriticalIdentityVersion,
        p_request_id: input.requestId,
        p_file_ids: [...input.fileIds],
      });
      if (!Array.isArray(r) || !r.every(isRecord)) throw new ProfileRepositoryError("invalid_data");
      return r.map((file) => {
        const kind = requiredString(file, "kind");
        if (kind !== "photo" && kind !== "selfie") throw new ProfileRepositoryError("invalid_data");
        return { fileId: requiredString(file, "file_id"), kind, normalizedKey: requiredString(file, "normalized_key") };
      });
    },

    async decideIdentityReview(input) {
      return mapProfile(await rpc("decide_identity_review", {
        p_actor_user_id: input.actorUserId,
        p_guest_id: input.guestId,
        p_review_id: input.request.reviewId,
        p_expected_revision: input.request.expectedProfileRevision,
        p_operation_id: input.request.operationId,
        p_decision: input.request.decision,
        p_correction_reason: input.request.correctionReason ?? null,
      }).then((value) => isRecord(value) ? value.profile : null));
    },
  };
  return Object.freeze(repo);
}

export type { UploadIntentRequest };
