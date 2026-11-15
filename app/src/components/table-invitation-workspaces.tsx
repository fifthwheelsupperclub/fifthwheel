import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageState } from "./ui/page-state";
import { clockAfter, eventDate, eventTime, eventWhen, timestamp } from "../format/datetime";
import { PageHeader } from "./ui/page-header";
import { AppShell } from "./app-shell";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleAlert, Clock3, LoaderCircle, Mail, MapPin, RefreshCw, ShieldCheck, Table2, Ticket, UserRound, UsersRound } from "lucide-react";
import { MemberWorkspaceShell } from "./member-tables-workspace.tsx";
import { MemberCheckoutWorkspace } from "./member-checkout-workspace.tsx";
import type {
  AdminTableInvitationDTO, AdminTableInvitationListDTO, MemberTableInvitationDetailDTO,
  ReconcileTableInvitationDeliveryResultDTO, RetryTableInvitationDeliveryRequest, RetryTableInvitationDeliveryResultDTO, TableInvitationDeliveryState,
  TableInvitationErrorCode, TableInvitationResponse, TableInvitationState,
} from "../table-invitations.contract.ts";
import { RemoveGuestAction } from "./ops-workspaces.tsx";
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
const dateLabel = (value: string) => eventDate(value.slice(0, 10), { long: true });
const timeLabel = (value: string) => eventTime(value);
function deliveryCopy(state: TableInvitationDeliveryState): Readonly<{ label: string; detail: string; tone: DeliveryTone }> {
  switch (state) {
    case "queued": return { label: "Waiting to send", detail: "The invitation is active.", tone: "neutral" };
    case "sending": return { label: "Sending", detail: "The invitation is active.", tone: "neutral" };
    case "accepted": return { label: "Sent", detail: "Resend accepted it. Delivery isn’t confirmed.", tone: "good" };
    case "delivered": return { label: "Delivered", detail: "Resend reports this email was delivered.", tone: "good" };
    case "failed": return { label: "Not sent", detail: "The invitation is still active. Safe to send again.", tone: "bad" };
    case "unknown": return { label: "Unconfirmed", detail: "We don’t know whether it was sent. Check status before sending again.", tone: "warning" };
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

  const content = <>
    <Link to="/requests" className="page-header-back"><ArrowLeft aria-hidden="true" />Requests</Link>
    {state === "loading" && <PageState variant="loading" title="Loading…" />}
    {state === "unauthenticated" && <PageState variant="signed-out" title="Sign in to continue" message="Sign in with the email the invitation was sent to." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/invitations/${invitationId}`)}`}>Continue to sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <PageState variant="no-access" title="This invitation is for a different account" message="Sign in with the email the invitation was sent to." action={<Link className="button button-outline" to="/requests">Back to Requests</Link>} />}
    {state === "not_found" && <PageState variant="empty" title="Invitation not found" message="This invitation is not available to the current account." action={<Link className="button button-outline" to="/requests">Back to Requests</Link>} />}
    {state === "error" && <PageState variant="error" title="Invitation details are temporarily unavailable" message={message || "Try again shortly."} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again</button>} />}
    {state === "ready" && detail && <>
      <PageHeader className="invitation-member-heading" title={`You’re invited to ${detail.table.title}`} description={`${eventWhen(detail.table.localDate, detail.table.startLocalTime)} · ${detail.table.neighborhood}`} />
      <div className="invitation-member-grid">
        <section className="invitation-member-card"><h2>Your seat</h2><p>{detail.state === "active" ? `Pay to confirm your seat at ${detail.table.title}.` : invitationStateText(detail.state)}</p><MemberCheckoutWorkspace invitationId={invitationId} /></section>
      </div>
      <section className="invitation-itinerary-section">
        <div className="invitation-itinerary-head"><h2>Evening itinerary</h2>{detail.table.itineraryAvailable && <a className="button button-tertiary" href={`/tables/${encodeURIComponent(detail.table.tableId)}`}>Full details</a>}</div>
        {detail.table.itineraryAvailable ? <ol className="invitation-stops">{detail.table.stops.map((stop, index) => <li key={`${stop.role}-${index}`}><span className="invitation-stop-number">0{index + 1}</span><div><p className="eyebrow">{stop.role.charAt(0).toUpperCase() + stop.role.slice(1)} · {clockAfter(detail.table.startLocalTime, stop.minutesFromStart)}</p><h3>{stop.venueName}</h3><p>{stop.venueAddress}</p>{stop.publicNotes && <small>{stop.publicNotes}</small>}</div></li>)}</ol>
          : <p className="invitation-itinerary-unavailable">The full plan isn’t available right now. Your invitation is still here.</p>}
      </section>
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
      <div className="product-topbar-actions"><a className="account-action" href={`/sign-in?returnTo=${encodeURIComponent(continuation)}`}>Sign in<ArrowRight aria-hidden="true" /></a></div>
    </header>
    <div className="public-table-content">{children}</div>
  </main>;
}

function InvitationState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return <section className="invitation-workspace-state" role="status"><span>{icon}</span><h2>{title}</h2>{detail && <p>{detail}</p>}{action}</section>;
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
      if (append) setMessage("We couldn’t load more. Nothing has changed.");
      else { setState("error"); setMessage("We couldn’t load invitation emails. Nothing has changed."); }
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
        setMessage("Queued to send again.");
      } else {
        if (result && !result.ok && !result.error.retryable) clearLocalOperationId(key);
        setMessage(result && !result.ok ? result.error.safeMessage : "We’re not sure that worked. Refresh and try again.");
        if (response.status === 409) await load();
      }
    } catch { setMessage("We’re not sure that worked. Refresh and try again."); }
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
          ? "Sent (checked; nothing was resent)."
          : "Still unconfirmed. Nothing was resent.");
      } else {
        setMessage(result && !result.ok ? result.error.safeMessage : "Couldn’t check. Nothing was resent.");
        if (response.status === 409) await load();
      }
    } catch {
      setMessage("Couldn’t check. Nothing was resent.");
    } finally { setReconcileId(null); }
  }

  return <AppShell role="admin" active="invitations" className="table-invitation-admin-page">
      <PageHeader className="table-invitation-admin-heading" title="Invitation emails" description="Status of each invitation email. “Sent” means Resend accepted it, not that it reached the inbox." actions={<button className="icon-action" type="button" aria-label="Refresh invitations" onClick={() => void load()} disabled={state === "loading"}><RefreshCw aria-hidden="true" /></button>} />
      {message && <div className="table-invitation-alert" role="status"><CircleAlert aria-hidden="true" />{message}</div>}
      {state === "loading" && <InvitationState icon={<LoaderCircle className="spin" />} title="Loading…" />}
      {state === "unauthenticated" && <InvitationState icon={<ShieldCheck />} title="Sign in to continue" detail="Sign in to see this page." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fadmin%2Ftable-invitations">Sign in<ArrowRight aria-hidden="true" /></a>} />}
      {state === "forbidden" && <InvitationState icon={<ShieldCheck />} title="You don’t have access to this page" detail={message || "Only admins can do this."} />}
      {state === "error" && <InvitationState icon={<CircleAlert />} title="We couldn’t load invitation emails" detail={message || "Try again in a moment."} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
      {state === "ready" && items.length === 0 && <InvitationState icon={<Mail />} title="No invitation emails yet" detail="They appear here once a roster is approved." />}
      {state === "ready" && items.length > 0 && <div className="admin-invitation-list">{items.map((item) => {
        const delivery = deliveryCopy(item.delivery.state);
        return <article className="admin-invitation-card" key={item.invitationId}>
          <div className="admin-invitation-main"><span className="admin-invitation-icon"><Ticket aria-hidden="true" /></span><div><p className="eyebrow">{item.invitationState === "active" ? "OPEN" : item.invitationState === "revoked" ? "WITHDRAWN" : "CLOSED"}</p><h2>{item.guest.displayName}</h2><p className="table-card-meta"><Table2 aria-hidden="true" />{item.table.title}<span>·</span><CalendarDays aria-hidden="true" />{dateLabel(item.table.localDate)}<span>·</span><MapPin aria-hidden="true" />{item.table.neighborhood}</p></div></div>
          <div className={`admin-invitation-delivery tone-${delivery.tone}`}><strong>{delivery.label}</strong><span>{delivery.detail}</span><small>{item.delivery.attemptCount} {item.delivery.attemptCount === 1 ? "attempt" : "attempts"}{item.delivery.lastAttemptAt ? ` · last ${timestamp(item.delivery.lastAttemptAt)}` : " · not sent yet"}</small></div>
          {item.delivery.safeErrorCode && <p className="admin-invitation-safe-error">Error code: {item.delivery.safeErrorCode.replaceAll("_", " ")}</p>}
          <details className="admin-invitation-attempts"><summary>History <span>({item.attempts.length})</span></summary><ol>{item.attempts.map((attempt) => <li key={attempt.attemptNumber}><span>Attempt {attempt.attemptNumber} · {attempt.state}</span><time>{timestamp(attempt.startedAt)}</time>{attempt.safeErrorCode && <small>{attempt.safeErrorCode.replaceAll("_", " ")}</small>}</li>)}</ol></details>
          {item.delivery.state === "failed" ? <button className="button button-outline admin-invitation-retry" type="button" onClick={() => void retry(item)} disabled={retryId === item.invitationId || item.invitationState !== "active"}>{retryId === item.invitationId ? <LoaderCircle className="spin" /> : <RefreshCw />}{retryId === item.invitationId ? "Sending…" : "Send again"}</button>
              : item.delivery.state === "unknown" ? <><p className="admin-invitation-recovery-note"><CircleAlert aria-hidden="true" />We don’t know if this was sent. Checking won’t send another email.</p><button className="button button-outline admin-invitation-retry" type="button" onClick={() => void reconcile(item)} disabled={reconcileId === item.invitationId}>{reconcileId === item.invitationId ? <LoaderCircle className="spin" /> : <RefreshCw />}{reconcileId === item.invitationId ? "Checking…" : "Check status"}</button></>
              : null}
          {item.delivery.state === "failed" && <p className="admin-invitation-recovery-note"><Mail aria-hidden="true" /></p>}
          {item.invitationState === "active" && <RemoveGuestAction invitationId={item.invitationId} guestName={item.guest.displayName} onDone={() => void load()} />}
        </article>;
      })}</div>}
      {state === "ready" && cursor && <div className="table-load-more"><button className="button button-outline" type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); void load(cursor, true); }}>{loadingMore ? "Loading…" : "Show more"}<ArrowRight aria-hidden="true" /></button></div>}
  </AppShell>;
}

function localOperationId(key: string) {
  try { const existing = sessionStorage.getItem(key); if (existing && uuidPattern.test(existing)) return existing; const id = crypto.randomUUID(); sessionStorage.setItem(key, id); return id; }
  catch { return crypto.randomUUID(); }
}
function clearLocalOperationId(key: string) { try { sessionStorage.removeItem(key); } catch { /* Best effort. */ } }
