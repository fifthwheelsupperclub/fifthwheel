/** Server-only persistence and provider contracts for W04. */

import type {
  IdentityReviewDetailDTO,
  IdentityReviewQueueItem,
  IdentityReviewDecisionRequest,
  MemberProfileDTO,
  MemberProfileSaveRequest,
  ProfileFileKind,
  UploadIntentRequest,
} from "../profile.contract.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { ImageNormalizer, NormalizedImage } from "./image-normalizer.server.ts";

export type ProfileErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "temporarily_unavailable";

export class ProfileRepositoryError extends Error {
  readonly code: "configuration_invalid" | "repository_unavailable" | "not_found" | "conflict" | "forbidden" | "invalid_data" | "invalid_input";

  constructor(code: ProfileRepositoryError["code"]) {
    super(code);
    this.name = "ProfileRepositoryError";
    this.code = code;
  }
}

export type ProfileServiceResult<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{
      ok: false;
      code: ProfileErrorCode;
      message: string;
      retryable: boolean;
      correlationId: string;
      fields?: Readonly<Record<string, string>>;
    }>;

export type StoredProfile = Readonly<{
  guestId: string;
  authUserId: string;
  admissionId: string;
  profileRevision: number;
  criticalIdentityVersion: number;
  reviewedIdentityVersion: number | null;
  identityStatus: MemberProfileDTO["identityStatus"];
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: MemberProfileDTO["identity"];
  openTo: readonly MemberProfileDTO["identity"][];
  matchAgeMin: number;
  matchAgeMax: number;
  neighborhood: string;
  nights: readonly string[];
  lookingFor: MemberProfileDTO["lookingFor"];
  surpriseGame: MemberProfileDTO["surpriseGame"];
  phone: string | null;
  oneLiner: string | null;
  latestCorrectionReason: string | null;
  evidenceReceivedAt: string | null;
  evidenceDeletedAt: string | null;
  updatedAt: string;
}>;

export type StoredProfileFile = Readonly<{
  fileId: string;
  guestId: string;
  authUserId: string;
  kind: ProfileFileKind;
  state: "pending_upload" | "quarantined" | "normalizing" | "ready" | "rejected" | "superseded" | "deleted";
  contentType: "image/jpeg" | "image/png" | "image/webp";
  declaredByteSize: number;
  actualByteSize: number | null;
  normalizedByteSize: number | null;
  profileRevisionAtIntent: number;
  criticalIdentityVersion: number;
  quarantineKey: string | null;
  normalizedKey: string | null;
  uploadTokenHash: string | null;
  uploadExpiresAt: string | null;
  uploadConsumedAt: string | null;
  receivedAt: string | null;
  retentionDueAt: string | null;
  deletedAt: string | null;
}>;

export type CreateUploadIntentInput = Readonly<{
  authUserId: string;
  guestId: string;
  request: UploadIntentRequest;
  fileId: string;
  quarantineKey: string;
  uploadTokenHash: string;
  expiresAt: string;
}>;

export type ProfileRepository = Readonly<{
  ensureProfile(authUserId: string): Promise<StoredProfile>;
  readProfile(authUserId: string): Promise<Readonly<{ profile: StoredProfile; files: readonly StoredProfileFile[] }>>;
  saveProfile(input: Readonly<{ authUserId: string; operationId: string; expectedProfileRevision: number; fields: Record<string, unknown> }>): Promise<StoredProfile>;
  createUploadIntent(input: CreateUploadIntentInput): Promise<Readonly<{ fileId: string; guestId: string; criticalIdentityVersion: number; expiresAt: string }>>;
  consumeUploadGrant(input: Readonly<{ authUserId: string; fileId: string; uploadTokenHash: string; byteSize: number }>): Promise<StoredProfileFile>;
  beginNormalization(input: Readonly<{ authUserId: string; fileId: string; expectedProfileRevision: number; expectedCriticalIdentityVersion: number }>): Promise<StoredProfileFile>;
  failUpload(input: Readonly<{ authUserId: string; fileId: string; safeReason: string }>): Promise<void>;
  finalizeUpload(input: Readonly<{ authUserId: string; fileId: string; expectedProfileRevision: number; expectedCriticalIdentityVersion: number; normalizedKey: string; image: NormalizedImage }>): Promise<Readonly<{ profile: StoredProfile; file: StoredProfileFile }>>;
  deleteFile(input: Readonly<{ authUserId: string; fileId: string; expectedProfileRevision: number; operationId: string }>): Promise<Readonly<{ profile: StoredProfile; file: StoredProfileFile }>>;
  getOwnerReadFile(input: Readonly<{ authUserId: string; fileId: string; expectedProfileRevision: number; expectedCriticalIdentityVersion: number }>): Promise<Readonly<{ normalizedKey: string; contentType: string }>>;
  submitProfile(input: Readonly<{ authUserId: string; expectedProfileRevision: number; operationId: string }>): Promise<Readonly<{ profile: StoredProfile; review: Record<string, unknown> }>>;
  listIdentityReviews(input: Readonly<{ cursor?: string; limit: number; status: "submitted" | "all" }>): Promise<Readonly<{ items: readonly IdentityReviewQueueItem[]; nextCursor: string | null }>>;
  findCurrentIdentityReview(guestId: string): Promise<Readonly<{ reviewId: string; criticalIdentityVersion: number }>>;
  prepareIdentityReviewRead(input: Readonly<{ actorUserId: string; guestId: string; reviewId: string; expectedCriticalIdentityVersion: number; requestId: string }>): Promise<Readonly<{ profile: StoredProfile; review: Record<string, unknown>; files: readonly Readonly<{ fileId: string; kind: ProfileFileKind; normalizedKey: string }>[] }>>;
  confirmIdentityReviewReadSet(input: Readonly<{ actorUserId: string; guestId: string; reviewId: string; expectedCriticalIdentityVersion: number; requestId: string; fileIds: readonly string[] }>): Promise<readonly Readonly<{ fileId: string; kind: ProfileFileKind; normalizedKey: string }>[] >;
  decideIdentityReview(input: Readonly<{ actorUserId: string; guestId: string; request: IdentityReviewDecisionRequest }>): Promise<StoredProfile>;
}>;

export type ProfileStorage = Readonly<{
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  createReadUrl(key: string, expiresInSeconds: number): Promise<Readonly<{ url: string; expiresAt: string }>>;
  download(key: string): Promise<Readonly<{ bytes: Uint8Array; contentType: string }>>;
}>;

export type ProfileServiceDependencies = Readonly<{
  resolvePrincipal(accessToken: string | null | undefined): Promise<ServerVerifiedPrincipal | null>;
  repository: ProfileRepository;
  storage: ProfileStorage;
  normalizer: ImageNormalizer;
  createId(): string;
  now(): Date;
}>;

export type ProfileServicePort = Readonly<{
  readMemberProfile(accessToken: string | null | undefined): Promise<ProfileServiceResult<MemberProfileDTO>>;
  saveMemberProfile(accessToken: string | null | undefined, request: MemberProfileSaveRequest): Promise<ProfileServiceResult<MemberProfileDTO>>;
  createMemberUploadIntent(accessToken: string | null | undefined, request: UploadIntentRequest): Promise<ProfileServiceResult<unknown>>;
  receiveMemberUpload(accessToken: string | null | undefined, fileId: string, uploadToken: string, request: Request): Promise<ProfileServiceResult<unknown>>;
  completeMemberUpload(accessToken: string | null | undefined, fileId: string, input: Readonly<{ expectedProfileRevision: number; expectedCriticalIdentityVersion: number }>): Promise<ProfileServiceResult<unknown>>;
  getOwnerFileReadUrl(accessToken: string | null | undefined, fileId: string, input: Readonly<{ expectedProfileRevision: number; expectedCriticalIdentityVersion: number }>): Promise<ProfileServiceResult<unknown>>;
  submitMemberProfile(accessToken: string | null | undefined, input: Readonly<{ operationId: string; expectedProfileRevision: number }>): Promise<ProfileServiceResult<unknown>>;
  deleteMemberProfileFile(accessToken: string | null | undefined, fileId: string, input: Readonly<{ operationId: string; expectedProfileRevision: number }>): Promise<ProfileServiceResult<unknown>>;
  listAdminIdentityReviews(accessToken: string | null | undefined, input: Readonly<{ cursor?: string; limit?: number; status?: "submitted" | "all" }>): Promise<ProfileServiceResult<Readonly<{ items: readonly IdentityReviewQueueItem[]; nextCursor: string | null }>>>;
  readAdminIdentityReview(accessToken: string | null | undefined, guestId: string): Promise<ProfileServiceResult<IdentityReviewDetailDTO>>;
  decideAdminIdentityReview(accessToken: string | null | undefined, guestId: string, request: IdentityReviewDecisionRequest): Promise<ProfileServiceResult<unknown>>;
}>;

export type ImageNormalizerPort = ImageNormalizer;
