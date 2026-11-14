/** Browser-safe W04 profile and identity-review DTOs. Never put provider rows or credentials here. */

export type ProfileIdentity = "woman" | "man" | "non_binary";
export type IdentityStatus = "draft" | "submitted" | "approved" | "resubmission_required";
export type ProfileFileKind = "photo" | "selfie";
export type ProfileFileState = "pending_upload" | "ready" | "rejected" | "superseded" | "deleted";

export type ProfileFileSummary = Readonly<{
  fileId: string;
  kind: ProfileFileKind;
  state: ProfileFileState;
}>;

export type MemberProfileDTO = Readonly<{
  profileRevision: number;
  criticalIdentityVersion: number;
  reviewedIdentityVersion: number | null;
  identityStatus: IdentityStatus;
  /** Latest member-visible correction guidance; never includes reviewer identity or private notes. */
  latestCorrectionReason: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: ProfileIdentity;
  openTo: readonly ProfileIdentity[];
  matchAgeMin: number;
  matchAgeMax: number;
  neighborhood: string;
  nights: readonly string[];
  lookingFor: "Casual" | "Open" | "Relationship";
  surpriseGame: "Yes, surprise me" | "I'd rather keep it conversational";
  phone: string | null;
  oneLiner: string | null;
  files: readonly ProfileFileSummary[];
  missingFields: readonly string[];
}>;

export type IdentityReviewQueueItem = Readonly<{
  reviewId: string;
  guestId: string;
  firstName: string;
  lastName: string;
  submittedAt: string;
  profileRevision: number;
  criticalIdentityVersion: number;
  attemptNumber: number;
}>;

/** Reviewers receive only fields needed for manual identity review and completeness checks. */
export type IdentityReviewProfileDTO = Readonly<{
  profileRevision: number;
  criticalIdentityVersion: number;
  reviewedIdentityVersion: number | null;
  identityStatus: IdentityStatus;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: ProfileIdentity;
  files: readonly ProfileFileSummary[];
  missingFields: readonly string[];
}>;

export type IdentityReviewDetailDTO = Readonly<{
  profile: IdentityReviewProfileDTO;
  reviewId: string;
  submittedCriticalIdentityVersion: number;
  submittedAt: string;
  attemptNumber: number;
  correctionReason: string | null;
  evidence: readonly Readonly<{
    fileId: string;
    kind: ProfileFileKind;
    readUrl: string;
    expiresAt: string;
  }>[];
}>;

export type W04ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "conflict" | "temporarily_unavailable";

export type W04Error = Readonly<{
  code: W04ErrorCode;
  message: string;
  retryable: boolean;
  fields?: Readonly<Record<string, string>>;
  correlationId: string;
}>;

export type W04Response<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; code: W04ErrorCode; message: string; retryable: boolean; correlationId: string; fields?: Readonly<Record<string, string>> }>;

export type ProfileMutationRequest = Readonly<{
  operationId: string;
  expectedProfileRevision: number;
}>;

export type MemberProfileSaveRequest = ProfileMutationRequest & Readonly<{
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: ProfileIdentity;
  openTo: readonly ProfileIdentity[];
  matchAgeMin: number;
  matchAgeMax: number;
  neighborhood: string;
  nights: readonly string[];
  lookingFor: "Casual" | "Open" | "Relationship";
  surpriseGame: "Yes, surprise me" | "I'd rather keep it conversational";
  phone?: string | null;
  oneLiner?: string | null;
}>;

export type UploadIntentRequest = ProfileMutationRequest & Readonly<{
  expectedCriticalIdentityVersion: number;
  kind: ProfileFileKind;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
}>;

/** Ephemeral token is held in memory only and sent in X-FW-Upload-Token, never in a URL. */
export type UploadIntentDTO = Readonly<{
  fileId: string;
  criticalIdentityVersion: number;
  uploadUrl: string;
  uploadToken: string;
  expiresAt: string;
}>;

export type UploadContentResultDTO = Readonly<{
  fileId: string;
  received: true;
  byteSize: number;
}>;

export type CompleteUploadRequest = ProfileMutationRequest & Readonly<{
  expectedCriticalIdentityVersion: number;
}>;

export type CompleteUploadResultDTO = Readonly<{
  fileId: string;
  state: "ready";
  profileRevision: number;
  criticalIdentityVersion: number;
}>;

export type ReadProfileFileRequest = ProfileMutationRequest & Readonly<{
  expectedCriticalIdentityVersion: number;
}>;

export type ReadProfileFileResultDTO = Readonly<{
  readUrl: string;
  expiresAt: string;
}>;

export type SubmitProfileResultDTO = Readonly<{
  profileRevision: number;
  criticalIdentityVersion: number;
  identityStatus: "submitted";
  reviewId: string;
  attemptNumber: number;
}>;

export type IdentityReviewDecisionRequest = Readonly<{
  operationId: string;
  expectedProfileRevision: number;
  reviewId: string;
  decision: "approved" | "resubmission_required";
  correctionReason?: string;
}>;

export type IdentityReviewDecisionResultDTO = Readonly<{
  guestId: string;
  profileRevision: number;
  criticalIdentityVersion: number;
  reviewedIdentityVersion: number | null;
  identityStatus: IdentityStatus;
  reviewedAt: string;
}>;
