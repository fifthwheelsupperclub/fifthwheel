/** Authorized W04 profile, upload and identity-review operations. */

import { createHash, randomBytes } from "node:crypto";
import {
  authorize,
  type AppPermission,
  type ServerVerifiedPrincipal,
} from "./authorization.server.ts";
import { assertExactOrigin } from "./origin.server.ts";
import { ProfileRepositoryError } from "./profile.contract.server.ts";
import { ProfileStorageError } from "./profile.storage.supabase.server.ts";
import type {
  ProfileErrorCode,
  ProfileServiceDependencies,
  ProfileServicePort,
  ProfileServiceResult,
  StoredProfile,
  StoredProfileFile,
} from "./profile.contract.server.ts";
import type {
  IdentityReviewDecisionRequest,
  IdentityReviewDetailDTO,
  IdentityReviewProfileDTO,
  MemberProfileDTO,
  MemberProfileSaveRequest,
  UploadIntentRequest,
} from "../profile.contract.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxUploadBytes = 8 * 1024 * 1024;
const neighborhoods = new Set(["Inman Park", "Chamblee", "Virginia Highlands"]);
const weekdays = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

function fail<T>(code: ProfileErrorCode, correlationId: string, fields?: Record<string, string>): ProfileServiceResult<T> {
  const messageByCode: Record<ProfileErrorCode, string> = {
    unauthenticated: "Sign in to continue.",
    forbidden: "You do not have access to this profile action.",
    not_found: "The requested profile information is unavailable.",
    invalid_input: "Check the highlighted fields and try again.",
    conflict: "This profile changed. Refresh it and try again.",
    temporarily_unavailable: "This profile action is temporarily unavailable. Try again shortly.",
  };
  return {
    ok: false,
    code,
    message: messageByCode[code],
    retryable: code === "conflict" || code === "temporarily_unavailable",
    correlationId,
    ...(fields ? { fields } : {}),
  };
}

function mapError(error: unknown): ProfileErrorCode {
  if (error instanceof ProfileRepositoryError) {
    switch (error.code) {
      case "not_found": return "not_found";
      case "forbidden": return "forbidden";
      case "conflict": return "conflict";
      case "invalid_input": return "invalid_input";
      default: return "temporarily_unavailable";
    }
  }
  if (error instanceof ProfileStorageError) return "temporarily_unavailable";
  return "temporarily_unavailable";
}

function authorized(
  principal: ServerVerifiedPrincipal | null,
  permission: AppPermission,
): principal is ServerVerifiedPrincipal {
  return authorize(principal, permission).allowed;
}

function memberDTO(profile: StoredProfile, files: readonly StoredProfileFile[]): MemberProfileDTO {
  const currentFiles = files.filter((file) => file.criticalIdentityVersion === profile.criticalIdentityVersion);
  const missing: string[] = [];
  const approvedCurrent = profile.identityStatus === "approved"
    && profile.reviewedIdentityVersion === profile.criticalIdentityVersion
    && profile.evidenceReceivedAt !== null;
  if (!approvedCurrent && !currentFiles.some((file) => file.kind === "photo" && file.state === "ready")) missing.push("photos");
  if (!approvedCurrent && !currentFiles.some((file) => file.kind === "selfie" && file.state === "ready")) missing.push("selfie");
  return Object.freeze({
    profileRevision: profile.profileRevision,
    criticalIdentityVersion: profile.criticalIdentityVersion,
    reviewedIdentityVersion: profile.reviewedIdentityVersion,
    identityStatus: profile.identityStatus,
    latestCorrectionReason: profile.latestCorrectionReason,
    firstName: profile.firstName,
    lastName: profile.lastName,
    dateOfBirth: profile.dateOfBirth,
    identity: profile.identity,
    openTo: [...profile.openTo],
    matchAgeMin: profile.matchAgeMin,
    matchAgeMax: profile.matchAgeMax,
    neighborhood: profile.neighborhood,
    nights: [...profile.nights],
    lookingFor: profile.lookingFor,
    surpriseGame: profile.surpriseGame,
    phone: profile.phone,
    oneLiner: profile.oneLiner,
    files: files.map((file) => ({
      fileId: file.fileId,
      kind: file.kind,
      state: file.state === "quarantined" || file.state === "normalizing" ? "pending_upload" : file.state,
    })),
    missingFields: missing,
  });
}

type ReviewFileSummary = Readonly<{
  fileId: string;
  kind: "photo" | "selfie";
  state: "pending_upload" | "ready" | "rejected" | "superseded" | "deleted";
  criticalIdentityVersion: number;
}>;

function reviewProfileDTO(profile: StoredProfile, files: readonly ReviewFileSummary[]): IdentityReviewProfileDTO {
  const currentFiles = files.filter((file) => file.criticalIdentityVersion === profile.criticalIdentityVersion && file.state !== "deleted");
  const missingFields: string[] = [];
  if (!currentFiles.some((file) => file.kind === "photo" && file.state === "ready")) missingFields.push("photos");
  if (!currentFiles.some((file) => file.kind === "selfie" && file.state === "ready")) missingFields.push("selfie");
  return Object.freeze({
    profileRevision: profile.profileRevision,
    criticalIdentityVersion: profile.criticalIdentityVersion,
    reviewedIdentityVersion: profile.reviewedIdentityVersion,
    identityStatus: profile.identityStatus,
    firstName: profile.firstName,
    lastName: profile.lastName,
    dateOfBirth: profile.dateOfBirth,
    identity: profile.identity,
    files: currentFiles.map((file) => ({
      fileId: file.fileId,
      kind: file.kind,
      state: file.state,
    })),
    missingFields,
  });
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year!, month! - 1, day!);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null;
  return { year: year!, month: month!, day: day! };
}

function validateProfileSave(value: unknown, now: Date): Record<string, string> | null {
  const fields: Record<string, string> = {};
  if (!isRecord(value)) return { form: "Submit a valid profile." };
  const input = value;
  if (typeof input.operationId !== "string" || !uuidPattern.test(input.operationId)) fields.operationId = "Refresh and try again.";
  if (!validRevision(input.expectedProfileRevision)) fields.expectedProfileRevision = "Refresh and try again.";
  if (typeof input.firstName !== "string" || !input.firstName.trim() || input.firstName.length > 100) fields.firstName = "Add a valid first name.";
  if (typeof input.lastName !== "string" || !input.lastName.trim() || input.lastName.length > 100) fields.lastName = "Add a valid last name.";
  const birth = typeof input.dateOfBirth === "string" ? validDate(input.dateOfBirth) : null;
  if (!birth) fields.dateOfBirth = "Enter a valid date of birth.";
  else {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (name: string) => Number(parts.find((entry) => entry.type === name)?.value);
    const year = part("year"); const month = part("month"); const day = part("day");
    const age = year - birth.year - (month < birth.month || (month === birth.month && day < birth.day) ? 1 : 0);
    if (age < 21) fields.dateOfBirth = "You must be 21 or older.";
  }
  const identities = new Set(["woman", "man", "non_binary"]);
  if (typeof input.identity !== "string" || !identities.has(input.identity)) fields.identity = "Choose a valid identity.";
  if (!Array.isArray(input.openTo) || input.openTo.length < 1 || input.openTo.length > 3
      || input.openTo.some((option) => typeof option !== "string" || !identities.has(option))
      || new Set(input.openTo).size !== input.openTo.length) fields.openTo = "Choose one or more valid options.";
  const minAge = input.matchAgeMin;
  const maxAge = input.matchAgeMax;
  if (typeof minAge !== "number" || !Number.isInteger(minAge) || minAge < 21 || minAge > 120) fields.matchAgeMin = "Enter an age from 21 to 120.";
  if (typeof maxAge !== "number" || !Number.isInteger(maxAge) || maxAge < 21 || maxAge > 120
      || (typeof minAge === "number" && maxAge < minAge)) fields.matchAgeMax = "Enter a valid maximum from 21 to 120.";
  if (typeof input.neighborhood !== "string" || !neighborhoods.has(input.neighborhood)) fields.neighborhood = "Choose a valid neighborhood.";
  if (!Array.isArray(input.nights) || input.nights.length > 7 || input.nights.some((day) => typeof day !== "string" || !weekdays.has(day))
      || new Set(input.nights).size !== input.nights.length) fields.nights = "Choose valid days.";
  if (typeof input.lookingFor !== "string" || !["Casual", "Open", "Relationship"].includes(input.lookingFor)) fields.lookingFor = "Choose what you are looking for.";
  if (typeof input.surpriseGame !== "string" || !["Yes, surprise me", "I'd rather keep it conversational"].includes(input.surpriseGame)) fields.surpriseGame = "Choose a valid option.";
  if (input.phone !== undefined && input.phone !== null && (typeof input.phone !== "string" || input.phone.length > 40)) fields.phone = "Phone must be 40 characters or fewer.";
  if (input.oneLiner !== undefined && input.oneLiner !== null && (typeof input.oneLiner !== "string" || input.oneLiner.length > 1000)) fields.oneLiner = "Keep this to 1,000 characters or fewer.";
  return Object.keys(fields).length ? fields : null;
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    if (!/^\d{1,8}$/.test(lengthHeader) || Number(lengthHeader) > maxUploadBytes) throw new TypeError("upload_too_large");
  }
  if (!request.body) throw new TypeError("upload_empty");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxUploadBytes) {
        await reader.cancel("upload_too_large").catch(() => undefined);
        throw new TypeError("upload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length < 1) throw new TypeError("upload_empty");
  if (lengthHeader !== null && Number(lengthHeader) !== length) throw new TypeError("upload_size_mismatch");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validateUploadIntent(value: unknown): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!isRecord(value)) return { form: "Submit a valid upload request." };
  const input = value;
  if (typeof input.operationId !== "string" || !uuidPattern.test(input.operationId)) errors.operationId = "Refresh and try again.";
  if (!validRevision(input.expectedProfileRevision)) errors.expectedProfileRevision = "Refresh and try again.";
  if (!validRevision(input.expectedCriticalIdentityVersion)) errors.expectedCriticalIdentityVersion = "Refresh and try again.";
  if (input.kind !== "photo" && input.kind !== "selfie") errors.kind = "Choose a photo or selfie.";
  if (typeof input.contentType !== "string" || !imageTypes.has(input.contentType)) errors.contentType = "Use a JPEG, PNG, or WebP image.";
  if (typeof input.byteSize !== "number" || !Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > maxUploadBytes) errors.byteSize = "Images must be 8 MB or smaller.";
  return Object.keys(errors).length ? errors : null;
}

export function createProfileService(
  dependencies: ProfileServiceDependencies & Readonly<{ appOrigin: string }>,
): ProfileServicePort {
  const { resolvePrincipal, repository, storage, normalizer, createId, now, appOrigin } = dependencies;

  async function getPrincipal(accessToken: string | null | undefined): Promise<ServerVerifiedPrincipal | null | undefined> {
    try {
      return await resolvePrincipal(accessToken);
    } catch {
      // A verifier outage is not an invalid session. Preserve the distinction
      // so the UI can retry instead of signing the member out.
      return undefined;
    }
  }

  const service: ProfileServicePort = {
    async readMemberProfile(accessToken) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:read-own" })) return fail("forbidden", correlationId);
      try {
        const data = await repository.readProfile(principal.userId);
        return { ok: true, data: memberDTO(data.profile, data.files), correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async saveMemberProfile(accessToken, request) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:edit-own" })) return fail("forbidden", correlationId);
      const fields = validateProfileSave(request, now());
      if (fields) return fail("invalid_input", correlationId, fields);
      try {
        const profile = await repository.saveProfile({
          authUserId: principal.userId,
          operationId: request.operationId,
          expectedProfileRevision: request.expectedProfileRevision,
          fields: request as unknown as Record<string, unknown>,
        });
        const current = await repository.readProfile(principal.userId);
        return { ok: true, data: memberDTO(profile, current.files), correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async createMemberUploadIntent(accessToken, request) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:edit-own" })) return fail("forbidden", correlationId);
      const fields = validateUploadIntent(request);
      if (fields) return fail("invalid_input", correlationId, fields);
      try {
        const profile = await repository.ensureProfile(principal.userId);
        const fileId = createId();
        const uploadToken = randomBytes(32).toString("base64url");
        // Leave clock/network margin below the database's five-minute ceiling.
        const expiresAt = new Date(now().getTime() + 4 * 60 * 1000 + 30 * 1000).toISOString();
        const quarantineKey = `quarantine/${profile.guestId}/${fileId}`;
        const created = await repository.createUploadIntent({
          authUserId: principal.userId,
          guestId: profile.guestId,
          request,
          fileId,
          quarantineKey,
          uploadTokenHash: tokenHash(uploadToken),
          expiresAt,
        });
        return {
          ok: true,
          data: {
            fileId: created.fileId,
            criticalIdentityVersion: created.criticalIdentityVersion,
            uploadUrl: `/api/member/profile/files/${created.fileId}/content`,
            uploadToken,
            expiresAt: created.expiresAt,
          },
          correlationId,
        };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async receiveMemberUpload(accessToken, fileId, uploadToken, request) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:edit-own" })) return fail("forbidden", correlationId);
      if (!uuidPattern.test(fileId) || !/^[A-Za-z0-9_-]{40,64}$/.test(uploadToken)) return fail("invalid_input", correlationId);
      const origin = assertExactOrigin(request, appOrigin);
      if (!origin.allowed) return fail("forbidden", correlationId);
      const requestType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
      if (!requestType || !imageTypes.has(requestType)) return fail("invalid_input", correlationId, { contentType: "Use a JPEG, PNG, or WebP image." });
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedBody(request);
      } catch (error) {
        const name = error instanceof Error ? error.message : "upload_invalid";
        return fail("invalid_input", correlationId, { file: name === "upload_too_large" ? "Images must be 8 MB or smaller." : "Choose a valid image file." });
      }
      try {
        const consumed = await repository.consumeUploadGrant({
          authUserId: principal.userId,
          fileId,
          uploadTokenHash: tokenHash(uploadToken),
          byteSize: bytes.byteLength,
        });
        if (requestType !== consumed.contentType || !consumed.quarantineKey) {
          await repository.failUpload({ authUserId: principal.userId, fileId, safeReason: "content_type_mismatch" }).catch(() => undefined);
          return fail("invalid_input", correlationId, { contentType: "The file type did not match the upload request." });
        }
        await storage.upload(consumed.quarantineKey, bytes, consumed.contentType);
        return { ok: true, data: { fileId, received: true as const, byteSize: bytes.byteLength }, correlationId };
      } catch (error) {
        await repository.failUpload({ authUserId: principal.userId, fileId, safeReason: "upload_failed" }).catch(() => undefined);
        return fail(mapError(error), correlationId);
      }
    },

    async completeMemberUpload(accessToken, fileId, input) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:edit-own" })) return fail("forbidden", correlationId);
      if (!uuidPattern.test(fileId) || !validRevision(input.expectedProfileRevision)
        || !validRevision(input.expectedCriticalIdentityVersion)) return fail("invalid_input", correlationId);
      let normalizedKey: string | null = null;
      let quarantineKey: string | null = null;
      try {
        const file = await repository.beginNormalization({
          authUserId: principal.userId,
          fileId,
          expectedProfileRevision: input.expectedProfileRevision,
          expectedCriticalIdentityVersion: input.expectedCriticalIdentityVersion,
        });
        if (file.authUserId !== principal.userId || file.state !== "normalizing" || !file.quarantineKey) return fail("not_found", correlationId);
        quarantineKey = file.quarantineKey;
        const original = await storage.download(quarantineKey);
        if (original.bytes.byteLength !== file.actualByteSize || original.bytes.byteLength > maxUploadBytes) {
          throw new TypeError("source_size_mismatch");
        }
        const image = await normalizer.normalize({ bytes: original.bytes, claimedContentType: file.contentType });
        normalizedKey = `normalized/${file.guestId}/${file.fileId}/${createId()}`;
        await storage.upload(normalizedKey, image.bytes, image.contentType);
        await storage.remove([quarantineKey]);
        const result = await repository.finalizeUpload({
          authUserId: principal.userId,
          fileId,
          expectedProfileRevision: input.expectedProfileRevision,
          expectedCriticalIdentityVersion: input.expectedCriticalIdentityVersion,
          normalizedKey,
          image,
        });
        return {
          ok: true,
          data: {
            fileId,
            state: "ready" as const,
            profileRevision: result.profile.profileRevision,
            criticalIdentityVersion: result.profile.criticalIdentityVersion,
          },
          correlationId,
        };
      } catch (error) {
        if (normalizedKey) await storage.remove([normalizedKey]).catch(() => undefined);
        await repository.failUpload({ authUserId: principal.userId, fileId, safeReason: "normalization_or_finalize_failed" }).catch(() => undefined);
        return fail(mapError(error), correlationId);
      }
    },

    async getOwnerFileReadUrl(accessToken, fileId, input) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:read-own" })) return fail("forbidden", correlationId);
      if (!uuidPattern.test(fileId) || !validRevision(input.expectedProfileRevision)
        || !validRevision(input.expectedCriticalIdentityVersion)) return fail("invalid_input", correlationId);
      try {
        const file = await repository.getOwnerReadFile({
          authUserId: principal.userId,
          fileId,
          expectedProfileRevision: input.expectedProfileRevision,
          expectedCriticalIdentityVersion: input.expectedCriticalIdentityVersion,
        });
        const signed = await storage.createReadUrl(file.normalizedKey, 300);
        return { ok: true, data: { readUrl: signed.url, expiresAt: signed.expiresAt }, correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async submitMemberProfile(accessToken, input) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:edit-own" })) return fail("forbidden", correlationId);
      if (!uuidPattern.test(input.operationId) || !validRevision(input.expectedProfileRevision)) return fail("invalid_input", correlationId);
      try {
        const result = await repository.submitProfile({ authUserId: principal.userId, ...input });
        return { ok: true, data: {
          profileRevision: result.profile.profileRevision,
          criticalIdentityVersion: result.profile.criticalIdentityVersion,
          identityStatus: "submitted" as const,
          reviewId: String(result.review.review_id ?? ""),
          attemptNumber: Number(result.review.attempt_number ?? 0),
        }, correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async deleteMemberProfileFile(accessToken, fileId, input) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:edit-own" })) return fail("forbidden", correlationId);
      if (!uuidPattern.test(fileId) || !uuidPattern.test(input.operationId) || !validRevision(input.expectedProfileRevision)) return fail("invalid_input", correlationId);
      try {
        const result = await repository.deleteFile({ authUserId: principal.userId, fileId, ...input });
        const keys = [result.file.quarantineKey, result.file.normalizedKey].filter((key): key is string => Boolean(key));
        if (keys.length) await storage.remove(keys);
        return { ok: true, data: { fileId, state: "superseded" as const, profileRevision: result.profile.profileRevision, criticalIdentityVersion: result.profile.criticalIdentityVersion }, correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async listAdminIdentityReviews(accessToken, input) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "admin", action: "waitlist:read" })) return fail("forbidden", correlationId);
      const limit = input.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail("invalid_input", correlationId);
      try {
        const data = await repository.listIdentityReviews({ limit, status: input.status ?? "submitted", ...(input.cursor ? { cursor: input.cursor } : {}) });
        return { ok: true, data, correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async readAdminIdentityReview(accessToken, guestId) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "admin", action: "waitlist:read" })) return fail("forbidden", correlationId);
      if (!uuidPattern.test(guestId)) return fail("invalid_input", correlationId);
      try {
        const currentReview = await repository.findCurrentIdentityReview(guestId);
        const requestId = createId();
        const review = await repository.prepareIdentityReviewRead({
          actorUserId: principal.userId,
          guestId,
          reviewId: currentReview.reviewId,
          expectedCriticalIdentityVersion: currentReview.criticalIdentityVersion,
          requestId,
        });
        const currentFiles = await repository.confirmIdentityReviewReadSet({
          actorUserId: principal.userId,
          guestId,
          reviewId: currentReview.reviewId,
          expectedCriticalIdentityVersion: currentReview.criticalIdentityVersion,
          requestId,
          fileIds: review.files.map((file) => file.fileId),
        });
        const evidence = await Promise.all(currentFiles.map(async (file) => {
          const signed = await storage.createReadUrl(file.normalizedKey, 300);
          return { fileId: file.fileId, kind: file.kind, readUrl: signed.url, expiresAt: signed.expiresAt };
        }));
        const submittedCriticalIdentityVersion = Number(review.review.critical_identity_version);
        if (!Number.isSafeInteger(submittedCriticalIdentityVersion)) return fail("temporarily_unavailable", correlationId);
        return {
          ok: true,
          data: {
            profile: reviewProfileDTO(review.profile, currentFiles.map((file) => ({
              fileId: file.fileId, kind: file.kind, state: "ready", criticalIdentityVersion: currentReview.criticalIdentityVersion,
            }))),
            reviewId: currentReview.reviewId,
            submittedCriticalIdentityVersion,
            submittedAt: String(review.review.submitted_at ?? ""),
            attemptNumber: Number(review.review.attempt_number ?? 0),
            correctionReason: typeof review.review.correction_reason === "string" ? review.review.correction_reason : null,
            evidence,
          },
          correlationId,
        };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async decideAdminIdentityReview(accessToken, guestId, request: IdentityReviewDecisionRequest) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "admin", action: "waitlist:read" })) return fail("forbidden", correlationId);
      if (!isRecord(request) || !uuidPattern.test(guestId) || !uuidPattern.test(request.operationId) || !uuidPattern.test(request.reviewId)
        || !validRevision(request.expectedProfileRevision)
        || (request.decision !== "approved" && request.decision !== "resubmission_required")
        || (request.decision === "resubmission_required" && (typeof request.correctionReason !== "string" || request.correctionReason.trim().length < 1 || request.correctionReason.length > 2000))) {
        return fail("invalid_input", correlationId);
      }
      try {
        const profile = await repository.decideIdentityReview({ actorUserId: principal.userId, guestId, request });
        return { ok: true, data: {
          guestId,
          profileRevision: profile.profileRevision,
          criticalIdentityVersion: profile.criticalIdentityVersion,
          reviewedIdentityVersion: profile.reviewedIdentityVersion,
          identityStatus: profile.identityStatus,
          reviewedAt: now().toISOString(),
        }, correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },
  };
  return Object.freeze(service);
}
