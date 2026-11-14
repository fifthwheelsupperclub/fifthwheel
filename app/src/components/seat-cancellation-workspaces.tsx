import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { StaffSidebar } from "./staff-nav";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck, Ticket, UserRound, Wallet } from "lucide-react";
import { MemberWorkspaceShell } from "./member-tables-workspace.tsx";
import { SignOutButton } from "./sign-out-button.tsx";
import type {
  AdminCancellationDetailDTO, AdminCancellationQueueDTO, AdminCancellationQueueItemDTO,
  CancellationErrorCode, CancellationResponse, DecideCancellationInput, MemberCancellationHistoryDTO,
  MemberCancellationRequestDTO, RequestAvailabilityDTO, RequestAvailabilityReason,
} from "../seat-cancellation.contract.ts";
import "./seat-cancellation-workspaces.css";

type ViewState = "loading" | "ready" | "unauthenticated" | "forbidden" | "not_found" | "error";
type Envelope<T> = CancellationResponse<T>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestStates = new Set<MemberCancellationRequestDTO["state"]>(["pending", "approved", "denied"]);
const seatStates = new Set<MemberCancellationHistoryDTO["seatState"]>(["confirmed", "cancellation_requested", "cancelled", "completed"]);
const availabilityReasons = new Set<RequestAvailabilityReason>(["available", "request_pending", "seat_not_active", "payment_unresolved", "table_closed"]);

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isSafeString(value: unknown, max = 2_000): value is string { return typeof value === "string" && value.length <= max; }
function parseRequest(value: unknown): MemberCancellationRequestDTO | null {
  if (!isRecord(value) || !uuid.test(String(value.requestId ?? "")) || !uuid.test(String(value.seatId ?? ""))
    || !requestStates.has(value.state as MemberCancellationRequestDTO["state"]) || !Number.isSafeInteger(value.version) || Number(value.version) < 1
    || !isDate(value.requestedAt) || !(value.decidedAt === null || isDate(value.decidedAt))
    || !(value.memberReason === null || isSafeString(value.memberReason)) || !(value.memberSafeReason === null || isSafeString(value.memberSafeReason, 500))
    || !(value.refundCents === null || Number.isSafeInteger(value.refundCents) && Number(value.refundCents) >= 0 && Number(value.refundCents) <= 2500)) return null;
  return value as unknown as MemberCancellationRequestDTO;
}
function parseAvailability(value: unknown): RequestAvailabilityDTO | null {
  if (!isRecord(value) || typeof value.canRequest !== "boolean" || !availabilityReasons.has(value.reason as RequestAvailabilityReason)) return null;
  if (value.canRequest !== (value.reason === "available")) return null;
  return value as unknown as RequestAvailabilityDTO;
}
function parseMemberHistory(value: unknown): MemberCancellationHistoryDTO | null {
  if (!isRecord(value) || !seatStates.has(value.seatState as MemberCancellationHistoryDTO["seatState"])
    || !Array.isArray(value.items) || value.nextCursor !== null) return null;
  const items = value.items.map(parseRequest);
  const requestAvailability = parseAvailability(value.requestAvailability);
  if (items.some((item) => !item) || !requestAvailability) return null;
  return { seatState: value.seatState as MemberCancellationHistoryDTO["seatState"], items: items as MemberCancellationRequestDTO[], nextCursor: null, requestAvailability };
}
function parseQueueItem(value: unknown, requirePending = true): AdminCancellationQueueItemDTO | null {
  if (!isRecord(value) || !isRecord(value.request) || !isRecord(value.member) || !isRecord(value.table) || !isRecord(value.seat)) return null;
  const request = parseRequest(value.request);
  const { member, table, seat } = value;
  if (!request || !uuid.test(String(member.guestId ?? "")) || typeof member.displayName !== "string" || !member.displayName.trim()
    || !uuid.test(String(table.tableId ?? "")) || typeof table.title !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(String(table.localDate))
    || typeof table.startLocalTime !== "string" || !/^\d{2}:\d{2}$/.test(table.startLocalTime)
    || !uuid.test(String(seat.seatId ?? "")) || !["confirmed", "cancellation_requested", "cancelled", "completed"].includes(String(seat.state))
    || !isDate(seat.paidAt) || seat.amountCents !== 2500 || !Number.isSafeInteger(seat.refundAvailableCents)
    || Number(seat.refundAvailableCents) < 0 || Number(seat.refundAvailableCents) > 2500) return null;
  if (requirePending && request.state !== "pending") return null;
  return value as unknown as AdminCancellationQueueItemDTO;
}
function parseQueue(value: unknown): AdminCancellationQueueDTO | null {
  if (!isRecord(value) || !Array.isArray(value.items) || !(value.nextCursor === null || typeof value.nextCursor === "string")) return null;
  const items = value.items.map((item) => parseQueueItem(item));
  if (items.some((item) => !item)) return null;
  return { items: items as AdminCancellationQueueItemDTO[], nextCursor: value.nextCursor as string | null };
}
function parseAdminDetail(value: unknown): AdminCancellationDetailDTO | null {
  const item = parseQueueItem(value, false);
  if (!item || !isRecord(value) || !isRecord(value.refundBalance)) return null;
  const balance = value.refundBalance;
  if (balance.paidCents !== 2500 || !Number.isSafeInteger(balance.refundCommittedCents) || Number(balance.refundCommittedCents) < 0
    || Number(balance.refundCommittedCents) > 2500 || !Number.isSafeInteger(balance.refundAvailableCents)
    || Number(balance.refundAvailableCents) < 0 || Number(balance.refundAvailableCents) > 2500
    || Number(balance.refundCommittedCents) + Number(balance.refundAvailableCents) > 2500) return null;
  return value as unknown as AdminCancellationDetailDTO;
}
function parseEnvelope<T>(value: unknown, parse: (data: unknown) => T | null): Envelope<T> | null {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.correlationId !== "string") return null;
  if (value.ok) { const data = parse(value.data); return data === null ? null : { ok: true, data, correlationId: value.correlationId }; }
  if (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.safeMessage !== "string"
    || typeof value.error.retryable !== "boolean" || typeof value.error.correlationId !== "string") return null;
  return { ok: false, correlationId: value.correlationId, error: { code: value.error.code as CancellationErrorCode, safeMessage: value.error.safeMessage,
    retryable: value.error.retryable, correlationId: value.error.correlationId } };
}
async function getJson<T>(url: string, parse: (data: unknown) => T | null): Promise<{ response: Response; envelope: Envelope<T> | null }> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  return { response, envelope: parseEnvelope(await response.json().catch(() => null), parse) };
}
function money(cents: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function dateLabel(value: string): string { return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short" }).format(new Date(value)); }
function requestReason(reason: RequestAvailabilityReason): string {
  switch (reason) {
    case "available": return "You can request cancellation for this active Seat.";
    case "request_pending": return "Your request is already being reviewed.";
    case "seat_not_active": return "This Seat is no longer active, so a new request cannot be made.";
    case "payment_unresolved": return "We’re still confirming your payment. You can request cancellation once we know its status.";
    case "table_closed": return "This Table is complete or cancelled, so new cancellation requests are closed.";
  }
}
function stateTitle(state: MemberCancellationRequestDTO["state"]): string {
  switch (state) { case "pending": return "Request under review"; case "approved": return "Cancellation approved"; case "denied": return "Request declined"; }
}
function adminSeatStatusLabel(state: AdminCancellationQueueItemDTO["seat"]["state"]): string {
  switch (state) {
    case "confirmed": return "Seat active";
    case "cancellation_requested": return "Cancellation requested";
    case "completed": return "Table completed";
    case "cancelled": return "Table cancelled";
  }
}
function denialSeatOutcome(state: AdminCancellationQueueItemDTO["seat"]["state"]): string {
  switch (state) {
    case "completed": return "Denying leaves the Seat marked as completed.";
    case "cancelled": return "Denying leaves the Seat marked as cancelled.";
    case "confirmed":
    case "cancellation_requested": return "Denying leaves the Seat active.";
  }
}
function deniedSeatHeading(state: AdminCancellationQueueItemDTO["seat"]["state"]): string {
  switch (state) {
    case "completed": return "Request denied · Seat remains completed";
    case "cancelled": return "Request denied · Seat remains cancelled";
    case "confirmed":
    case "cancellation_requested": return "Request denied · Seat remains active";
  }
}
function denialButtonLabel(state: AdminCancellationQueueItemDTO["seat"]["state"]): string {
  switch (state) {
    case "completed": return "Deny · keep Seat completed";
    case "cancelled": return "Deny · keep Seat cancelled";
    case "confirmed":
    case "cancellation_requested": return "Deny · keep Seat active";
  }
}

export function MemberSeatCancellationWorkspace({ seatId }: { seatId: string }) {
  const [state, setState] = useState<ViewState>("loading");
  const [data, setData] = useState<MemberCancellationHistoryDTO | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const { response, envelope } = await getJson(`/api/me/seats/${encodeURIComponent(seatId)}/cancellation-requests`, parseMemberHistory);
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      if (response.status === 404) { setState("not_found"); return; }
      if (!response.ok || !envelope) throw new Error("Cancellation status could not be read.");
      if (!envelope.ok) { setState(envelope.error.code === "unauthenticated" ? "unauthenticated" : envelope.error.code === "forbidden" ? "forbidden" : envelope.error.code === "not_found" ? "not_found" : "error"); setMessage(envelope.error.safeMessage); return; }
      setData(envelope.data); setState("ready");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation status is temporarily unavailable."); setState("error"); }
  }, [seatId]);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const body: { operationId: string; memberReason?: string } = { operationId: crypto.randomUUID() };
      if (reason.trim()) body.memberReason = reason.trim();
      const response = await fetch(`/api/me/seats/${encodeURIComponent(seatId)}/cancellation-requests`, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
      const envelope = parseEnvelope(await response.json().catch(() => null), parseRequest);
      if (!response.ok || !envelope) throw new Error("We could not confirm the cancellation request. Refresh to check its saved status.");
      if (!envelope.ok) { setMessage(envelope.error.safeMessage); return; }
      setReason(""); await load(); setMessage("Your request was saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "We could not confirm the cancellation request."); }
    finally { setBusy(false); }
  };
  const pendingRequest = data?.items.find((item) => item.state === "pending") ?? null;
  return <MemberWorkspaceShell active="seats"><main className="cancellation-page">
    <div className="product-breadcrumb"><Link to="/my-seats/$seatId" params={{ seatId }}>My Seats</Link><span>›</span><span>Cancellation request</span></div>
    {state === "loading" && <CancellationState icon={<LoaderCircle className="member-seat-spin" />} title="Loading cancellation status" detail="Checking your saved request and Seat availability." />}
    {state === "unauthenticated" && <CancellationState icon={<ShieldCheck />} title="Sign in to continue" detail="Cancellation requests are private to the member account that owns this Seat." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/my-seats/${seatId}/cancellation`)}`}>Sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <CancellationState icon={<ShieldCheck />} title="This Seat is not available to this account" detail="Check that you signed in with the member account that owns this Seat." />}
    {state === "not_found" && <CancellationState icon={<Ticket />} title="Seat not found" detail="This Seat is not available to the current account." action={<Link className="button button-outline" to="/my-seats">Back to My Seats</Link>} />}
    {state === "error" && <CancellationState icon={<AlertCircle />} title="Cancellation status is unavailable" detail={message} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && data && <>
      <header className="cancellation-heading"><p className="eyebrow">YOUR SEAT</p><h1>Cancellation request</h1><p>Ask the team to review your Seat. You will see their decision here.</p></header>
      {pendingRequest && <section className="cancellation-retention-note" role="note"><CheckCircle2 aria-hidden="true" /><div>{data.seatState === "completed" ? <><strong>The Table is complete.</strong><p>Your cancellation request remains under review.</p></> : data.seatState === "cancelled" ? <><strong>The Table and your Seat have been cancelled.</strong><p>Your cancellation request remains under review.</p></> : <><strong>Your Seat stays active while your request is reviewed.</strong><p>You remain eligible for check-in and voting until the team approves its removal.</p></>}</div></section>}
      {message && <p className="cancellation-alert" role="status"><CheckCircle2 aria-hidden="true" />{message}</p>}
      {data.items.length > 0 && <section className="cancellation-request-card"><p className="eyebrow">REQUEST HISTORY</p><h2>{pendingRequest ? "Request history" : "Previous requests"}</h2><ol className="cancellation-history">{data.items.map((item) => <li key={item.requestId}><div className="cancellation-history-heading"><strong>{stateTitle(item.state)}</strong><time dateTime={item.requestedAt}>{dateLabel(item.requestedAt)}</time></div>{item.memberReason && <div className="cancellation-reason"><strong>Your note</strong><p>{item.memberReason}</p></div>}{item.memberSafeReason && <div className="cancellation-reason"><strong>Team response</strong><p>{item.memberSafeReason}</p></div>}{item.state === "approved" && <ApprovedRefundMessage refundCents={item.refundCents} />}</li>)}</ol></section>}
      {data.requestAvailability.canRequest ? <section className="cancellation-request-card"><p className="eyebrow">REQUEST A REVIEW</p><h2>{data.items.length > 0 ? "Request another review" : "Ask to cancel this Seat"}</h2><p>The team will decide whether to keep your Seat or remove it, and whether any refund is owed.</p><div className="cancellation-availability available" role="status"><Clock3 aria-hidden="true" />{requestReason(data.requestAvailability.reason)}</div><form onSubmit={submit} className="cancellation-form"><label htmlFor="cancellation-member-reason">Optional note to the team</label><textarea id="cancellation-member-reason" rows={4} maxLength={2000} value={reason} onChange={(event) => setReason(event.currentTarget.value)} placeholder="Share any context that may help with the review." /><span className="cancellation-count">{reason.length}/2000</span><button className="button button-primary" type="submit" disabled={busy || Boolean(pendingRequest)}>{busy ? <LoaderCircle className="member-seat-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{busy ? "Sending request…" : "Submit cancellation request"}</button></form></section> : !pendingRequest && <section className="cancellation-request-card"><p className="eyebrow">REQUEST AVAILABILITY</p><h2>No new request available</h2><div className="cancellation-availability unavailable" role="status"><Clock3 aria-hidden="true" />{requestReason(data.requestAvailability.reason)}</div></section>}
      <div className="cancellation-footer-actions"><Link className="button button-outline" to="/my-seats/$seatId" params={{ seatId }}><ArrowLeft aria-hidden="true" />Back to Seat details</Link><button className="button button-outline" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />Refresh status</button></div>
    </>}
  </main></MemberWorkspaceShell>;
}

function ApprovedRefundMessage({ refundCents }: { refundCents: number | null }) {
  if (refundCents === null) return <p className="cancellation-retained">The team approved removing your Seat. Your refund amount is still being confirmed.</p>;
  if (refundCents === 0) return <p className="cancellation-retained">The team approved removing your Seat and decided not to issue a refund.</p>;
  return <p className="cancellation-retained">The team approved removing your Seat and recorded a {money(refundCents)} refund to be sent. This does not confirm that the money has reached your account. Check My Seats for the refund status.</p>;
}

export function AdminCancellationsQueue() {
  const [state, setState] = useState<ViewState>("loading");
  const [data, setData] = useState<AdminCancellationQueueDTO | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async (cursor?: string) => {
    setState("loading"); setMessage("");
    try {
      const query = new URLSearchParams({ limit: "50" }); if (cursor) query.set("cursor", cursor);
      const { response, envelope } = await getJson(`/api/admin/cancellations?${query}`, parseQueue);
      if (response.status === 401) { setState("unauthenticated"); return; } if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok || !envelope) throw new Error("The cancellation queue could not be read.");
      if (!envelope.ok) { setState(envelope.error.code === "unauthenticated" ? "unauthenticated" : envelope.error.code === "forbidden" ? "forbidden" : "error"); setMessage(envelope.error.safeMessage); return; }
      setData(envelope.data); setState("ready");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The cancellation queue is temporarily unavailable."); setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <AdminCancellationShell active="queue"><main className="cancellation-admin-page">
    <div className="product-breadcrumb"><span>ADMIN WORKSPACE</span><span>›</span><span>Cancellations</span></div>
    <header className="cancellation-heading"><p className="eyebrow">MONEY · REVIEW</p><h1>Cancellation requests</h1><p>Review the request, confirm whether to keep or remove the Seat, then record the refund decision.</p></header>
    {state === "loading" && <CancellationState icon={<LoaderCircle className="member-seat-spin" />} title="Loading requests" detail="Reading the current cancellation queue." />}
    {state === "unauthenticated" && <CancellationState icon={<ShieldCheck />} title="Sign in to continue" detail="This queue is available to authorized administrators only." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fadmin%2Fcancellations">Sign in</a>} />}
    {state === "forbidden" && <CancellationState icon={<ShieldCheck />} title="Administrator access is required" detail="Hosts cannot approve Seat removals or make refund decisions." />}
    {state === "error" && <CancellationState icon={<AlertCircle />} title="Cancellation queue is unavailable" detail={message} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && data && <>{message && <p className="cancellation-alert" role="status">{message}</p>}<section className="cancellation-admin-list" aria-label="Pending cancellation requests">{data.items.length === 0 ? <div className="cancellation-empty"><CheckCircle2 aria-hidden="true" /><h2>No pending requests</h2><p>New member requests will appear here.</p></div> : data.items.map((item) => <AdminCancellationCard key={item.request.requestId} item={item} />)}</section>{data.nextCursor && <button className="button button-outline" type="button" onClick={() => void load(data.nextCursor!)}>Load more<ArrowRight aria-hidden="true" /></button>}</>}
  </main></AdminCancellationShell>;
}

function AdminCancellationCard({ item }: { item: AdminCancellationQueueItemDTO }) {
  return <article className="cancellation-admin-card"><div className="cancellation-admin-card-main"><span className="cancellation-admin-avatar"><UserRound aria-hidden="true" /></span><div><p className="eyebrow">REQUESTED {new Date(item.request.requestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p><h2>{item.member.displayName}</h2><p>{item.table.title} · {item.table.localDate} · {item.table.startLocalTime}</p><p className="cancellation-admin-seat"><Ticket aria-hidden="true" />{adminSeatStatusLabel(item.seat.state)} · Paid {money(item.seat.amountCents)} · Max refund {money(item.seat.refundAvailableCents)}</p></div></div><Link className="button button-outline" to="/admin/cancellations/$requestId" params={{ requestId: item.request.requestId }}>Review request<ArrowRight aria-hidden="true" /></Link></article>;
}

export function AdminCancellationDetail({ requestId }: { requestId: string }) {
  const [state, setState] = useState<ViewState>("loading");
  const [data, setData] = useState<AdminCancellationDetailDTO | null>(null);
  const [decision, setDecision] = useState<"approve" | "deny" | null>(null);
  const [refundChoice, setRefundChoice] = useState<"none" | "full" | "partial" | null>(null);
  const [partialDollars, setPartialDollars] = useState("");
  const [safeReason, setSafeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const { response, envelope } = await getJson(`/api/admin/cancellations/${encodeURIComponent(requestId)}`, parseAdminDetail);
      if (response.status === 401) { setState("unauthenticated"); return; } if (response.status === 403) { setState("forbidden"); return; } if (response.status === 404) { setState("not_found"); return; }
      if (!response.ok || !envelope) throw new Error("The cancellation request could not be read.");
      if (!envelope.ok) { setState(envelope.error.code === "unauthenticated" ? "unauthenticated" : envelope.error.code === "forbidden" ? "forbidden" : envelope.error.code === "not_found" ? "not_found" : "error"); setMessage(envelope.error.safeMessage); return; }
      setData(envelope.data); setState("ready"); setDecision(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The cancellation request is temporarily unavailable."); setState("error"); }
  }, [requestId]);
  useEffect(() => { void load(); }, [load]);
  const amount = data ? refundChoice === "none" ? 0 : refundChoice === "full" ? data.refundBalance.refundAvailableCents : parseDollars(partialDollars) : 0;
  const submitDecision = async () => {
    if (!data || !decision || safeReason.trim().length < 3 || decision === "approve" && (amount < 0 || amount > data.refundBalance.refundAvailableCents)) return;
    setBusy(true); setMessage("");
    const body: DecideCancellationInput = { operationId: crypto.randomUUID(), expectedVersion: data.request.version, decision,
      refundCents: decision === "deny" ? 0 : amount, memberSafeReason: safeReason.trim() };
    try {
      const response = await fetch(`/api/admin/cancellations/${encodeURIComponent(requestId)}/decision`, { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
      const envelope = parseEnvelope(await response.json().catch(() => null), (value) => isRecord(value) ? value : null);
      if (!response.ok || !envelope) throw new Error("We could not confirm the decision. Refresh to check the saved request.");
      if (!envelope.ok) { setMessage(envelope.error.safeMessage); setDecision(null); return; }
      setSafeReason(""); setDecision(null); await load(); setMessage("The decision was saved. If a refund was approved, this records the amount to be paid; it does not send money.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The decision outcome could not be confirmed."); }
    finally { setBusy(false); }
  };
  return <AdminCancellationShell active="detail"><main className="cancellation-admin-page">
    <div className="product-breadcrumb"><Link to="/admin/cancellations">Cancellations</Link><span>›</span><span>Review request</span></div>
    {state === "loading" && <CancellationState icon={<LoaderCircle className="member-seat-spin" />} title="Loading request" detail="Checking the latest request and refund amount." />}
    {state === "unauthenticated" && <CancellationState icon={<ShieldCheck />} title="Sign in to continue" detail="This review is available to authorized administrators only." />}
    {state === "forbidden" && <CancellationState icon={<ShieldCheck />} title="Administrator access is required" detail="Host access cannot make cancellation or refund decisions." />}
    {state === "not_found" && <CancellationState icon={<Ticket />} title="Request not found" detail="It may have been removed or is outside this workspace." action={<Link className="button button-outline" to="/admin/cancellations">Back to queue</Link>} />}
    {state === "error" && <CancellationState icon={<AlertCircle />} title="Request unavailable" detail={message} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && data && <>
      <header className="cancellation-heading"><p className="eyebrow">MEMBER REQUEST · VERSION {data.request.version}</p><h1>{data.member.displayName}</h1><p>{data.table.title} · {data.table.localDate} · {data.table.startLocalTime}</p></header>
      {message && <p className="cancellation-alert" role="status"><CheckCircle2 aria-hidden="true" />{message}</p>}
      <section className="cancellation-admin-context"><div><p className="eyebrow">SEAT STATUS</p><h2>{data.seat.state.replaceAll("_", " ")}</h2><p>Paid {money(data.seat.amountCents)} · Max refund {money(data.refundBalance.refundAvailableCents)}</p></div><div><p className="eyebrow">REQUESTED</p><p>{dateLabel(data.request.requestedAt)}</p></div>{data.request.memberReason && <div className="cancellation-admin-member-note"><p className="eyebrow">MEMBER NOTE</p><p>{data.request.memberReason}</p></div>}</section>
      {data.request.memberSafeReason && <section className="cancellation-admin-context"><div><p className="eyebrow">SAVED TEAM RESPONSE</p><p>{data.request.memberSafeReason}</p></div></section>}
      {data.request.state === "pending" ? <section className="cancellation-decision-card"><p className="eyebrow">REVIEW DECISION</p><h2>Keep or remove this Seat</h2><p>Approve to remove the Seat. {denialSeatOutcome(data.seat.state)} If you approve a refund, the amount is recorded for processing. This screen does not send money.</p>
        <label htmlFor="cancellation-safe-reason">Member-visible explanation</label><textarea id="cancellation-safe-reason" maxLength={500} rows={4} value={safeReason} onChange={(event) => setSafeReason(event.currentTarget.value)} placeholder="Write a clear explanation the member can see." />
        <div className="cancellation-refund-field"><span>Refund decision</span><label><input type="radio" name="refund-choice" checked={refundChoice === "full"} onChange={() => setRefundChoice("full")} />Full refund · {money(data.refundBalance.refundAvailableCents)}</label><label><input type="radio" name="refund-choice" checked={refundChoice === "partial"} onChange={() => setRefundChoice("partial")} />Partial refund</label>{refundChoice === "partial" && <label className="cancellation-partial-input">Refund amount in dollars<input inputMode="decimal" type="number" min="0.01" max={(data.refundBalance.refundAvailableCents / 100).toFixed(2)} step="0.01" value={partialDollars} onChange={(event) => setPartialDollars(event.currentTarget.value)} /></label>}<label><input type="radio" name="refund-choice" checked={refundChoice === "none"} onChange={() => setRefundChoice("none")} />No refund</label><p>Amount still available to refund: {money(data.refundBalance.refundAvailableCents)}. Amount already owed for other refunds: {money(data.refundBalance.refundCommittedCents)}.</p></div>
        <div className="cancellation-decision-actions"><button className="button button-outline" type="button" disabled={busy} onClick={() => setDecision("deny")}>{denialButtonLabel(data.seat.state)}</button><button className="button button-primary" type="button" disabled={busy || safeReason.trim().length < 3 || refundChoice === null || refundChoice === "partial" && amount <= 0 || amount > data.refundBalance.refundAvailableCents} onClick={() => setDecision("approve")}>Approve · remove Seat<ArrowRight aria-hidden="true" /></button></div>
        {decision && <div className="cancellation-confirm" role="alertdialog" aria-labelledby="cancellation-confirm-title"><h3 id="cancellation-confirm-title">Confirm {decision === "approve" ? "Seat removal" : "denial"}</h3><p>{decision === "approve" ? `The Seat will be removed. ${amount > 0 ? `A ${money(amount)} refund will be recorded for processing. This decision does not send money.` : "No refund will be recorded."}` : `${denialSeatOutcome(data.seat.state)} No refund will be recorded.`}</p><p className="cancellation-confirm-reason">Member will see: “{safeReason.trim()}”</p><div><button className="button button-outline" type="button" disabled={busy} onClick={() => setDecision(null)}>Go back</button><button className="button button-primary" type="button" disabled={busy || safeReason.trim().length < 1 || decision === "approve" && (refundChoice === "partial" && amount <= 0 || amount > data.refundBalance.refundAvailableCents)} onClick={() => void submitDecision()}>{busy ? "Saving…" : "Confirm decision"}</button></div></div>}
      </section> : <section className="cancellation-request-card"><p className="eyebrow">DECISION SAVED</p><h2>{data.request.state === "approved" ? "Seat removal approved" : deniedSeatHeading(data.seat.state)}</h2>{data.request.memberSafeReason && <p>{data.request.memberSafeReason}</p>}{data.request.state === "approved" && data.request.refundCents !== null && <p>{data.request.refundCents === 0 ? "No refund was authorized." : `${money(data.request.refundCents)} refund recorded for processing. This does not confirm that money has reached the member.`}</p>}</section>}
      <div className="cancellation-footer-actions"><Link className="button button-outline" to="/admin/cancellations"><ArrowLeft aria-hidden="true" />Back to queue</Link><button className="button button-outline" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />Refresh status</button></div>
    </>}
  </main></AdminCancellationShell>;
}

function parseDollars(value: string): number { if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(value)) return 0; return Math.round(Number(value) * 100); }
function CancellationState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <section className="cancellation-state" role="status"><span>{icon}</span><h2>{title}</h2><p>{detail}</p>{action}</section>;
}
function AdminCancellationShell({ active, children }: { active: "queue" | "detail"; children: ReactNode }) {
  return <main className="product-page cancellation-admin-workspace"><header className="product-topbar"><a className="brand" href="/admin/cancellations" aria-label="Fifth Wheel admin workspace"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a><div className="product-topbar-actions"><span className="product-workspace-label">ADMIN WORKSPACE</span><SignOutButton /></div></header><div className="product-layout"><StaffSidebar active="cancellations" foot="A refund amount is recorded for processing; this decision does not send money." footIcon={<Wallet aria-hidden="true" />} /><section className="product-content cancellation-admin-content">{children}</section></div></main>;
}
