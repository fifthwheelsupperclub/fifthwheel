import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { GuestSidebar } from "./guest-nav";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  CircleAlert,
  Clock3,
  House,
  ImagePlus,
  ClipboardList,
  LoaderCircle,
  ShieldCheck,
  Table2,
  Trash2,
  UserRound,
} from "lucide-react";
import { SignOutButton } from "./sign-out-button.tsx";
import type {
  CompleteUploadResultDTO,
  IdentityStatus,
  MemberProfileDTO,
  ProfileFileKind,
  ProfileFileSummary,
  ReadProfileFileResultDTO,
  SubmitProfileResultDTO,
  UploadContentResultDTO,
  UploadIntentDTO,
  UploadIntentRequest,
  W04Error,
  W04Response,
} from "../profile.contract.ts";

type LoadState = "loading" | "ready" | "unauthenticated" | "forbidden" | "error";
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type SubmitState = "idle" | "submitting" | "submitted" | "error" | "conflict";
type Identity = MemberProfileDTO["identity"];
type LookingFor = MemberProfileDTO["lookingFor"];
type SurpriseGame = MemberProfileDTO["surpriseGame"];
type ImageContentType = UploadIntentRequest["contentType"];

type Draft = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: Identity | "";
  openTo: Identity[];
  matchAgeMin: string;
  matchAgeMax: string;
  neighborhood: string;
  nights: string[];
  lookingFor: LookingFor | "";
  surpriseGame: SurpriseGame | "";
  phone: string;
  oneLiner: string;
};

type ApiOutcome<T> = Readonly<{ data: T; error: null }> | Readonly<{ data: null; error: W04Error | null }>;
type PendingOperation = Readonly<{ fingerprint: string; id: string }>;

const identityOptions: ReadonlyArray<Readonly<{ value: Identity; label: string }>> = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non_binary", label: "Non-binary" },
];
const openToOptions: ReadonlyArray<Readonly<{ value: Identity; label: string }>> = [
  { value: "woman", label: "Women" },
  { value: "man", label: "Men" },
  { value: "non_binary", label: "Non-binary people" },
];
const neighborhoods = ["Inman Park", "Chamblee", "Virginia Highlands"] as const;
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const lookingForOptions: LookingFor[] = ["Casual", "Open", "Relationship"];
const surpriseOptions: SurpriseGame[] = ["Yes, surprise me", "I'd rather keep it conversational"];
const acceptedTypes = new Set<ImageContentType>(["image/jpeg", "image/png", "image/webp"]);
const tableReturnToPattern = /^\/tables(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;
const maximumUploadBytes = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isW04Error(value: unknown): value is W04Error {
  return isRecord(value)
    && typeof value.code === "string"
    && typeof value.message === "string"
    && typeof value.retryable === "boolean"
    && typeof value.correlationId === "string";
}

function isProfile(value: unknown): value is MemberProfileDTO {
  return isRecord(value)
    && Number.isSafeInteger(value.profileRevision)
    && Number.isSafeInteger(value.criticalIdentityVersion)
    && (value.reviewedIdentityVersion === null || Number.isSafeInteger(value.reviewedIdentityVersion))
    && ["draft", "submitted", "approved", "resubmission_required"].includes(String(value.identityStatus))
    && (typeof value.latestCorrectionReason === "string" || value.latestCorrectionReason === null)
    && typeof value.firstName === "string"
    && typeof value.lastName === "string"
    && typeof value.dateOfBirth === "string"
    && ["woman", "man", "non_binary"].includes(String(value.identity))
    && Array.isArray(value.openTo)
    && value.openTo.every((entry) => ["woman", "man", "non_binary"].includes(String(entry)))
    && Number.isSafeInteger(value.matchAgeMin)
    && Number.isSafeInteger(value.matchAgeMax)
    && typeof value.neighborhood === "string"
    && Array.isArray(value.nights)
    && typeof value.lookingFor === "string"
    && typeof value.surpriseGame === "string"
    && (typeof value.phone === "string" || value.phone === null)
    && (typeof value.oneLiner === "string" || value.oneLiner === null)
    && Array.isArray(value.files)
    && value.files.every((file) => isRecord(file)
      && typeof file.fileId === "string"
      && (file.kind === "photo" || file.kind === "selfie")
      && ["pending_upload", "ready", "rejected", "superseded", "deleted"].includes(String(file.state)))
    && Array.isArray(value.missingFields)
    && value.missingFields.every((field) => typeof field === "string");
}

function responseData<T>(body: unknown, isExpected: (value: unknown) => value is T): ApiOutcome<T> {
  if (!isRecord(body)) return { data: null, error: null };
  if (body.ok === true && isExpected(body.data)) return { data: body.data, error: null };
  if (body.ok === false && isW04Error({ ...body, code: body.code, message: body.message })) {
    return { data: null, error: body as W04Error };
  }
  return { data: null, error: null };
}

async function readApi<T>(response: Response, isExpected: (value: unknown) => value is T): Promise<ApiOutcome<T>> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = responseData(body, isExpected);
  return response.ok ? parsed : { data: null, error: parsed.error };
}

function draftFromProfile(profile: MemberProfileDTO): Draft {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    dateOfBirth: profile.dateOfBirth,
    identity: profile.identity,
    openTo: [...profile.openTo],
    matchAgeMin: String(profile.matchAgeMin),
    matchAgeMax: String(profile.matchAgeMax),
    neighborhood: profile.neighborhood,
    nights: [...profile.nights],
    lookingFor: profile.lookingFor,
    surpriseGame: profile.surpriseGame,
    phone: profile.phone ?? "",
    oneLiner: profile.oneLiner ?? "",
  };
}

function statusLabel(status: IdentityStatus): string {
  return {
    draft: "INCOMPLETE",
    submitted: "IN REVIEW",
    approved: "APPROVED",
    resubmission_required: "CHANGES REQUESTED",
  }[status];
}

function statusCopy(status: IdentityStatus): string {
  return {
    draft: "Finish the required details and add a separate photo and selfie before submitting for review.",
    submitted: "The review team is checking your profile. You can keep editing. Changes to your identity details or review photos need another review.",
    approved: "The review team approved the profile details and photos you submitted. This is a manual review; it does not verify a government ID or check background records.",
    resubmission_required: "Please make the correction requested by the review team, then submit your profile again.",
  }[status];
}

function fieldMessage(fields: Record<string, string>, key: string): string | undefined {
  return fields[key] ?? fields[key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase())];
}

function operationIdFor(ref: { current: PendingOperation | null }, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (ref.current?.fingerprint === fingerprint) return ref.current.id;
  const id = crypto.randomUUID();
  ref.current = { fingerprint, id };
  return id;
}

function profileValidation(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.firstName.trim()) errors.firstName = "Enter your first name.";
  if (!draft.lastName.trim()) errors.lastName = "Enter your last name.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dateOfBirth)) errors.dateOfBirth = "Enter your date of birth.";
  if (!draft.identity) errors.identity = "Choose one identity.";
  if (draft.openTo.length === 0) errors.openTo = "Choose at least one group you are open to meeting.";
  const min = Number(draft.matchAgeMin);
  const max = Number(draft.matchAgeMax);
  if (!Number.isSafeInteger(min) || min < 21 || min > 120) errors.matchAgeMin = "Choose a whole number from 21 to 120.";
  if (!Number.isSafeInteger(max) || max < 21 || max > 120) errors.matchAgeMax = "Choose a whole number from 21 to 120.";
  else if (Number.isSafeInteger(min) && max < min) errors.matchAgeMax = "The oldest age must be at least the youngest age.";
  if (!neighborhoods.includes(draft.neighborhood as typeof neighborhoods[number])) errors.neighborhood = "Choose a neighborhood.";
  if (!lookingForOptions.includes(draft.lookingFor as LookingFor)) errors.lookingFor = "Choose what you are looking for.";
  if (!surpriseOptions.includes(draft.surpriseGame as SurpriseGame)) errors.surpriseGame = "Choose an option.";
  return errors;
}

function profilePayload(draft: Draft) {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    dateOfBirth: draft.dateOfBirth,
    identity: draft.identity as Identity,
    openTo: draft.openTo,
    matchAgeMin: Number(draft.matchAgeMin),
    matchAgeMax: Number(draft.matchAgeMax),
    neighborhood: draft.neighborhood,
    nights: draft.nights,
    lookingFor: draft.lookingFor as LookingFor,
    surpriseGame: draft.surpriseGame as SurpriseGame,
    phone: draft.phone.trim() || null,
    oneLiner: draft.oneLiner.trim() || null,
  };
}

function isUploadIntent(value: unknown): value is UploadIntentDTO {
  return isRecord(value)
    && typeof value.fileId === "string"
    && Number.isSafeInteger(value.criticalIdentityVersion)
    && typeof value.uploadUrl === "string"
    && typeof value.uploadToken === "string"
    && typeof value.expiresAt === "string";
}

function isUploaded(value: unknown): value is UploadContentResultDTO {
  return isRecord(value) && typeof value.fileId === "string" && value.received === true && Number.isSafeInteger(value.byteSize);
}

function isCompleted(value: unknown): value is CompleteUploadResultDTO {
  return isRecord(value)
    && typeof value.fileId === "string"
    && value.state === "ready"
    && Number.isSafeInteger(value.profileRevision)
    && Number.isSafeInteger(value.criticalIdentityVersion);
}

function isReadUrl(value: unknown): value is ReadProfileFileResultDTO {
  return isRecord(value) && typeof value.readUrl === "string" && typeof value.expiresAt === "string";
}

function isDeletedFile(value: unknown): value is Readonly<{
  fileId: string;
  state: "superseded";
  profileRevision: number;
  criticalIdentityVersion: number;
}> {
  return isRecord(value) && typeof value.fileId === "string" && value.state === "superseded"
    && Number.isSafeInteger(value.profileRevision) && Number.isSafeInteger(value.criticalIdentityVersion);
}

function isSubmitted(value: unknown): value is SubmitProfileResultDTO {
  return isRecord(value)
    && Number.isSafeInteger(value.profileRevision)
    && Number.isSafeInteger(value.criticalIdentityVersion)
    && value.identityStatus === "submitted"
    && typeof value.reviewId === "string"
    && Number.isSafeInteger(value.attemptNumber);
}

export function ProfileWorkspace() {
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [profile, setProfile] = useState<MemberProfileDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState("");
  const [uploadState, setUploadState] = useState<Readonly<Record<ProfileFileKind, string>>>({ photo: "", selfie: "" });
  const [fileError, setFileError] = useState("");
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const saveOperation = useRef<PendingOperation | null>(null);
  const submitOperation = useRef<PendingOperation | null>(null);
  const dirty = useMemo(() => profile && draft ? JSON.stringify(profilePayload(draft)) !== JSON.stringify(profilePayload(draftFromProfile(profile))) : false, [profile, draft]);

  useEffect(() => {
    const candidate = new URL(window.location.href).searchParams.get("returnTo");
    if (candidate && tableReturnToPattern.test(candidate)) setReturnTo(candidate);
  }, []);

  async function loadProfile(signal?: AbortSignal) {
    setLoadState("loading");
    try {
      const response = await fetch("/api/member/profile", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (response.status === 401) { setLoadState("unauthenticated"); setProfile(null); setDraft(null); return; }
      if (response.status === 403 || response.status === 404) { setLoadState("forbidden"); setProfile(null); setDraft(null); return; }
      const result = await readApi(response, isProfile);
      if (!response.ok || !result.data) { setLoadState("error"); setProfile(null); setDraft(null); return; }
      setProfile(result.data);
      setDraft(draftFromProfile(result.data));
      setServerErrors({});
      setFormMessage("");
      setSaveState("idle");
      setSubmitState("idle");
      setLoadState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadState("error");
      setProfile(null);
      setDraft(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, []);

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setSaveState("idle");
    setSubmitState("idle");
    setFormMessage("");
    setServerErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function saveProfile() {
    if (!profile || !draft) return;
    const errors = profileValidation(draft);
    setServerErrors(errors);
    if (Object.keys(errors).length) {
      setSaveState("error");
      setFormMessage("Review the highlighted fields before saving.");
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }

    const payload = { expectedProfileRevision: profile.profileRevision, ...profilePayload(draft) };
    const operationId = operationIdFor(saveOperation, payload);
    setSaveState("saving");
    setFormMessage("");
    try {
      const response = await fetch("/api/member/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ...payload, operationId }),
      });
      const result = await readApi(response, isProfile);
      if (response.status === 409 || result.error?.code === "conflict") {
        setSaveState("conflict");
        setFormMessage("This profile changed in another session. Reload the latest version before saving again.");
        return;
      }
      if (!response.ok || !result.data) {
        if (result.error?.fields) setServerErrors(result.error.fields);
        setSaveState("error");
        setFormMessage(result.error?.message ?? "Your changes could not be saved. Your entries are still here; try again.");
        return;
      }
      saveOperation.current = null;
      setProfile(result.data);
      setDraft(draftFromProfile(result.data));
      setServerErrors({});
      setSaveState("saved");
      setFormMessage("Your profile changes are saved.");
    } catch {
      setSaveState("error");
      setFormMessage("Your changes could not be saved. Your entries are still here; try again.");
    }
  }

  async function submitForReview() {
    if (!profile || !draft || dirty) {
      setFormMessage("Save your current changes before submitting for review.");
      return;
    }
    const errors = profileValidation(draft);
    setServerErrors(errors);
    if (Object.keys(errors).length) {
      setSubmitState("error");
      setFormMessage("Review the highlighted fields before submitting.");
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }
    if (profile.missingFields.length > 0) {
      setSubmitState("error");
      setFormMessage("Complete the required fields and add one profile photo and a separate selfie before submitting.");
      return;
    }
    const payload = { expectedProfileRevision: profile.profileRevision };
    const operationId = operationIdFor(submitOperation, payload);
    setSubmitState("submitting");
    setFormMessage("");
    try {
      const response = await fetch("/api/member/profile/submit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ...payload, operationId }),
      });
      const result = await readApi(response, isSubmitted);
      if (response.status === 409 || result.error?.code === "conflict") {
        setSubmitState("conflict");
        setFormMessage("This profile changed before it could be submitted. Reload the latest version and review it first.");
        return;
      }
      if (!response.ok || !result.data) {
        if (result.error?.fields) setServerErrors(result.error.fields);
        setSubmitState("error");
        setFormMessage(result.error?.message ?? "Your profile could not be submitted. Review the requirements and try again.");
        return;
      }
      submitOperation.current = null;
      setSubmitState("submitted");
      setFormMessage("Your profile has been sent for review.");
      await loadProfile();
      setSubmitState("submitted");
      setFormMessage("Your profile has been sent for review.");
    } catch {
      setSubmitState("error");
      setFormMessage("Your profile could not be submitted. Try again when service is available.");
    }
  }

  async function uploadFile(kind: ProfileFileKind, file: File) {
    if (!profile) return;
    const limitCount = kind === "photo"
      ? profile.files.filter((item) => item.kind === "photo" && !["superseded", "deleted"].includes(item.state)).length
      : profile.files.filter((item) => item.kind === "selfie" && !["superseded", "deleted"].includes(item.state)).length;
    if (file.size <= 0 || file.size > maximumUploadBytes) {
      setFileError("Choose an image no larger than 8 MB.");
      return;
    }
    if (!acceptedTypes.has(file.type as ImageContentType)) {
      setFileError("Use a JPEG, PNG or WebP image. HEIC is not supported.");
      return;
    }
    if ((kind === "photo" && limitCount >= 6) || (kind === "selfie" && limitCount >= 1)) {
      setFileError(kind === "photo" ? "You can add up to six profile photos." : "Remove the current selfie before adding a new one.");
      return;
    }
    if (dirty) {
      setFileError("Save your profile changes before adding evidence.");
      return;
    }

    setFileError("");
    setUploadState((current) => ({ ...current, [kind]: "Preparing secure upload…" }));
    const revisions = {
      expectedProfileRevision: profile.profileRevision,
      expectedCriticalIdentityVersion: profile.criticalIdentityVersion,
    };
    const intentBody = {
      ...revisions,
      operationId: crypto.randomUUID(),
      kind,
      contentType: file.type as ImageContentType,
      byteSize: file.size,
    };
    try {
      const intentResponse = await fetch("/api/member/profile/files", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(intentBody),
      });
      const intentResult = await readApi(intentResponse, isUploadIntent);
      if (!intentResponse.ok || !intentResult.data) {
        setUploadState((current) => ({ ...current, [kind]: "" }));
        setFileError(intentResult.error?.message ?? "A secure upload could not be started. Try again.");
        return;
      }
      const intent = intentResult.data;
      const uploadUrl = new URL(intent.uploadUrl, window.location.origin);
      const expectedPath = "/api/member/profile/files/" + encodeURIComponent(intent.fileId) + "/content";
      const expiresAt = Date.parse(intent.expiresAt);
      if (
        uploadUrl.origin !== window.location.origin
        || uploadUrl.pathname !== expectedPath
        || uploadUrl.search
        || uploadUrl.hash
        || !Number.isFinite(expiresAt)
        || expiresAt <= Date.now()
        || intent.uploadToken.length < 16
        || intent.uploadToken.length > 4096
      ) {
        setUploadState((current) => ({ ...current, [kind]: "" }));
        setFileError("The secure upload could not be verified. Request a fresh upload.");
        return;
      }
      setUploadState((current) => ({ ...current, [kind]: "Uploading private evidence…" }));
      const contentResponse = await fetch(uploadUrl, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": file.type, "X-FW-Upload-Token": intent.uploadToken },
        body: file,
      });
      const contentResult = await readApi(contentResponse, isUploaded);
      if (!contentResponse.ok || !contentResult.data || contentResult.data.fileId !== intent.fileId) {
        setUploadState((current) => ({ ...current, [kind]: "" }));
        setFileError(contentResult.error?.message ?? "The upload did not finish. Start a fresh upload to retry.");
        return;
      }
      setUploadState((current) => ({ ...current, [kind]: "Checking and protecting the image…" }));
      const completeResponse = await fetch("/api/member/profile/files/" + encodeURIComponent(intent.fileId) + "/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ...revisions, operationId: crypto.randomUUID() }),
      });
      const completeResult = await readApi(completeResponse, isCompleted);
      if (!completeResponse.ok || !completeResult.data || completeResult.data.fileId !== intent.fileId) {
        setUploadState((current) => ({ ...current, [kind]: "" }));
        setFileError(completeResult.error?.message ?? "The image is still private and has not been approved. Refresh the profile to check its status.");
        return;
      }
      setUploadState((current) => ({ ...current, [kind]: "" }));
      await loadProfile();
    } catch {
      setUploadState((current) => ({ ...current, [kind]: "" }));
      setFileError("The secure upload was interrupted. Start a fresh upload to retry.");
    }
  }

  async function removeFile(file: ProfileFileSummary) {
    if (!profile) return;
    setFileBusy(file.fileId);
    setFileError("");
    try {
      const response = await fetch(`/api/member/profile/files/${encodeURIComponent(file.fileId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operationId: crypto.randomUUID(), expectedProfileRevision: profile.profileRevision }),
      });
      const result = await readApi(response, isDeletedFile);
      if (!response.ok || !result.data || result.data.fileId !== file.fileId) {
        setFileError(result.error?.message ?? "This image could not be removed. Refresh the profile and try again.");
        return;
      }
      setPreviewUrls((current) => { const next = { ...current }; delete next[file.fileId]; return next; });
      await loadProfile();
    } catch {
      setFileError("This image could not be removed. Refresh the profile and try again.");
    } finally {
      setFileBusy(null);
    }
  }

  async function showPrivatePreview(file: ProfileFileSummary) {
    if (!profile) return;
    setFileBusy(file.fileId);
    setFileError("");
    try {
      const response = await fetch(`/api/member/profile/files/${encodeURIComponent(file.fileId)}/read-url`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          operationId: crypto.randomUUID(),
          expectedProfileRevision: profile.profileRevision,
          expectedCriticalIdentityVersion: profile.criticalIdentityVersion,
        }),
      });
      const result = await readApi(response, isReadUrl);
      if (!response.ok || !result.data) {
        setFileError(result.error?.message ?? "A private preview could not be opened. Try again.");
        return;
      }
      const url = new URL(result.data.readUrl, window.location.origin);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        setFileError("The private image link could not be verified.");
        return;
      }
      setPreviewUrls((current) => ({ ...current, [file.fileId]: url.href }));
    } catch {
      setFileError("A private preview could not be opened. Try again.");
    } finally {
      setFileBusy(null);
    }
  }

  const photoFiles = profile?.files.filter((file) => file.kind === "photo" && !["superseded", "deleted"].includes(file.state)) ?? [];
  const selfieFiles = profile?.files.filter((file) => file.kind === "selfie" && !["superseded", "deleted"].includes(file.state)) ?? [];
  const currentApproved = profile?.identityStatus === "approved" && profile.reviewedIdentityVersion === profile.criticalIdentityVersion;
  const hasBlockingFields = profile ? profile.missingFields.length > 0 : true;
  const submitDisabled = !profile || !draft || dirty || hasBlockingFields || profile.identityStatus === "submitted" || submitState === "submitting" || Object.values(uploadState).some(Boolean);

  return <main className="product-page">
    <header className="product-topbar">
      <a className="brand" href="/member" aria-label="Fifth Wheel member home"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions"><a className="account-action account-action-active" href="/account/profile" aria-current="page"><UserRound aria-hidden="true" />Account</a><SignOutButton /></div>
    </header>
    <div className="product-layout">
      <GuestSidebar foot="Your profile stays private and is visible only to you and the authorized review team." />
      <section className="product-content profile-content" aria-labelledby="profile-heading">
        <div className="product-breadcrumb">Member <span>/</span> Account <span>/</span> Profile</div>
        {loadState === "loading" && <section className="data-state" role="status" aria-live="polite"><span className="data-state-icon"><LoaderCircle className="is-spinning" aria-hidden="true" /></span><h2>Loading your profile</h2><p>Your saved details and review status are being checked.</p></section>}
        {loadState === "unauthenticated" && <section className="data-state data-state-error"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Sign in to view your profile</h2><p>This page is available to the member account connected to your app invitation.</p><a className="button button-primary" href={returnTo ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in"}>Go to sign in<ArrowRight aria-hidden="true" /></a></section>}
        {loadState === "forbidden" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Member profile unavailable</h2><p>This account does not have an active member profile. If you expected access, contact the team.</p><a className="button button-outline" href="/member">Return to member home<ArrowRight aria-hidden="true" /></a></section>}
        {loadState === "error" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Your profile could not load</h2><p>Your saved information has not been changed. Try again when service is available.</p><button className="button button-outline" type="button" onClick={() => void loadProfile()}>Try again<ArrowRight aria-hidden="true" /></button></section>}
        {loadState === "ready" && profile && draft && <>
          <div className="page-heading-row profile-heading-row"><div><p className="eyebrow">ACCOUNT / PROFILE</p><h1 id="profile-heading">A good introduction<br /><em>starts with you.</em></h1><p className="page-intro">Tell us who you are and who you would like to meet. These details stay private.</p></div><span className={`status-pill ${profile.identityStatus === "approved" ? "status-pill-success" : profile.identityStatus === "resubmission_required" ? "status-pill-alert" : ""}`}>{statusLabel(profile.identityStatus)}</span></div>
          <section className="profile-review-status" aria-label="Identity review status" data-status={profile.identityStatus}>
            <span className="profile-status-icon">{profile.identityStatus === "approved" ? <BadgeCheck aria-hidden="true" /> : profile.identityStatus === "submitted" ? <Clock3 aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}</span>
            <div><p className="eyebrow">IDENTITY REVIEW</p><h2>{profile.identityStatus === "approved" ? "Profile approved" : profile.identityStatus === "submitted" ? "Review in progress" : profile.identityStatus === "resubmission_required" ? "A correction is needed" : "Complete your profile"}</h2><p>{statusCopy(profile.identityStatus)}</p>{profile.latestCorrectionReason && profile.identityStatus === "resubmission_required" && <p className="correction-reason"><strong>Requested correction:</strong> {profile.latestCorrectionReason}</p>}</div>
          </section>
          {currentApproved && returnTo && <p className="profile-version-guidance"><Table2 aria-hidden="true" /><span>{returnTo === "/tables" ? "Your profile is approved. Continue browsing Tables." : "Your profile is approved. Continue to the Table you selected."}</span><a className="text-action" href={returnTo}>{returnTo === "/tables" ? "Continue to Tables" : "Continue to Table"}<ArrowRight aria-hidden="true" /></a></p>}
          <p className="profile-version-guidance"><ShieldCheck aria-hidden="true" /><span>Changes to your date of birth, identity, profile photos or selfie need another review. Preference changes keep your current review, but may affect future Table invitations.</span></p>
          {currentApproved && profile.files.some((file) => file.state === "deleted") && <p className="evidence-retention-note"><ShieldCheck aria-hidden="true" />We remove review images on a set schedule. Your approved profile stays approved after they are removed. Changes to your identity details need another review.</p>}
          <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} noValidate>
            <section className="profile-section" aria-labelledby="profile-basics-heading">
              <div className="profile-section-heading"><span className="profile-section-icon"><UserRound aria-hidden="true" /></span><div><p className="eyebrow">01 / ABOUT YOU</p><h2 id="profile-basics-heading">The essentials</h2><p>Required for a complete member profile.</p></div></div>
              <div className="profile-form-grid">
                <Field id="firstName" label="First name" error={fieldMessage(serverErrors, "firstName")}><input id="firstName" name="firstName" autoComplete="given-name" maxLength={100} value={draft.firstName} onChange={(event) => updateDraft("firstName", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "firstName"))} /></Field>
                <Field id="lastName" label="Last name" error={fieldMessage(serverErrors, "lastName")}><input id="lastName" name="lastName" autoComplete="family-name" maxLength={100} value={draft.lastName} onChange={(event) => updateDraft("lastName", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "lastName"))} /></Field>
                <Field id="dateOfBirth" label="Date of birth" hint="You must be at least 21. Matching ages can be set from 21 to 120." error={fieldMessage(serverErrors, "dateOfBirth")}><input id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday" value={draft.dateOfBirth} onChange={(event) => updateDraft("dateOfBirth", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "dateOfBirth"))} /></Field>
                <Field id="neighborhood" label="Neighborhood" error={fieldMessage(serverErrors, "neighborhood")}><select id="neighborhood" name="neighborhood" value={draft.neighborhood} onChange={(event) => updateDraft("neighborhood", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "neighborhood"))}><option value="">Choose a neighborhood</option>{neighborhoods.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              </div>
              <ChoiceGroup id="identity" legend="How do you identify?" description="Choose one option." error={fieldMessage(serverErrors, "identity")}>
                {identityOptions.map((item) => <label className="choice-card" key={item.value}><input type="radio" name="identity" value={item.value} checked={draft.identity === item.value} onChange={() => updateDraft("identity", item.value)} /><span>{item.label}</span></label>)}
              </ChoiceGroup>
            </section>

            <section className="profile-section" aria-labelledby="profile-preferences-heading">
              <div className="profile-section-heading"><span className="profile-section-icon"><ImagePlus aria-hidden="true" /></span><div><p className="eyebrow">02 / YOUR PREFERENCES</p><h2 id="profile-preferences-heading">Who you would like to meet</h2><p>Choose every group you are open to meeting. Keep your own identity separate.</p></div></div>
              <ChoiceGroup id="openTo" legend="I’m open to meeting" description="Choose one or more. Your choices are saved exactly as selected." error={fieldMessage(serverErrors, "openTo")}>
                {openToOptions.map((item) => <label className="choice-card" key={item.value}><input type="checkbox" name="openTo" value={item.value} checked={draft.openTo.includes(item.value)} onChange={(event) => updateDraft("openTo", event.currentTarget.checked ? [...draft.openTo, item.value] : draft.openTo.filter((value) => value !== item.value))} /><span>{item.label}</span></label>)}
              </ChoiceGroup>
              <div className="profile-form-grid match-age-grid">
                <Field id="matchAgeMin" label="Youngest age" hint="Whole years, 21–120." error={fieldMessage(serverErrors, "matchAgeMin")}><input id="matchAgeMin" name="matchAgeMin" type="number" inputMode="numeric" min={21} max={120} step={1} value={draft.matchAgeMin} onChange={(event) => updateDraft("matchAgeMin", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "matchAgeMin"))} /></Field>
                <Field id="matchAgeMax" label="Oldest age" hint="Must be at least the youngest age." error={fieldMessage(serverErrors, "matchAgeMax")}><input id="matchAgeMax" name="matchAgeMax" type="number" inputMode="numeric" min={21} max={120} step={1} value={draft.matchAgeMax} onChange={(event) => updateDraft("matchAgeMax", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "matchAgeMax"))} /></Field>
              </div>
              <ChoiceGroup id="nights" legend="Which nights usually work?" description="Optional. Choose any that suit you.">
                <div className="choice-grid choice-grid-weekdays">{weekdays.map((day) => <label className="choice-card choice-card-compact" key={day}><input type="checkbox" name="nights" value={day} checked={draft.nights.includes(day)} onChange={(event) => updateDraft("nights", event.currentTarget.checked ? [...draft.nights, day] : draft.nights.filter((value) => value !== day))} /><span>{day}</span></label>)}</div>
              </ChoiceGroup>
              <div className="profile-form-grid">
                <Field id="lookingFor" label="What are you looking for?" error={fieldMessage(serverErrors, "lookingFor")}><select id="lookingFor" name="lookingFor" value={draft.lookingFor} onChange={(event) => updateDraft("lookingFor", event.currentTarget.value as LookingFor | "")}><option value="">Choose an option</option>{lookingForOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field id="surpriseGame" label="Surprise game" error={fieldMessage(serverErrors, "surpriseGame")}><select id="surpriseGame" name="surpriseGame" value={draft.surpriseGame} onChange={(event) => updateDraft("surpriseGame", event.currentTarget.value as SurpriseGame | "")}><option value="">Choose an option</option>{surpriseOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
              </div>
            </section>

            <section className="profile-section" aria-labelledby="profile-details-heading">
              <div className="profile-section-heading"><span className="profile-section-icon"><Camera aria-hidden="true" /></span><div><p className="eyebrow">03 / MORE ABOUT YOU</p><h2 id="profile-details-heading">A little more, if you like</h2><p>These details are optional and are not automated eligibility filters.</p></div></div>
              <div className="profile-form-grid">
                <Field id="phone" label="Phone number" hint="Optional. We won’t ask you to verify it."><input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={40} value={draft.phone} onChange={(event) => updateDraft("phone", event.currentTarget.value)} /></Field>
                <Field id="oneLiner" label="One-line introduction" hint="Optional."><input id="oneLiner" name="oneLiner" maxLength={240} value={draft.oneLiner} onChange={(event) => updateDraft("oneLiner", event.currentTarget.value)} /></Field>
              </div>
            </section>

            <section className="profile-section evidence-section" aria-labelledby="profile-evidence-heading">
              <div className="profile-section-heading"><span className="profile-section-icon"><ShieldCheck aria-hidden="true" /></span><div><p className="eyebrow">04 / PHOTOS FOR REVIEW</p><h2 id="profile-evidence-heading">Photos and a separate selfie</h2><p>Only the review team can see these private images. They review them by hand; they do not verify a government ID or check background records.</p></div></div>
              <EvidenceUpload kind="photo" title="Profile photos" description="Add at least one clear photo. Up to six." files={photoFiles} busyFile={fileBusy} uploadMessage={uploadState.photo} previewUrls={previewUrls} onUpload={(file) => void uploadFile("photo", file)} onPreview={(file) => void showPrivatePreview(file)} onRemove={(file) => void removeFile(file)} />
              <EvidenceUpload kind="selfie" title="Private selfie" description="A separate selfie is required for the review team." files={selfieFiles} busyFile={fileBusy} uploadMessage={uploadState.selfie} previewUrls={previewUrls} onUpload={(file) => void uploadFile("selfie", file)} onPreview={(file) => void showPrivatePreview(file)} onRemove={(file) => void removeFile(file)} />
              {fileError && <p className="form-error file-error" role="alert"><CircleAlert aria-hidden="true" />{fileError}</p>}
              <p className="profile-privacy-note"><ShieldCheck aria-hidden="true" />We remove hidden image details before review and delete the images on a set schedule. Your approved profile stays complete after the images are removed unless your identity details change.</p>
            </section>

            {profile.missingFields.length > 0 && <section className="profile-missing-summary" aria-label="Profile completion requirements"><p className="eyebrow">STILL NEEDED</p><ul>{profile.missingFields.map((field) => <li key={field}>{friendlyMissingField(field)}</li>)}</ul></section>}
            {formMessage && <div className={`profile-feedback ${saveState === "error" || saveState === "conflict" || submitState === "error" || submitState === "conflict" ? "profile-feedback-error" : ""}`} role={saveState === "error" || saveState === "conflict" || submitState === "error" || submitState === "conflict" ? "alert" : "status"} aria-live="polite">{saveState === "error" || saveState === "conflict" || submitState === "error" || submitState === "conflict" ? <CircleAlert aria-hidden="true" /> : <BadgeCheck aria-hidden="true" />}{formMessage}{(saveState === "conflict" || submitState === "conflict") && <button className="text-action" type="button" onClick={() => void loadProfile()}>Reload current profile</button>}</div>}
            <div className="profile-form-actions">
              <button className="button button-outline" type="button" onClick={() => void saveProfile()} disabled={!dirty || saveState === "saving"}>
                {saveState === "saving" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}{saveState === "saving" ? "Saving…" : "Save changes"}
              </button>
              <button className="button button-primary" type="button" onClick={() => void submitForReview()} disabled={submitDisabled}>
                {submitState === "submitting" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{submitState === "submitting" ? "Submitting…" : "Submit for identity review"}
              </button>
            </div>
            <p className="profile-review-footnote">Profile review does not include government ID verification or a background check.</p>
          </form>
        </>}
      </section>
    </div>
  </main>;
}

function Field(props: Readonly<{ id: string; label: string; hint?: string; error?: string; children: ReactNode }>) {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  const errorId = props.error ? `${props.id}-error` : undefined;
  const child = Children.only(props.children);
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<Record<string, unknown>>, { "aria-describedby": describedBy, "aria-invalid": Boolean(props.error) })
    : child;
  return <div className="profile-field">
    <label htmlFor={props.id}>{props.label}</label>
    {control}
    {props.hint && <small id={hintId} className="field-hint">{props.hint}</small>}
    {props.error && <small id={errorId} className="field-error" role="alert">{props.error}</small>}
  </div>;
}

function ChoiceGroup(props: Readonly<{ id: string; legend: string; description: string; error?: string; children: React.ReactNode }>) {
  const describedBy = [props.description ? `${props.id}-description` : null, props.error ? `${props.id}-error` : null].filter(Boolean).join(" ") || undefined;
  return <fieldset className="profile-choice-group" aria-describedby={describedBy} aria-invalid={Boolean(props.error)}>
    <legend>{props.legend}</legend>
    <p id={`${props.id}-description`}>{props.description}</p>
    <div className="profile-choice-options">{props.children}</div>
    {props.error && <small id={`${props.id}-error`} className="field-error" role="alert">{props.error}</small>}
  </fieldset>;
}

function EvidenceUpload(props: Readonly<{
  kind: ProfileFileKind;
  title: string;
  description: string;
  files: readonly ProfileFileSummary[];
  busyFile: string | null;
  uploadMessage: string;
  previewUrls: Readonly<Record<string, string>>;
  onUpload: (file: File) => void;
  onPreview: (file: ProfileFileSummary) => void;
  onRemove: (file: ProfileFileSummary) => void;
}>) {
  const readyCount = props.files.filter((file) => file.state === "ready").length;
  const canAdd = props.kind === "photo" ? props.files.length < 6 : props.files.length === 0;
  return <div className="evidence-card">
    <div className="evidence-card-heading"><span className="evidence-icon">{props.kind === "photo" ? <ImagePlus aria-hidden="true" /> : <Camera aria-hidden="true" />}</span><div><h3>{props.title}</h3><p>{props.description}</p></div><span className={`evidence-count ${readyCount ? "is-ready" : ""}`}>{readyCount} ready</span></div>
    {props.files.map((file) => <div className="evidence-file" key={file.fileId}>
      <span className="evidence-file-state">{file.state === "ready" ? <BadgeCheck aria-hidden="true" /> : <Clock3 aria-hidden="true" />}{fileStatusLabel(file.state)}</span>
      {file.state === "ready" && <button className="text-action" type="button" onClick={() => void props.onPreview(file)} disabled={props.busyFile === file.fileId}>{props.busyFile === file.fileId ? "Opening…" : "View privately"}</button>}
      {file.state !== "ready" && <span className="evidence-file-note">This file is not available for review.</span>}
      <button className="icon-action" type="button" aria-label={`Remove ${props.kind === "photo" ? "profile photo" : "selfie"}`} onClick={() => void props.onRemove(file)} disabled={props.busyFile === file.fileId}><Trash2 aria-hidden="true" /></button>
      {props.previewUrls[file.fileId] && <figure className="evidence-preview"><img src={props.previewUrls[file.fileId]} alt={props.kind === "photo" ? "Your private profile photo" : "Your private selfie"} referrerPolicy="no-referrer" loading="lazy" /><figcaption>Private preview. Link expires shortly and is not saved.</figcaption></figure>}
    </div>)}
    {canAdd && <label className="evidence-upload-button"><input type="file" accept="image/jpeg,image/png,image/webp" capture={props.kind === "selfie" ? "user" : undefined} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) props.onUpload(file); event.currentTarget.value = ""; }} disabled={Boolean(props.uploadMessage)} /><ImagePlus aria-hidden="true" /><span>{props.uploadMessage || (props.kind === "photo" ? "Add a photo" : "Add a selfie")}</span><small>JPEG, PNG or WebP · up to 8 MB</small></label>}
    {!canAdd && props.kind === "photo" && <p className="field-hint">You have reached the six-photo limit. Remove a photo to add another.</p>}
  </div>;
}

function friendlyMissingField(field: string): string {
  const labels: Record<string, string> = {
    firstName: "First name",
    lastName: "Last name",
    dateOfBirth: "Date of birth",
    identity: "Your identity",
    openTo: "Who you are open to meeting",
    matchAgeMin: "Youngest matching age",
    matchAgeMax: "Oldest matching age",
    neighborhood: "Neighborhood",
    nights: "Available nights",
    lookingFor: "What you are looking for",
    surpriseGame: "Surprise game preference",
    photo: "At least one ready profile photo",
    selfie: "One separate ready selfie",
  };
  return labels[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function fileStatusLabel(state: ProfileFileSummary["state"]): string {
  return {
    pending_upload: "Upload pending",
    ready: "Ready for review",
    rejected: "Needs replacement",
    superseded: "Replaced",
    deleted: "Removed",
  }[state];
}
