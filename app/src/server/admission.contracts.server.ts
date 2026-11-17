/**
 * Server-only boundary types for the admission slice.
 * Do not import these from browser routes or serialize repository records directly.
 */

import type { Database } from "./database.types";

export type WaitlistSignupRow = Database["public"]["Tables"]["waitlist_signups"]["Row"];
export type AppAdmissionRow = Database["public"]["Tables"]["app_admissions"]["Row"];
export type AppAuditEventRow = Database["public"]["Tables"]["app_audit_events"]["Row"];

export type WaitlistIdentity = "Woman" | "Man" | "Non-binary";
export type MarketingOpenTo = "Women" | "Men" | "Non-binary people";
export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";
export type LookingFor = "Casual" | "Open" | "Relationship";
export type SurpriseGame = "Yes, surprise me" | "I'd rather keep it conversational";

/** Shape currently posted by the existing marketing form. All values remain untrusted until parsed. */
export type MarketingWaitlistPayload = Readonly<{
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  birthdate?: unknown;
  match_age_min?: unknown;
  match_age_max?: unknown;
  neighborhood?: unknown;
  identity?: unknown;
  open_to?: unknown;
  nights?: unknown;
  looking_for?: unknown;
  surprise_game?: unknown;
  referral?: unknown;
  source?: unknown;
  submitted_at?: unknown;
  _gotcha?: unknown;
}>;

/** Validated representation; received_at is always supplied by the database, not the client. */
export type ValidatedWaitlistIntake = Readonly<{
  firstName: string;
  lastName: string;
  emailNormalized: string;
  birthdate: string;
  identity: WaitlistIdentity;
  openTo: readonly [MarketingOpenTo, ...MarketingOpenTo[]];
  matchAgeMin: number;
  matchAgeMax: number;
  neighborhood: string;
  nights: readonly Weekday[];
  lookingFor: LookingFor;
  surpriseGame: SurpriseGame;
  referral: string;
  source: "landing-page";
  /** Advisory ad/UTM attribution sent by the marketing form; sanitized, never required. */
  attribution: Readonly<Record<string, string>> | null;
  isTest: boolean;
}>;

export type SafeFieldErrors = Readonly<Record<string, string>>;

export type ServiceErrorCode =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "conflict"
  | "invalid_link"
  | "provider_rejected"
  | "provider_outcome_unknown"
  | "temporarily_unavailable";

/** Safe for an API response; provider payloads, PII and internal exceptions do not belong here. */
export type ServiceError = Readonly<{
  code: ServiceErrorCode;
  safeMessage: string;
  fields?: SafeFieldErrors;
  retryAfterSeconds?: number;
}>;

export type ServiceResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: ServiceError }>;

/** Neutral response shared by every successful marketing waitlist submission. */
export type WaitlistSubmitResponse = Readonly<{ received: true }>;

export type WaitlistInsertResult = Readonly<{
  kind: "created" | "existing";
  signup: WaitlistSignupRow;
}>;

export interface WaitlistRepository {
  /** Inserts once; on a normalized-email conflict, returns the existing row without updating it. */
  insertIfAbsent(intake: ValidatedWaitlistIntake): Promise<WaitlistInsertResult>;
  findById(signupId: string): Promise<WaitlistSignupRow | null>;
}

export interface AdmissionRepository {
  /** Matches an invited (placed, not yet signed in) or activated admission. */
  findActiveAdmissionByEmail(emailNormalized: string): Promise<AppAdmissionRow | null>;
  /** Binds/activates only the unique admission matching a server-verified Auth identity. */
  activateFromVerifiedIdentity(input: Readonly<{
    authUserId: string;
    emailNormalized: string;
    activatedAt: string;
  }>): Promise<Readonly<{ kind: "activated" | "already_active" | "not_admitted"; admission?: AppAdmissionRow }>>;
}

export type MagicLinkKind = "magiclink" | "invite";

export type VerifiedAuthIdentity = Readonly<{
  authUserId: string;
  emailNormalized: string;
  emailVerified: boolean;
}>;

/** Tokens and links in this interface are secrets: keep them server-side and out of logs. */
export interface AuthLinkProvider {
  createMagicLink(input: Readonly<{
    emailNormalized: string;
    redirectTo: string;
    kind: MagicLinkKind;
    safeReturnTo?: string;
  }>): Promise<Readonly<{ actionLink: string; authUserId: string }>>;
  verifyCallback(input: Readonly<{
    tokenHash: string;
    kind: MagicLinkKind;
  }>): Promise<Readonly<{
    identity: VerifiedAuthIdentity;
    session: Readonly<{ accessToken: string; refreshToken: string }>;
  }>>;
}

export type EmailSendResult =
  | Readonly<{ state: "accepted"; providerMessageId?: string }>
  | Readonly<{ state: "failed"; safeErrorCode: string; retryable: boolean }>
  | Readonly<{ state: "unknown"; safeErrorCode: string }>;

export interface MagicLinkEmailProvider {
  sendSignInLink(input: Readonly<{ recipientEmail: string; actionLink: string; kind: MagicLinkKind }>): Promise<EmailSendResult>;
}

export interface ReturningLinkRequestRepository {
  /** Returns an active admission only; implementations must not reveal misses to callers. */
  findActiveAdmissionByEmail(emailNormalized: string): Promise<AppAdmissionRow | null>;
  /** Atomically enforces a per-recipient cooldown without storing raw IP addresses. */
  claimRecipientCooldown(input: Readonly<{
    admissionId: string;
    requestedAt: string;
    cooldownSeconds: number;
  }>): Promise<boolean>;
}

export type ReturningLinkRequest = Readonly<{
  email: string;
  safeReturnTo?: string;
}>;

/** Returning-link requests use one generic response regardless of account/admission state. */
export type ReturningLinkResponse = Readonly<{ accepted: true }>;

export type CallbackVerificationRequest = Readonly<{
  tokenHash: string;
  kind: MagicLinkKind;
  safeReturnTo?: string;
}>;

export type CallbackVerificationResult = Readonly<{
  identity: VerifiedAuthIdentity;
  session: Readonly<{ accessToken: string; refreshToken: string }>;
  admissionId: string;
  firstActivation: boolean;
  nextPath: string;
}>;

export type AuditAction =
  | "waitlist.signup.created"
  | "app.admission.invited"
  | "app.admission.activated"
  | "app.admission.deleted"
  | "app.invitation.queued"
  | "app.invitation.accepted"
  | "app.invitation.delivered"
  | "app.invitation.failed"
  | "app.invitation.unknown"
  | "app.invitation.retry_requested"
  | "member_link.requested"
  | "auth.callback.rejected"
  | "authorization.denied";

export type AuditSubjectType =
  | "waitlist_signup"
  | "app_admission"
  | "invitation_delivery"
  | "delivery_attempt"
  | "auth_identity"
  | "member_link_request";

export type AuditSystemActor = "auth_callback" | "email_delivery_worker" | "retention_worker" | "supply_sync_worker";
export type AuditState = "invited" | "activated" | "deleted" | "queued" | "sending" | "accepted" | "delivered" | "failed" | "unknown";
export type AuditReasonCode =
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "conflict"
  | "invalid_link"
  | "provider_rejected"
  | "provider_outcome_unknown"
  | "temporarily_unavailable"
  | "duplicate_request"
  | "honeypot_ignored";

/** Only enums, booleans and small counters are permitted; never put PII or free-form errors here. */
export type SafeAuditMetadata = Readonly<{
  state?: AuditState;
  from_state?: AuditState;
  to_state?: AuditState;
  reason_code?: AuditReasonCode;
  attempt_number?: number;
  retryable?: boolean;
}>;

export type AuditActor =
  | Readonly<{ actorType: "user"; actorUserId: string; systemActor: null }>
  | Readonly<{ actorType: "system"; actorUserId: null; systemActor: AuditSystemActor }>;

export type AuditEventInput = AuditActor & Readonly<{
  action: AuditAction;
  subjectType: AuditSubjectType;
  subjectId: string;
  requestId?: string | null;
  operationId?: string | null;
  metadata?: SafeAuditMetadata;
}>;

export interface AuditRepository {
  /** Inserts only. Implementations must not expose update/delete operations for this table. */
  append(event: AuditEventInput): Promise<AppAuditEventRow>;
  /** Callers must authorize before reads; pages are ordered by occurred_at, event_id. */
  listForSubject(input: Readonly<{
    subjectType: AuditSubjectType;
    subjectId: string;
    before?: Readonly<{ occurredAt: string; eventId: string }>;
    limit: number;
  }>): Promise<Readonly<{ rows: readonly AppAuditEventRow[]; nextCursor: Readonly<{ occurredAt: string; eventId: string }> | null }>>;
}
