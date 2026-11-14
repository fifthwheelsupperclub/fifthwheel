import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { INVITATION_STATE_HEADING, INVITATION_STATE_PILL, REQUEST_STATE_LABEL, type RequestState } from "../copy/states.ts";
import { GuestSidebar } from "./guest-nav";
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, CircleAlert, ClipboardList, Clock3,
  House, Mail, MapPin, Share2, Table2, Ticket, UserRound, Utensils, X,
} from "lucide-react";
import { SignOutButton } from "./sign-out-button.tsx";
import type { TableInvitationDeliveryState, TableInvitationHistorySummaryDTO } from "../table-invitations.contract.ts";
import "./member-tables-workspace.css";

type TableInvitationSummary = TableInvitationHistorySummaryDTO;
type TableStop = Readonly<{ role: string; venueName: string; venueAddress: string; minutesFromStart: number; publicNotes: string }>;
type TableData = Readonly<{
  tableId: string;
  title: string;
  localDate: string;
  startLocalTime?: string;
  neighborhood: string;
  stops?: readonly TableStop[];
  priceCents?: number;
  ownRequest?: Readonly<{ requestId: string; tableId: string; state: RequestState; declineReason: string | null; createdAt: string; updatedAt: string }> | null;
  isCurrentlyPublished?: boolean;
  previewOnly?: boolean;
}>;
type RequestRecord = Readonly<{
  requestId: string;
  tableId: string;
  state: RequestState;
  createdAt: string;
  declineReason: string | null;
  table: TableData;
  tableInvitation: TableInvitationSummary | null;
}>;
type Envelope = Readonly<{ ok: true; data: unknown }> | Readonly<{ ok: false; error: Readonly<{ code: string; safeMessage: string }> }>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = new Set<RequestState>(["pending", "withdrawn", "declined", "closed_by_table"]);
const invitationStates = new Set<TableInvitationHistorySummaryDTO["state"]>(["active", "revoked", "closed"]);
const invitationDeliveryStates = new Set<TableInvitationDeliveryState>(["queued", "sending", "accepted", "delivered", "failed", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readEnvelope(response: Response): Promise<Envelope | null> {
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || typeof body.ok !== "boolean") return null;
  if (body.ok && "data" in body) return { ok: true, data: body.data };
  if (!body.ok && isRecord(body.error) && typeof body.error.code === "string" && typeof body.error.safeMessage === "string") {
    return { ok: false, error: { code: body.error.code, safeMessage: body.error.safeMessage } };
  }
  return null;
}

function parseTable(value: unknown): TableData | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.tableId ?? ""))
    || typeof value.title !== "string" || typeof value.localDate !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.localDate)
    || typeof value.startLocalTime !== "string" || !/^\d{2}:\d{2}$/.test(value.startLocalTime)
    || typeof value.neighborhood !== "string") return null;

  const stopsRaw = value.stops;
  if (!Array.isArray(stopsRaw) || stopsRaw.length !== 3 || stopsRaw.some((item, index) => !isRecord(item)
    || item.role !== (["drinks", "dinner", "dessert"] as const)[index]
    || typeof item.venueName !== "string" || typeof item.venueAddress !== "string"
    || !Number.isInteger(item.minutesFromStart) || typeof item.publicNotes !== "string")) return null;
  const stops = stopsRaw.map((item) => ({
    role: String((item as Record<string, unknown>).role),
    venueName: String((item as Record<string, unknown>).venueName),
    venueAddress: String((item as Record<string, unknown>).venueAddress),
    minutesFromStart: Number((item as Record<string, unknown>).minutesFromStart),
    publicNotes: String((item as Record<string, unknown>).publicNotes),
  }));
  if (value.seatPriceCents !== 2500 || value.currency !== "USD") return null;
  const ownRequest = parseOwnRequest(value.ownRequest);
  if (ownRequest === undefined || (ownRequest && ownRequest.tableId !== value.tableId)) return null;
  return Object.freeze({
    tableId: value.tableId as string,
    title: value.title,
    localDate: value.localDate,
    startLocalTime: value.startLocalTime,
    neighborhood: value.neighborhood,
    stops: Object.freeze(stops), priceCents: 2500, ownRequest,
  });
}

function parseOwnRequest(value: unknown): TableData["ownRequest"] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !uuidPattern.test(String(value.requestId ?? "")) || !uuidPattern.test(String(value.tableId ?? "")) || !states.has(value.state as RequestState)
    || (value.declineReason !== null && typeof value.declineReason !== "string")
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) return undefined;
  return { requestId: value.requestId as string, tableId: value.tableId as string, state: value.state as RequestState,
    declineReason: value.declineReason as string | null, createdAt: value.createdAt, updatedAt: value.updatedAt };
}

function parseTablePreview(value: unknown): TableData | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.tableId ?? ""))
    || typeof value.title !== "string" || typeof value.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.localDate)
    || typeof value.neighborhood !== "string") return null;
  return Object.freeze({ tableId: value.tableId as string, title: value.title, localDate: value.localDate, neighborhood: value.neighborhood, previewOnly: true });
}

function parseTableList(value: unknown): Readonly<{ items: readonly TableData[]; nextCursor: string | null }> | null {
  if (!isRecord(value) || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) return null;
  const items = value.items.map(parseTableListItem);
  if (items.some((item) => !item)) return null;
  return { items: items as TableData[], nextCursor: value.nextCursor as string | null };
}

function parseTableListItem(value: unknown): TableData | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.tableId ?? ""))
    || typeof value.title !== "string" || typeof value.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.localDate)
    || typeof value.startLocalTime !== "string" || !/^\d{2}:\d{2}$/.test(value.startLocalTime)
    || typeof value.neighborhood !== "string" || value.seatPriceCents !== 2500 || value.currency !== "USD") return null;
  const ownRequest = parseOwnRequest(value.ownRequest);
  if (ownRequest === undefined || (ownRequest && ownRequest.tableId !== value.tableId)) return null;
  return { tableId: value.tableId as string, title: value.title, localDate: value.localDate, startLocalTime: value.startLocalTime,
    neighborhood: value.neighborhood, priceCents: 2500, ownRequest };
}

function parseRequest(value: unknown): RequestRecord | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.requestId ?? "")) || !uuidPattern.test(String(value.tableId ?? ""))
    || !states.has(value.state as RequestState) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
    || (value.declineReason !== null && typeof value.declineReason !== "string")) return null;
  const table = parseTableSummary(value.table);
  if (!table || !(value.tableInvitation === null || isRecord(value.tableInvitation))) return null;
  let tableInvitation: TableInvitationSummary | null = null;
  if (isRecord(value.tableInvitation)) {
    const offer = value.tableInvitation;
    if (!uuidPattern.test(String(offer.invitationId ?? "")) || !invitationStates.has(offer.state as TableInvitationHistorySummaryDTO["state"])
      || !invitationDeliveryStates.has(offer.deliveryState as TableInvitationDeliveryState) || typeof offer.createdAt !== "string"
      || !Number.isFinite(Date.parse(offer.createdAt))) return null;
    tableInvitation = { invitationId: offer.invitationId as string, state: offer.state as TableInvitationHistorySummaryDTO["state"],
      deliveryState: offer.deliveryState as TableInvitationDeliveryState, createdAt: offer.createdAt };
  }
  return {
    requestId: value.requestId as string,
    tableId: value.tableId as string,
    state: value.state as RequestState,
    createdAt: value.createdAt,
    declineReason: value.declineReason as string | null,
    table,
    tableInvitation,
  };
}

function parseTableSummary(value: unknown): TableData | null {
  if (!isRecord(value) || !uuidPattern.test(String(value.tableId ?? ""))
    || typeof value.title !== "string" || typeof value.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.localDate)
    || typeof value.startLocalTime !== "string" || !/^\d{2}:\d{2}$/.test(value.startLocalTime)
    || typeof value.neighborhood !== "string" || typeof value.isCurrentlyPublished !== "boolean") return null;
  return { tableId: value.tableId as string, title: value.title, localDate: value.localDate, startLocalTime: value.startLocalTime,
    neighborhood: value.neighborhood, isCurrentlyPublished: value.isCurrentlyPublished, previewOnly: true };
}

function parseRequests(value: unknown): Readonly<{ items: readonly RequestRecord[]; nextCursor: string | null }> | null {
  if (!isRecord(value) || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) return null;
  const items = value.items.map(parseRequest);
  if (items.some((item) => !item)) return null;
  return { items: items as RequestRecord[], nextCursor: value.nextCursor as string | null };
}

function safeError(error: Envelope | null): string {
  if (!error || error.ok) return "The service returned an unexpected response. Try again.";
  return error.error.safeMessage;
}

function invitationDeliveryMessage(state: TableInvitationDeliveryState): Readonly<{ label: string; detail: string }> {
  switch (state) {
    case "queued": return { label: "Email queued", detail: "The invitation is active. Email delivery has not been confirmed." };
    case "sending": return { label: "Email sending", detail: "The invitation is active while delivery is being attempted." };
    case "accepted": return { label: "Email provider accepted", detail: "The provider accepted the email. Inbox delivery is not confirmed." };
    case "delivered": return { label: "Delivery confirmed", detail: "The delivery provider reports the invitation email was delivered." };
    case "failed": return { label: "Email delivery failed", detail: "The invitation remains active. Contact the team if you need help opening it." };
    case "unknown": return { label: "Email outcome unknown", detail: "The invitation remains active while the team checks the delivery outcome." };
  }
}

function safeTablePath(tableId: string): string {
  return `/tables/${encodeURIComponent(tableId)}`;
}

function operationIdFor(key: string): string {
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && uuidPattern.test(existing)) return existing;
    const next = crypto.randomUUID();
    window.sessionStorage.setItem(key, next);
    return next;
  } catch { return crypto.randomUUID(); }
}

function clearOperationId(key: string): void {
  try { window.sessionStorage.removeItem(key); } catch { /* storage can be unavailable in private contexts */ }
}

function formatLocalDate(value: string, withDay = true): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: withDay ? "long" : undefined, month: "long", day: "numeric", year: "numeric",
  }).format(date);
}

function formatTime(value: string | undefined): string {
  if (!value) return "Time unavailable";
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(Date.UTC(2026, 0, 1, hour!, minute!));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(date);
}

function titleCase(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

export function MemberWorkspaceShell({ active, children }: { active: "tables" | "requests" | "seats"; children: ReactNode }) {
  return <main className="product-page member-tables-page">
    <header className="product-topbar">
      <a className="brand" href="/member" aria-label="Fifth Wheel member home"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions"><span className="product-workspace-label">MEMBER WORKSPACE</span><a className="account-action" href="/account/profile"><UserRound aria-hidden="true" />Account</a><SignOutButton /></div>
    </header>
    <div className="product-layout">
      <GuestSidebar active={active === "seats" ? "seats" : active === "requests" ? "requests" : active === "tables" ? "tables" : undefined} foot={active === "seats" ? "A Seat appears here only after verified payment." : "A request is a step toward a Table, not an invitation or a confirmed Seat."} />
      <div className="product-content member-tables-content">{children}</div>
    </div>
  </main>;
}

export function MemberTablesWorkspace() {
  const [state, setState] = useState<"loading" | "ready" | "unauthenticated" | "access_required" | "profile_incomplete" | "error">("loading");
  const [items, setItems] = useState<readonly TableData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", neighborhood: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSequence = useRef(0);

  const loadTables = useCallback(async (nextFilters: typeof filters, nextCursor: string | null = null, append = false) => {
    const sequence = ++requestSequence.current;
    if (append) setLoadingMore(true); else setState("loading");
    setErrorMessage("");
    const query = new URLSearchParams({ limit: "20" });
    if (nextFilters.dateFrom) query.set("dateFrom", nextFilters.dateFrom);
    if (nextFilters.dateTo) query.set("dateTo", nextFilters.dateTo);
    if (nextFilters.neighborhood.trim()) query.set("neighborhood", nextFilters.neighborhood.trim());
    if (nextCursor) query.set("cursor", nextCursor);
    try {
      const response = await fetch(`/api/tables?${query.toString()}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      const result = await readEnvelope(response);
      if (sequence !== requestSequence.current) return;
      if (response.status === 401 || (result && !result.ok && result.error.code === "unauthenticated")) {
        setState("unauthenticated"); setItems([]); return;
      }
      if (response.status === 403 || (result && !result.ok && result.error.code === "forbidden")) {
        setState("access_required"); setItems([]); return;
      }
      if (result && !result.ok && result.error.code === "profile_incomplete") {
        setState("profile_incomplete"); setItems([]); setErrorMessage(result.error.safeMessage); return;
      }
      if (!response.ok || !result || !result.ok) throw new Error(safeError(result));
      const page = parseTableList(result.data);
      if (!page) throw new Error("The published Table list could not be verified.");
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setState("ready");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Published Tables are temporarily unavailable.");
      if (!append) setItems([]);
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = { dateFrom: params.get("dateFrom") ?? "", dateTo: params.get("dateTo") ?? "", neighborhood: params.get("neighborhood") ?? "" };
    setFilters(initial);
    void loadTables(initial);
    const onPopState = () => {
      const current = new URLSearchParams(window.location.search);
      const next = { dateFrom: current.get("dateFrom") ?? "", dateTo: current.get("dateTo") ?? "", neighborhood: current.get("neighborhood") ?? "" };
      setFilters(next); void loadTables(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("popstate", onPopState); requestSequence.current += 1; };
  }, [loadTables]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.neighborhood.trim()) params.set("neighborhood", filters.neighborhood.trim());
    window.history.pushState({}, "", `/tables${params.size ? `?${params}` : ""}`);
    void loadTables(filters);
  }

  function clearFilters() {
    const empty = { dateFrom: "", dateTo: "", neighborhood: "" };
    setFilters(empty);
    window.history.pushState({}, "", "/tables");
    void loadTables(empty);
  }

  const content = <>
    <div className="product-breadcrumb">Member <span>/</span> Tables</div>
    <div className="tables-heading-row"><div><p className="eyebrow">FIND YOUR PEOPLE</p><h1 id="tables-heading">An evening worth<br /><em>looking forward to.</em></h1><p className="page-intro">Browse upcoming published Tables in Atlanta. A request starts a conversation; it is not an invitation or a confirmed Seat.</p></div><span className="tables-heading-mark"><Utensils aria-hidden="true" /></span></div>
    <form className="table-filter-panel" onSubmit={applyFilters} aria-label="Filter published Tables">
      <div className="table-filter-intro"><span><CalendarDays aria-hidden="true" /></span><div><strong>Find a night that fits</strong><small>Dates are shown in Atlanta local time.</small></div></div>
      <label>From<input type="date" value={filters.dateFrom} onChange={(event) => { const dateFrom = event.currentTarget.value; setFilters((value) => ({ ...value, dateFrom })); }} /></label>
      <label>To<input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => { const dateTo = event.currentTarget.value; setFilters((value) => ({ ...value, dateTo })); }} /></label>
      <label className="table-filter-neighborhood">Neighborhood<input type="text" maxLength={120} value={filters.neighborhood} placeholder="Any Atlanta neighborhood" onChange={(event) => { const neighborhood = event.currentTarget.value; setFilters((value) => ({ ...value, neighborhood })); }} /></label>
      <button className="button button-primary table-filter-submit" type="submit">Apply filters<ArrowRight aria-hidden="true" /></button>
    </form>
    {state === "loading" && <TableState icon={<span className="entry-loader small" />} title="Finding upcoming Tables" detail="Checking the current published schedule." />}
    {state === "unauthenticated" && <TableState error title="Sign in to browse Tables" detail="Your Table search will be ready after you sign in." action={<a className="button button-primary" href="/sign-in?returnTo=%2Ftables">Continue to sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "access_required" && <TableState error title="An app invitation is required" detail="Joining the waitlist does not grant app access. Sign in with the email address that received your app invitation." action={<a className="button button-primary" href="/sign-in?returnTo=%2Ftables">Use an admitted account<ArrowRight aria-hidden="true" /></a>} />}
    {state === "profile_incomplete" && <TableState error title="Finish your profile to browse" detail={errorMessage || "Published Tables are available to members with an approved profile."} action={<a className="button button-primary" href="/account/profile?returnTo=%2Ftables">Complete your profile<ArrowRight aria-hidden="true" /></a>} />}
    {state === "error" && <TableState error title="Tables are temporarily unavailable" detail={errorMessage || "We could not verify the published schedule. No sample Tables are shown."} action={<button className="button button-outline" type="button" onClick={() => void loadTables(filters)}>Try again<ArrowRight aria-hidden="true" /></button>} />}
    {state === "ready" && items.length === 0 && <TableState title="No upcoming Tables match yet" detail="Try a wider date range or remove the neighborhood filter. We’ll show a Table here only after staff publish it." action={<button className="button button-outline" type="button" onClick={clearFilters}>Clear filters<X aria-hidden="true" /></button>} />}
    {state === "ready" && items.length > 0 && <>
      <div className="tables-results-heading"><div><p className="eyebrow">UPCOMING IN ATLANTA</p><h2>{items.length === 1 ? "A table to consider" : "Tables to consider"}</h2></div><div className="tables-results-tools"><p>{cursor ? "More nights are available below." : "Every evening follows a three-stop itinerary."}</p>{(filters.dateFrom || filters.dateTo || filters.neighborhood.trim()) && <button className="button button-outline table-clear-filters" type="button" onClick={clearFilters}>Clear filters<X aria-hidden="true" /></button>}</div></div>
      <div className="table-card-grid">{items.map((table) => <article className="member-table-card" key={table.tableId}>
        <div className="member-table-card-top"><span className="table-date-icon"><CalendarDays aria-hidden="true" /></span><span className="table-card-price">$25 <small>total</small></span></div>
        <p className="table-card-date">{formatLocalDate(table.localDate)}</p><h3>{table.title}</h3>
        <p className="table-card-meta"><MapPin aria-hidden="true" />{table.neighborhood}<span aria-hidden="true">·</span><Clock3 aria-hidden="true" />{formatTime(table.startLocalTime)}</p>
        <a className="button button-outline table-card-link" href={safeTablePath(table.tableId)}>View Table<ArrowRight aria-hidden="true" /></a>
      </article>)}</div>
      {cursor && <div className="table-load-more"><button className="button button-outline" type="button" onClick={() => void loadTables(filters, cursor, true)} disabled={loadingMore}>{loadingMore ? "Loading more…" : "Load more Tables"}<ChevronDown aria-hidden="true" /></button></div>}
    </>}
  </>;
  return state === "access_required" || state === "unauthenticated"
    ? <PublicTableShell returnTo="/tables">{content}</PublicTableShell>
    : <MemberWorkspaceShell active="tables">{content}</MemberWorkspaceShell>;
}

function PublicTableShell({ returnTo, children }: { returnTo: string; children: ReactNode }) {
  return <main className="product-page member-tables-page public-table-page">
    <header className="product-topbar">
      <a className="brand" href="/" aria-label="Fifth Wheel home"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions"><span className="product-workspace-label">SHARED TABLE</span><a className="account-action" href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in<ArrowRight aria-hidden="true" /></a></div>
    </header>
    <div className="public-table-content">{children}</div>
  </main>;
}

export function MemberTableDetailWorkspace({ tableId }: { tableId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "preview" | "unauthenticated" | "access_required" | "profile_incomplete" | "not_found" | "error">("loading");
  const [table, setTable] = useState<TableData | null>(null);
  const [message, setMessage] = useState("");
  const [actionState, setActionState] = useState<"idle" | "working" | "error">("idle");
  const [shareMessage, setShareMessage] = useState("");
  const [continueTo, setContinueTo] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/tables/${encodeURIComponent(tableId)}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      const result = await readEnvelope(response);
      if (result && !result.ok && result.error.code === "not_found") { setState("not_found"); return; }
      if (result && !result.ok && result.error.code === "not_future") { setState("not_found"); setMessage("This Table is no longer upcoming."); return; }
      if (result && !result.ok && result.error.code === "profile_incomplete") { setState("profile_incomplete"); setMessage(result.error.safeMessage); return; }
      if (result && !result.ok && result.error.code === "unauthenticated") { setState("unauthenticated"); setMessage(result.error.safeMessage); return; }
      if (response.status === 403 || (result && !result.ok && result.error.code === "forbidden")) { setState("access_required"); setMessage(result && !result.ok ? result.error.safeMessage : "App member access is required to view this Table."); return; }
      if (!response.ok || !result || !result.ok) throw new Error(safeError(result));
      if (!isRecord(result.data) || (result.data.view !== "preview" && result.data.view !== "member")) throw new Error("The Table details could not be verified.");
      const candidate = result.data.view === "preview" ? parseTablePreview(result.data.table) : parseTable(result.data.table);
      if (!candidate) throw new Error("The Table details could not be verified.");
      setTable(candidate);
      setState(result.data.view === "preview" || candidate.previewOnly ? "preview" : "ready");
      setContinueTo(safeTablePath(candidate.tableId));
    } catch (error) {
      setState("error"); setMessage(error instanceof Error ? error.message : "The Table could not load."); setTable(null);
    }
  }, [tableId]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  async function requestSeat() {
    if (!table || table.previewOnly || actionState === "working") return;
    setActionState("working"); setMessage("");
    const storageKey = `fw-seat-request-op-${table.tableId}`;
    const operationId = operationIdFor(storageKey);
    try {
      const response = await fetch(`/api/tables/${encodeURIComponent(table.tableId)}/requests`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operationId }),
      });
      const result = await readEnvelope(response);
      if (response.ok && result?.ok) {
        clearOperationId(storageKey);
        await loadDetail();
        setMessage("Request received — awaiting review.");
        setActionState("idle");
        return;
      }
      if (result && !result.ok) {
        if (["profile_incomplete", "not_found", "not_future", "forbidden", "validation_failed", "operation_conflict", "invalid_transition", "unauthenticated"].includes(result.error.code)) clearOperationId(storageKey);
        if (result.error.code === "profile_incomplete") setState("profile_incomplete");
        setMessage(result.error.safeMessage);
      } else {
        setMessage("We could not confirm your request. Check Requests before trying again.");
      }
      setActionState("error");
    } catch {
      setMessage("We could not confirm your request. Check Requests before trying again.");
      setActionState("error");
    }
  }

  async function withdrawRequest() {
    if (!table || table.ownRequest?.state !== "pending" || actionState === "working") return;
    setActionState("working"); setMessage("");
    const storageKey = `fw-seat-request-withdraw-op-${table.tableId}`;
    const operationId = operationIdFor(storageKey);
    try {
      const requestId = table.ownRequest?.requestId;
      if (!requestId || !uuidPattern.test(requestId)) throw new Error("The request identifier could not be verified.");
      const response = await fetch(`/api/me/requests/${encodeURIComponent(requestId)}/withdraw`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operationId }),
      });
      const result = await readEnvelope(response);
      if (response.ok && result?.ok) {
        clearOperationId(storageKey);
        await loadDetail();
        setMessage("Your request was withdrawn. It will remain in Requests history.");
        setActionState("idle");
        return;
      }
      setMessage(result && !result.ok ? result.error.safeMessage : "We could not confirm withdrawal. Refresh the Table before retrying.");
      setActionState("error");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not confirm withdrawal. Refresh the Table before retrying.");
      setActionState("error");
    }
  }

  async function shareTable() {
    const path = safeTablePath(tableId);
    const absolute = new URL(path, window.location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: table?.title ?? "Fifth Wheel Table", url: absolute });
      else { await navigator.clipboard.writeText(absolute); setShareMessage("Table link copied. Anyone who opens it follows the same sign-in and profile gates."); }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareMessage("This link could not be shared from your browser. Copy the address to share it.");
    }
  }

  const content = <>
    <div className="product-breadcrumb"><a href="/tables">Tables</a><span>/</span>Table detail</div>
    {state === "loading" && <TableState icon={<span className="entry-loader small" />} title="Opening the Table" detail="Checking the current published details." />}
    {state === "unauthenticated" && table ? <TablePreview table={table} continueTo={continueTo ?? safeTablePath(tableId)} />
      : state === "unauthenticated" ? <TableState error title="Sign in to continue" detail="This Table link can be opened after you sign in." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(safeTablePath(tableId))}`}>Sign in to continue<ArrowRight aria-hidden="true" /></a>} />
      : null}
    {state === "preview" && table && <TablePreview table={table} continueTo={safeTablePath(table.tableId)} />}
    {state === "access_required" && <TableState error title="An app invitation is required" detail={message || "Waitlist signup does not grant access to the full Table. Sign in with an admitted app account to continue."} action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(safeTablePath(tableId))}`}>Use an admitted account<ArrowRight aria-hidden="true" /></a>} />}
    {state === "profile_incomplete" && <TableState error title="Complete your profile first" detail={message || "A profile approved by the team is needed to view the itinerary and request a Seat."} action={<a className="button button-primary" href={`/account/profile?returnTo=${encodeURIComponent(safeTablePath(tableId))}`}>Continue to your profile<ArrowRight aria-hidden="true" /></a>} />}
    {state === "not_found" && <TableState error title="This Table isn’t available" detail={message || "It may have passed or is no longer published. We don’t have enough current information to show its details."} action={<a className="button button-outline" href="/tables"><ArrowLeft aria-hidden="true" />Browse upcoming Tables</a>} />}
    {state === "error" && <TableState error title="Table details are temporarily unavailable" detail={message || "We couldn’t verify this published Table, so its itinerary and price are hidden."} action={<button className="button button-outline" type="button" onClick={() => void loadDetail()}>Try again<ArrowRight aria-hidden="true" /></button>} />}
    {state === "ready" && table && table.stops && table.startLocalTime && <>
      <div className="member-table-detail-heading"><p className="eyebrow">A FIFTH WHEEL EVENING</p><p className="table-detail-date">{formatLocalDate(table.localDate)}</p><h1>{table.title}</h1><p className="table-card-meta"><MapPin aria-hidden="true" />{table.neighborhood}<span aria-hidden="true">·</span><Clock3 aria-hidden="true" />Starts at {formatTime(table.startLocalTime)} Atlanta time</p></div>
      <div className="table-detail-layout">
        <section className="table-itinerary-card" aria-labelledby="itinerary-title"><div className="table-section-heading"><span><Utensils aria-hidden="true" /></span><div><p className="eyebrow">THREE STOPS, ONE GOOD NIGHT</p><h2 id="itinerary-title">Your itinerary</h2></div></div>
          <ol className="table-itinerary-list">{table.stops.map((stop, index) => <li key={`${stop.role}-${index}`}><span className="table-itinerary-step">0{index + 1}</span><div><p className="table-stop-role">{titleCase(stop.role)}{stop.minutesFromStart === 0 ? " · Start" : ` · ${stop.minutesFromStart} min later`}</p><h3>{stop.venueName}</h3><p className="table-stop-address">{stop.venueAddress}</p>{stop.publicNotes && <p className="table-stop-note">{stop.publicNotes}</p>}</div></li>)}</ol>
        </section>
        <aside className="table-request-card" aria-labelledby="request-card-title"><p className="eyebrow">YOUR NEXT STEP</p><h2 id="request-card-title">A seat at this Table</h2><div className="table-price"><strong>$25</strong><span>total for one Seat</span></div><p>Send a request for the team to consider. This is not a Table invitation, guaranteed place, or payment.</p>
          {table.ownRequest?.state === "pending" ? <div className="table-own-request pending"><span><Check aria-hidden="true" /></span><div><strong>Request received — awaiting review.</strong><small>The team will review your request. You can withdraw while it is pending.</small></div></div>
            : table.ownRequest?.state === "declined" ? <div className="table-own-request declined"><span><CircleAlert aria-hidden="true" /></span><div><strong>This request was declined.</strong><small>{table.ownRequest.declineReason || "See Requests for your history."}</small></div></div>
              : table.ownRequest?.state === "withdrawn" ? <div className="table-own-request withdrawn"><span><X aria-hidden="true" /></span><div><strong>Your earlier request was withdrawn.</strong><small>You can send a new request if you are still interested.</small></div></div>
                : table.ownRequest?.state === "closed_by_table" ? <div className="table-own-request declined"><span><CircleAlert aria-hidden="true" /></span><div><strong>This Table was cancelled.</strong><small>Any payment you made will be refunded. See Requests and My Seats for status.</small></div></div>
                : null}
          {table.ownRequest?.state !== "pending" && table.ownRequest?.state !== "closed_by_table" && <button className="button button-primary table-request-submit" type="button" onClick={() => void requestSeat()} disabled={actionState === "working"}>{actionState === "working" ? "Sending request…" : table.ownRequest?.state === "withdrawn" || table.ownRequest?.state === "declined" ? "Request again" : "Request a Seat"}<ArrowRight aria-hidden="true" /></button>}
          {table.ownRequest?.state === "pending" && <button className="button button-outline table-request-submit" type="button" onClick={() => void withdrawRequest()} disabled={actionState === "working"}>{actionState === "working" ? "Withdrawing…" : "Withdraw request"}<X aria-hidden="true" /></button>}
          <button className="table-share-action" type="button" onClick={() => void shareTable()}><Share2 aria-hidden="true" />Share this Table link</button>
          {shareMessage && <p className="table-share-message" role="status">{shareMessage}</p>}
          {message && actionState !== "idle" && <p className={`table-action-message ${actionState === "error" ? "is-error" : ""}`} role={actionState === "error" ? "alert" : "status"}>{message}</p>}
          <a className="table-requests-link" href="/requests">See your Requests<ArrowRight aria-hidden="true" /></a>
        </aside>
      </div>
    </>}
  </>;
  return state === "preview" || state === "access_required" || state === "unauthenticated"
    ? <PublicTableShell returnTo={safeTablePath(table?.tableId ?? tableId)}>{content}</PublicTableShell>
    : <MemberWorkspaceShell active="tables">{content}</MemberWorkspaceShell>;
}

function TablePreview({ table, continueTo }: { table: TableData; continueTo: string }) {
  return <section className="table-preview-card" aria-labelledby="table-preview-title">
    <span className="table-preview-icon"><Table2 aria-hidden="true" /></span><p className="eyebrow">SHARED TABLE PREVIEW</p><h1 id="table-preview-title">{table.title}</h1>
    <p className="table-card-meta"><MapPin aria-hidden="true" />{table.neighborhood}<span aria-hidden="true">·</span><CalendarDays aria-hidden="true" />{formatLocalDate(table.localDate, false)}</p>
    <p className="table-preview-boundary">Sign in with an admitted member account and complete an approved profile to see the itinerary and request a Seat. Sharing this link does not invite anyone or reserve a place.</p>
    <a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(continueTo)}`}>Sign in to continue<ArrowRight aria-hidden="true" /></a>
  </section>;
}

export function MemberRequestsWorkspace() {
  const [state, setState] = useState<"loading" | "ready" | "unauthenticated" | "profile_incomplete" | "error">("loading");
  const [items, setItems] = useState<readonly RequestRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const loadRequests = useCallback(async (nextCursor: string | null = null, append = false) => {
    const sequence = ++loadSequence.current;
    if (append) setLoadingMore(true); else setState("loading");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (nextCursor) query.set("cursor", nextCursor);
      const response = await fetch(`/api/me/requests?${query.toString()}`, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      const result = await readEnvelope(response);
      if (sequence !== loadSequence.current) return;
      if (response.status === 401 || (result && !result.ok && result.error.code === "unauthenticated")) { setState("unauthenticated"); setItems([]); return; }
      if (result && !result.ok && result.error.code === "profile_incomplete") { setState("profile_incomplete"); setItems([]); setMessage(result.error.safeMessage); return; }
      if (!response.ok || !result || !result.ok) throw new Error(safeError(result));
      const page = parseRequests(result.data);
      if (!page) throw new Error("Your request history could not be verified.");
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor); setState("ready"); setMessage("");
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setState("error"); setMessage(error instanceof Error ? error.message : "Requests are temporarily unavailable."); if (!append) setItems([]);
    } finally { if (sequence === loadSequence.current) setLoadingMore(false); }
  }, []);

  useEffect(() => { void loadRequests(); return () => { loadSequence.current += 1; }; }, [loadRequests]);

  async function withdraw(item: RequestRecord) {
    if (item.state !== "pending" || actionId) return;
    setActionId(item.requestId); setMessage("");
    const key = `fw-request-withdraw-op-${item.requestId}`;
    const operationId = operationIdFor(key);
    try {
      const response = await fetch(`/api/me/requests/${encodeURIComponent(item.requestId)}/withdraw`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ operationId }),
      });
      const result = await readEnvelope(response);
      if (response.ok && result?.ok) { clearOperationId(key); await loadRequests(); return; }
      if (result && !result.ok && ["not_found", "forbidden", "validation_failed", "invalid_transition", "operation_conflict", "unauthenticated"].includes(result.error.code)) clearOperationId(key);
      setMessage(result && !result.ok ? result.error.safeMessage : "We could not confirm withdrawal. Refresh Requests before trying again.");
    } catch { setMessage("We could not confirm withdrawal. Refresh Requests before trying again."); }
    finally { setActionId(null); }
  }

  return <MemberWorkspaceShell active="requests">
    <div className="product-breadcrumb">Member <span>/</span> Requests</div>
    <div className="tables-heading-row requests-heading-row"><div><p className="eyebrow">YOUR TABLE JOURNEY</p><h1 id="requests-heading">Every request,<br /><em>right here.</em></h1><p className="page-intro">Follow your requests for staff consideration. A pending request is not an invitation or a promise of a Seat.</p></div><span className="tables-heading-mark"><ClipboardList aria-hidden="true" /></span></div>
    {state === "loading" && <TableState icon={<span className="entry-loader small" />} title="Loading your requests" detail="Checking your latest request history." />}
    {state === "unauthenticated" && <TableState error title="Sign in to view Requests" detail="Your request history is private to your admitted member account." action={<a className="button button-primary" href="/sign-in?returnTo=%2Frequests">Continue to sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "profile_incomplete" && <TableState error title="Requests aren’t available yet" detail={message || "Complete your profile to use member requests."} action={<a className="button button-primary" href="/account/profile">Complete your profile<ArrowRight aria-hidden="true" /></a>} />}
    {state === "error" && <TableState error title="Requests are temporarily unavailable" detail={message || "Your saved requests were not changed."} action={<button className="button button-outline" type="button" onClick={() => void loadRequests()}>Try again<ArrowRight aria-hidden="true" /></button>} />}
    {state === "ready" && items.length === 0 && <TableState title="No requests yet" detail="When you ask the team to consider you for a Table, it will appear here. Requests do not reserve or charge for a Seat." action={<a className="button button-primary" href="/tables">Browse Tables<ArrowRight aria-hidden="true" /></a>} />}
    {state === "ready" && items.length > 0 && <div className="request-history-list">{items.map((item) => <article className="request-history-card" key={item.requestId}>
      <div className="request-history-main"><span className={`request-state-icon state-${item.state}`}>{item.state === "pending" ? <Clock3 aria-hidden="true" /> : item.state === "withdrawn" ? <X aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}</span><div><p className="eyebrow">{item.tableInvitation?.state === "active" ? "SEAT REQUEST · STILL PENDING" : item.state === "pending" ? "AWAITING REVIEW" : item.state === "withdrawn" ? "WITHDRAWN" : item.state === "closed_by_table" ? "TABLE CANCELLED" : "REQUEST UPDATE"}</p><h2>{item.table.title}</h2><p className="table-card-meta"><MapPin aria-hidden="true" />{item.table.neighborhood}<span aria-hidden="true">·</span><CalendarDays aria-hidden="true" />{formatLocalDate(item.table.localDate, false)}</p></div></div>
      <div className="request-history-status"><span className={`status-pill ${item.state === "pending" ? "" : item.state === "declined" ? "status-pill-alert" : ""}`}>{REQUEST_STATE_LABEL[item.state]}</span><p>Requested {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(item.createdAt))}</p>{item.state === "declined" && item.declineReason && <p className="request-decline-explanation">{item.declineReason}</p>}{item.state === "pending" && item.tableInvitation?.state !== "active" && <button className="button button-outline request-withdraw-button" type="button" onClick={() => void withdraw(item)} disabled={actionId === item.requestId}>{actionId === item.requestId ? "Withdrawing…" : "Withdraw request"}<X aria-hidden="true" /></button>}</div>
      {item.tableInvitation && <section className={`request-offer-card offer-${item.tableInvitation.state}`} aria-label="Table invitation status">
        <div className="request-offer-heading"><span className="request-offer-icon"><Ticket aria-hidden="true" /></span><div><p className="eyebrow">TABLE INVITATION</p><strong>{INVITATION_STATE_HEADING[item.tableInvitation.state]}</strong></div><span className={`status-pill ${item.tableInvitation.state === "active" ? "status-pill-success" : "status-pill-neutral"}`}>{INVITATION_STATE_PILL[item.tableInvitation.state]}</span></div>
        {item.tableInvitation.state === "active" && <p className="request-offer-boundary">This is a separate offer. Your Seat request remains in history, and this invitation does not confirm a paid Seat.</p>}
        <div className="request-offer-delivery"><Mail aria-hidden="true" /><span><strong>{invitationDeliveryMessage(item.tableInvitation.deliveryState).label}</strong><small>{invitationDeliveryMessage(item.tableInvitation.deliveryState).detail}</small></span></div>
        <a className="request-offer-link" href={`/invitations/${encodeURIComponent(item.tableInvitation.invitationId)}`}>Review Table invitation<ArrowRight aria-hidden="true" /></a>
        {item.state === "pending" && item.tableInvitation.state === "active" && <p className="request-offer-withdraw-note">Request withdrawal is unavailable while this invitation is active. This offer is managed separately.</p>}
      </section>}
      {item.table.isCurrentlyPublished
        ? <a className="request-table-link" href={safeTablePath(item.tableId)}>View Table details<ArrowRight aria-hidden="true" /></a>
        : <p className="request-table-unavailable">This Table is no longer published. Your request history remains here.</p>}
    </article>)}</div>}
    {message && state === "ready" && <p className="table-action-message is-error" role="alert">{message}</p>}
    {cursor && state === "ready" && <div className="table-load-more"><button className="button button-outline" type="button" onClick={() => void loadRequests(cursor, true)} disabled={loadingMore}>{loadingMore ? "Loading more…" : "Load earlier requests"}<ChevronDown aria-hidden="true" /></button></div>}
  </MemberWorkspaceShell>;
}

function TableState({ title, detail, action, error = false, icon }: { title: string; detail: string; action?: ReactNode; error?: boolean; icon?: ReactNode }) {
  return <section className={`table-data-state ${error ? "is-error" : ""}`} role={error ? "alert" : icon ? "status" : undefined} aria-live={error || icon ? "polite" : undefined}>
    <span className="table-data-icon">{icon ?? (error ? <CircleAlert aria-hidden="true" /> : <Table2 aria-hidden="true" />)}</span><h2>{title}</h2><p>{detail}</p>{action}
  </section>;
}
