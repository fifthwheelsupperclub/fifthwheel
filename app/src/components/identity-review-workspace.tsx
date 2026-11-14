import { useEffect, useRef, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, BadgeCheck, CircleAlert, Clock3, FileCheck2, LoaderCircle, RefreshCw, ShieldCheck, Table2, UserRoundCheck, UsersRound } from "lucide-react";
import type { IdentityReviewDecisionResultDTO, IdentityReviewDetailDTO, IdentityReviewQueueItem, ProfileFileSummary, W04Error } from "../profile.contract.ts";
import { SignOutButton } from "./sign-out-button.tsx";

type State = "loading" | "ready" | "unauthenticated" | "forbidden" | "error";
type ApiOutcome<T> = Readonly<{ data: T; error: null }> | Readonly<{ data: null; error: W04Error | null }>;
type PendingOperation = Readonly<{ fingerprint: string; id: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isError(value: unknown): value is W04Error {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string"
    && typeof value.retryable === "boolean" && typeof value.correlationId === "string";
}

function responseData<T>(body: unknown, valid: (value: unknown) => value is T): ApiOutcome<T> {
  if (!isRecord(body)) return { data: null, error: null };
  if (body.ok === true && valid(body.data)) return { data: body.data, error: null };
  if (body.ok === false && isError(body)) return { data: null, error: body };
  return { data: null, error: null };
}

async function readApi<T>(response: Response, valid: (value: unknown) => value is T): Promise<ApiOutcome<T>> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = responseData(body, valid);
  return response.ok ? parsed : { data: null, error: parsed.error };
}

function isQueueItem(value: unknown): value is IdentityReviewQueueItem {
  return isRecord(value) && typeof value.reviewId === "string" && typeof value.guestId === "string"
    && typeof value.firstName === "string" && typeof value.lastName === "string"
    && typeof value.submittedAt === "string" && Number.isSafeInteger(value.profileRevision)
    && Number.isSafeInteger(value.criticalIdentityVersion) && Number.isSafeInteger(value.attemptNumber);
}

type QueueData = Readonly<{ items: readonly IdentityReviewQueueItem[]; nextCursor: string | null }>;
function isQueueData(value: unknown): value is QueueData {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isQueueItem)
    && (typeof value.nextCursor === "string" || value.nextCursor === null);
}

function isFileSummary(value: unknown): value is ProfileFileSummary {
  return isRecord(value) && typeof value.fileId === "string" && (value.kind === "photo" || value.kind === "selfie")
    && ["pending_upload", "ready", "rejected", "superseded", "deleted"].includes(String(value.state));
}

function isReviewDetail(value: unknown): value is IdentityReviewDetailDTO {
  return isRecord(value) && typeof value.reviewId === "string" && typeof value.submittedAt === "string"
    && Number.isSafeInteger(value.attemptNumber) && Number.isSafeInteger(value.submittedCriticalIdentityVersion)
    && (typeof value.correctionReason === "string" || value.correctionReason === null)
    && isRecord(value.profile) && Number.isSafeInteger(value.profile.profileRevision)
    && Number.isSafeInteger(value.profile.criticalIdentityVersion)
    && (value.profile.reviewedIdentityVersion === null || Number.isSafeInteger(value.profile.reviewedIdentityVersion))
    && typeof value.profile.firstName === "string" && typeof value.profile.lastName === "string"
    && typeof value.profile.dateOfBirth === "string" && ["woman", "man", "non_binary"].includes(String(value.profile.identity))
    && Array.isArray(value.profile.files) && value.profile.files.every(isFileSummary)
    && Array.isArray(value.profile.missingFields) && value.profile.missingFields.every((field) => typeof field === "string")
    && Array.isArray(value.evidence) && value.evidence.every((item) => isRecord(item) && typeof item.fileId === "string"
      && (item.kind === "photo" || item.kind === "selfie") && typeof item.readUrl === "string" && typeof item.expiresAt === "string");
}

function isDecision(value: unknown): value is IdentityReviewDecisionResultDTO {
  return isRecord(value) && typeof value.guestId === "string" && Number.isSafeInteger(value.profileRevision)
    && Number.isSafeInteger(value.criticalIdentityVersion)
    && (value.reviewedIdentityVersion === null || Number.isSafeInteger(value.reviewedIdentityVersion))
    && ["draft", "submitted", "approved", "resubmission_required"].includes(String(value.identityStatus))
    && typeof value.reviewedAt === "string";
}

function operationIdFor(ref: { current: PendingOperation | null }, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (ref.current?.fingerprint === fingerprint) return ref.current.id;
  const id = crypto.randomUUID();
  ref.current = { fingerprint, id };
  return id;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatBirthDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Date unavailable";
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function safeIdentityLabel(value: string): string {
  return value === "woman" ? "Woman" : value === "man" ? "Man" : value === "non_binary" ? "Non-binary" : "Not provided";
}

export function IdentityReviewQueue() {
  const [state, setState] = useState<State>("loading");
  const [items, setItems] = useState<readonly IdentityReviewQueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");

  async function loadQueue(cursor?: string, append = false, signal?: AbortSignal) {
    if (append) setLoadingMore(true);
    else setState("loading");
    setMessage("");
    const query = new URLSearchParams({ status: "submitted" });
    if (cursor) query.set("cursor", cursor);
    try {
      const response = await fetch("/api/admin/identity-reviews?" + query.toString(), {
        method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal,
      });
      if (response.status === 401) { setState("unauthenticated"); setItems([]); return; }
      if (response.status === 403) { setState("forbidden"); setItems([]); return; }
      const result = await readApi(response, isQueueData);
      if (!response.ok || !result.data) {
        setState("error");
        setMessage(result.error?.message ?? "The identity review queue could not load. Try again shortly.");
        if (!append) setItems([]);
        return;
      }
      setItems((current) => append ? [...current, ...result.data.items] : result.data.items);
      setNextCursor(result.data.nextCursor);
      setState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error");
      setMessage("The identity review queue could not load. Try again shortly.");
      if (!append) setItems([]);
    } finally { setLoadingMore(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadQueue(undefined, false, controller.signal);
    return () => controller.abort();
  }, []);

  return <AdminReviewShell active="queue">
    <div className="product-breadcrumb">People <span>/</span> Identity review</div>
    <div className="page-heading-row"><div><p className="eyebrow">PEOPLE / IDENTITY REVIEW</p><h1 id="identity-review-heading">Thoughtful review, one person at a time.</h1><p className="page-intro">Review only the current submitted profile version. This manual photo review does not verify government ID or background history.</p></div><span className="status-pill status-pill-neutral"><Clock3 aria-hidden="true" />{state === "ready" ? items.length + " pending" : "Review queue"}</span></div>
    {state === "loading" && <section className="data-state" role="status" aria-live="polite"><span className="data-state-icon"><LoaderCircle className="is-spinning" aria-hidden="true" /></span><h2>Loading the review queue</h2><p>Only current submitted profiles are shown.</p></section>}
    {state === "unauthenticated" && <section className="data-state data-state-error"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Sign in to review profiles</h2><p>This workspace requires a verified staff account.</p><a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a></section>}
    {state === "forbidden" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Identity reviews are restricted</h2><p>Your current account is not authorized to access member identity evidence.</p><a className="button button-outline" href="/admin/waitlist">Return to the admin workspace<ArrowRight aria-hidden="true" /></a></section>}
    {state === "error" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>The queue is unavailable</h2><p>{message}</p><button className="button button-outline" type="button" onClick={() => void loadQueue()}>Try again<RefreshCw aria-hidden="true" /></button></section>}
    {state === "ready" && (items.length === 0
      ? <section className="empty-review-state"><span className="data-state-icon"><BadgeCheck aria-hidden="true" /></span><h2>No profiles are waiting for review</h2><p>When a member submits a complete profile, it will appear here.</p></section>
      : <>
        <section className="review-queue" aria-label="Submitted identity reviews">
          {items.map((item) => <a className="review-queue-item" href={"/admin/identity-review/" + encodeURIComponent(item.guestId)} key={item.guestId + "-" + item.reviewId}>
            <span className="review-queue-icon"><UserRoundCheck aria-hidden="true" /></span>
            <span className="review-queue-main"><strong>{item.firstName} {item.lastName}</strong><small>Submitted {formatDate(item.submittedAt)} · Review {item.attemptNumber}</small></span>
            <span className="review-queue-revision">Version {item.profileRevision}</span><ArrowRight aria-hidden="true" />
          </a>)}
        </section>
        {nextCursor && <button className="button button-outline review-load-more" type="button" onClick={() => void loadQueue(nextCursor, true)} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more reviews"}<ArrowRight aria-hidden="true" /></button>}
      </>)}
  </AdminReviewShell>;
}

/** The queue route is the layout parent of the parameterized review route. */
export function IdentityReviewRouteLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === "/admin/identity-review" ? <IdentityReviewQueue /> : <Outlet />;
}

export function IdentityReviewDetail({ guestId }: Readonly<{ guestId: string }>) {
  const [state, setState] = useState<State>("loading");
  const [detail, setDetail] = useState<IdentityReviewDetailDTO | null>(null);
  const [message, setMessage] = useState("");
  const [decisionState, setDecisionState] = useState<"idle" | "sending" | "done" | "error" | "conflict">("idle");
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionMode, setDecisionMode] = useState<"none" | "approve" | "request">("none");
  const [correctionReason, setCorrectionReason] = useState("");
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(new Set());
  const decisionOperation = useRef<PendingOperation | null>(null);

  async function loadDetail(signal?: AbortSignal) {
    setState("loading");
    setMessage("");
    try {
      const response = await fetch("/api/admin/identity-reviews/" + encodeURIComponent(guestId), {
        method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal,
      });
      if (response.status === 401) { setState("unauthenticated"); setDetail(null); return; }
      if (response.status === 403) { setState("forbidden"); setDetail(null); return; }
      if (response.status === 404) { setState("error"); setMessage("This review is no longer available. It may have been completed or changed."); setDetail(null); return; }
      const result = await readApi(response, isReviewDetail);
      if (!response.ok || !result.data) {
        setState("error");
        setMessage(result.error?.message ?? "The review detail could not load. No evidence was exposed.");
        setDetail(null);
        return;
      }
      setDetail(result.data);
      setFailedImages(new Set());
      setDecisionMode("none");
      setDecisionState("idle");
      setDecisionMessage("");
      setState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error");
      setMessage("The review detail could not load. Try again shortly.");
      setDetail(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(controller.signal);
    return () => controller.abort();
  }, [guestId]);

  async function submitDecision(decision: "approved" | "resubmission_required") {
    if (!detail) return;
    const reason = correctionReason.trim();
    if (decision === "resubmission_required" && (reason.length < 1 || reason.length > 2000)) {
      setDecisionState("error");
      setDecisionMessage("Write a correction explanation between 1 and 2,000 characters.");
      return;
    }
    const payload = {
      expectedProfileRevision: detail.profile.profileRevision,
      reviewId: detail.reviewId,
      decision,
      ...(decision === "resubmission_required" ? { correctionReason: reason } : {}),
    };
    const operationId = operationIdFor(decisionOperation, payload);
    setDecisionState("sending");
    setDecisionMessage("");
    try {
      const response = await fetch("/api/admin/identity-reviews/" + encodeURIComponent(guestId) + "/decision", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ...payload, operationId }),
      });
      const result = await readApi(response, isDecision);
      if (response.status === 409 || result.error?.code === "conflict") {
        setDecisionState("conflict");
        setDecisionMessage("This profile changed after you opened it. Reload the latest review before deciding.");
        return;
      }
      if (!response.ok || !result.data) {
        setDecisionState("error");
        setDecisionMessage(result.error?.message ?? "The review decision could not be saved. Try again.");
        return;
      }
      decisionOperation.current = null;
      setDecisionState("done");
      setDecisionMessage(decision === "approved" ? "The submitted identity version is approved." : "The member can now see the correction request and resubmit.");
      setDecisionMode("none");
    } catch {
      setDecisionState("error");
      setDecisionMessage("The review decision could not be confirmed. Reload the review to check its current status.");
    }
  }

  const profile = detail?.profile;
  const reviewCurrent = Boolean(profile && detail && profile.identityStatus === "submitted"
    && detail.submittedCriticalIdentityVersion === profile.criticalIdentityVersion);
  const readyPhotos = profile?.files.filter((file) => file.kind === "photo" && file.state === "ready").length ?? 0;
  const readySelfies = profile?.files.filter((file) => file.kind === "selfie" && file.state === "ready").length ?? 0;
  const evidenceMatches = Boolean(detail && profile && detail.evidence.length === readyPhotos + readySelfies
    && detail.evidence.every((item) => profile.files.some((file) => file.fileId === item.fileId && file.kind === item.kind && file.state === "ready")));
  const mayDecide = Boolean(reviewCurrent && readyPhotos >= 1 && readySelfies === 1 && evidenceMatches && decisionState !== "sending" && decisionState !== "done");

  return <AdminReviewShell active="detail">
    <div className="product-breadcrumb"><a href="/admin/identity-review"><ArrowLeft aria-hidden="true" />Identity review queue</a><span>/</span>Review detail</div>
    {state === "loading" && <section className="data-state" role="status" aria-live="polite"><span className="data-state-icon"><LoaderCircle className="is-spinning" aria-hidden="true" /></span><h2>Loading the current review</h2><p>Private photos are shown only to staff assigned to this review.</p></section>}
    {state === "unauthenticated" && <section className="data-state data-state-error"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Sign in to continue</h2><p>This workspace requires a verified staff account.</p><a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a></section>}
    {state === "forbidden" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Identity reviews are restricted</h2><p>Your current account cannot access private identity evidence.</p><a className="button button-outline" href="/admin/identity-review">Return to the review queue<ArrowRight aria-hidden="true" /></a></section>}
    {state === "error" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Review detail unavailable</h2><p>{message}</p><button className="button button-outline" type="button" onClick={() => void loadDetail()}>Reload review<RefreshCw aria-hidden="true" /></button></section>}
    {state === "ready" && detail && profile && <>
      <div className="page-heading-row review-detail-heading"><div><p className="eyebrow">IDENTITY REVIEW / ATTEMPT {detail.attemptNumber}</p><h1 id="identity-review-detail-heading">{profile.firstName} {profile.lastName}</h1><p className="page-intro">Submitted {formatDate(detail.submittedAt)} · Profile version {profile.profileRevision} · Identity version {profile.criticalIdentityVersion}</p></div><span className={"status-pill " + (reviewCurrent ? "status-pill-neutral" : "status-pill-alert")}>{reviewCurrent ? "CURRENT SUBMISSION" : "STALE REVIEW"}</span></div>
      {detail.correctionReason && <section className="review-history-note"><p className="eyebrow">PREVIOUS CORRECTION</p><p>{detail.correctionReason}</p></section>}
      {!reviewCurrent && <div className="review-conflict-banner" role="alert"><CircleAlert aria-hidden="true" /><span>The member changed their profile after this review was submitted. Refresh before approving it or requesting changes.</span><button className="text-action" type="button" onClick={() => void loadDetail()}>Refresh review</button></div>}
      <div className="review-detail-grid">
        <section className="review-card" aria-labelledby="review-profile-heading">
          <div className="review-card-heading"><span className="profile-section-icon"><UserRoundCheck aria-hidden="true" /></span><div><p className="eyebrow">CURRENT SUBMITTED VERSION</p><h2 id="review-profile-heading">Identity details</h2></div></div>
          <dl className="review-facts"><div className="review-fact"><dt>Full name</dt><dd>{profile.firstName} {profile.lastName}</dd></div><div className="review-fact"><dt>Date of birth</dt><dd>{formatBirthDate(profile.dateOfBirth)}</dd></div><div className="review-fact"><dt>Identity</dt><dd>{safeIdentityLabel(profile.identity)}</dd></div><div className="review-fact"><dt>Review attempt</dt><dd>{detail.attemptNumber}</dd></div></dl>
          <div className="review-evidence-summary"><strong>Photos on this submission</strong><span>{readyPhotos} profile photo{readyPhotos === 1 ? "" : "s"} · {readySelfies} separate selfie</span>{profile.missingFields.length > 0 && <p>Still needed: {profile.missingFields.map(friendlyField).join(", ")}</p>}</div>
        </section>
        <section className="review-card review-evidence-card" aria-labelledby="review-evidence-heading">
          <div className="review-card-heading"><span className="profile-section-icon"><ShieldCheck aria-hidden="true" /></span><div><p className="eyebrow">PRIVATE EVIDENCE</p><h2 id="review-evidence-heading">Review the submitted images</h2><p>Each image link is temporary and access is logged.</p></div><button className="icon-action" type="button" aria-label="Refresh private evidence links" onClick={() => void loadDetail()}><RefreshCw aria-hidden="true" /></button></div>
          {detail.evidence.length === 0 && <p className="empty-evidence">No ready evidence is attached to this submitted version.</p>}
          <div className="review-image-grid">{detail.evidence.map((item) => <figure className="review-evidence-image" key={item.fileId}>
            {failedImages.has(item.fileId) ? <div className="review-image-unavailable"><CircleAlert aria-hidden="true" /><span>Image unavailable. Refresh the review to request a new audited link.</span></div> : <img src={safeEvidenceUrl(item.readUrl)} alt={item.kind === "photo" ? "Member submitted profile photo" : "Member submitted private selfie"} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailedImages((current) => new Set(current).add(item.fileId))} />}
            <figcaption><span>{item.kind === "photo" ? "Profile photo" : "Private selfie"}</span><small>Temporary review link</small></figcaption>
          </figure>)}</div>
          <p className="review-manual-note"><ShieldCheck aria-hidden="true" />Review these images by hand. This does not verify a government ID or check background records.</p>
        </section>
      </div>
      {decisionMessage && <div className={"profile-feedback " + (decisionState === "error" || decisionState === "conflict" ? "profile-feedback-error" : "")} role={decisionState === "error" || decisionState === "conflict" ? "alert" : "status"}>{decisionState === "error" || decisionState === "conflict" ? <CircleAlert aria-hidden="true" /> : <BadgeCheck aria-hidden="true" />}{decisionMessage}</div>}
      {decisionState === "done" ? <div className="review-decision-complete"><BadgeCheck aria-hidden="true" /><div><strong>Decision saved</strong><p>{decisionMessage}</p><a className="button button-primary" href="/admin/identity-review">Back to review queue<ArrowRight aria-hidden="true" /></a></div></div> : <section className="review-decision-panel" aria-labelledby="review-decision-heading">
        <div><p className="eyebrow">REVIEW DECISION</p><h2 id="review-decision-heading">What should happen next?</h2><p>Decisions apply only to the submitted identity version shown above.</p></div>
        {decisionMode === "none" && <div className="review-decision-actions"><button className="button button-outline" type="button" onClick={() => { setDecisionMode("request"); setDecisionState("idle"); }} disabled={!mayDecide}><FileCheck2 aria-hidden="true" />Request a correction</button><button className="button button-primary" type="button" onClick={() => setDecisionMode("approve")} disabled={!mayDecide}><BadgeCheck aria-hidden="true" />Approve this version</button></div>}
        {decisionMode === "approve" && <div className="decision-confirmation"><p>Approve the profile details and photos shown here? This is a manual review. It does not verify a government ID or check background records.</p><div><button className="button button-outline" type="button" onClick={() => setDecisionMode("none")}>Cancel</button><button className="button button-primary" type="button" onClick={() => void submitDecision("approved")} disabled={!mayDecide || decisionState === "sending"}>{decisionState === "sending" ? "Saving decision…" : "Confirm approval"}<ArrowRight aria-hidden="true" /></button></div></div>}
        {decisionMode === "request" && <div className="decision-request"><label htmlFor="correction-reason">Explain what the member needs to correct</label><textarea id="correction-reason" rows={4} maxLength={2000} value={correctionReason} onChange={(event) => setCorrectionReason(event.currentTarget.value)} aria-describedby="correction-reason-help" aria-invalid={decisionState === "error" && !correctionReason.trim()} /><small id="correction-reason-help">Required, 1–2,000 characters. This explanation is shown to the member.</small><div><button className="button button-outline" type="button" onClick={() => setDecisionMode("none")}>Cancel</button><button className="button button-primary" type="button" onClick={() => void submitDecision("resubmission_required")} disabled={!mayDecide || decisionState === "sending" || !correctionReason.trim()}>{decisionState === "sending" ? "Saving decision…" : "Send correction request"}<ArrowRight aria-hidden="true" /></button></div></div>}
      </section>}
    </>}
  </AdminReviewShell>;
}

function safeEvidenceUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function friendlyField(field: string): string {
  const labels: Record<string, string> = { firstName: "first name", lastName: "last name", dateOfBirth: "date of birth", identity: "identity", photo: "profile photo", selfie: "separate selfie" };
  return labels[field] ?? field.replace(/([A-Z])/g, " $1").toLowerCase();
}

function AdminReviewShell(props: Readonly<{ active: "queue" | "detail"; children: React.ReactNode }>) {
  return <main className="product-page">
    <header className="product-topbar">
      <a className="brand" href="/admin/waitlist" aria-label="Fifth Wheel admin workspace"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions"><span className="product-workspace-label">ADMIN WORKSPACE</span><SignOutButton /></div>
    </header>
    <div className="product-layout">
      <aside className="product-sidebar" aria-label="Admin navigation">
        <p className="sidebar-caption">WORKSPACE</p><span className="member-nav-link is-preview-disabled" aria-disabled="true">Overview</span>
        <p className="group-label">PEOPLE</p><a className="member-nav-link" href="/admin/waitlist"><UserRoundCheck aria-hidden="true" />Waitlist</a>
        <a className={"member-nav-link " + (props.active === "queue" || props.active === "detail" ? "active" : "")} href="/admin/identity-review" aria-current={props.active === "queue" ? "page" : undefined}><FileCheck2 aria-hidden="true" />Identity review</a>
        <a className="member-nav-link" href="/admin/seat-requests"><UsersRound aria-hidden="true" />Seat requests</a>
        <p className="group-label">TABLES</p><a className="member-nav-link" href="/admin/tables"><Table2 aria-hidden="true" />Tables</a>
        <p className="group-label">MONEY</p><a className="member-nav-link" href="/admin/cancellations">Cancellations</a><a className="member-nav-link" href="/admin/refunds">Refunds</a>
        <p className="group-label">OPERATIONS</p><span className="member-nav-link is-preview-disabled" aria-disabled="true">Communications</span><a className="member-nav-link" href="/admin/table-invitations">Table invitation delivery</a><span className="member-nav-link is-preview-disabled" aria-disabled="true">Conduct reports</span><span className="member-nav-link is-preview-disabled" aria-disabled="true">Audit</span>
        <div className="product-sidebar-foot"><ShieldCheck aria-hidden="true" />Identity evidence is restricted to current submitted reviews.</div>
      </aside>
      <section className="product-content identity-review-content">{props.children}</section>
    </div>
  </main>;
}

