import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { eventDate, timestamp } from "../format/datetime";
import { PageHeader } from "./ui/page-header";
import { PageState } from "./ui/page-state";
import { AppShell } from "./app-shell";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, BadgeCheck, Ban, CalendarDays, Check, ChevronDown, CircleAlert, Clock3, Database, FileCheck2, FilePlus2, LoaderCircle, MapPin, RefreshCw, Save, ShieldCheck, Table2, WifiOff } from "lucide-react";
import type {
  SupplyCreateDraftRequest, SupplyCreateDraftResultDTO, SupplyDraftContent, SupplyDraftPreviewDTO,
  SupplyManagementError, SupplyManagementResponse, SupplyRevisionSummaryDTO, SupplyStagedCandidateDTO,
  SupplyTableDetailDTO, SupplyTableLifecycle, SupplyTableListDTO, SupplyTableListItemDTO,
  SupplyValidationIssue, SupplyVenueListDTO,
} from "../supply.management.contract.ts";
import "./admin-supply-management-workspace.css";

type LoadState = "loading" | "ready" | "error" | "unauthenticated" | "forbidden";
type MutationState = "idle" | "running" | "error" | "unknown" | "conflict";
type ActionKind = "create" | "save" | "preview" | "accept" | "publish" | "sync" | null;
type PendingOperation = Readonly<{ fingerprint: string; id: string }>;
type FormErrors = Readonly<Record<string, string>>;
type DialogMode = "closed" | "create" | "accept" | "publish";

const lifecycleLabels: Record<SupplyTableLifecycle, string> = {
  draft: "Draft", accepted: "Approved", published: "Live", review_required: "Needs review", upstream_missing: "Removed from Airtable",
};
const syncPath = "/api/admin/supply/sync";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validLifecycle(value: unknown): value is SupplyTableLifecycle {
  return ["draft", "accepted", "published", "review_required", "upstream_missing"].includes(String(value));
}
function validProviderState(value: unknown): value is SupplyTableListDTO["providerState"] {
  return ["fixture", "disabled_unmapped", "ready", "unavailable"].includes(String(value));
}
function isVenueList(value: unknown): value is SupplyVenueListDTO {
  return isRecord(value) && validProviderState(value.providerState) && Array.isArray(value.items)
    && value.items.every((item) => isRecord(item) && typeof item.venueId === "string" && typeof item.name === "string" && typeof item.address === "string" && typeof item.neighborhood === "string");
}
function isListItem(value: unknown): value is SupplyTableListItemDTO {
  return isRecord(value) && typeof value.tableId === "string" && typeof value.title === "string"
    && typeof value.localDate === "string" && typeof value.startLocalTime === "string" && (typeof value.startsAt === "string" || value.startsAt === null)
    && typeof value.neighborhood === "string" && validLifecycle(value.lifecycle)
    && (Number.isSafeInteger(value.draftRevision) || value.draftRevision === null)
    && (typeof value.acceptedRevisionId === "string" || value.acceptedRevisionId === null)
    && (typeof value.publishedRevisionId === "string" || value.publishedRevisionId === null)
    && typeof value.updatedAt === "string" && (typeof value.sourceRevisionId === "string" || value.sourceRevisionId === null)
    && ["current", "stale", "missing"].includes(String(value.syncState))
    && typeof value.canCreateDraft === "boolean";
}
function isCandidate(value: unknown): value is SupplyStagedCandidateDTO {
  return isRecord(value) && typeof value.tableId === "string" && typeof value.sourceRevisionId === "string"
    && typeof value.title === "string" && typeof value.localDate === "string" && typeof value.startLocalTime === "string" && typeof value.neighborhood === "string"
    && typeof value.canCreateDraft === "boolean";
}
function isList(value: unknown): value is SupplyTableListDTO {
  return isRecord(value) && validProviderState(value.providerState) && typeof value.mutationsEnabled === "boolean"
    && typeof value.canCreateDraft === "boolean"
    && Array.isArray(value.items) && value.items.every(isListItem) && Array.isArray(value.stagedCandidates) && value.stagedCandidates.every(isCandidate)
    && (typeof value.nextCursor === "string" || value.nextCursor === null);
}
function isStop(value: unknown, role: "drinks" | "dinner" | "dessert"): boolean {
  return isRecord(value) && value.role === role && typeof value.venueId === "string" && typeof value.venueName === "string"
    && typeof value.venueAddress === "string" && Number.isSafeInteger(value.minutesFromStart) && typeof value.publicNotes === "string";
}
function isContent(value: unknown): value is SupplyDraftContent {
  return isRecord(value) && typeof value.title === "string" && typeof value.localDate === "string" && typeof value.startLocalTime === "string"
    && typeof value.neighborhood === "string" && typeof value.hostNotes === "string" && Array.isArray(value.stops) && value.stops.length === 3
    && isStop(value.stops[0], "drinks") && isStop(value.stops[1], "dinner") && isStop(value.stops[2], "dessert");
}
function isRevision(value: unknown): value is SupplyRevisionSummaryDTO {
  return isRecord(value) && typeof value.revisionId === "string" && Number.isSafeInteger(value.revision)
    && ["draft", "accepted", "published"].includes(String(value.state)) && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string" && isContent(value.content);
}
function isDetail(value: unknown): value is SupplyTableDetailDTO {
  return isRecord(value) && validProviderState(value.providerState) && typeof value.mutationsEnabled === "boolean"
    && typeof value.tableId === "string" && validLifecycle(value.lifecycle)
    && (value.draft === null || isRevision(value.draft)) && (value.accepted === null || isRevision(value.accepted))
    && (value.published === null || isRevision(value.published))
    && ["current", "stale", "missing"].includes(String(value.syncState))
    && ["current", "stale", "missing"].includes(String(value.currentSyncState))
    && typeof value.canEditDraft === "boolean" && typeof value.canAccept === "boolean" && typeof value.canPublish === "boolean";
}
function isIssue(value: unknown): value is SupplyValidationIssue {
  return isRecord(value) && ["title", "schedule", "neighborhood", "stops", "venue"].includes(String(value.field))
    && typeof value.code === "string" && typeof value.message === "string"
    && (value.stopRole === undefined || ["drinks", "dinner", "dessert"].includes(String(value.stopRole)));
}
function isPreview(value: unknown): value is SupplyDraftPreviewDTO {
  return isRecord(value) && typeof value.tableId === "string" && Number.isSafeInteger(value.draftRevision)
    && typeof value.valid === "boolean" && (typeof value.startsAt === "string" || value.startsAt === null)
    && Array.isArray(value.changes) && value.changes.every((item) => isRecord(item) && typeof item.field === "string" && (typeof item.before === "string" || item.before === null) && (typeof item.after === "string" || item.after === null))
    && Array.isArray(value.issues) && value.issues.every(isIssue) && typeof value.canAccept === "boolean" && typeof value.canPublish === "boolean" && validProviderState(value.providerState);
}
function isCreateResult(value: unknown): value is SupplyCreateDraftResultDTO {
  return isRecord(value) && typeof value.tableId === "string" && isRevision(value.draft);
}
function isManagementError(value: unknown): value is SupplyManagementError {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string"
    && typeof value.retryable === "boolean" && typeof value.correlationId === "string"
    && (value.fields === undefined || (isRecord(value.fields) && Object.values(value.fields).every((field) => typeof field === "string")));
}
function parseEnvelope<T>(body: unknown, valid: (value: unknown) => value is T): SupplyManagementResponse<T> | null {
  if (!isRecord(body)) return null;
  if (body.ok === true && valid(body.data) && typeof body.correlationId === "string") return { ok: true, data: body.data, correlationId: body.correlationId };
  if (body.ok === false && isManagementError(body.error)) return { ok: false, error: body.error };
  return null;
}

const formatDate = (value: string, _time?: string) => eventDate(value);
const formatTimestamp = (value: string) => timestamp(value);
function providerDescription(state: SupplyTableListDTO["providerState"]): Readonly<{ title: string; text: string; className: string; icon: typeof Database }> {
  switch (state) {
    case "fixture": return { title: "Test mode", text: "Changes don’t reach Airtable.", className: "supply-mode-fixture", icon: Database };
    case "ready": return { title: "Airtable is connected", text: "Editing is turned off here.", className: "supply-mode-ready", icon: Database };
    case "unavailable": return { title: "Airtable is unavailable", text: "Live tables are unaffected. Changes that need Airtable are paused.", className: "supply-mode-unavailable", icon: WifiOff };
    case "disabled_unmapped": return { title: "Airtable isn’t set up yet", text: "Ask the operations owner to connect the Airtable fields. Editing is paused until then.", className: "supply-mode-disabled", icon: Ban };
  }
}
function operationIdFor(ref: { current: PendingOperation | null }, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (ref.current?.fingerprint === fingerprint) return ref.current.id;
  const id = crypto.randomUUID();
  ref.current = { fingerprint, id };
  return id;
}
function emptyContent(): SupplyDraftContent {
  return {
    title: "", localDate: "", startLocalTime: "", neighborhood: "", hostNotes: "",
    stops: [
      { role: "drinks", venueId: "", venueName: "", venueAddress: "", minutesFromStart: 0, publicNotes: "" },
      { role: "dinner", venueId: "", venueName: "", venueAddress: "", minutesFromStart: 45, publicNotes: "" },
      { role: "dessert", venueId: "", venueName: "", venueAddress: "", minutesFromStart: 120, publicNotes: "" },
    ],
  };
}

async function requestData<T>(response: Response, valid: (value: unknown) => value is T): Promise<SupplyManagementResponse<T> | null> {
  const body: unknown = await response.json().catch(() => null);
  return parseEnvelope(body, valid);
}

function AdminSupplyShell(props: Readonly<{ children: React.ReactNode }>) {
  return <AppShell role="admin" active="tables" className="supply-management-page" contentClassName="supply-management-content">{props.children}</AppShell>;
}

function StatePanel({ state, message, onRetry }: Readonly<{ state: LoadState; message: string; onRetry: () => void }>) {
  if (state === "loading") return <PageState variant="loading" title="Loading…" message="Reading the latest authorized supply snapshot." />;
  if (state === "unauthenticated") return <PageState variant="signed-out" title="Sign in to manage Tables" message="This workspace requires a verified staff account." action={<a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a>} />;
  if (state === "forbidden") return <PageState variant="no-access" title="Table management is restricted" message="Your current account is not authorized to view these supply records." action={<a className="button button-outline" href="/admin/waitlist">Return to admin workspace<ArrowRight aria-hidden="true" /></a>} />;
  if (state === "error") return <PageState variant="error" title="We couldn’t load tables" message={message} action={<button className="button button-outline" type="button" onClick={onRetry}>Try again<RefreshCw aria-hidden="true" /></button>} />;
  return null;
}

export function AdminTablesRouteLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === "/admin/tables" ? <AdminSupplyTableList /> : <Outlet />;
}

function AdminSupplyTableList() {
  const [state, setState] = useState<LoadState>("loading");
  const [list, setList] = useState<SupplyTableListDTO | null>(null);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<readonly SupplyTableListItemDTO[]>([]);
  const [dialog, setDialog] = useState<DialogMode>("closed");
  const [venues, setVenues] = useState<SupplyVenueListDTO | null>(null);
  const [venueState, setVenueState] = useState<LoadState>("loading");
  const [mutationState, setMutationState] = useState<MutationState>("idle");
  const [pendingListAction, setPendingListAction] = useState<"create" | "sync" | null>(null);
  const [mutationMessage, setMutationMessage] = useState("");
  const createOperation = useRef<PendingOperation | null>(null);
  const syncOperation = useRef<PendingOperation | null>(null);
  const manualFormRef = useRef<HTMLFormElement>(null);
  const [content, setContent] = useState<SupplyDraftContent>(emptyContent);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  const loadList = useCallback(async (nextCursor?: string | null, append = false, selectedFilter = filter) => {
    if (!append) setState("loading");
    setMessage("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (selectedFilter) query.set("state", selectedFilter);
      if (nextCursor) query.set("cursor", nextCursor);
      const response = await fetch(`/api/supply/tables?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setState("unauthenticated"); setList(null); setItems([]); return; }
      if (response.status === 403) { setState("forbidden"); setList(null); setItems([]); return; }
      const result = await requestData(response, isList);
      if (!response.ok || !result?.ok) {
        setState("error"); setList(null); setItems([]); setMessage(result && !result.ok ? result.error.message : "We couldn’t load tables."); return;
      }
      setList(result.data);
      setItems((current) => append ? [...current, ...result.data.items] : result.data.items);
      setCursor(result.data.nextCursor);
      setState("ready");
    } catch {
      setState("error"); setList(null); setItems([]); setMessage("We couldn’t load tables. Try again in a moment.");
    }
  }, [filter]);

  useEffect(() => { void loadList(null, false); }, [loadList]);

  async function loadVenues() {
    setVenueState("loading");
    try {
      const response = await fetch("/api/supply/venues", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setVenueState("unauthenticated"); return; }
      if (response.status === 403) { setVenueState("forbidden"); return; }
      const result = await requestData(response, isVenueList);
      if (!response.ok || !result?.ok) { setVenueState("error"); setMutationMessage(result && !result.ok ? result.error.message : "Venue options could not be loaded."); return; }
      setVenues(result.data); setVenueState("ready");
    } catch { setVenueState("error"); setMutationMessage("Venue options could not be loaded. Try again shortly."); }
  }

  function openManualDraft() {
    if (!list?.canCreateDraft || list.providerState !== "fixture" || !list.mutationsEnabled || mutationState === "unknown" || mutationState === "running") return;
    setContent(emptyContent()); setFormErrors({}); setMutationMessage(""); setMutationState("idle");
    setDialog("create"); void loadVenues();
  }

  function updateStop(index: number, patch: Partial<SupplyDraftContent["stops"][number]>) {
    setContent((current) => ({ ...current, stops: current.stops.map((stop, i) => i === index ? { ...stop, ...patch } : stop) as unknown as SupplyDraftContent["stops"] }));
    setFormErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`stops.${index}.`))));
  }

  async function createManualDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!list || !list.canCreateDraft || list.providerState !== "fixture" || !list.mutationsEnabled || (mutationState === "unknown" && pendingListAction !== "create")) return;
    const payload: SupplyCreateDraftRequest["source"] = { kind: "manual", content };
    const body = { source: payload };
    const operationId = operationIdFor(createOperation, body);
    setMutationState("running"); setPendingListAction("create"); setMutationMessage(""); setFormErrors({});
    try {
      const response = await fetch("/api/supply/drafts", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ...body, operationId }) });
      if (response.status === 401) { createOperation.current = null; setPendingListAction(null); setMutationState("error"); setMutationMessage("You’ve been signed out. Sign in again."); return; }
      if (response.status === 403) { createOperation.current = null; setPendingListAction(null); setMutationState("error"); setMutationMessage("Your account cannot create Table drafts."); return; }
      const result = await requestData(response, isCreateResult);
      if (!response.ok || !result?.ok) {
        const error = result && !result.ok ? result.error : null;
        setMutationState(error?.retryable ? "unknown" : "error"); setMutationMessage(error?.message ?? "Draft creation could not be confirmed.");
        setFormErrors(error?.fields ?? {});
        if (!error?.retryable) { createOperation.current = null; setPendingListAction(null); }
        return;
      }
      createOperation.current = null; setPendingListAction(null);
      window.location.assign(`/admin/tables/${encodeURIComponent(result.data.tableId)}`);
    } catch {
      setMutationState("unknown"); setMutationMessage("We’re not sure that saved. Try again; it won’t save twice.");
    }
  }

  async function createCandidateDraft(candidate: SupplyStagedCandidateDTO) {
    if (!list || !candidate.canCreateDraft || list.providerState !== "fixture" || !list.mutationsEnabled || (mutationState === "unknown" && pendingListAction !== "create")) return;
    const source: SupplyCreateDraftRequest["source"] = { kind: "candidate", revisionId: candidate.sourceRevisionId, tableId: candidate.tableId };
    const body = { source };
    const operationId = operationIdFor(createOperation, body);
    setMutationState("running"); setPendingListAction("create"); setMutationMessage("");
    try {
      const response = await fetch("/api/supply/drafts", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ...body, operationId }) });
      const result = await requestData(response, isCreateResult);
      if (!response.ok || !result?.ok) { const error = result && !result.ok ? result.error : null; setMutationState(error?.retryable ? "unknown" : "error"); setMutationMessage(error?.message ?? "Draft creation could not be confirmed."); if (!error?.retryable) { createOperation.current = null; setPendingListAction(null); } return; }
      createOperation.current = null; setPendingListAction(null);
      window.location.assign(`/admin/tables/${encodeURIComponent(result.data.tableId)}`);
    } catch { setMutationState("unknown"); setMutationMessage("We’re not sure that saved. Try again; it won’t save twice."); }
  }

  async function runSync() {
    if (!list || !list.canCreateDraft || list.providerState !== "fixture" || !list.mutationsEnabled || (mutationState === "unknown" && pendingListAction !== "sync")) return;
    const body = {};
    const operationId = operationIdFor(syncOperation, { sync: true });
    setMutationState("running"); setPendingListAction("sync"); setMutationMessage("");
    try {
      const response = await fetch(syncPath, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ operationId, ...body }) });
      const result = await response.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: { message?: string; retryable?: boolean } } | null;
      if (!response.ok || !result?.ok) { setMutationState(result?.error?.retryable ? "unknown" : "error"); setMutationMessage(result?.error?.message ?? "Sync could not be confirmed."); if (!result?.error?.retryable) { syncOperation.current = null; setPendingListAction(null); } return; }
      syncOperation.current = null; setPendingListAction(null); setMutationState("idle"); setMutationMessage("Airtable check complete. Updating the Tables ready for review."); await loadList(null, false);
    } catch { setMutationState("unknown"); setMutationMessage("We could not confirm whether the Airtable check finished. Refresh this page before trying again."); }
  }

  const visibleItems = useMemo(() => items.filter((item) => {
    const match = search.trim().toLowerCase();
    return !match || `${item.title} ${item.neighborhood}`.toLowerCase().includes(match);
  }), [items, search]);
  const provider = list ? providerDescription(list.providerState) : null;
  const ProviderIcon = provider?.icon ?? Database;
  const fixtureMutationsEnabled = Boolean(list?.providerState === "fixture" && list.mutationsEnabled);
  const closeDialog = useCallback(() => setDialog("closed"), []);

  return <AdminSupplyShell>
    <PageHeader className="supply-management-heading" titleId="supply-list-heading" title="Tables" description="Review details, make a draft, and approve changes before guests can see them." status={state === "ready" && list ? <span className="status-pill status-pill-neutral"><Table2 aria-hidden="true" />{items.length} on this page</span> : undefined} />

    {state !== "ready" && <StatePanel state={state} message={message} onRetry={() => void loadList(null, false)} />}
    {state === "ready" && list && provider && <>
      <section className={`supply-mode-card ${provider.className}`} aria-label="Airtable mode"><span className="supply-mode-icon"><ProviderIcon aria-hidden="true" /></span><div><p className="eyebrow">AIRTABLE</p><h2>{provider.title}</h2><p>{provider.text}</p></div><span className={`supply-mode-capability ${fixtureMutationsEnabled ? "is-enabled" : ""}`}>{fixtureMutationsEnabled ? "Test mode" : "Editing is turned off here"}</span></section>

      {list.stagedCandidates.length > 0 && <section className="supply-candidate-section" aria-labelledby="staged-candidates-heading">
        <div className="supply-section-heading"><div><p className="eyebrow">FROM AIRTABLE</p><h2 id="staged-candidates-heading">New from Airtable</h2><p>Guests can’t see these yet.</p></div><span className="status-pill status-pill-pending"><Clock3 aria-hidden="true" />{list.stagedCandidates.length} to review</span></div>
        <div className="supply-candidate-list">{list.stagedCandidates.map((candidate) => {
          const source: SupplyCreateDraftRequest["source"] = { kind: "candidate", revisionId: candidate.sourceRevisionId, tableId: candidate.tableId };
          const canRetry = pendingListAction === "create" && mutationState === "unknown" && createOperation.current?.fingerprint === JSON.stringify({ source });
          return <article className="supply-candidate-row" key={candidate.sourceRevisionId + candidate.tableId}>
            <span className="supply-candidate-icon"><Database aria-hidden="true" /></span>
            <div className="supply-candidate-main"><strong>{candidate.title}</strong><span>{formatDate(candidate.localDate, candidate.startLocalTime)} · {candidate.startLocalTime} · {candidate.neighborhood}</span><small>Not visible to members yet</small></div>
            <button className="button button-outline" type="button" disabled={!candidate.canCreateDraft || !fixtureMutationsEnabled || mutationState === "running" || (mutationState === "unknown" && !canRetry)} onClick={() => void createCandidateDraft(candidate)}>{canRetry ? "Try again" : "Start draft"}<ArrowRight aria-hidden="true" /></button>
          </article>;
        })}</div>
      </section>}

      <section className="supply-list-controls"><div><p className="eyebrow">CURRENT TABLES</p><h2>Manage Tables</h2></div><div className="supply-list-actions"><label className="supply-search"><span className="visually-hidden">Search Tables on this page</span><input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search title or neighborhood" /></label><label className="supply-filter"><span className="visually-hidden">Filter by Table status</span><select value={filter} onChange={(event) => { setFilter(event.currentTarget.value); setItems([]); setCursor(null); }}><option value="">All statuses</option><option value="draft">Draft</option><option value="accepted">Approved</option><option value="published">Published</option><option value="review_required">Review needed</option><option value="upstream_missing">Source missing</option></select><ChevronDown aria-hidden="true" /></label><button className="icon-action" type="button" aria-label="Refresh Table list" onClick={() => void loadList(null, false)}><RefreshCw aria-hidden="true" /></button>{list.canCreateDraft && <><a className="button button-outline" href="/admin/tables/weekly-clone"><CalendarDays aria-hidden="true" />Weekly preview</a><button className="button button-primary" type="button" disabled={!fixtureMutationsEnabled || mutationState === "running" || mutationState === "unknown"} onClick={openManualDraft}><FilePlus2 aria-hidden="true" />Create draft</button></>}</div></section>

      {mutationMessage && <div className={`supply-mutation-feedback ${mutationState === "error" || mutationState === "conflict" ? "is-error" : mutationState === "unknown" ? "is-warning" : ""}`} role={mutationState === "error" || mutationState === "conflict" || mutationState === "unknown" ? "alert" : "status"}><CircleAlert aria-hidden="true" />{mutationMessage}{mutationState === "unknown" && <span>Keep this page open and try the same action again.</span>}</div>}
      {visibleItems.length === 0 ? <PageState variant="empty" className="supply-list-empty" title={search || filter ? "No Tables match these filters" : "No Table supply records yet"} message={search || filter ? "Clear the search or lifecycle filter to see more records." : "A complete sync or an authorized draft will appear here. No sample records are shown."} action={(search || filter) ? <button className="button button-outline" type="button" onClick={() => { setSearch(""); setFilter(""); void loadList(null, false, ""); }}>Clear filters</button> : undefined} /> : <div className="supply-table-list" aria-label="Table supply records">{visibleItems.map((item) => <a className="supply-table-row" href={`/admin/tables/${encodeURIComponent(item.tableId)}`} key={item.tableId}><span className="supply-table-date"><CalendarDays aria-hidden="true" /><strong>{formatDate(item.localDate, item.startLocalTime)}</strong><small>{item.startLocalTime} Atlanta time</small></span><span className="supply-table-main"><strong>{item.title || "Untitled Table draft"}</strong><span><MapPin aria-hidden="true" />{item.neighborhood || "Neighborhood not set"}</span>{item.syncState === "missing" && <span className="supply-source-missing" role="status"><CircleAlert aria-hidden="true" />Source record missing in latest sync</span>}</span><span className={`status-pill ${item.lifecycle === "published" ? "status-pill-success" : item.lifecycle === "review_required" || item.lifecycle === "upstream_missing" ? "status-pill-warning" : "status-pill-pending"}`}>{lifecycleLabels[item.lifecycle]}</span><span className="supply-table-revision">{item.draftRevision === null ? "No draft" : `Draft v${item.draftRevision}`}</span><ArrowRight aria-hidden="true" /></a>)}</div>}

      {cursor && <div className="supply-pagination"><span>More Table records are available.</span><button className="button button-outline" type="button" onClick={() => void loadList(cursor, true)}>Load more Tables<ArrowRight aria-hidden="true" /></button></div>}
      {list.canCreateDraft && <section className="supply-sync-strip"><span className="supply-sync-strip-icon"><RefreshCw aria-hidden="true" /></span><div><h2>Check Airtable</h2><p>Pulls in new or changed tables for you to review. Nothing goes live.</p></div><button className="button button-outline" type="button" onClick={() => void runSync()} disabled={!fixtureMutationsEnabled || mutationState === "running" || (mutationState === "unknown" && pendingListAction !== "sync")}>{mutationState === "running" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{mutationState === "running" ? "Checking…" : mutationState === "unknown" && pendingListAction === "sync" ? "Check again" : "Check Airtable"}</button></section>}
    </>}

    <ManualDraftDialog open={dialog === "create"} onClose={closeDialog} onSubmit={createManualDraft} formRef={manualFormRef} content={content} setContent={setContent} updateStop={updateStop} venues={venues?.items ?? []} venueState={venueState} mutationState={mutationState} mutationMessage={mutationMessage} fieldErrors={formErrors} mutationsEnabled={fixtureMutationsEnabled && Boolean(list?.canCreateDraft)} />
  </AdminSupplyShell>;
}

function ManualDraftDialog(props: Readonly<{
  open: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; formRef: React.RefObject<HTMLFormElement | null>;
  content: SupplyDraftContent; setContent: React.Dispatch<React.SetStateAction<SupplyDraftContent>>;
  updateStop: (index: number, patch: Partial<SupplyDraftContent["stops"][number]>) => void;
  venues: readonly SupplyVenueListDTO["items"][number][]; venueState: LoadState; mutationState: MutationState; mutationMessage: string;
  fieldErrors: FormErrors; mutationsEnabled: boolean;
}>) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!props.open) return;
    closeRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    first?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0]?.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); closeRef.current?.focus(); };
  }, [props.open, props.onClose]);
  if (!props.open) return null;

  function setField(key: keyof SupplyDraftContent, value: string) {
    props.setContent((current) => ({ ...current, [key]: value }));
  }
  const locked = props.mutationState === "running" || props.mutationState === "unknown";
  return <div className="supply-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !locked) props.onClose(); }}>
    <section className="supply-modal supply-editor-modal" role="dialog" aria-modal="true" aria-labelledby="supply-create-title" ref={dialogRef} tabIndex={-1}>
      <div className="supply-modal-heading"><span className="supply-modal-icon"><FilePlus2 aria-hidden="true" /></span><button className="icon-button" type="button" aria-label="Close draft editor" disabled={locked} onClick={props.onClose}>×</button></div>
      <h2 id="supply-create-title">New table draft</h2><p className="supply-modal-intro">Guests won’t see this until you approve and publish it.</p>
      {props.venueState === "loading" && <p className="supply-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Loading approved venue options…</p>}
      {props.venueState === "error" && <p className="supply-inline-state is-error" role="alert"><CircleAlert aria-hidden="true" />Venue options are unavailable. Retry by closing and reopening the editor.</p>}
      {props.venueState === "forbidden" && <p className="supply-inline-state is-error" role="alert"><ShieldCheck aria-hidden="true" />Your account cannot view venue options.</p>}
      <form ref={props.formRef} className="supply-editor-form" onSubmit={props.onSubmit}>
        <fieldset className="supply-form-lock" disabled={locked}>
        <div className="supply-form-grid">
          <Field label="Public Table title" id="draft-title" error={props.fieldErrors.title}><input id="draft-title" required maxLength={180} value={props.content.title} onChange={(event) => setField("title", event.currentTarget.value)} /></Field>
          <Field label="Neighborhood" id="draft-neighborhood" error={props.fieldErrors.neighborhood}><input id="draft-neighborhood" required maxLength={120} value={props.content.neighborhood} onChange={(event) => setField("neighborhood", event.currentTarget.value)} /></Field>
          <Field label="Atlanta local date" id="draft-date" error={props.fieldErrors.localDate ?? props.fieldErrors.schedule}><input id="draft-date" required type="date" value={props.content.localDate} onChange={(event) => setField("localDate", event.currentTarget.value)} /></Field>
          <Field label="Atlanta local start time" id="draft-time" error={props.fieldErrors.startLocalTime ?? props.fieldErrors.schedule}><input id="draft-time" required type="time" value={props.content.startLocalTime} onChange={(event) => setField("startLocalTime", event.currentTarget.value)} /><small>Atlanta time.</small></Field>
        </div>
        <label className="supply-field supply-private-notes" htmlFor="draft-host-notes"><span>Notes for staff (guests don’t see these)</span><textarea id="draft-host-notes" rows={3} maxLength={2000} value={props.content.hostNotes} onChange={(event) => setField("hostNotes", event.currentTarget.value)} /><small></small></label>
        <fieldset className="supply-stops-fieldset"><legend>Three-stop itinerary</legend><p>Stops stay in the required drinks → dinner → dessert order. Start offsets default to 0, 45 and 120 minutes.</p>
          {props.content.stops.map((stop, index) => <section className="supply-stop-editor" key={stop.role}><div className="supply-stop-editor-heading"><span>{index + 1}</span><div><strong>{stop.role[0]!.toUpperCase() + stop.role.slice(1)}</strong><small>{stop.minutesFromStart} minutes after the table begins</small></div></div>
            <Field label={`${stop.role[0]!.toUpperCase() + stop.role.slice(1)} venue`} id={`draft-stop-${stop.role}-venue`} error={props.fieldErrors[`stops.${stop.role}.venueId`] ?? props.fieldErrors.venue}>
              <select id={`draft-stop-${stop.role}-venue`} required value={stop.venueId} disabled={props.venueState !== "ready" || !props.mutationsEnabled} onChange={(event) => {
                const venue = props.venues.find((item) => item.venueId === event.currentTarget.value);
                props.updateStop(index, { venueId: venue?.venueId ?? "", venueName: venue?.name ?? "", venueAddress: venue?.address ?? "" });
              }}><option value="">Choose a venue</option>{props.venues.map((venue) => <option key={venue.venueId} value={venue.venueId}>{venue.name} · {venue.neighborhood}</option>)}</select>
            </Field>
            <Field label="Minutes from start" id={`draft-stop-${stop.role}-offset`} error={props.fieldErrors[`stops.${stop.role}.minutesFromStart`]}><input id={`draft-stop-${stop.role}-offset`} type="number" min={0} max={720} step={5} value={stop.minutesFromStart} onChange={(event) => props.updateStop(index, { minutesFromStart: Number(event.currentTarget.value) })} /></Field>
            <label className="supply-field" htmlFor={`draft-stop-${stop.role}-notes`}><span>Note for guests</span><textarea id={`draft-stop-${stop.role}-notes`} rows={2} maxLength={500} value={stop.publicNotes} onChange={(event) => props.updateStop(index, { publicNotes: event.currentTarget.value })} /></label>
            {stop.venueId && <p className="supply-venue-summary"><MapPin aria-hidden="true" />{stop.venueName} · {stop.venueAddress}</p>}
          </section>)}
        </fieldset>
        </fieldset>
        {props.mutationMessage && <p className={`supply-inline-state ${props.mutationState === "error" || props.mutationState === "unknown" ? "is-error" : ""}`} role={props.mutationState === "error" || props.mutationState === "unknown" ? "alert" : "status"}><CircleAlert aria-hidden="true" />{props.mutationMessage}</p>}
        <div className="supply-modal-actions"><button className="button button-outline" type="button" onClick={props.onClose} disabled={locked}>Cancel</button><button className="button button-primary" type="submit" disabled={!props.mutationsEnabled || props.venueState !== "ready" || props.mutationState === "running"}>{props.mutationState === "running" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <FilePlus2 aria-hidden="true" />}{props.mutationState === "running" ? "Creating draft…" : props.mutationState === "unknown" ? "Retry same draft operation" : "Create private draft"}</button></div>
      </form>
    </section>
  </div>;
}

function Field(props: Readonly<{ label: string; id: string; error?: string; children: React.ReactNode }>) {
  return <label className="supply-field" htmlFor={props.id}><span>{props.label}</span>{props.children}{props.error && <small className="supply-field-error" role="alert">{props.error}</small>}</label>;
}

export function AdminSupplyTableDetail({ tableId, footer }: Readonly<{ tableId: string; footer?: React.ReactNode }>) {
  const [state, setState] = useState<LoadState>("loading");
  const [detail, setDetail] = useState<SupplyTableDetailDTO | null>(null);
  const [venues, setVenues] = useState<SupplyVenueListDTO | null>(null);
  const [content, setContent] = useState<SupplyDraftContent | null>(null);
  const [preview, setPreview] = useState<SupplyDraftPreviewDTO | null>(null);
  const [message, setMessage] = useState("");
  const [mutationMessage, setMutationMessage] = useState("");
  const [mutationState, setMutationState] = useState<MutationState>("idle");
  const [mutationKind, setMutationKind] = useState<ActionKind>(null);
  const [dialog, setDialog] = useState<DialogMode>("closed");
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const saveOperation = useRef<PendingOperation | null>(null);
  const acceptOperation = useRef<PendingOperation | null>(null);
  const publishOperation = useRef<PendingOperation | null>(null);
  const saveSnapshotRef = useRef<string>("");

  const loadDetail = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const response = await fetch(`/api/supply/tables/${encodeURIComponent(tableId)}`, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (response.status === 401) { setState("unauthenticated"); setDetail(null); return; }
      if (response.status === 403) { setState("forbidden"); setDetail(null); return; }
      if (response.status === 404) { setState("error"); setDetail(null); setMessage("This Table record could not be found or is no longer available."); return; }
      const result = await requestData(response, isDetail);
      if (!response.ok || !result?.ok) { setState("error"); setDetail(null); setMessage(result && !result.ok ? result.error.message : "Table detail could not be loaded."); return; }
      setDetail(result.data);
      const draftContent = result.data.draft?.content ?? null;
      setContent(draftContent);
      saveSnapshotRef.current = draftContent ? JSON.stringify(draftContent) : "";
      setPreview(null); setFieldErrors({}); setMutationState("idle"); setMutationMessage(""); setState("ready");
      if (result.data.canEditDraft && result.data.mutationsEnabled) void loadVenueOptions();
    } catch { setState("error"); setDetail(null); setMessage("Table detail could not be loaded. Try again shortly."); }
  }, [tableId]);

  async function loadVenueOptions() {
    try {
      const response = await fetch("/api/supply/venues", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      const result = await requestData(response, isVenueList);
      if (response.ok && result?.ok) setVenues(result.data);
    } catch { /* Detail remains readable; editing stays blocked until venues can be refreshed. */ }
  }

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  function updateField(key: keyof SupplyDraftContent, value: string) {
    setContent((current) => current ? { ...current, [key]: value } : current);
    setPreview(null); setFieldErrors((current) => { const next = { ...current }; delete next[key]; delete next.schedule; return next; });
  }
  function updateDetailStop(index: number, patch: Partial<SupplyDraftContent["stops"][number]>) {
    setContent((current) => current ? ({ ...current, stops: current.stops.map((stop, i) => i === index ? { ...stop, ...patch } : stop) as unknown as SupplyDraftContent["stops"] }) : current);
    setPreview(null);
    setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`stops.${index}.`))));
  }

  const dirty = Boolean(content && JSON.stringify(content) !== saveSnapshotRef.current);
  const draft = detail?.draft ?? null;
  const fixtureMutationsEnabled = Boolean(detail?.providerState === "fixture" && detail.mutationsEnabled);
  const editable = Boolean(detail?.canEditDraft && fixtureMutationsEnabled && draft && content);

  async function saveDraft(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!detail || !draft || !content || !editable || !fixtureMutationsEnabled) return;
    const requestBody = { expectedDraftRevision: draft.revision, content };
    const operationId = operationIdFor(saveOperation, requestBody);
    setMutationState("running"); setMutationKind("save"); setMutationMessage(""); setFieldErrors({});
    try {
      const response = await fetch(`/api/supply/drafts/${encodeURIComponent(draft.revisionId)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ...requestBody, operationId }) });
      if (response.status === 401) { setMutationState("error"); setMutationMessage("You’ve been signed out. Sign in again."); return; }
      if (response.status === 403) { setMutationState("error"); setMutationMessage("Your account cannot edit this draft."); return; }
      const result = await requestData(response, isRevision);
      if (!response.ok || !result?.ok) {
        const error = result && !result.ok ? result.error : null;
        const isConflict = response.status === 409 || error?.code === "revision_conflict" || error?.code === "protected_change";
        setMutationState(isConflict ? "conflict" : error?.retryable ? "unknown" : "error"); setMutationMessage(error?.message ?? "Draft changes could not be confirmed."); setFieldErrors(error?.fields ?? {});
        if (isConflict) { saveOperation.current = null; await loadDetail(); }
        else if (!error?.retryable) saveOperation.current = null;
        return;
      }
      saveOperation.current = null; setDetail((current) => current ? { ...current, draft: result.data } : current);
      setContent(result.data.content); saveSnapshotRef.current = JSON.stringify(result.data.content); setPreview(null); setMutationState("idle"); setMutationMessage("Draft saved.");
    } catch { setMutationState("unknown"); setMutationMessage("We could not confirm the save. Retry will reuse the same operation ID."); }
    finally { setMutationKind(null); }
  }

  async function createPreview() {
    if (!detail || !draft || !content || !editable || dirty || mutationState === "running") return;
    setMutationState("running"); setMutationKind("preview"); setMutationMessage("");
    try {
      const response = await fetch(`/api/supply/drafts/${encodeURIComponent(draft.revisionId)}/preview`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ expectedDraftRevision: draft.revision }) });
      if (response.status === 401) { setMutationState("error"); setMutationMessage("You’ve been signed out. Sign in again."); return; }
      if (response.status === 403) { setMutationState("error"); setMutationMessage("Your account cannot preview this draft."); return; }
      const result = await requestData(response, isPreview);
      if (!response.ok || !result?.ok) { const error = result && !result.ok ? result.error : null; setMutationState(response.status === 409 || error?.code === "revision_conflict" ? "conflict" : "error"); setMutationMessage(error?.message ?? "Draft preview could not be loaded."); setFieldErrors(error?.fields ?? {}); return; }
      setPreview(result.data); setMutationState("idle"); setMutationMessage(result.data.valid ? "Up to date." : "Fix these before approving:");
    } catch { setMutationState("error"); setMutationMessage("Draft preview could not be loaded. Try again shortly."); }
    finally { setMutationKind(null); }
  }

  async function revisionAction(kind: "accept" | "publish") {
    if (!detail || !draft || !preview || !fixtureMutationsEnabled) return;
    if (detail.currentSyncState === "missing") return;
    if (kind === "accept" && (!detail.canAccept || !preview.canAccept)) return;
    if (kind === "publish" && (!detail.canPublish || !preview.canPublish)) return;
    const requestBody = { expectedDraftRevision: draft.revision };
    const operationRef = kind === "accept" ? acceptOperation : publishOperation;
    const operationId = operationIdFor(operationRef, requestBody);
    setMutationState("running"); setMutationKind(kind); setMutationMessage("");
    try {
      const response = await fetch(`/api/supply/drafts/${encodeURIComponent(draft.revisionId)}/${kind}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ...requestBody, operationId }) });
      if (response.status === 401) { setMutationState("error"); setMutationMessage("You’ve been signed out. Sign in again."); return; }
      if (response.status === 403) { setMutationState("error"); setMutationMessage("You don’t have permission to do this."); return; }
      const result: SupplyManagementResponse<SupplyRevisionSummaryDTO | SupplyTableDetailDTO> | null = kind === "publish"
        ? await requestData(response, isDetail)
        : await requestData(response, isRevision);
      if (!response.ok || !result?.ok) {
        const error = result && !result.ok ? result.error : null;
        const conflict = response.status === 409 || error?.code === "revision_conflict" || error?.code === "protected_change";
        setMutationState(conflict ? "conflict" : error?.retryable ? "unknown" : "error"); setMutationMessage(error?.message ?? `The ${kind} result could not be confirmed.`);
        if (conflict) { operationRef.current = null; await loadDetail(); }
        else if (!error?.retryable) operationRef.current = null;
        return;
      }
      operationRef.current = null; setDialog("closed"); setPreview(null); setMutationState("idle");
      await loadDetail();
      setMutationMessage(kind === "accept" ? "Approved. Not live yet." : "Published. Guests can see it now.");
    } catch { setMutationState("unknown"); setMutationMessage("We’re not sure that worked. Try again; it’s safe."); }
    finally { setMutationKind(null); }
  }

  const provider = detail ? providerDescription(detail.providerState) : null;
  const ProviderIcon = provider?.icon ?? Database;
  const isStale = detail?.currentSyncState !== "current";

  return <AdminSupplyShell>
    <a href="/admin/tables" className="page-header-back"><ArrowLeft aria-hidden="true" />Tables</a>
    {state !== "ready" && <StatePanel state={state} message={message} onRetry={() => void loadDetail()} />}
    {state === "ready" && detail && <>
      <div className="page-heading-row supply-detail-heading"><div><p className="eyebrow">{lifecycleLabels[detail.lifecycle].toUpperCase()}</p><h1 id="supply-detail-title">{draft?.content.title || detail.published?.content.title || detail.accepted?.content.title || "Table draft"}</h1><p className="page-intro">{draft?.content.neighborhood || detail.published?.content.neighborhood || detail.accepted?.content.neighborhood || "Neighborhood not set"} · Updated {formatTimestamp(draft?.updatedAt ?? detail.published?.updatedAt ?? detail.accepted?.updatedAt ?? "")}</p></div><span className={`status-pill ${isStale ? "status-pill-warning" : "status-pill-neutral"}`}><Clock3 aria-hidden="true" />{detail.currentSyncState === "current" ? "Matches Airtable" : detail.currentSyncState === "stale" ? "Changed in Airtable" : "Removed from Airtable"}</span></div>
      {provider && <section className={`supply-mode-inline ${provider.className}`}><ProviderIcon aria-hidden="true" /><span><strong>{provider.title}</strong><small>{fixtureMutationsEnabled ? "Test mode" : "Editing is turned off here"}</small></span></section>}
      {isStale && <section className="supply-detail-warning" role="status"><CircleAlert aria-hidden="true" /><div><strong>{detail.currentSyncState === "missing" ? "Removed from Airtable" : "Changed in Airtable"}</strong><p>{detail.currentSyncState === "missing" ? "This table isn’t in Airtable anymore. Guests still see the live version." : "Airtable has newer details. Review them below."}</p></div></section>}
      {mutationMessage && <div className={`supply-mutation-feedback ${mutationState === "error" || mutationState === "conflict" ? "is-error" : mutationState === "unknown" ? "is-warning" : ""}`} role={mutationState === "error" || mutationState === "conflict" || mutationState === "unknown" ? "alert" : "status"}><CircleAlert aria-hidden="true" />{mutationMessage}{mutationState === "conflict" && <button className="text-action" type="button" onClick={() => void loadDetail()}>Reload current revision</button>}{mutationState === "unknown" && <small>Retry the same action while the operation is unchanged.</small>}</div>}

      <div className="supply-revision-grid">
        {detail.published && <SupplySnapshot title="Current guest-visible revision" label={`Published · ${formatTimestamp(detail.published.updatedAt)}`} revision={detail.published} privateNotes={false} />}
        {detail.accepted && <SupplySnapshot title="Accepted revision" label={`Accepted · ${formatTimestamp(detail.accepted.updatedAt)}`} revision={detail.accepted} privateNotes />}
      </div>
      {!draft && <section className="supply-no-draft"><span className="data-state-icon"><FileCheck2 aria-hidden="true" /></span><div><h2>No draft yet</h2><p>Start one from “New from Airtable” on the Tables page.</p><a className="button button-outline" href="/admin/tables">Back to Tables<ArrowRight aria-hidden="true" /></a></div></section>}

      {draft && content && <section className="supply-editor-section" aria-labelledby="supply-editor-title"><div className="supply-section-heading"><div><p className="eyebrow">DRAFT</p><h2 id="supply-editor-title">{detail.canEditDraft ? "Edit draft" : "Draft"}</h2><p>Guests won’t see changes until you publish.</p></div><span className={`status-pill ${draft.state === "draft" ? "status-pill-pending" : "status-pill-neutral"}`}>{draft.state}</span></div>
        <form className="supply-detail-form" onSubmit={(event) => void saveDraft(event)}>
          <div className="supply-form-grid">
            <Field label="Public Table title" id="detail-title" error={fieldErrors.title}><input id="detail-title" required maxLength={180} disabled={!editable || mutationState === "running"} value={content.title} onChange={(event) => updateField("title", event.currentTarget.value)} /></Field>
            <Field label="Neighborhood" id="detail-neighborhood" error={fieldErrors.neighborhood}><input id="detail-neighborhood" required maxLength={120} disabled={!editable || mutationState === "running"} value={content.neighborhood} onChange={(event) => updateField("neighborhood", event.currentTarget.value)} /></Field>
            <Field label="Atlanta local date" id="detail-date" error={fieldErrors.localDate ?? fieldErrors.schedule}><input id="detail-date" type="date" required disabled={!editable || mutationState === "running"} value={content.localDate} onChange={(event) => updateField("localDate", event.currentTarget.value)} /></Field>
            <Field label="Atlanta local start time" id="detail-time" error={fieldErrors.startLocalTime ?? fieldErrors.schedule}><input id="detail-time" type="time" required disabled={!editable || mutationState === "running"} value={content.startLocalTime} onChange={(event) => updateField("startLocalTime", event.currentTarget.value)} /><small>America/New_York time; daylight-saving gaps and repeated times require correction.</small></Field>
          </div>
          <label className="supply-field supply-private-notes" htmlFor="detail-host-notes"><span>Notes for staff (guests don’t see these)</span><textarea id="detail-host-notes" rows={3} maxLength={2000} disabled={!editable || mutationState === "running"} value={content.hostNotes} onChange={(event) => updateField("hostNotes", event.currentTarget.value)} /><small></small></label>
          <fieldset className="supply-stops-fieldset"><legend>Three-stop itinerary</legend><p>Drinks → dinner → dessert. Only public notes appear in the member itinerary.</p>
            {content.stops.map((stop, index) => <section className="supply-stop-editor" key={stop.role}><div className="supply-stop-editor-heading"><span>{index + 1}</span><div><strong>{stop.role[0]!.toUpperCase() + stop.role.slice(1)}</strong><small>{stop.minutesFromStart} minutes after the table begins</small></div></div>
              <Field label={`${stop.role[0]!.toUpperCase() + stop.role.slice(1)} venue`} id={`detail-${stop.role}-venue`} error={fieldErrors[`stops.${stop.role}.venueId`] ?? fieldErrors.venue}><select id={`detail-${stop.role}-venue`} required disabled={!editable || mutationState === "running" || !venues} value={stop.venueId} onChange={(event) => { const venue = venues?.items.find((item) => item.venueId === event.currentTarget.value); updateDetailStop(index, { venueId: venue?.venueId ?? "", venueName: venue?.name ?? "", venueAddress: venue?.address ?? "" }); }}><option value="">Choose a venue</option>{venues?.items.map((venue) => <option key={venue.venueId} value={venue.venueId}>{venue.name} · {venue.neighborhood}</option>)}{stop.venueId && !venues?.items.some((venue) => venue.venueId === stop.venueId) && <option value={stop.venueId}>{stop.venueName} · unavailable</option>}</select></Field>
              <Field label="Minutes from start" id={`detail-${stop.role}-offset`} error={fieldErrors[`stops.${stop.role}.minutesFromStart`]}><input id={`detail-${stop.role}-offset`} type="number" min={0} max={720} step={5} disabled={!editable || mutationState === "running"} value={stop.minutesFromStart} onChange={(event) => updateDetailStop(index, { minutesFromStart: Number(event.currentTarget.value) })} /></Field>
              <label className="supply-field" htmlFor={`detail-${stop.role}-public-notes`}><span>Note for guests</span><textarea id={`detail-${stop.role}-public-notes`} rows={2} maxLength={500} disabled={!editable || mutationState === "running"} value={stop.publicNotes} onChange={(event) => updateDetailStop(index, { publicNotes: event.currentTarget.value })} /></label>
              <p className="supply-venue-summary"><MapPin aria-hidden="true" />{stop.venueName || "Venue not selected"}{stop.venueAddress ? ` · ${stop.venueAddress}` : ""}</p>
            </section>)}
          </fieldset>
          <div className="supply-editor-actions"><span>{dirty ? "Unsaved changes" : `Saved revision ${draft.revision}`}</span><div><button className="button button-outline" type="button" disabled={!editable || mutationState === "running" || dirty} onClick={() => void createPreview()}>{mutationKind === "preview" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <FileCheck2 aria-hidden="true" />}{mutationKind === "preview" ? "Reviewing…" : "Preview revision"}</button><button className="button button-primary" type="submit" disabled={!editable || !dirty || mutationState === "running"}>{String(mutationKind) === "save" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Save aria-hidden="true" />}{String(mutationKind) === "save" ? "Saving…" : mutationState === "unknown" && String(mutationKind) === "save" ? "Retry save" : mutationState === "unknown" && saveOperation.current ? "Retry save" : "Save draft"}</button></div></div>
        </form>
      </section>}

      {preview && draft && <section className="supply-preview-section" aria-labelledby="supply-preview-title"><div className="supply-section-heading"><div><p className="eyebrow">PREVIEW</p><h2 id="supply-preview-title">Check the details before approving.</h2><p>{preview.startsAt ? `Starts ${formatTimestamp(preview.startsAt)}.` : "This draft doesn’t have a valid start time yet."}</p></div><span className={`status-pill ${preview.valid ? "status-pill-success" : "status-pill-warning"}`}>{preview.valid ? "Ready" : "Needs fixes"}</span></div>
        {preview.issues.length > 0 && <ul className="supply-validation-list">{preview.issues.map((issue, index) => <li key={`${issue.field}-${issue.stopRole ?? "table"}-${index}`}><CircleAlert aria-hidden="true" /><span><strong>{issue.stopRole ? `${issue.stopRole} · ` : ""}{issue.field}</strong>{issue.message}</span></li>)}</ul>}
        {preview.changes.length > 0 && <div className="supply-change-list"><h3>Changes</h3>{preview.changes.map((change, index) => <div key={`${change.field}-${index}`}><strong>{change.field}</strong><span>{change.before ?? "No previous value"}</span><ArrowRight aria-hidden="true" /><span>{change.after ?? "Removed"}</span></div>)}</div>}
        {preview.valid && preview.changes.length === 0 && <p className="supply-no-changes">This revision matches the current source snapshot.</p>}
        <div className="supply-review-actions"><p>{detail.currentSyncState === "missing" ? "This table isn’t in Airtable anymore. Guests still see the live version." : "Approved changes aren’t live until you publish."}</p><div><button className="button button-outline" type="button" disabled={detail.currentSyncState === "missing" || !detail.canAccept || !preview.canAccept || !fixtureMutationsEnabled || mutationState === "running"} onClick={() => setDialog("accept")}><BadgeCheck aria-hidden="true" />Approve changes</button><button className="button button-primary" type="button" disabled={detail.currentSyncState === "missing" || !detail.canPublish || !preview.canPublish || !fixtureMutationsEnabled || mutationState === "running"} onClick={() => setDialog("publish")}><Check aria-hidden="true" />Publish</button></div></div>
      </section>}

      {!fixtureMutationsEnabled && <p className="supply-disabled-note"><Ban aria-hidden="true" />Write actions are disabled outside the isolated local fixture environment. Draft writes, acceptance and publication are unavailable here.</p>}
    </>}
    <SupplyConfirmDialog mode={dialog === "accept" || dialog === "publish" ? dialog : "closed"} onClose={() => setDialog("closed")} onConfirm={() => void revisionAction(dialog as "accept" | "publish")} disabled={mutationState === "running"} busy={mutationState === "running"} />
    {footer}
  </AdminSupplyShell>;
}

function SupplySnapshot({ title, label, revision, privateNotes }: Readonly<{ title: string; label: string; revision: SupplyRevisionSummaryDTO; privateNotes: boolean }>) {
  return <section className="supply-snapshot"><div className="supply-snapshot-heading"><span className="supply-snapshot-icon">{privateNotes ? <BadgeCheck aria-hidden="true" /> : <Check aria-hidden="true" />}</span><div><p className="eyebrow">{label}</p><h2>{title}</h2></div></div><p className="supply-snapshot-title">{revision.content.title}</p><p className="supply-snapshot-meta"><CalendarDays aria-hidden="true" />{formatDate(revision.content.localDate, revision.content.startLocalTime)} · {revision.content.startLocalTime} · {revision.content.neighborhood}</p><div className="supply-snapshot-stops">{revision.content.stops.map((stop) => <article key={stop.role}><strong>{stop.role}</strong><span>{stop.venueName}</span><small>{stop.venueAddress}</small>{stop.publicNotes && <p>{stop.publicNotes}</p>}</article>)}</div>{privateNotes && revision.content.hostNotes && <div className="supply-host-notes"><strong>Private host notes</strong><p>{revision.content.hostNotes}</p></div>}</section>;
}

function SupplyConfirmDialog(props: Readonly<{ mode: "closed" | "accept" | "publish"; onClose: () => void; onConfirm: () => void; disabled: boolean; busy: boolean }>) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (props.mode === "closed") return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !props.busy) { event.preventDefault(); props.onClose(); } };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocusRef.current?.focus(); };
  }, [props.mode, props.busy, props.onClose]);
  if (props.mode === "closed") return null;
  const accepting = props.mode === "accept";
  return <div className="supply-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !props.busy) props.onClose(); }}><section className="supply-modal supply-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="supply-confirm-title" ref={dialogRef} tabIndex={-1}><span className="supply-modal-icon">{accepting ? <BadgeCheck aria-hidden="true" /> : <Check aria-hidden="true" />}</span><h2 id="supply-confirm-title">{accepting ? "Approve these changes?" : "Publish these changes?"}</h2><p>{accepting ? "Guests will still see the current version until you publish." : "Guests will see them right away."}</p><div className="supply-modal-actions"><button className="button button-outline" type="button" onClick={props.onClose} disabled={props.busy}>Cancel</button><button className="button button-primary" type="button" onClick={props.onConfirm} disabled={props.disabled}>{props.busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : accepting ? <BadgeCheck aria-hidden="true" /> : <Check aria-hidden="true" />}{props.busy ? (accepting ? "Accepting…" : "Publishing…") : (accepting ? "Approve" : "Publish")}</button></div></section></div>;
}
