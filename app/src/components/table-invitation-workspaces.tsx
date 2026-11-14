import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleAlert, Clock3, LoaderCircle, Mail, MapPin, RefreshCw, ShieldCheck, Table2, Ticket, UserRound, UsersRound } from "lucide-react";
import { MemberWorkspaceShell } from "./member-tables-workspace.tsx";
import { SignOutButton } from "./sign-out-button.tsx";
import { MemberCheckoutWorkspace } from "./member-checkout-workspace.tsx";
import type {
  AdminTableInvitationDTO, AdminTableInvitationListDTO, MemberTableInvitationDetailDTO,
  ReconcileTableInvitationDeliveryResultDTO, RetryTableInvitationDeliveryRequest, RetryTableInvitationDeliveryResultDTO, TableInvitationDeliveryState,
  TableInvitationErrorCode, TableInvitationResponse, TableInvitationState,
} from "../table-invitations.contract.ts";
import "./table-invitation-workspaces.css";

type InvitationPageState = "loading" | "ready" | "unauthenticated" | "forbidden" | "not_found" | "error";
type DeliveryTone = "neutral" | "good" | "warning" | "bad";
type Envelope<T> = TableInvitationResponse<T>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invitationStates = new Set<TableInvitationState>(["active", "revoked", "closed"]);
const deliveryStates = new Set<TableInvitationDeliveryState>(["queued", "sending", "accepted", "delivered", "failed", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string { return typeof value === "string"; }
function isDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }

function decodeEnvelope<T>(value: unknown, decodeData: (data: unknown) => T | null): Envelope<T> | null {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !isText(value.correlationId)) return null;
  if (value.ok) {
    const data = decodeData(value.data);
    return data === null ? null : { ok: true, data, correlationId: value.correlationId };
  }
  if (!isRecord(value.error) || !isText(value.error.code) || !isText(value.error.safeMessage) || typeof value.error.retryable !== "boolean") return null;
  return { ok: false, error: { code: value.error.code as TableInvitationErrorCode, safeMessage: value.error.safeMessage,
    retryable: value.error.retryable, correlationId: value.correlationId } };
}

function decodeMemberDetail(value: unknown): MemberTableInvitationDetailDTO | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.invitationId ?? "")) || !invitationStates.has(value.state as TableInvitationState)
    || !isDate(value.createdAt) || !isRecord(value.delivery) || !deliveryStates.has(value.delivery.state as TableInvitationDeliveryState)
    || !isCount(value.delivery.attemptCount) || !(value.delivery.lastAttemptAt === null || isDate(value.delivery.lastAttemptAt)) || !isRecord(value.table)) return null;
  const table = value.table;
  if (!uuidPattern.test(String(table.tableId ?? "")) || !isText(table.title) || !isText(table.localDate) || !/^\d{4}-\d{2}-\d{2}$/.test(table.localDate)
    || !isText(table.startLocalTime) || !/^\d{2}:\d{2}$/.test(table.startLocalTime) || !isText(table.neighborhood)
    || table.seatPriceCents !== 2500 || table.currency !== "USD" || !Array.isArray(table.stops) || typeof table.itineraryAvailable !== "boolean") return null;
  const stops = table.stops.map((stop) => {
    if (!isRecord(stop) || !["drinks", "dinner", "dessert"].includes(String(stop.role)) || !isText(stop.venueName) || !isText(stop.venueAddress)
      || !isCount(stop.minutesFromStart) || !isText(stop.publicNotes)) return null;
    return { role: stop.role as "drinks" | "dinner" | "dessert", venueName: stop.venueName, venueAddress: stop.venueAddress,
      minutesFromStart: stop.minutesFromStart, publicNotes: stop.publicNotes };
  });
  if (stops.some((stop) => stop === null) || (table.itineraryAvailable && stops.length !== 3) || (!table.itineraryAvailable && stops.length !== 0)) return null;
  return { invitationId: value.invitationId as string, state: value.state as TableInvitationState, createdAt: value.createdAt,
    delivery: { state: value.delivery.state as TableInvitationDeliveryState, attemptCount: value.delivery.attemptCount as number, lastAttemptAt: value.delivery.lastAttemptAt as string | null },
    table: { tableId: table.tableId as string, title: table.title, localDate: table.localDate, startLocalTime: table.startLocalTime,
      neighborhood: table.neighborhood, seatPriceCents: 2500, currency: "USD", stops: stops as NonNullable<typeof stops[number]>[], itineraryAvailable: table.itineraryAvailable } };
}

function decodeAdminItem(value: unknown): AdminTableInvitationDTO | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.invitationId ?? "")) || !invitationStates.has(value.invitationState as TableInvitationState)
    || !isDate(value.createdAt) || !isRecord(value.guest) || !uuidPattern.test(String(value.guest.guestId ?? "")) || !isText(value.guest.displayName)
    || !isRecord(value.table) || !uuidPattern.test(String(value.table.tableId ?? "")) || !isText(value.table.title)
    || !isText(value.table.localDate) || !isText(value.table.startLocalTime) || !isText(value.table.neighborhood)
    || !isRecord(value.delivery) || !uuidPattern.test(String(value.delivery.outboxId ?? ""))
    || !deliveryStates.has(value.delivery.state as TableInvitationDeliveryState) || !isCount(value.delivery.attemptCount)
    || !isDate(value.delivery.queuedAt) || !isDate(value.delivery.nextAttemptAt)
    || !(value.delivery.lastAttemptAt === null || isDate(value.delivery.lastAttemptAt))
    || !(value.delivery.safeErrorCode === null || isText(value.delivery.safeErrorCode)) || !Array.isArray(value.attempts)) return null;
  const attempts = value.attempts.map((attempt) => {
    if (!isRecord(attempt) || !isCount(attempt.attemptNumber) || attempt.attemptNumber < 1
      || !["sending", "accepted", "delivered", "failed", "unknown"].includes(String(attempt.state))
      || !isDate(attempt.startedAt) || !(attempt.finishedAt === null || isDate(attempt.finishedAt))
      || !(attempt.safeErrorCode === null || isText(attempt.safeErrorCode))) return null;
    return { attemptNumber: attempt.attemptNumber, state: attempt.state as AdminTableInvitationDTO["attempts"][number]["state"],
      startedAt: attempt.startedAt, finishedAt: attempt.finishedAt as string | null, safeErrorCode: attempt.safeErrorCode as string | null };
  });
  if (attempts.some((attempt) => attempt === null)) return null;
  return { invitationId: value.invitationId as string, invitationState: value.invitationState as TableInvitationState, createdAt: value.createdAt,
    guest: { guestId: value.guest.guestId as string, displayName: value.guest.displayName },
    table: { tableId: value.table.tableId as string, title: value.table.title, localDate: value.table.localDate,
      startLocalTime: value.table.startLocalTime, neighborhood: value.table.neighborhood },
    delivery: { outboxId: value.delivery.outboxId as string, state: value.delivery.state as TableInvitationDeliveryState,
      attemptCount: value.delivery.attemptCount as number, queuedAt: value.delivery.queuedAt, nextAttemptAt: value.delivery.nextAttemptAt,
      lastAttemptAt: value.delivery.lastAttemptAt as string | null, safeErrorCode: value.delivery.safeErrorCode as string | null },
    attempts: attempts as AdminTableInvitationDTO["attempts"] };
}
function decodeAdminList(value: unknown): AdminTableInvitationListDTO | null {
  if (!isRecord(value) || !Array.isArray(value.items) || !(value.nextCursor === null || isText(value.nextCursor))) return null;
  const items = value.items.map(decodeAdminItem);
  return items.some((item) => item === null) ? null : { items: items as AdminTableInvitationDTO[], nextCursor: value.nextCursor };
}
function decodeRetry(value: unknown): RetryTableInvitationDeliveryResultDTO | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.invitationId ?? "")) || value.deliveryState !== "queued"
    || !isCount(value.attemptCount) || !isDate(value.queuedAt) || !isDate(value.nextAttemptAt)) return null;
  return { invitationId: value.invitationId as string, deliveryState: "queued", attemptCount: value.attemptCount,
    queuedAt: value.queuedAt, nextAttemptAt: value.nextAttemptAt };
}
function decodeReconcile(value: unknown): ReconcileTableInvitationDeliveryResultDTO | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.invitationId ?? ""))
    || !["accepted", "unknown"].includes(String(value.deliveryState)) || !isCount(value.attemptCount)) return null;
  return { invitationId: value.invitationId as string, deliveryState: value.deliveryState as "accepted" | "unknown", attemptCount: value.attemptCount };
}
function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}
function timeLabel(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return value;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2020, 0, 1, hour, minute));
}
function deliveryCopy(state: TableInvitationDeliveryState): Readonly<{ label: string; detail: string; tone: DeliveryTone }> {
  switch (state) {
    case "queued": return { label: "Email queued", detail: "The email is waiting for a delivery attempt. The invitation is active.", tone: "neutral" };
    case "sending": return { label: "Email sending", detail: "A delivery attempt is in progress. The invitation is active.", tone: "neutral" };
    case "accepted": return { label: "Email service accepted", detail: "The email service accepted the message, but delivery to the inbox is not confirmed.", tone: "good" };
    case "delivered": return { label: "Delivery confirmed", detail: "The provider reports this email was delivered. The invitation remains separate from a paid Seat.", tone: "good" };
    case "failed": return { label: "Email delivery failed", detail: "The invitation itself is still active. An administrator can queue a safe retry.", tone: "bad" };
    case "unknown": return { label: "Email status unclear", detail: "The invitation is still active. Check the existing email attempt before trying again.", tone: "warning" };
  }
}
function invitationStateText(state: TableInvitationState) {
  return state === "active" ? "Open invitation" : state === "revoked" ? "Invitation revoked" : "Invitation closed";
}
async function requestEnvelope<T>(response: Response, decoder: (data: unknown) => T | null): Promise<Envelope<T> | null> {
  const json: unknown = await response.json().catch(() => null);
  return decodeEnvelope(json, decoder);
}

export function MemberTableInvitationWorkspace({ invitationId }: { invitationId: string }) {
  const [state, setState] = useState<InvitationPageState>("loading");
  const [detail, setDetail] = useState<MemberTableInvitationDetailDTO | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/me/table-invitations/${encodeURIComponent(invitationId)}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      if (response.status === 404) { setState("not_found"); return; }
      const result = await requestEnvelope(response, decodeMemberDetail);
      if (!response.ok || !result) throw new Error("invalid_response");
      if (!result.ok) { setState(result.error.code === "unauthenticated" ? "unauthenticated" : result.error.code === "forbidden" ? "forbidden" : result.error.code === "not_found" ? "not_found" : "error"); setMessage(result.error.safeMessage); return; }
      setDetail(result.data); setState("ready");
    } catch {
      setState("error"); setMessage("The invitation service is temporarily unavailable. Try again shortly.");
    }
  }, [invitationId]);
  useEffect(() => { void load(); }, [load]);
  const offerState = detail ? deliveryCopy(detail.delivery.state) : null;

  const content = <>
    <div className="product-breadcrumb"><Link to="/requests">Requests</Link><span>›</span>Table invitation</div>
    {state === "loading" && <InvitationState icon={<LoaderCircle className="spin" />} title="Opening your invitation" detail="Checking this offer for your member account." />}
    {state === "unauthenticated" && <InvitationState icon={<ShieldCheck />} title="Sign in to continue" detail="Sign in with the member account connected to your invitation." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/invitations/${invitationId}`)}`}>Continue to sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <InvitationState icon={<ShieldCheck />} title="This invitation is not available to this account" detail="Table invitations are limited to the named member. Check that you signed in with the account that received the offer." action={<Link className="button button-outline" to="/requests"><ArrowLeft aria-hidden="true" />Back to Requests</Link>} />}
    {state === "not_found" && <InvitationState icon={<Ticket />} title="Invitation not found" detail="This invitation is not available to the current account." action={<Link className="button button-outline" to="/requests"><ArrowLeft aria-hidden="true" />Back to Requests</Link>} />}
    {state === "error" && <InvitationState icon={<CircleAlert />} title="Invitation details are temporarily unavailable" detail={message || "Try again shortly."} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && detail && offerState && <>
      <div className="invitation-member-heading"><p className="eyebrow">TABLE INVITATION</p><h1>{detail.table.title}</h1><p className="page-intro"><CalendarDays aria-hidden="true" />{dateLabel(detail.table.localDate)}<span>·</span><Clock3 aria-hidden="true" />{timeLabel(detail.table.startLocalTime)}<span>·</span><MapPin aria-hidden="true" />{detail.table.neighborhood}</p></div>
      <section className={`invitation-member-status tone-${offerState.tone}`}>
        <div className="invitation-status-icon">{detail.delivery.state === "delivered" || detail.delivery.state === "accepted" ? <Check aria-hidden="true" /> : detail.delivery.state === "failed" || detail.delivery.state === "unknown" ? <CircleAlert aria-hidden="true" /> : <Mail aria-hidden="true" />}</div>
        <div><p className="eyebrow">{invitationStateText(detail.state)}</p><h2>{offerState.label}</h2><p>{offerState.detail}</p></div>
      </section>
      <div className="invitation-member-grid">
        <section className="invitation-member-card"><p className="eyebrow">YOUR OFFER</p><h2>You’re invited to this Table</h2><p>This Table invitation is named for your member account. It is separate from your pending Seat request and does not confirm a paid Seat.</p><MemberCheckoutWorkspace invitationId={invitationId} /></section>
        <section className="invitation-member-card invitation-delivery-card"><p className="eyebrow">EMAIL STATUS</p><h2>{offerState.label}</h2><p>{offerState.detail}</p><dl><div><dt>Invitation created</dt><dd>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(detail.createdAt))}</dd></div><div><dt>Attempts recorded</dt><dd>{detail.delivery.attemptCount}</dd></div>{detail.delivery.lastAttemptAt && <div><dt>Last attempt</dt><dd>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(detail.delivery.lastAttemptAt))}</dd></div>}</dl></section>
      </div>
      <section className="invitation-itinerary-section"><div className="invitation-section-heading"><span><Table2 aria-hidden="true" /></span><div><p className="eyebrow">TABLE DETAILS</p><h2>Evening itinerary</h2></div></div>
        {detail.table.itineraryAvailable ? <ol className="invitation-stops">{detail.table.stops.map((stop, index) => <li key={`${stop.role}-${index}`}><span className="invitation-stop-number">0{index + 1}</span><div><p className="eyebrow">{stop.role.toUpperCase()} · {stop.minutesFromStart === 0 ? "START" : `+${stop.minutesFromStart} MIN`}</p><h3>{stop.venueName}</h3><p>{stop.venueAddress}</p>{stop.publicNotes && <small>{stop.publicNotes}</small>}</div></li>)}</ol>
          : <p className="invitation-itinerary-unavailable">The published itinerary is not currently available. Your invitation record and Table summary remain here.</p>}
      </section>
      <div className="invitation-member-actions"><Link className="button button-outline" to="/requests"><ArrowLeft aria-hidden="true" />Back to Requests</Link>{detail.table.itineraryAvailable && <a className="button button-primary" href={`/tables/${encodeURIComponent(detail.table.tableId)}`}>View Table details<ArrowRight aria-hidden="true" /></a>}</div>
    </>}
  </>;
  return state === "unauthenticated"
    ? <InvitationPublicShell invitationId={invitationId}>{content}</InvitationPublicShell>
    : <MemberWorkspaceShell active="requests">{content}</MemberWorkspaceShell>;
}

function InvitationPublicShell({ invitationId, children }: { invitationId: string; children: ReactNode }) {
  const continuation = `/invitations/${encodeURIComponent(invitationId)}`;
  return <main className="product-page member-tables-page public-table-page">
    <header className="product-topbar">
      <a className="brand" href="/" aria-label="Fifth Wheel home"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions"><span className="product-workspace-label">TABLE INVITATION</span><a className="account-action" href={`/sign-in?returnTo=${encodeURIComponent(continuation)}`}>Sign in<ArrowRight aria-hidden="true" /></a></div>
    </header>
    <div className="public-table-content">{children}</div>
  </main>;
}

function InvitationState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <section className="invitation-workspace-state" role="status"><span>{icon}</span><h2>{title}</h2><p>{detail}</p>{action}</section>;
}

export function AdminTableInvitationDeliveryWorkspace() {
  const [state, setState] = useState<InvitationPageState>("loading");
  const [items, setItems] = useState<AdminTableInvitationDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryId, setRetryId] = useState<string | null>(null);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async (next?: string, append = false) => {
    if (!append) setState("loading"); setMessage("");
    try {
      const query = new URLSearchParams({ limit: "25" }); if (next) query.set("cursor", next);
      const response = await fetch(`/api/admin/table-invitations?${query.toString()}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      const result = await requestEnvelope(response, decodeAdminList);
      if (!response.ok || !result) throw new Error("invalid_response");
      if (!result.ok) { setState(result.error.code === "unauthenticated" ? "unauthenticated" : result.error.code === "forbidden" ? "forbidden" : "error"); setMessage(result.error.safeMessage); return; }
      setItems((current) => append ? [...current, ...result.data.items] : [...result.data.items]); setCursor(result.data.nextCursor); setState("ready");
    } catch {
      if (append) setMessage("More delivery records could not be loaded. Current invitation states are unchanged.");
      else { setState("error"); setMessage("Table invitation delivery status is temporarily unavailable. No delivery state was changed."); }
    } finally { setLoadingMore(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function retry(item: AdminTableInvitationDTO) {
    if (item.delivery.state !== "failed" || retryId) return;
    setRetryId(item.invitationId); setMessage("");
    const key = `fw-table-invitation-retry:${item.invitationId}`;
    const operationId = localOperationId(key);
    const requestBody: RetryTableInvitationDeliveryRequest = { operationId, expectedAttemptCount: item.delivery.attemptCount };
    try {
      const response = await fetch(`/api/admin/table-invitations/${encodeURIComponent(item.invitationId)}/retry`, {
        method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(requestBody),
      });
      const result = await requestEnvelope(response, decodeRetry);
      if (response.ok && result?.ok) {
        clearLocalOperationId(key);
        await load();
        setMessage("A new email attempt is queued. This page did not send the email or confirm delivery.");
      } else {
        if (result && !result.ok && !result.error.retryable) clearLocalOperationId(key);
        setMessage(result && !result.ok ? result.error.safeMessage : "The retry outcome could not be confirmed. Refresh before retrying.");
        if (response.status === 409) await load();
      }
    } catch { setMessage("We could not confirm whether the retry was queued. Refresh this invitation before trying again."); }
    finally { setRetryId(null); }
  }

  async function reconcile(item: AdminTableInvitationDTO) {
    if (item.delivery.state !== "unknown" || reconcileId) return;
    setReconcileId(item.invitationId); setMessage("");
    try {
      const response = await fetch(`/api/admin/table-invitations/${encodeURIComponent(item.invitationId)}/reconcile`, {
        method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ expectedAttemptCount: item.delivery.attemptCount }),
      });
      const result = await requestEnvelope(response, decodeReconcile);
      if (response.ok && result?.ok) {
        await load();
        setMessage(result.data.deliveryState === "accepted"
          ? "The email service accepted this existing attempt. No email was sent again, and delivery to the inbox is not confirmed."
          : "The email status is still unclear. No email was sent again, and this invitation remains active.");
      } else {
        setMessage(result && !result.ok ? result.error.safeMessage : "We could not confirm the email status. No email was sent again.");
        if (response.status === 409) await load();
      }
    } catch {
      setMessage("We could not confirm the email status. No email was sent again.");
    } finally { setReconcileId(null); }
  }

  return <main className="product-page table-invitation-admin-page">
    <header className="product-topbar"><a className="brand" href="/admin/table-invitations" aria-label="Fifth Wheel admin Table invitation delivery"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a><div className="product-topbar-actions"><span className="product-workspace-label">ADMIN WORKSPACE</span><SignOutButton /></div></header>
    <div className="product-layout"><aside className="product-sidebar" aria-label="Admin navigation"><span className="sidebar-caption">WORKSPACE</span>
      <p className="group-label">PEOPLE</p><a className="member-nav-link" href="/admin/waitlist"><UsersRound aria-hidden="true" />Waitlist</a><a className="member-nav-link" href="/admin/identity-review"><ShieldCheck aria-hidden="true" />Identity review</a><a className="member-nav-link" href="/admin/seat-requests"><UsersRound aria-hidden="true" />Seat requests</a>
      <p className="group-label">TABLE OPERATIONS</p><a className="member-nav-link active" aria-current="page" href="/admin/table-invitations"><Ticket aria-hidden="true" />Table invitation delivery</a><a className="member-nav-link" href="/admin/tables"><Table2 aria-hidden="true" />Tables</a>
      <p className="group-label">MONEY</p><a className="member-nav-link" href="/admin/cancellations">Cancellations</a>
      <div className="product-sidebar-foot"><ShieldCheck aria-hidden="true" /><span>Retry queues delivery work; it never changes offer approval or payment state.</span></div>
    </aside><section className="product-content">
      <div className="product-breadcrumb">Operations<span>›</span>Table invitation delivery</div>
      <div className="page-heading-row table-invitation-admin-heading"><div><p className="eyebrow">OPERATIONS · EMAIL STATUS</p><h1>Table invitations</h1><p className="page-intro">Check email attempts for approved Table invitations. An email service accepting a message does not confirm it reached the inbox. This page queues retries; it does not send email itself.</p></div><button className="icon-action" type="button" aria-label="Refresh invitations" onClick={() => void load()} disabled={state === "loading"}><RefreshCw aria-hidden="true" /></button></div>
      {message && <div className="table-invitation-alert" role="status"><CircleAlert aria-hidden="true" />{message}</div>}
      {state === "loading" && <InvitationState icon={<LoaderCircle className="spin" />} title="Loading invitations" detail="Checking current delivery states." />}
      {state === "unauthenticated" && <InvitationState icon={<ShieldCheck />} title="Sign in to continue" detail="Delivery recovery is available to authorized administrators." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fadmin%2Ftable-invitations">Sign in<ArrowRight aria-hidden="true" /></a>} />}
      {state === "forbidden" && <InvitationState icon={<ShieldCheck />} title="Administrator access required" detail={message || "This queue is restricted to authorized administrators."} />}
      {state === "error" && <InvitationState icon={<CircleAlert />} title="Delivery queue unavailable" detail={message || "Try again shortly."} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
      {state === "ready" && items.length === 0 && <InvitationState icon={<Mail />} title="No Table invitation deliveries" detail="When a roster is approved, its invitation delivery records appear here. No sample records are shown." />}
      {state === "ready" && items.length > 0 && <div className="admin-invitation-list">{items.map((item) => {
        const delivery = deliveryCopy(item.delivery.state);
        return <article className="admin-invitation-card" key={item.invitationId}>
          <div className="admin-invitation-main"><span className="admin-invitation-icon"><Ticket aria-hidden="true" /></span><div><p className="eyebrow">{item.invitationState === "active" ? "ACTIVE TABLE INVITATION" : item.invitationState === "revoked" ? "REVOKED INVITATION" : "CLOSED INVITATION"}</p><h2>{item.guest.displayName}</h2><p className="table-card-meta"><Table2 aria-hidden="true" />{item.table.title}<span>·</span><CalendarDays aria-hidden="true" />{dateLabel(item.table.localDate)}<span>·</span><MapPin aria-hidden="true" />{item.table.neighborhood}</p></div></div>
          <div className={`admin-invitation-delivery tone-${delivery.tone}`}><strong>{delivery.label}</strong><span>{delivery.detail}</span><small>{item.delivery.attemptCount} {item.delivery.attemptCount === 1 ? "attempt" : "attempts"}{item.delivery.lastAttemptAt ? ` · last ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.delivery.lastAttemptAt))}` : " · no attempt yet"}</small></div>
          {item.delivery.safeErrorCode && <p className="admin-invitation-safe-error">Latest safe delivery code: {item.delivery.safeErrorCode.replaceAll("_", " ")}</p>}
          <details className="admin-invitation-attempts"><summary>Attempt history <span>({item.attempts.length})</span></summary><ol>{item.attempts.map((attempt) => <li key={attempt.attemptNumber}><span>Attempt {attempt.attemptNumber} · {attempt.state}</span><time>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.startedAt))}</time>{attempt.safeErrorCode && <small>{attempt.safeErrorCode.replaceAll("_", " ")}</small>}</li>)}</ol></details>
          {item.delivery.state === "failed" ? <button className="button button-outline admin-invitation-retry" type="button" onClick={() => void retry(item)} disabled={retryId === item.invitationId || item.invitationState !== "active"}>{retryId === item.invitationId ? <LoaderCircle className="spin" /> : <RefreshCw />}{retryId === item.invitationId ? "Queueing retry…" : "Queue delivery retry"}</button>
              : item.delivery.state === "unknown" ? <><p className="admin-invitation-recovery-note"><CircleAlert aria-hidden="true" />We could not confirm the email status. Check this existing attempt before trying again; this check will not send another email.</p><button className="button button-outline admin-invitation-retry" type="button" onClick={() => void reconcile(item)} disabled={reconcileId === item.invitationId}>{reconcileId === item.invitationId ? <LoaderCircle className="spin" /> : <RefreshCw />}{reconcileId === item.invitationId ? "Checking email…" : "Check email status"}</button></>
              : null}
          {item.delivery.state === "failed" && <p className="admin-invitation-recovery-note"><Mail aria-hidden="true" />Retry queues a new delivery attempt. It does not send email inline or change the invitation.</p>}
        </article>;
      })}</div>}
      {state === "ready" && cursor && <div className="table-load-more"><button className="button button-outline" type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); void load(cursor, true); }}>{loadingMore ? "Loading more…" : "Load more"}<ArrowRight aria-hidden="true" /></button></div>}
    </section></div>
  </main>;
}

function localOperationId(key: string) {
  try { const existing = sessionStorage.getItem(key); if (existing && uuidPattern.test(existing)) return existing; const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id; }
  catch { return crypto.randomUUID(); }
}
function clearLocalOperationId(key: string) { try { sessionStorage.removeItem(key); } catch { /* Best effort. */ } }
