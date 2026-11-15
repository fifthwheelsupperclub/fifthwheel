import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { calendarDate, clockAfter, eventDate, eventTime, eventWhen, instantDate, monthDay, todayInAtlanta, weekStart } from "../format/datetime";
import { buttonClass } from "./ui/button";
import { PageHeader } from "./ui/page-header";
import { PageState } from "./ui/page-state";
import { StatusBadge, type BadgeTone } from "./ui/status-badge";
import { AppShell } from "./app-shell";
import { INVITATION_STATE_HEADING, INVITATION_STATE_PILL, REQUEST_STATE_LABEL, type RequestState } from "../copy/states.ts";
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, CircleAlert, ClipboardList, Clock3,
  House, MapPin, Share2, Table2, Ticket, UserRound, Utensils, X,
} from "lucide-react";
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

const formatLocalDate = (value: string, withDay = true) => (withDay ? eventDate(value, { long: true }) : calendarDate(value));

const formatTime = (value: string | undefined) => eventTime(value);

function titleCase(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }

export function MemberWorkspaceShell({ active, children }: { active: "tables" | "requests" | "seats"; children: ReactNode }) {
  return <AppShell role="guest" active={active} className="member-tables-page" contentClassName="member-tables-content">{children}</AppShell>;
}

export function MemberTablesWorkspace() {
  const [state, setState] = useState<"loading" | "ready" | "unauthenticated" | "access_required" | "profile_incomplete" | "error">("loading");
  const [items, setItems] = useState<readonly TableData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", neighborhood: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSequence = useRef(0);
  const lastApplied = useRef("");

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
      setErrorMessage(error instanceof Error ? error.message : "Try again in a moment.");
      if (!append) setItems([]);
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = { dateFrom: params.get("dateFrom") ?? "", dateTo: params.get("dateTo") ?? "", neighborhood: params.get("neighborhood") ?? "" };
    setFilters(initial);
    lastApplied.current = JSON.stringify(initial);
    void loadTables(initial);
    const onPopState = () => {
      const current = new URLSearchParams(window.location.search);
      const next = { dateFrom: current.get("dateFrom") ?? "", dateTo: current.get("dateTo") ?? "", neighborhood: current.get("neighborhood") ?? "" };
      setFilters(next); lastApplied.current = JSON.stringify(next); void loadTables(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => { window.removeEventListener("popstate", onPopState); requestSequence.current += 1; };
  }, [loadTables]);

  function pushFilters(next: typeof filters, replace: boolean) {
    const params = new URLSearchParams();
    if (next.dateFrom) params.set("dateFrom", next.dateFrom);
    if (next.dateTo) params.set("dateTo", next.dateTo);
    if (next.neighborhood.trim()) params.set("neighborhood", next.neighborhood.trim());
    const url = `/tables${params.size ? `?${params}` : ""}`;
    if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
  }

  // Filters apply as they change (dates at once, typing after a short pause); Enter applies immediately.
  useEffect(() => {
    const key = JSON.stringify(filters);
    if (key === lastApplied.current) return;
    const timer = window.setTimeout(() => { lastApplied.current = key; pushFilters(filters, true); void loadTables(filters); }, 350);
    return () => window.clearTimeout(timer);
  }, [filters, loadTables]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    lastApplied.current = JSON.stringify(filters);
    pushFilters(filters, false);
    void loadTables(filters);
  }

  function clearFilters() {
    const empty = { dateFrom: "", dateTo: "", neighborhood: "" };
    setFilters(empty);
    lastApplied.current = JSON.stringify(empty);
    window.history.pushState({}, "", "/tables");
    void loadTables(empty);
  }

  const hasFilters = Boolean(filters.dateFrom || filters.dateTo || filters.neighborhood);
  const today = todayInAtlanta();
  const thisWeek = weekStart(today);
  const nextWeek = weekStart(new Date(Date.parse(`${thisWeek}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10));
  const weekLabel = (start: string) => start <= thisWeek ? "This week" : start === nextWeek ? "Next week" : `Week of ${monthDay(start)}`;
  const weeks: Array<{ start: string; label: string; tables: TableData[] }> = [];
  for (const table of items) {
    const start = weekStart(table.localDate);
    const last = weeks[weeks.length - 1];
    if (last && last.start === start) last.tables.push(table); else weeks.push({ start, label: weekLabel(start), tables: [table] });
  }
  const requestBadge = (table: TableData) => {
    const state = table.ownRequest?.state;
    return state ? <StatusBadge tone={state === "pending" ? "pending" : state === "declined" ? "danger" : "neutral"}>{REQUEST_STATE_LABEL[state]}</StatusBadge> : null;
  };

  const showFilters = state === "loading" || state === "ready";
  const content = <>
    <PageHeader titleId="tables-heading" title="Tables" description="Upcoming evenings in Atlanta. Request a seat at any that suit you." />
    {showFilters && <form className="tbl-filters" onSubmit={applyFilters} aria-label="Filter published Tables">
      <label>From<input type="date" value={filters.dateFrom} onChange={(event) => { const dateFrom = event.currentTarget.value; setFilters((value) => ({ ...value, dateFrom })); }} /></label>
      <label>To<input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => { const dateTo = event.currentTarget.value; setFilters((value) => ({ ...value, dateTo })); }} /></label>
      <label className="tbl-filter-neighborhood">Neighborhood<input type="text" maxLength={120} value={filters.neighborhood} placeholder="Any neighborhood" onChange={(event) => { const neighborhood = event.currentTarget.value; setFilters((value) => ({ ...value, neighborhood })); }} /></label>
      {hasFilters && <button className="button button-tertiary" type="button" onClick={clearFilters}>Clear filters</button>}
    </form>}
    {state === "loading" && <PageState variant="loading" title="Loading tables…" />}
    {state === "unauthenticated" && <PageState variant="signed-out" title="Sign in to browse Tables" message="Your Table search will be ready after you sign in." action={<a className="button button-primary" href="/sign-in?returnTo=%2Ftables">Continue to sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "access_required" && <PageState variant="no-access" title="You don’t have access yet" message="If you joined the waitlist, we’ll email you when you’re in. Already in? Sign in with that email." action={<a className="button button-primary" href="/sign-in?returnTo=%2Ftables">Sign in with a different email<ArrowRight aria-hidden="true" /></a>} />}
    {state === "profile_incomplete" && <PageState variant="no-access" title="Finish your profile to see tables" message={errorMessage || "We review every profile before you can browse."} action={<a className="button button-primary" href="/account/profile?returnTo=%2Ftables">Complete your profile<ArrowRight aria-hidden="true" /></a>} />}
    {state === "error" && <PageState variant="error" title="We couldn’t load tables" message={errorMessage || "Try again in a moment."} action={<button className="button button-outline" type="button" onClick={() => void loadTables(filters)}>Try again</button>} />}
    {state === "ready" && items.length === 0 && <PageState variant="empty" title={hasFilters ? "No tables match those dates" : "No tables yet"} message={hasFilters ? "Try different dates or another neighborhood." : "New evenings are added regularly. Check back soon."} />}
    {state === "ready" && items.length > 0 && <>
      <p className="tbl-zone">Times are Atlanta time.</p>
      {weeks.map((week) => <section className="tbl-week" key={week.start} aria-label={week.label}>
        <h2>{week.label}</h2>
        <div className="tbl-grid">{week.tables.map((table) => <a className="tbl-card" key={table.tableId} href={safeTablePath(table.tableId)}>
          <span className="tbl-date"><small>{eventDate(table.localDate).split(",")[0]}</small><strong>{monthDay(table.localDate).split(" ")[1]}</strong></span>
          <span className="tbl-main"><h3>{table.title}</h3><span>{table.neighborhood} · {formatTime(table.startLocalTime)}</span></span>
          <span className="tbl-side"><strong>${((table.priceCents ?? 2500) / 100).toFixed(0)}</strong>{requestBadge(table)}</span>
        </a>)}</div>
      </section>)}
      {cursor && <div className="table-load-more"><button className="button button-outline" type="button" onClick={() => void loadTables(filters, cursor, true)} disabled={loadingMore}>{loadingMore ? "Loading…" : "Show more"}<ChevronDown aria-hidden="true" /></button></div>}
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
        setMessage("We’re not sure your request went through. Check Requests before trying again.");
      }
      setActionState("error");
    } catch {
      setMessage("We’re not sure your request went through. Check Requests before trying again.");
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
      setMessage(result && !result.ok ? result.error.safeMessage : "We’re not sure your request was withdrawn. Refresh the page to check.");
      setActionState("error");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We’re not sure your request was withdrawn. Refresh the page to check.");
      setActionState("error");
    }
  }

  async function shareTable() {
    const path = safeTablePath(tableId);
    const absolute = new URL(path, window.location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: table?.title ?? "Fifth Wheel Table", url: absolute });
      else { await navigator.clipboard.writeText(absolute); setShareMessage("Link copied. Friends will need their own access to request a seat."); }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareMessage("Couldn’t share from this browser. Copy the address bar instead.");
    }
  }

  const content = <>
    <a href="/tables" className="page-header-back"><ArrowLeft aria-hidden="true" />Tables</a>
    {state === "loading" && <PageState variant="loading" title="Opening the Table" />}
    {state === "unauthenticated" && table ? <TablePreview table={table} continueTo={continueTo ?? safeTablePath(tableId)} />
      : state === "unauthenticated" ? <PageState variant="signed-out" title="Sign in to continue" message="This Table link can be opened after you sign in." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(safeTablePath(tableId))}`}>Sign in to continue<ArrowRight aria-hidden="true" /></a>} />
      : null}
    {state === "preview" && table && <TablePreview table={table} continueTo={safeTablePath(table.tableId)} />}
    {state === "access_required" && <PageState variant="no-access" title="You don’t have access yet" message={message || "If you joined the waitlist, we’ll email you when you’re in. Already in? Sign in with that email."} action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(safeTablePath(tableId))}`}>Sign in with a different email<ArrowRight aria-hidden="true" /></a>} />}
    {state === "profile_incomplete" && <PageState variant="no-access" title="Finish your profile first" message={message || "Finish your profile to see the plan and request a seat."} action={<a className="button button-primary" href={`/account/profile?returnTo=${encodeURIComponent(safeTablePath(tableId))}`}>Continue to your profile<ArrowRight aria-hidden="true" /></a>} />}
    {state === "not_found" && <PageState variant="empty" title="This table isn’t available" message={message || "It may have already happened or been removed."} action={<a className="button button-outline" href="/tables"><ArrowLeft aria-hidden="true" />Browse upcoming Tables</a>} />}
    {state === "error" && <PageState variant="error" title="Table details are temporarily unavailable" message={message || "We couldn’t verify this published Table, so its itinerary and price are hidden."} action={<button className="button button-outline" type="button" onClick={() => void loadDetail()}>Try again<ArrowRight aria-hidden="true" /></button>} />}
    {state === "ready" && table && table.stops && table.startLocalTime && <>
      <PageHeader titleId="table-title" title={table.title} description={`${eventWhen(table.localDate, table.startLocalTime)} · ${table.neighborhood}`} />
      <div className="table-detail-layout">
        <section className="table-itinerary-card" aria-labelledby="itinerary-title"><h2 id="itinerary-title">The evening</h2>
          <ol className="table-itinerary-list">{table.stops.map((stop, index) => <li key={`${stop.role}-${index}`}><span className="table-itinerary-step">0{index + 1}</span><div><p className="table-stop-role">{titleCase(stop.role)} · {clockAfter(table.startLocalTime ?? "", stop.minutesFromStart)}</p><h3>{stop.venueName}</h3><p className="table-stop-address">{stop.venueAddress}</p>{stop.publicNotes && <p className="table-stop-note">{stop.publicNotes}</p>}</div></li>)}</ol>
        </section>
        <aside className="table-request-card" aria-labelledby="request-card-title"><h2 id="request-card-title">Request a seat</h2><div className="table-price"><strong>$25</strong><span>per seat, only if you’re invited</span></div><p>Nothing is charged now. We’ll let you know if you’re invited.</p>
          {table.ownRequest?.state === "pending" ? <div className="table-own-request pending"><span><Check aria-hidden="true" /></span><div><strong>Request received — awaiting review.</strong><a href="/requests">View in Requests</a></div></div>
            : table.ownRequest?.state === "declined" ? <div className="table-own-request declined"><span><CircleAlert aria-hidden="true" /></span><div><strong>This request was declined.</strong><small>{table.ownRequest.declineReason || "See Requests for your history."}</small></div></div>
              : table.ownRequest?.state === "withdrawn" ? <div className="table-own-request withdrawn"><span><X aria-hidden="true" /></span><div><strong>You withdrew your request.</strong></div></div>
                : table.ownRequest?.state === "closed_by_table" ? <div className="table-own-request declined"><span><CircleAlert aria-hidden="true" /></span><div><strong>This table was cancelled.</strong><small>If you paid, you’ll get a full refund. Track it in My Seats.</small></div></div>
                : null}
          {table.ownRequest?.state !== "pending" && table.ownRequest?.state !== "closed_by_table" && <button className="button button-primary table-request-submit" type="button" onClick={() => void requestSeat()} disabled={actionState === "working"}>{actionState === "working" ? "Sending…" : table.ownRequest?.state === "withdrawn" || table.ownRequest?.state === "declined" ? "Request again" : "Request a seat"}<ArrowRight aria-hidden="true" /></button>}
          {table.ownRequest?.state === "pending" && <button className="button button-outline table-request-submit" type="button" onClick={() => void withdrawRequest()} disabled={actionState === "working"}>{actionState === "working" ? "Withdrawing…" : "Withdraw request"}<X aria-hidden="true" /></button>}
          <button className="table-share-action" type="button" onClick={() => void shareTable()}><Share2 aria-hidden="true" />Share this Table link</button>
          {shareMessage && <p className="table-share-message" role="status">{shareMessage}</p>}
          {message && actionState !== "idle" && <p className={`table-action-message ${actionState === "error" ? "is-error" : ""}`} role={actionState === "error" ? "alert" : "status"}>{message}</p>}
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
    <h1 id="table-preview-title">{table.title}</h1>
    <p className="table-card-meta"><MapPin aria-hidden="true" />{table.neighborhood}<span aria-hidden="true">·</span><CalendarDays aria-hidden="true" />{formatLocalDate(table.localDate, false)}</p>
    <p className="table-preview-boundary">Sign in to see the full plan and request a seat. New here? <a href="https://fifthwheel.community/#waitlist" target="_blank" rel="noreferrer">Join the waitlist.</a></p>
    <a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(continueTo)}`}>Sign in to request a seat<ArrowRight aria-hidden="true" /></a>
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
      setState("error"); setMessage(error instanceof Error ? error.message : "Nothing has changed. Try again."); if (!append) setItems([]);
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
      setMessage(result && !result.ok ? result.error.safeMessage : "We’re not sure your request was withdrawn. Refresh the page to check.");
    } catch { setMessage("We’re not sure your request was withdrawn. Refresh the page to check."); }
    finally { setActionId(null); }
  }

  const invited = items.filter((i) => i.tableInvitation?.state === "active");
  const waiting = items.filter((i) => i.state === "pending" && i.tableInvitation?.state !== "active");
  const past = items.filter((i) => !invited.includes(i) && !waiting.includes(i));
  const meta = (i: RequestRecord) => `${eventWhen(i.table.localDate, i.table.startLocalTime ?? "")} · ${i.table.neighborhood}`;
  const pastBadge = (i: RequestRecord): [BadgeTone, string] => i.tableInvitation && i.tableInvitation.state !== "active" && i.state === "pending"
    ? ["neutral", INVITATION_STATE_PILL[i.tableInvitation.state]]
    : [i.state === "declined" ? "danger" : "neutral", REQUEST_STATE_LABEL[i.state]];
  const title = (i: RequestRecord) => i.table.isCurrentlyPublished ? <a href={safeTablePath(i.tableId)}>{i.table.title}</a> : <>{i.table.title}</>;

  return <MemberWorkspaceShell active="requests">
    <PageHeader titleId="requests-heading" title="Requests" />
    {state === "loading" && <PageState variant="loading" title="Loading your requests" />}
    {state === "unauthenticated" && <PageState variant="signed-out" title="Sign in to view your requests" message="Sign in with the email you used to join." action={<a className="button button-primary" href="/sign-in?returnTo=%2Frequests">Sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "profile_incomplete" && <PageState variant="no-access" title="Finish your profile first" message={message || "You can request seats once we’ve reviewed your profile."} action={<a className="button button-primary" href="/account/profile">Complete your profile<ArrowRight aria-hidden="true" /></a>} />}
    {state === "error" && <PageState variant="error" title="We couldn’t load your requests" message={message || "Nothing has changed. Try again."} action={<button className="button button-outline" type="button" onClick={() => void loadRequests()}>Try again</button>} />}
    {state === "ready" && items.length === 0 && <PageState variant="empty" title="No requests yet" message="Find a table you like and request a seat." action={<a className="button button-primary" href="/tables">Browse tables</a>} />}
    {state === "ready" && items.length > 0 && <div className="req-groups">
      {invited.length > 0 && <section aria-labelledby="req-invited"><h2 id="req-invited">Invited — pay to confirm</h2><div className="req-list">{invited.map((i) => <article className="request-history-card req-card req-card-invited" key={i.requestId}>
        <div><h3>{title(i)}</h3><p>{meta(i)}</p></div>
        <a className={buttonClass("primary")} href={`/invitations/${encodeURIComponent(i.tableInvitation!.invitationId)}`}>Pay to confirm<ArrowRight aria-hidden="true" /></a>
      </article>)}</div></section>}
      {waiting.length > 0 && <section aria-labelledby="req-waiting"><h2 id="req-waiting">Waiting to hear</h2><div className="req-list">{waiting.map((i) => <article className="request-history-card req-card" key={i.requestId}>
        <div><h3>{title(i)}</h3><p>{meta(i)}</p><p className="req-sub">Requested {instantDate(i.createdAt)}</p></div>
        <div className="req-side"><StatusBadge tone="pending">{REQUEST_STATE_LABEL[i.state]}</StatusBadge>
          <button className="button button-outline request-withdraw-button" type="button" onClick={() => void withdraw(i)} disabled={actionId === i.requestId}>{actionId === i.requestId ? "Withdrawing…" : "Withdraw request"}</button></div>
      </article>)}</div></section>}
      {past.length > 0 && <details className="req-past"><summary>Past requests ({past.length})</summary><div className="req-list">{past.map((i) => { const [tone, label] = pastBadge(i); return <article className="request-history-card req-card" key={i.requestId}>
        <div><h3>{title(i)}</h3><p>{meta(i)}</p>{i.state === "declined" && i.declineReason && <p className="req-sub">{i.declineReason}</p>}{!i.table.isCurrentlyPublished && <p className="req-sub">This table is no longer available.</p>}</div>
        <div className="req-side"><StatusBadge tone={tone}>{label}</StatusBadge></div>
      </article>; })}</div></details>}
    </div>}
    {message && state === "ready" && <p className="table-action-message is-error" role="alert">{message}</p>}
    {cursor && state === "ready" && <div className="table-load-more"><button className="button button-outline" type="button" onClick={() => void loadRequests(cursor, true)} disabled={loadingMore}>{loadingMore ? "Loading more…" : "Load earlier requests"}<ChevronDown aria-hidden="true" /></button></div>}
  </MemberWorkspaceShell>;
}

