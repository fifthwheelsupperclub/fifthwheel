import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, CreditCard,
  Download, FileText, LoaderCircle, MapPin, RefreshCw, ShieldCheck, Ticket, Utensils,
} from "lucide-react";
import { MemberWorkspaceShell } from "./member-tables-workspace.tsx";
import type {
  MemberPendingCheckoutDTO, MemberSeatCancellationDTO, MemberSeatDetailDTO, MemberSeatDTO,
  MemberSeatErrorCode, MemberSeatListDTO, MemberSeatPaymentDTO, MemberSeatRefundDTO, MemberSeatResponse, MemberSeatTableDTO,
  MemberSeatTableSummaryDTO,
} from "../seats.contract.ts";
import "./member-seats-workspace.css";

type PageState = "loading" | "ready" | "unauthenticated" | "forbidden" | "not_found" | "error";
type ApiEnvelope<T> = MemberSeatResponse<T>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const seatStates = new Set<MemberSeatDTO["state"]>(["confirmed", "cancellation_requested", "cancelled", "completed"]);
const paymentStates = new Set<MemberSeatDTO["payment"]["state"]>(["paid", "refund_pending", "refunded", "unknown"]);
const refundStates = new Set<NonNullable<MemberSeatDTO["refund"]>["state"]>(["open", "pending", "submitted", "unknown", "failed", "succeeded"]);
const checkoutStates = new Set<MemberPendingCheckoutDTO["state"]>(["checkout_open", "processing", "unknown", "failed", "expired", "refund_pending"]);
const pendingPaymentStates = new Set(["not_started", "processing", "paid", "refund_pending", "refunded", "unknown"]);
const nextActions = new Set<MemberPendingCheckoutDTO["nextAction"]>(["resume_checkout", "check_status", "retry_invitation", "contact_support", "none"]);
const cancellationStates = new Set<MemberSeatCancellationDTO["status"]>(["none", "pending", "approved", "denied"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validText(value: unknown, max = 500): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function safeCalendarHref(seatId: string, value: unknown): string | null | undefined {
  if (!record(value) || typeof value.available !== "boolean") return undefined;
  const expected = `/api/me/seats/${encodeURIComponent(seatId)}/calendar.ics`;
  if (value.available) return value.href === expected ? expected : undefined;
  return value.href === null ? null : undefined;
}

function parseTableSummary(value: unknown): MemberSeatTableSummaryDTO | null {
  if (!record(value) || !uuid.test(String(value.tableId ?? "")) || !validText(value.title) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.localDate ?? ""))
    || typeof value.startLocalTime !== "string" || !/^\d{2}:\d{2}$/.test(value.startLocalTime)
    || value.timeZone !== "America/New_York" || !validDate(value.startsAt) || !validText(value.neighborhood)) return null;
  return { tableId: value.tableId as string, title: value.title as string, localDate: value.localDate as string, startLocalTime: value.startLocalTime as string,
    timeZone: "America/New_York", startsAt: value.startsAt as string, neighborhood: value.neighborhood as string };
}

function parseRefund(value: unknown): MemberSeatRefundDTO | null | undefined {
  if (value === null) return null;
  if (!record(value) || !refundStates.has(value.state as MemberSeatRefundDTO["state"])
    || !Number.isSafeInteger(value.amountCents) || Number(value.amountCents) < 0 || Number(value.amountCents) > 2500 || value.currency !== "USD") return undefined;
  return { state: value.state as MemberSeatRefundDTO["state"], amountCents: Number(value.amountCents), currency: "USD" };
}

function parsePayment(value: unknown, detail: boolean): MemberSeatPaymentDTO | MemberSeatDTO["payment"]["state"] | undefined {
  if (!record(value) || !paymentStates.has(value.state as MemberSeatDTO["payment"]["state"])
    || value.amountCents !== 2500 || value.currency !== "USD" || !(value.paidAt === null || validDate(value.paidAt))) return undefined;
  if (!detail) return value.state as MemberSeatDTO["payment"]["state"];
  if (!record(value.receipt)) return undefined;
  if (value.receipt.state === "available" && typeof value.receipt.url === "string" && safeReceiptUrl(value.receipt.url)) {
    return { state: value.state as MemberSeatPaymentDTO["state"], amountCents: 2500, currency: "USD", paidAt: value.paidAt as string | null,
      receipt: { state: "available", url: value.receipt.url } };
  }
  if ((value.receipt.state === "unavailable" || value.receipt.state === "unknown") && value.receipt.url === null) {
    return { state: value.state as MemberSeatPaymentDTO["state"], amountCents: 2500, currency: "USD", paidAt: value.paidAt as string | null,
      receipt: { state: value.receipt.state, url: null } };
  }
  return undefined;
}

function safeReceiptUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "pay.stripe.com" && !url.username && !url.password && url.pathname.startsWith("/receipts/");
  } catch { return false; }
}

function parseSeatSummary(value: unknown): MemberSeatDTO | null {
  if (!record(value) || !uuid.test(String(value.seatId ?? "")) || !seatStates.has(value.state as MemberSeatDTO["state"])
    || !(value.participationState === "current" || value.participationState === "past") || !validDate(value.createdAt)) return null;
  const table = parseTableSummary(value.table);
  const refund = parseRefund(value.refund);
  const paymentState = parsePayment(value.payment, false);
  const calendar = safeCalendarHref(value.seatId as string, value.calendar);
  if (!table || refund === undefined || !paymentStates.has(paymentState as MemberSeatDTO["payment"]["state"]) || calendar === undefined) return null;
  const paymentRaw = value.payment as Record<string, unknown>;
  return { seatId: value.seatId as string, state: value.state as MemberSeatDTO["state"], participationState: value.participationState,
    createdAt: value.createdAt, table, payment: { state: paymentRaw.state as MemberSeatDTO["payment"]["state"], amountCents: 2500,
      currency: "USD", paidAt: paymentRaw.paidAt as string | null }, refund, calendar: { available: calendar !== null, href: calendar } };
}

function parseItinerary(value: unknown): MemberSeatTableDTO["itinerary"] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const roles = ["drinks", "dinner", "dessert"] as const;
  const parsed = value.map((item, index) => {
    if (!record(item) || item.role !== roles[index] || !validText(item.venueName) || !validText(item.venueAddress)
      || !Number.isSafeInteger(item.minutesFromStart) || Number(item.minutesFromStart) < 0 || !validText(item.publicNotes, 2_000)) return null;
    return { role: item.role as typeof roles[number], venueName: item.venueName, venueAddress: item.venueAddress,
      minutesFromStart: Number(item.minutesFromStart), publicNotes: item.publicNotes };
  });
  return parsed.some((stop) => stop === null) ? null : parsed as unknown as MemberSeatTableDTO["itinerary"];
}

function parseCancellation(value: unknown): MemberSeatCancellationDTO | null {
  if (!record(value) || !cancellationStates.has(value.status as MemberSeatCancellationDTO["status"]) || !Array.isArray(value.history)) return null;
  const history = value.history.map((entry) => {
    if (!record(entry) || !uuid.test(String(entry.requestId ?? "")) || !["pending", "approved", "denied"].includes(String(entry.status))
      || !validDate(entry.requestedAt) || !(entry.decidedAt === null || validDate(entry.decidedAt))
      || !(entry.safeReason === null || typeof entry.safeReason === "string" && entry.safeReason.length <= 2_000)) return null;
    return { requestId: entry.requestId as string, status: entry.status as "pending" | "approved" | "denied", requestedAt: entry.requestedAt,
      decidedAt: entry.decidedAt as string | null, safeReason: entry.safeReason as string | null };
  });
  return history.some((entry) => entry === null) ? null : { status: value.status as MemberSeatCancellationDTO["status"], history: history as NonNullable<typeof history[number]>[] };
}

function parseSeatDetail(value: unknown): MemberSeatDetailDTO | null {
  const summary = parseSeatSummary(value);
  if (!summary || !record(value) || !record(value.table) || !record(value.payment)) return null;
  const itinerary = parseItinerary(value.table.itinerary);
  const cancellation = parseCancellation(value.cancellation);
  const payment = parsePayment(value.payment, true) as MemberSeatPaymentDTO | undefined;
  if (!itinerary || !cancellation || !payment) return null;
  return { ...summary, table: { ...summary.table, itinerary }, payment, cancellation };
}

function parsePendingCheckout(value: unknown): MemberPendingCheckoutDTO | null {
  if (!record(value) || !uuid.test(String(value.attemptId ?? "")) || !uuid.test(String(value.invitationId ?? ""))
    || !checkoutStates.has(value.state as MemberPendingCheckoutDTO["state"]) || !nextActions.has(value.nextAction as MemberPendingCheckoutDTO["nextAction"])
    || !validDate(value.createdAt) || !validDate(value.holdUntil) || !record(value.price) || value.price.amountCents !== 2500 || value.price.currency !== "USD"
    || !record(value.payment) || !pendingPaymentStates.has(String(value.payment.state)) || value.payment.amountCents !== 2500 || value.payment.currency !== "USD"
    || !(value.payment.paidAt === null || validDate(value.payment.paidAt))) return null;
  const table = parseTableSummary(value.table);
  const refund = parseRefund(value.refund);
  if (!table || refund === undefined) return null;
  if (value.state === "refund_pending" && (value.payment.state !== "refund_pending" || refund === null || value.nextAction !== "contact_support")) return null;
  return { attemptId: value.attemptId as string, invitationId: value.invitationId as string, state: value.state as MemberPendingCheckoutDTO["state"],
    nextAction: value.nextAction as MemberPendingCheckoutDTO["nextAction"], createdAt: value.createdAt, holdUntil: value.holdUntil,
    price: { amountCents: 2500, currency: "USD" },
    payment: { state: value.payment.state as MemberPendingCheckoutDTO["payment"]["state"], amountCents: 2500, currency: "USD", paidAt: value.payment.paidAt as string | null },
    refund, table };
}

function parseSeatList(value: unknown): MemberSeatListDTO | null {
  if (!record(value) || !Array.isArray(value.items) || !Array.isArray(value.pendingCheckouts)
    || !(value.nextCursor === null || typeof value.nextCursor === "string")) return null;
  const items = value.items.map(parseSeatSummary);
  const pendingCheckouts = value.pendingCheckouts.map(parsePendingCheckout);
  if (items.some((item) => !item) || pendingCheckouts.some((item) => !item)) return null;
  return { items: items as MemberSeatDTO[], pendingCheckouts: pendingCheckouts as MemberPendingCheckoutDTO[], nextCursor: value.nextCursor as string | null };
}

function parseEnvelope<T>(value: unknown, parse: (data: unknown) => T | null): ApiEnvelope<T> | null {
  if (!record(value) || typeof value.ok !== "boolean" || typeof value.correlationId !== "string") return null;
  if (value.ok) {
    const data = parse(value.data);
    return data === null ? null : { ok: true, data, correlationId: value.correlationId };
  }
  if (!record(value.error) || typeof value.error.code !== "string" || typeof value.error.safeMessage !== "string"
    || typeof value.error.retryable !== "boolean" || typeof value.error.correlationId !== "string") return null;
  return { ok: false, correlationId: value.correlationId, error: {
    code: value.error.code as MemberSeatErrorCode,
    safeMessage: value.error.safeMessage, retryable: value.error.retryable, correlationId: value.error.correlationId,
  } };
}

async function readEnvelope<T>(response: Response, parse: (data: unknown) => T | null): Promise<ApiEnvelope<T> | null> {
  return parseEnvelope(await response.json().catch(() => null), parse);
}

function dateLabel(value: string, timeZone: string, withWeekday = false): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric", year: "numeric", weekday: withWeekday ? "long" : undefined }).format(new Date(value));
}
function timeLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function money(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}
function seatStateCopy(state: MemberSeatDTO["state"]): Readonly<{ title: string; detail: string; tone: "good" | "warning" | "neutral" | "muted" }> {
  switch (state) {
    case "confirmed": return { title: "Seat confirmed", detail: "Your Seat is saved to your account.", tone: "good" };
    case "cancellation_requested": return { title: "Cancellation under review", detail: "Your Seat remains active while the team reviews your request.", tone: "warning" };
    case "cancelled": return { title: "Seat cancelled", detail: "This Seat was removed from the Table.", tone: "muted" };
    case "completed": return { title: "Evening complete", detail: "Your Table has concluded.", tone: "neutral" };
  }
}
function paymentCopy(state: MemberSeatDTO["payment"]["state"]): string {
  switch (state) {
    case "paid": return "Payment confirmed";
    case "refund_pending": return "Payment received; refund pending";
    case "refunded": return "Refunded";
    case "unknown": return "Payment status unknown";
  }
}
function refundCopy(state: MemberSeatRefundDTO["state"]): string {
  switch (state) {
    case "open": return "Refund owed";
    case "pending": return "Refund queued";
    case "submitted": return "Refund processing";
    case "unknown": return "Refund status unclear";
    case "failed": return "Refund not completed";
    case "succeeded": return "Refund complete";
  }
}
function refundDetailCopy(state: MemberSeatRefundDTO["state"]): string {
  switch (state) {
    case "open": return "A refund is owed. It has not been queued for processing yet.";
    case "pending": return "Your refund is queued for processing. The payment provider has not confirmed it yet.";
    case "submitted": return "The payment provider accepted the refund request. We’re waiting for confirmation that it has been processed.";
    case "unknown": return "We can’t confirm whether the refund was processed yet. The amount remains owed until the provider confirms the result.";
    case "failed": return "The refund attempt failed. The amount is still owed.";
    case "succeeded": return "The payment provider confirmed this refund.";
  }
}
function checkoutCopy(value: MemberPendingCheckoutDTO): Readonly<{ title: string; detail: string; action: string | null; href: string | null }> {
  const invitation = `/invitations/${encodeURIComponent(value.invitationId)}`;
  switch (value.state) {
    case "refund_pending": return { title: "Payment received; refund pending.", detail: "A $25 charge was received. The refund is being handled; do not start another payment.", action: null, href: null };
    case "checkout_open": return { title: "Checkout open", detail: `A temporary checkout hold is active until ${dateTimeLabel(value.holdUntil)}. This is not a confirmed Seat.`, action: value.nextAction === "resume_checkout" ? "Continue checkout" : null, href: value.nextAction === "resume_checkout" ? invitation : null };
    case "processing": return { title: "Payment processing", detail: "No Seat is confirmed yet. Check the saved status before taking another payment action.", action: value.nextAction === "check_status" ? "Check payment status" : null, href: value.nextAction === "check_status" ? `${invitation}?checkout=return&attemptId=${encodeURIComponent(value.attemptId)}` : null };
    case "unknown": return { title: "Payment status unknown", detail: "Do not start another payment while the outcome is unresolved.", action: value.nextAction === "check_status" ? "Check payment status" : null, href: value.nextAction === "check_status" ? `${invitation}?checkout=return&attemptId=${encodeURIComponent(value.attemptId)}` : null };
    case "failed": return { title: "Checkout failed", detail: "No confirmed Seat is shown. The server will tell you whether this invitation can be retried.", action: value.nextAction === "retry_invitation" ? "Return to invitation" : null, href: value.nextAction === "retry_invitation" ? invitation : null };
    case "expired": return { title: "Checkout window ended", detail: "Confirm the saved payment status before starting another checkout.", action: value.nextAction === "retry_invitation" ? "Return to invitation" : null, href: value.nextAction === "retry_invitation" ? invitation : null };
  }
}

export function MemberSeatsListWorkspace() {
  const [state, setState] = useState<PageState>("loading");
  const [items, setItems] = useState<readonly MemberSeatDTO[]>([]);
  const [pending, setPending] = useState<readonly MemberPendingCheckoutDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const hasLoaded = useRef(false);
  const load = useCallback(async (nextCursor?: string, append = false) => {
    if (append) setLoadingMore(true);
    else if (hasLoaded.current) setRefreshing(true);
    else setState("loading");
    setMessage("");
    const query = new URLSearchParams({ limit: "20" });
    if (nextCursor) query.set("cursor", nextCursor);
    try {
      const response = await fetch(`/api/me/seats?${query.toString()}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      const result = await readEnvelope(response, parseSeatList);
      if (!response.ok || !result) throw new Error("The Seat list returned an unexpected response.");
      if (!result.ok) {
        setState(result.error.code === "unauthenticated" ? "unauthenticated" : result.error.code === "forbidden" ? "forbidden" : "error");
        setMessage(result.error.safeMessage);
        return;
      }
      setItems((current) => append ? uniqueBy([...current, ...result.data.items], (item) => item.seatId) : result.data.items);
      setPending((current) => append ? uniqueBy([...current, ...result.data.pendingCheckouts], (item) => item.attemptId) : result.data.pendingCheckouts);
      setCursor(result.data.nextCursor);
      hasLoaded.current = true;
      setState("ready");
    } catch (error) {
      const safeMessage = error instanceof Error ? error.message : "The Seat list is temporarily unavailable.";
      if (append || hasLoaded.current) setMessage(`${safeMessage} Your current Seat statuses are unchanged.`);
      else { setMessage(safeMessage); setState("error"); }
    } finally { setLoadingMore(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = items.filter((item) => item.participationState === "current").sort((a, b) => a.table.startsAt.localeCompare(b.table.startsAt));
  const past = items.filter((item) => item.participationState === "past").sort((a, b) => b.table.startsAt.localeCompare(a.table.startsAt));
  const canLoadMore = cursor !== null;

  return <MemberWorkspaceShell active="seats"><div className="member-seats-page">
    <div className="product-breadcrumb"><span>MEMBER WORKSPACE</span><span>·</span><span>My Seats</span></div>
    <div className="member-seats-heading"><div><p className="eyebrow">YOUR EVENINGS</p><h1>My Seats</h1><p className="page-intro">Your payment, Seat and refund status from your member account.</p></div><button className="icon-action" type="button" aria-label="Refresh My Seats" onClick={() => void load()} disabled={refreshing}><RefreshCw aria-hidden="true" className={refreshing ? "member-seat-spin" : ""} /></button></div>
    {message && <p className={`member-seat-notice ${state === "error" ? "is-error" : ""}`} role={state === "error" ? "alert" : "status"}><AlertCircle aria-hidden="true" />{message}</p>}
    {state === "loading" && <SeatState icon={<LoaderCircle className="member-seat-spin" />} title="Loading your Seats" detail="Checking the latest saved payment and Seat status." />}
    {state === "unauthenticated" && <SeatState icon={<ShieldCheck />} title="Sign in to view your Seats" detail="Your payment and Seat records are private to your member account." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fmy-seats">Sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <SeatState icon={<ShieldCheck />} title="Member access is required" detail="This workspace is available to admitted members." />}
    {state === "error" && <SeatState icon={<AlertCircle />} title="My Seats is temporarily unavailable" detail={message || "Try again shortly. No Seat or payment status has changed."} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && <>
      {pending.length > 0 && <section className="member-seat-section" aria-labelledby="checkout-status-title"><div className="member-seat-section-heading"><div><p className="eyebrow">NEEDS ATTENTION</p><h2 id="checkout-status-title">Checkout status</h2></div><span>{pending.length}</span></div><div className="member-pending-list">{pending.map((attempt) => <PendingCheckoutCard key={attempt.attemptId} value={attempt} />)}</div></section>}
      {current.length > 0 && <SeatGroup title="Upcoming Seats" eyebrow="CURRENT" items={current} />}
      {past.length > 0 && <SeatGroup title="Past Seats" eyebrow="HISTORY" items={past} />}
      {items.length === 0 && pending.length === 0 && <section className="member-seat-empty"><span><Ticket aria-hidden="true" /></span><p className="eyebrow">YOUR NEXT EVENING</p><h2>No Seats yet</h2><p>A Seat appears here only after the payment service verifies payment and saves your place.</p><div><a className="button button-primary" href="/tables">Browse Tables<ArrowRight aria-hidden="true" /></a><a className="button button-outline" href="/requests">View Requests</a></div></section>}
      {canLoadMore && <div className="member-seat-load-more"><button className="button button-outline" type="button" onClick={() => void load(cursor, true)} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="member-seat-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{loadingMore ? "Loading more…" : "Load more"}</button></div>}
    </>}
  </div></MemberWorkspaceShell>;
}

export function MemberSeatDetailWorkspace({ seatId }: { seatId: string }) {
  const [state, setState] = useState<PageState>("loading");
  const [seat, setSeat] = useState<MemberSeatDetailDTO | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/me/seats/${encodeURIComponent(seatId)}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      if (response.status === 404) { setState("not_found"); return; }
      const result = await readEnvelope(response, parseSeatDetail);
      if (!response.ok || !result) throw new Error("The Seat details returned an unexpected response.");
      if (!result.ok) {
        setState(result.error.code === "unauthenticated" ? "unauthenticated" : result.error.code === "forbidden" ? "forbidden" : result.error.code === "not_found" ? "not_found" : "error");
        setMessage(result.error.safeMessage); return;
      }
      setSeat(result.data); setState("ready");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Seat details are temporarily unavailable."); setState("error"); }
  }, [seatId]);
  useEffect(() => { void load(); }, [load]);
  const seatStatus = seat ? seatStateCopy(seat.state) : null;

  return <MemberWorkspaceShell active="seats"><div className="member-seats-page">
    <div className="product-breadcrumb"><Link to="/my-seats">My Seats</Link><span>›</span><span>Seat details</span></div>
    {state === "loading" && <SeatState icon={<LoaderCircle className="member-seat-spin" />} title="Loading Seat details" detail="Checking the saved payment, itinerary and current status." />}
    {state === "unauthenticated" && <SeatState icon={<ShieldCheck />} title="Sign in to continue" detail="Seat details are private to the member account." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/my-seats/${seatId}`)}`}>Sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <SeatState icon={<ShieldCheck />} title="This Seat is not available to this account" detail="Check that you signed in with the member account that owns this Seat." />}
    {state === "not_found" && <SeatState icon={<Ticket />} title="Seat not found" detail="This Seat is not available to the current account." action={<Link className="button button-outline" to="/my-seats"><ArrowLeft aria-hidden="true" />Back to My Seats</Link>} />}
    {state === "error" && <SeatState icon={<AlertCircle />} title="Seat details are temporarily unavailable" detail={message || "Try again shortly. Your saved Seat status has not changed."} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && seat && seatStatus && <>
      <div className="member-seat-detail-heading"><p className="eyebrow">{seat.participationState === "current" ? "CURRENT SEAT" : "PAST SEAT"}</p><h1>{seat.table.title}</h1><p className="member-seat-meta"><CalendarDays aria-hidden="true" />{dateLabel(seat.table.startsAt, seat.table.timeZone, true)}<span>·</span><Clock3 aria-hidden="true" />{timeLabel(seat.table.startsAt, seat.table.timeZone)}<span>·</span><MapPin aria-hidden="true" />{seat.table.neighborhood}</p></div>
      <section className={`member-seat-status tone-${seatStatus.tone}`} role="status"><span>{seatStatus.tone === "good" ? <CheckCircle2 aria-hidden="true" /> : seatStatus.tone === "warning" ? <Clock3 aria-hidden="true" /> : <Ticket aria-hidden="true" />}</span><div><p className="eyebrow">{seat.state.replaceAll("_", " ").toUpperCase()}</p><h2>{seatStatus.title}</h2><p>{seatStatus.detail}</p></div></section>
      <div className="member-seat-detail-grid">
        <section className="member-seat-card"><div className="member-seat-card-heading"><span><CreditCard aria-hidden="true" /></span><div><p className="eyebrow">PAYMENT</p><h2>{paymentCopy(seat.payment.state)}</h2></div></div><div className="member-seat-facts"><div><dt>Amount</dt><dd>{money(seat.payment.amountCents, seat.payment.currency)}</dd></div><div><dt>Paid</dt><dd>{seat.payment.paidAt ? dateTimeLabel(seat.payment.paidAt) : seat.payment.state === "unknown" ? "Status unknown" : "Not available"}</dd></div><div><dt>Receipt</dt><dd>{seat.payment.receipt.state === "available" ? <a href={seat.payment.receipt.url} target="_blank" rel="noopener noreferrer">View receipt<ArrowRight aria-hidden="true" /></a> : seat.payment.receipt.state === "unknown" ? "Receipt status unknown" : "Receipt unavailable"}</dd></div></div></section>
        <section className="member-seat-card"><div className="member-seat-card-heading"><span><ShieldCheck aria-hidden="true" /></span><div><p className="eyebrow">REFUND</p><h2>{seat.refund ? refundCopy(seat.refund.state) : "No refund is due for this Seat"}</h2></div></div>{seat.refund ? <><div className="member-seat-facts"><div><dt>Amount</dt><dd>{money(seat.refund.amountCents, seat.refund.currency)}</dd></div><div><dt>Status</dt><dd>{refundCopy(seat.refund.state)}</dd></div></div><p className="member-seat-card-copy">{refundDetailCopy(seat.refund.state)}</p></> : <p className="member-seat-card-copy">If that changes, the refund status will appear here.</p>}</section>
      </div>
      <section className="member-seat-card member-seat-itinerary"><div className="member-seat-card-heading"><span><Utensils aria-hidden="true" /></span><div><p className="eyebrow">TABLE DETAILS</p><h2>Evening itinerary</h2></div></div><ol className="member-seat-stops">{seat.table.itinerary.map((stop, index) => <li key={stop.role}><span className="member-seat-step">0{index + 1}</span><div><p className="eyebrow">{stop.role.toUpperCase()} · {stop.minutesFromStart === 0 ? "START" : `+${stop.minutesFromStart} MIN`}</p><h3>{stop.venueName}</h3><p>{stop.venueAddress}</p>{stop.publicNotes && <small>{stop.publicNotes}</small>}</div></li>)}</ol></section>
      <section className="member-seat-card member-seat-cancellation"><div className="member-seat-card-heading"><span><FileText aria-hidden="true" /></span><div><p className="eyebrow">CANCELLATION HISTORY</p><h2>{cancellationTitle(seat.cancellation.status)}</h2></div></div>{seat.cancellation.history.length === 0 ? <p className="member-seat-card-copy">There are no cancellation requests for this Seat.</p> : <ol className="member-seat-cancellation-history">{seat.cancellation.history.map((entry) => <li key={entry.requestId}><div><strong>{cancellationEntryTitle(entry.status)}</strong><time dateTime={entry.requestedAt}>Requested {dateTimeLabel(entry.requestedAt)}</time>{entry.decidedAt && <time dateTime={entry.decidedAt}>Decision {dateTimeLabel(entry.decidedAt)}</time>}</div>{entry.safeReason && <p>{entry.safeReason}</p>}</li>)}</ol>}</section>
      <div className="member-seat-detail-actions"><Link className="button button-outline" to="/my-seats"><ArrowLeft aria-hidden="true" />Back to My Seats</Link>{seat.state !== "cancelled" && seat.state !== "completed" && <Link className="button button-outline" to="/my-seats/$seatId/cancellation" params={{ seatId }}>{seat.state === "cancellation_requested" ? "View cancellation request" : "Request cancellation"}<ArrowRight aria-hidden="true" /></Link>}{seat.state !== "cancelled" && <a className="button button-outline" href={`/tonight/${encodeURIComponent(seat.table.tableId)}`}>Tonight &amp; recap</a>}{seat.calendar.available && seat.calendar.href && <a className="button button-primary" href={seat.calendar.href} download><Download aria-hidden="true" />Add to calendar</a>}<button className="button button-outline" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />Refresh status</button></div>
    </>}
  </div></MemberWorkspaceShell>;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
}

function SeatGroup({ title, eyebrow, items }: { title: string; eyebrow: string; items: readonly MemberSeatDTO[] }) {
  return <section className="member-seat-section"><div className="member-seat-section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span>{items.length}</span></div><div className="member-seat-list">{items.map((seat) => <SeatCard key={seat.seatId} seat={seat} />)}</div></section>;
}

function SeatCard({ seat }: { seat: MemberSeatDTO }) {
  const status = seatStateCopy(seat.state);
  return <article className="member-seat-list-card"><div className="member-seat-list-main"><span className="member-seat-list-icon"><Ticket aria-hidden="true" /></span><div><p className="eyebrow">{status.title}</p><h3>{seat.table.title}</h3><p className="member-seat-list-meta"><CalendarDays aria-hidden="true" />{dateLabel(seat.table.startsAt, seat.table.timeZone, true)}<span>·</span><Clock3 aria-hidden="true" />{timeLabel(seat.table.startsAt, seat.table.timeZone)}<span>·</span><MapPin aria-hidden="true" />{seat.table.neighborhood}</p></div></div><div className="member-seat-list-status"><strong>{paymentCopy(seat.payment.state)}</strong><span>{seat.refund ? refundCopy(seat.refund.state) : seat.payment.state === "unknown" ? "Status needs review" : money(seat.payment.amountCents, seat.payment.currency)}</span></div><Link className="button button-outline" to="/my-seats/$seatId" params={{ seatId: seat.seatId }}>View details<ArrowRight aria-hidden="true" /></Link></article>;
}

function PendingCheckoutCard({ value }: { value: MemberPendingCheckoutDTO }) {
  const state = checkoutCopy(value);
  const support = value.nextAction === "contact_support";
  return <article className="member-pending-card"><span className="member-pending-icon"><CreditCard aria-hidden="true" /></span><div className="member-pending-main"><p className="eyebrow">PAYMENT STATUS</p><h3>{value.table.title}</h3><p className="member-seat-list-meta"><CalendarDays aria-hidden="true" />{dateLabel(value.table.startsAt, value.table.timeZone, true)}<span>·</span><MapPin aria-hidden="true" />{value.table.neighborhood}</p><p className="member-pending-copy"><strong>{state.title}</strong>{state.detail}</p>{value.state === "refund_pending" ? <div className="member-pending-price">Amount received {money(value.payment.amountCents, value.payment.currency)}{value.refund && <span> · Refund {money(value.refund.amountCents, value.refund.currency)} pending</span>}</div> : <span className="member-pending-price">Amount due {money(value.price.amountCents, value.price.currency)}</span>}{support && <p className="member-support-note">{value.state === "refund_pending" ? "Contact the team if you need help with your refund. You don’t need to pay again." : "The payment service could not confirm this attempt. Contact the team before starting another payment."}</p>}</div>{state.href && state.action && <a className="button button-outline" href={state.href}>{state.action}<ArrowRight aria-hidden="true" /></a>}</article>;
}

function SeatState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <section className="member-seat-state" role="status"><span>{icon}</span><h2>{title}</h2><p>{detail}</p>{action}</section>;
}

function cancellationTitle(status: MemberSeatCancellationDTO["status"]): string {
  switch (status) {
    case "none": return "No request";
    case "pending": return "Request under review";
    case "approved": return "Cancellation approved";
    case "denied": return "Seat remains confirmed";
  }
}
function cancellationEntryTitle(status: "pending" | "approved" | "denied"): string {
  switch (status) {
    case "pending": return "Request submitted";
    case "approved": return "Request approved";
    case "denied": return "Request declined";
  }
}
