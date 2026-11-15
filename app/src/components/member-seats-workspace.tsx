import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PageState } from "./ui/page-state";
import { StatusBadge } from "./ui/status-badge";
import { clockAfter, instantDate, instantTime, timestamp } from "../format/datetime";
import { PageHeader } from "./ui/page-header";
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

type LoadState = "loading" | "ready" | "unauthenticated" | "forbidden" | "not_found" | "error";
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

const dateLabel = (value: string, timeZone: string, withWeekday = false) => instantDate(value, { tz: timeZone, long: withWeekday });
const timeLabel = (value: string, timeZone: string) => instantTime(value, { tz: timeZone });
const dateTimeLabel = (value: string) => timestamp(value);
function money(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}
function seatStateCopy(state: MemberSeatDTO["state"]): Readonly<{ title: string; detail: string; tone: "good" | "warning" | "neutral" | "muted" }> {
  switch (state) {
    case "confirmed": return { title: "Confirmed", detail: "Your seat is saved to your account.", tone: "good" };
    case "cancellation_requested": return { title: "Cancellation requested", detail: "Your seat stays yours until we decide.", tone: "warning" };
    case "cancelled": return { title: "Cancelled", detail: "This seat was cancelled.", tone: "muted" };
    case "completed": return { title: "Completed", detail: "This table has already happened.", tone: "neutral" };
  }
}
function paymentCopy(state: MemberSeatDTO["payment"]["state"]): string {
  switch (state) {
    case "paid": return "Paid";
    case "refund_pending": return "Payment received; refund pending";
    case "refunded": return "Refunded";
    case "unknown": return "Confirming payment";
  }
}
function refundCopy(state: MemberSeatRefundDTO["state"]): string {
  switch (state) {
    case "open": case "pending": return "Refund pending";
    case "submitted": return "Refund on its way";
    case "unknown": case "failed": return "Refund delayed";
    case "succeeded": return "Refunded";
  }
}
function refundDetailCopy(state: MemberSeatRefundDTO["state"]): string {
  switch (state) {
    case "open": case "pending": return "We’ll send your refund soon.";
    case "submitted": return "Your refund is on its way to your original payment method. Banks can take 5–10 business days.";
    case "unknown": case "failed": return "Your refund is taking longer than usual. You’re still owed the full amount, and we’ll sort it out. Questions? hello@fifthwheel.community";
    case "succeeded": return "Your refund has been sent.";
  }
}
function checkoutCopy(value: MemberPendingCheckoutDTO): Readonly<{ title: string; detail: string; action: string | null; href: string | null }> {
  const invitation = `/invitations/${encodeURIComponent(value.invitationId)}`;
  switch (value.state) {
    case "refund_pending": return { title: "Payment received; refund pending.", detail: "A $25 charge was received. The refund is being handled; do not start another payment.", action: null, href: null };
    case "checkout_open": return { title: "Seat held", detail: `Pay by ${dateTimeLabel(value.holdUntil)} to confirm.`, action: value.nextAction === "resume_checkout" ? "Continue to payment" : null, href: value.nextAction === "resume_checkout" ? invitation : null };
    case "processing": return { title: "Confirming payment", detail: "Don’t pay again. This updates on its own.", action: value.nextAction === "check_status" ? "Check again" : null, href: value.nextAction === "check_status" ? `${invitation}?checkout=return&attemptId=${encodeURIComponent(value.attemptId)}` : null };
    case "unknown": return { title: "Confirming payment", detail: "Don’t pay again. This updates on its own.", action: value.nextAction === "check_status" ? "Check again" : null, href: value.nextAction === "check_status" ? `${invitation}?checkout=return&attemptId=${encodeURIComponent(value.attemptId)}` : null };
    case "failed": return { title: "Payment didn’t go through", detail: "No seat is confirmed. You can go back to your invitation.", action: value.nextAction === "retry_invitation" ? "Back to invitation" : null, href: value.nextAction === "retry_invitation" ? invitation : null };
    case "expired": return { title: "Hold ended", detail: "Go back to your invitation to start again.", action: value.nextAction === "retry_invitation" ? "Back to invitation" : null, href: value.nextAction === "retry_invitation" ? invitation : null };
  }
}

export function MemberSeatsListWorkspace() {
  const [state, setState] = useState<LoadState>("loading");
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

  // Payments still settling refresh on their own; guests have no refresh button.
  useEffect(() => {
    if (state !== "ready" || pending.length === 0) return;
    const timer = window.setInterval(() => { void load(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [state, pending.length, load]);

  return <MemberWorkspaceShell active="seats"><div className="member-seats-page">
    <PageHeader className="member-seats-heading" title="My Seats" />
    {message && state === "ready" && <p className="member-seat-notice" role="status"><AlertCircle aria-hidden="true" />{message}</p>}
    {state === "loading" && <PageState variant="loading" title="Loading your seats" />}
    {state === "unauthenticated" && <PageState variant="signed-out" title="Sign in to view your seats" message="Sign in with the email you used to join." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fmy-seats">Sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <PageState variant="no-access" title="You don’t have access yet" message="If you joined the waitlist, we’ll email you when you’re in." />}
    {state === "error" && <PageState variant="error" title="We couldn’t load your seats" message="Try again in a moment. Nothing about your seats or payments has changed." action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again</button>} />}
    {state === "ready" && <>
      {current.length > 0 && <section className="seat-section" aria-labelledby="seats-upcoming"><h2 id="seats-upcoming">Upcoming</h2><div className="seat-list">{current.map((seat) => <SeatCard key={seat.seatId} seat={seat} />)}</div></section>}
      {pending.length > 0 && <section className="seat-section" aria-labelledby="seats-payments"><h2 id="seats-payments">Payments</h2><div className="seat-list">{pending.map((attempt) => <PendingCheckoutCard key={attempt.attemptId} value={attempt} />)}</div></section>}
      {past.length > 0 && <details className="seat-past"><summary>Past evenings ({past.length})</summary><div className="seat-list">{past.map((seat) => <SeatCard key={seat.seatId} seat={seat} />)}</div></details>}
      {items.length === 0 && pending.length === 0 && <PageState variant="empty" title="No seats yet" message="When you pay for an invitation, your seat shows up here." action={<a className="button button-primary" href="/tables">Browse tables</a>} />}
      {canLoadMore && <div className="member-seat-load-more"><button className="button button-outline" type="button" onClick={() => void load(cursor, true)} disabled={loadingMore}>{loadingMore ? "Loading more…" : "Load more"}</button></div>}
    </>}
  </div></MemberWorkspaceShell>;
}

export function MemberSeatDetailWorkspace({ seatId }: { seatId: string }) {
  const [state, setState] = useState<LoadState>("loading");
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

  const startMs = seat ? Date.parse(seat.table.startsAt) : 0;
  const now = Date.now();
  const tonight = Boolean(seat && seat.state !== "cancelled" && now >= startMs - 3 * 3_600_000 && now <= startMs + 12 * 3_600_000);
  const calendar = seat?.calendar.available && seat.calendar.href ? seat.calendar.href : null;
  const canCancel = Boolean(seat && seat.state !== "cancelled" && seat.state !== "completed");

  return <MemberWorkspaceShell active="seats"><div className="member-seats-page">
    <Link to="/my-seats" className="page-header-back"><ArrowLeft aria-hidden="true" />My Seats</Link>
    {state === "loading" && <PageState variant="loading" title="Loading seat details" />}
    {state === "unauthenticated" && <PageState variant="signed-out" title="Sign in to continue" message="Sign in with the email you used to join." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/my-seats/${seatId}`)}`}>Sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <PageState variant="no-access" title="This Seat is not available to this account" message="Check that you signed in with the email that owns this seat." />}
    {state === "not_found" && <PageState variant="empty" title="Seat not found" message="This seat is not available to the current account." action={<Link className="button button-outline" to="/my-seats">Back to My Seats</Link>} />}
    {state === "error" && <PageState variant="error" title="We couldn’t load this seat" message={message || "Try again in a moment. Your seat has not changed."} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again</button>} />}
    {state === "ready" && seat && seatStatus && <>
      <PageHeader title={seat.table.title} description={`${instantDate(seat.table.startsAt, { tz: seat.table.timeZone, long: true })} · ${timeLabel(seat.table.startsAt, seat.table.timeZone)} · ${seat.table.neighborhood}`}
        actions={tonight ? <a className="button button-primary" href={`/tonight/${encodeURIComponent(seat.table.tableId)}`}>Open tonight’s page</a> : calendar && seat.participationState === "current" ? <a className="button button-primary" href={calendar} download><Download aria-hidden="true" />Add to calendar</a> : undefined} />
      <section className={`seat-status tone-${seatStatus.tone}`} role="status"><h2>{seatStatus.title}</h2><p>{seatStatus.detail}</p></section>
      <section className="seat-block" aria-labelledby="seat-payment"><h2 id="seat-payment">Payment</h2>
        <dl className="seat-facts">
          <div><dt>Status</dt><dd>{paymentCopy(seat.payment.state)}</dd></div>
          <div><dt>Amount</dt><dd>{money(seat.payment.amountCents, seat.payment.currency)}</dd></div>
          <div><dt>Paid</dt><dd>{seat.payment.paidAt ? dateTimeLabel(seat.payment.paidAt) : seat.payment.state === "unknown" ? "Status unknown" : "Not available"}</dd></div>
          <div><dt>Receipt</dt><dd>{seat.payment.receipt.state === "available" ? <a href={seat.payment.receipt.url} target="_blank" rel="noopener noreferrer">View receipt</a> : seat.payment.receipt.state === "unknown" ? "Receipt status unknown" : "Receipt unavailable"}</dd></div>
          {seat.refund && <div><dt>Refund</dt><dd>{refundCopy(seat.refund.state)} · {money(seat.refund.amountCents, seat.refund.currency)}</dd></div>}
          {!seat.refund && seat.cancellation.status === "pending" && <div><dt>Refund</dt><dd>Decided after your cancellation is reviewed</dd></div>}
        </dl>
        {seat.refund && <p className="seat-note">{refundDetailCopy(seat.refund.state)}</p>}
      </section>
      <section className="seat-block seat-itinerary" aria-labelledby="seat-itinerary"><h2 id="seat-itinerary">Evening itinerary</h2>
        <ol className="member-seat-stops">{seat.table.itinerary.map((stop, index) => <li key={stop.role}><span className="member-seat-step">0{index + 1}</span><div><p className="eyebrow">{stop.role.charAt(0).toUpperCase() + stop.role.slice(1)} · {clockAfter(seat.table.startLocalTime, stop.minutesFromStart)}</p><h3>{stop.venueName}</h3><p>{stop.venueAddress}</p>{stop.publicNotes && <small>{stop.publicNotes}</small>}</div></li>)}</ol>
      </section>
      {seat.cancellation.history.length > 1 && <details className="seat-block seat-history"><summary>Cancellation history ({seat.cancellation.history.length})</summary>
        <ol className="member-seat-cancellation-history">{seat.cancellation.history.map((entry) => <li key={entry.requestId}><div><strong>{cancellationEntryTitle(entry.status)}</strong><time dateTime={entry.requestedAt}>Requested {dateTimeLabel(entry.requestedAt)}</time>{entry.decidedAt && <time dateTime={entry.decidedAt}>Decision {dateTimeLabel(entry.decidedAt)}</time>}</div>{entry.safeReason && <p>{entry.safeReason}</p>}</li>)}</ol></details>}
      {canCancel && <p className="seat-cancel-link"><Link to="/my-seats/$seatId/cancellation" params={{ seatId }}>{seat.state === "cancellation_requested" ? "View cancellation request" : "Ask to cancel"}</Link></p>}
    </>}
  </div></MemberWorkspaceShell>;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; });
}

function SeatCard({ seat }: { seat: MemberSeatDTO }) {
  const status = seatStateCopy(seat.state);
  const tone = status.tone === "good" ? "success" : status.tone === "warning" ? "pending" : "neutral";
  return <Link className="seat-card" to="/my-seats/$seatId" params={{ seatId: seat.seatId }}>
    <span><h3>{seat.table.title}</h3><small>{dateLabel(seat.table.startsAt, seat.table.timeZone)} · {timeLabel(seat.table.startsAt, seat.table.timeZone)} · {seat.table.neighborhood}</small></span>
    <StatusBadge tone={tone}>{status.title}</StatusBadge>
  </Link>;
}

function PendingCheckoutCard({ value }: { value: MemberPendingCheckoutDTO }) {
  const state = checkoutCopy(value);
  const support = value.nextAction === "contact_support";
  return <article className="seat-notice"><div>
    <h3>{value.table.title}</h3>
    <p className="seat-notice-meta">{dateLabel(value.table.startsAt, value.table.timeZone)} · {value.table.neighborhood}</p>
    <p className="member-pending-copy"><strong>{state.title}</strong> {state.detail}</p>
    {value.state === "refund_pending" ? <div className="member-pending-price">Amount received {money(value.payment.amountCents, value.payment.currency)}{value.refund && <span> · Refund {money(value.refund.amountCents, value.refund.currency)} pending</span>}</div> : <span className="member-pending-price">Amount due {money(value.price.amountCents, value.price.currency)}</span>}
    {support && <p className="member-support-note">{value.state === "refund_pending" ? "Contact the team if you need help with your refund. You don’t need to pay again." : "The payment service could not confirm this attempt. Contact the team before starting another payment."}</p>}
  </div>{state.href && state.action && <a className="button button-outline" href={state.href}>{state.action}</a>}</article>;
}

function cancellationTitle(status: MemberSeatCancellationDTO["status"]): string {
  switch (status) {
    case "none": return "No request";
    case "pending": return "Waiting for review";
    case "approved": return "Approved";
    case "denied": return "Declined";
  }
}
function cancellationEntryTitle(status: "pending" | "approved" | "denied"): string {
  switch (status) {
    case "pending": return "Waiting for review";
    case "approved": return "Approved";
    case "denied": return "Declined";
  }
}
