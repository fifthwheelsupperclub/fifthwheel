import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { eventDate, timestamp } from "../format/datetime";
import { PageHeader } from "./ui/page-header";
import { AppShell } from "./app-shell";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, Copy, LoaderCircle, RefreshCw, Table2, Undo2 } from "lucide-react";
import type {
  WeeklyCloneError, WeeklyCloneOperationDTO, WeeklyCloneOperationListDTO, WeeklyCloneOperationListItemDTO, WeeklyClonePreviewDTO, WeeklyCloneResponse,
  WeeklyCloneStartRequest,
} from "../supply.weekly-clone.contract.ts";
import "./admin-supply-weekly-clone.css";

type LoadState = "loading" | "ready" | "error";

const clonePath = "/api/admin/supply/weekly-clone";
const jsonHeaders = { accept: "application/json", "content-type": "application/json" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPreview(value: unknown): value is WeeklyClonePreviewDTO {
  return isRecord(value) && value.weekStartPolicy === "monday"
    && typeof value.sourceWeekStart === "string" && typeof value.targetWeekStart === "string" && Number.isSafeInteger(value.weekDelta)
    && Array.isArray(value.items) && value.items.every((item) => isRecord(item)
      && typeof item.sourceTableId === "string" && typeof item.title === "string"
      && typeof item.sourceLocalDate === "string" && typeof item.targetLocalDate === "string"
      && ["eligible", "conflict"].includes(String(item.eligibility))
      && (typeof item.conflictCode === "string" || item.conflictCode === null))
    && Number.isSafeInteger(value.eligibleCount) && Number.isSafeInteger(value.conflictCount);
}
function isSummary(value: unknown): value is WeeklyCloneOperationListItemDTO {
  return isRecord(value) && typeof value.operationId === "string" && typeof value.sourceWeekStart === "string" && typeof value.targetWeekStart === "string"
    && (value.state === "completed" || value.state === "undone") && typeof value.startedAt === "string" && typeof value.updatedAt === "string"
    && ["available", "blocked", "undone"].includes(String(value.undoState)) && Number.isSafeInteger(value.draftCount);
}
function isOperation(value: unknown): value is WeeklyCloneOperationDTO {
  return isSummary(value) && Array.isArray((value as Record<string, unknown>).items)
    && ((value as Record<string, unknown>).items as unknown[]).every((item) => isRecord(item)
      && typeof item.sourceTableId === "string" && typeof item.targetTableId === "string" && typeof item.title === "string"
      && typeof item.targetLocalDate === "string" && (item.state === "created" || item.state === "undone"));
}
function isOperationList(value: unknown): value is WeeklyCloneOperationListDTO {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isSummary) && (typeof value.nextCursor === "string" || value.nextCursor === null);
}
function isError(value: unknown): value is WeeklyCloneError {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string"
    && typeof value.retryable === "boolean" && typeof value.correlationId === "string";
}
function parseResponse<T>(body: unknown, valid: (value: unknown) => value is T): WeeklyCloneResponse<T> | null {
  if (!isRecord(body)) return null;
  if (body.ok === true && valid(body.data) && typeof body.correlationId === "string") return { ok: true, data: body.data, correlationId: body.correlationId };
  if (body.ok === false && isError(body.error)) return { ok: false, error: body.error };
  return null;
}
/** Fetches a JSON envelope; resolves to the data or a user-facing error message. */
async function request<T>(url: string, init: RequestInit, valid: (value: unknown) => value is T, fallback: string): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: init.method === "GET" ? { accept: "application/json" } : jsonHeaders });
    const result = parseResponse(await response.json().catch(() => null), valid);
    if (result?.ok) return { ok: true, data: result.data };
    if (response.status === 401) return { ok: false, message: "Sign in with an authorized staff account to continue." };
    if (response.status === 403) return { ok: false, message: "This workspace is restricted to authorized administrators." };
    return { ok: false, message: result && !result.ok ? result.error.message : fallback };
  } catch { return { ok: false, message: fallback }; }
}
function isWeekStart(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return parsed.getUTCDay() === 1;
}
function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
function dateInAtlanta(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function defaultWeekStart(): string {
  const today = dateInAtlanta();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, -((weekday + 6) % 7));
}
const formatDate = (value: string) => eventDate(value);
const stateLabel = (state: WeeklyCloneOperationDTO["state"]) => state === "completed" ? "Drafts copied" : "Copies removed";
function conflictLabel(code: string | null): string {
  const labels: Record<string, string> = {
    source_not_draft: "Only drafts can be copied.", source_changed: "The source changed and needs review.",
    protected_change: "This table has guests or payments, so it can’t be copied.",
  };
  return code ? labels[code] ?? "This source needs staff review." : "Can’t be copied.";
}
const undoBlockedMessage = "A copied draft was edited or used, so this copy can’t be undone.";

export function AdminSupplyWeeklyClone() {
  const [clientReady, setClientReady] = useState(false);
  const initialSource = useMemo(() => defaultWeekStart(), []);
  const [sourceWeekStart, setSourceWeekStart] = useState(initialSource);
  const [targetWeekStart, setTargetWeekStart] = useState(addDays(initialSource, 7));
  const [preview, setPreview] = useState<WeeklyClonePreviewDTO | null>(null);
  const [previewState, setPreviewState] = useState<LoadState>("ready");
  const [previewMessage, setPreviewMessage] = useState("");
  const [operation, setOperation] = useState<WeeklyCloneOperationDTO | null>(null);
  const [history, setHistory] = useState<WeeklyCloneOperationListDTO | null>(null);
  const [historyState, setHistoryState] = useState<LoadState>("loading");
  const [historyMessage, setHistoryMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  // A failed clone keeps its request so "Try again" replays the same operation ID (a no-op if it already committed).
  const [pendingClone, setPendingClone] = useState<WeeklyCloneStartRequest | null>(null);
  const [dialog, setDialog] = useState<"clone" | "undo" | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const loadHistory = useCallback(async (cursor?: string | null) => {
    if (!cursor) setHistoryState("loading");
    setHistoryMessage("");
    const query = new URLSearchParams({ limit: "20" });
    if (cursor) query.set("cursor", cursor);
    const result = await request(`${clonePath}/operations?${query}`, { method: "GET" }, isOperationList, "Recent copies could not be loaded. Try again.");
    if (!result.ok) { setHistory(null); setHistoryState("error"); setHistoryMessage(result.message); return; }
    setHistory((current) => cursor && current ? { ...result.data, items: [...current.items, ...result.data.items] } : result.data);
    setHistoryState("ready");
  }, []);

  useEffect(() => { setClientReady(true); void loadHistory(); }, [loadHistory]);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (dialog && !element.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
      element.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    } else if (!dialog && element.open) {
      element.close();
      previousFocus.current?.focus();
      previousFocus.current = null;
    }
  }, [dialog]);

  async function loadPreview(event?: React.FormEvent) {
    event?.preventDefault();
    if (!isWeekStart(sourceWeekStart) || !isWeekStart(targetWeekStart) || sourceWeekStart === targetWeekStart) {
      setPreview(null); setPreviewState("error"); setPreviewMessage("Choose two different Monday week starts."); return;
    }
    setPreviewState("loading"); setPreviewMessage("");
    const result = await request(`${clonePath}/preview`, { method: "POST", body: JSON.stringify({ sourceWeekStart, targetWeekStart }) }, isPreview, "The weekly draft preview could not be loaded. Try again.");
    if (!result.ok) { setPreview(null); setPreviewState("error"); setPreviewMessage(result.message); return; }
    setPreview(result.data); setPreviewState("ready");
  }

  async function runClone(clone: WeeklyCloneStartRequest) {
    setDialog(null); setPendingClone(clone); setOperation(null); setRunning(true); setActionMessage("");
    const result = await request(clonePath, { method: "POST", body: JSON.stringify(clone) }, isOperation, "We couldn’t confirm the copy. Try again; it won’t copy twice.");
    setRunning(false);
    if (!result.ok) { setActionMessage(result.message); return; }
    setPendingClone(null); setOperation(result.data); setPreview(null);
    void loadHistory();
  }

  async function openOperation(item: WeeklyCloneOperationListItemDTO) {
    setRunning(true); setActionMessage("");
    const result = await request(`${clonePath}/operations/${encodeURIComponent(item.operationId)}`, { method: "GET" }, isOperation, "This copy could not be loaded. Try again.");
    setRunning(false);
    if (!result.ok) { setActionMessage(result.message); return; }
    setPendingClone(null); setOperation(result.data);
  }

  async function runUndo() {
    if (!operation) return;
    setDialog(null); setRunning(true); setActionMessage("");
    const result = await request(`${clonePath}/operations/${encodeURIComponent(operation.operationId)}/undo`, { method: "POST", body: "{}" }, isOperation, "We couldn’t confirm the undo. Try again; it’s safe to repeat.");
    setRunning(false);
    if (!result.ok) { setActionMessage(result.message); return; }
    setOperation(result.data);
    void loadHistory();
  }

  const canClone = previewState === "ready" && !!preview && preview.eligibleCount > 0 && !running;
  const dayDelta = preview?.weekDelta ?? 0;

  return <AppShell role="admin" active="tables"><div className="weekly-clone-page" data-client-ready={clientReady ? "true" : "false"}>
    <a href="/admin/tables" className="page-header-back"><ArrowLeft aria-hidden="true" />Tables</a>
    <PageHeader className="weekly-clone-heading" titleId="weekly-clone-heading" title="Copy a week" description="Copy draft tables from one week to another. Only drafts are copied." />

    <section className="weekly-clone-card weekly-clone-schedule" aria-labelledby="weekly-preview-title">
      <div className="weekly-clone-section-heading"><div><h2 id="weekly-preview-title">Pick weeks</h2><p>Same day and time, different week.</p></div><span className="weekly-clone-timezone"><Clock3 aria-hidden="true" />Atlanta time</span></div>
      <form className="weekly-clone-week-form" onSubmit={loadPreview}>
        <label className="weekly-clone-field"><span>Copy from (week of)</span><input type="date" value={sourceWeekStart} onChange={(event) => { setSourceWeekStart(event.currentTarget.value); setPreview(null); }} aria-describedby="weekly-source-hint" /><small id="weekly-source-hint">The preview includes draft records scheduled within this week.</small></label>
        <div className="weekly-clone-shift" aria-hidden="true"><ArrowRight /></div>
        <label className="weekly-clone-field"><span>Copy to (week of)</span><input type="date" value={targetWeekStart} onChange={(event) => { setTargetWeekStart(event.currentTarget.value); setPreview(null); }} aria-describedby="weekly-target-hint" /><small id="weekly-target-hint">The weekday and local start time are preserved.</small></label>
        <div className="weekly-clone-week-actions"><button className="button button-primary" type="submit" disabled={previewState === "loading"}>{previewState === "loading" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Preview</button></div>
      </form>
      {previewState === "loading" && <div className="weekly-clone-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Loading…</div>}
      {previewState === "error" && <div className="weekly-clone-inline-state is-error" role="alert"><CircleAlert aria-hidden="true" /><span>{previewMessage}</span><button className="button button-outline" type="button" onClick={() => void loadPreview()}>Try again</button></div>}
    </section>

    {previewState === "ready" && preview && <section className="weekly-clone-card weekly-clone-preview" aria-labelledby="weekly-plan-title">
      <div className="weekly-clone-section-heading"><div><h2 id="weekly-plan-title">Drafts to review</h2><p>{formatDate(preview.sourceWeekStart)} through {formatDate(addDays(preview.sourceWeekStart, 6))} → {formatDate(preview.targetWeekStart)} through {formatDate(addDays(preview.targetWeekStart, 6))} <span className="weekly-clone-delta">{dayDelta > 0 ? "+" : ""}{dayDelta} {Math.abs(dayDelta) === 1 ? "week" : "weeks"}</span></p></div><div className="weekly-clone-counts"><span><strong>{preview.eligibleCount}</strong> eligible</span><span><strong>{preview.conflictCount}</strong> need review</span></div></div>
      {preview.items.length === 0 ? <div className="weekly-clone-empty"><Table2 aria-hidden="true" /><h3>No drafts found for this source week</h3><p>Pick another week or go back to Tables.</p><a className="button button-outline" href="/admin/tables">Back to Tables<ArrowRight aria-hidden="true" /></a></div> : <div className="weekly-clone-plan-list" role="list" aria-label="Weekly clone preview items">
        {preview.items.map((item) => <article className={`weekly-clone-plan-item ${item.eligibility === "conflict" ? "is-conflict" : ""}`} role="listitem" key={item.sourceTableId}>
          <span className="weekly-clone-item-icon">{item.eligibility === "eligible" ? <Copy aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}</span>
          <div className="weekly-clone-item-main"><h3>{item.title || "Untitled draft"}</h3><p>{formatDate(item.sourceLocalDate)} <ArrowRight aria-hidden="true" /> {formatDate(item.targetLocalDate)}</p>{item.eligibility === "conflict" && <small>{conflictLabel(item.conflictCode)}</small>}</div>
          <span className={`status-pill ${item.eligibility === "eligible" ? "status-pill-success" : "status-pill-warning"}`}>{item.eligibility === "eligible" ? "Eligible draft" : "Needs review"}</span>
        </article>)}
      </div>}
      {preview.items.length > 0 && <footer className="weekly-clone-plan-footer"><p>Eligible drafts are copied together in one step. Nothing goes live.</p><button className="button button-primary" type="button" disabled={!canClone} onClick={() => setDialog("clone")}><Copy aria-hidden="true" />Review copy</button></footer>}
    </section>}

    {(operation || pendingClone || actionMessage) && <section className="weekly-clone-card weekly-clone-operation" aria-labelledby="weekly-operation-title">
      <div className="weekly-clone-section-heading"><div><p className="eyebrow">COPY RESULT</p><h2 id="weekly-operation-title">{operation ? `${formatDate(operation.sourceWeekStart)} → ${formatDate(operation.targetWeekStart)}` : "Copy drafts"}</h2>{operation && <p>Run reference <code>{operation.operationId}</code></p>}</div>
        {operation && <span className="status-pill status-pill-success"><Check aria-hidden="true" />{stateLabel(operation.state)}</span>}
      </div>
      {running && <div className="weekly-clone-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Working…</div>}
      {!running && actionMessage && <div className="weekly-clone-inline-state is-error" role="alert"><CircleAlert aria-hidden="true" /><span>{actionMessage}</span>{pendingClone && <button className="button button-outline" type="button" onClick={() => void runClone(pendingClone)}><RefreshCw aria-hidden="true" />Try again</button>}</div>}
      {operation && <>
        <div className="weekly-clone-operation-list" role="list" aria-label="Copied drafts">{operation.items.map((item) => <article className="weekly-clone-operation-item" role="listitem" key={item.targetTableId}><span className={`weekly-clone-result-mark state-${item.state}`}>{item.state === "created" ? <Check aria-hidden="true" /> : <Undo2 aria-hidden="true" />}</span><div><strong>{item.title || "Untitled draft"}</strong><small>{formatDate(item.targetLocalDate)} · {item.state === "created" ? "Copied" : "Removed"}</small></div>{item.state === "created" && <a className="weekly-clone-target-id" href={`/admin/tables/${encodeURIComponent(item.targetTableId)}`}>Open copied draft<ArrowRight aria-hidden="true" /></a>}</article>)}</div>
        {operation.undoState === "available" && <div className="weekly-clone-undo"><div><strong>Undo this copy?</strong><p>All copied drafts are removed, as long as none has been edited or used.</p></div><button className="button button-outline" type="button" disabled={running} onClick={() => setDialog("undo")}><Undo2 aria-hidden="true" />Undo…</button></div>}
        {operation.undoState === "blocked" && <div className="weekly-clone-inline-state is-warning" role="status"><CircleAlert aria-hidden="true" />{undoBlockedMessage}</div>}
        {operation.undoState === "undone" && <div className="weekly-clone-inline-state is-success" role="status"><Check aria-hidden="true" />The copied drafts were removed. Source drafts were not changed.</div>}
      </>}
    </section>}

    <section className="weekly-clone-card weekly-clone-recent" aria-labelledby="weekly-recent-title">
      <div className="weekly-clone-section-heading"><div><h2 id="weekly-recent-title">Recent copies</h2></div>{historyState !== "error" && <button className="button button-outline" type="button" disabled={historyState === "loading"} onClick={() => void loadHistory()}><RefreshCw aria-hidden="true" />Refresh list</button>}</div>
      {historyState === "loading" && <div className="weekly-clone-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Loading…</div>}
      {historyState === "error" && <div className="weekly-clone-inline-state is-error" role="alert"><CircleAlert aria-hidden="true" /><span>{historyMessage}</span><button className="button button-outline" type="button" onClick={() => void loadHistory()}>Try again</button></div>}
      {historyState === "ready" && history?.items.length === 0 && <div className="weekly-clone-empty weekly-clone-empty-compact"><Table2 aria-hidden="true" /><h3>None yet</h3></div>}
      {historyState === "ready" && history && history.items.length > 0 && <div className="weekly-clone-recent-list" role="list" aria-label="Recent weekly clone operations">{history.items.map((item) => <article className="weekly-clone-recent-item" role="listitem" key={item.operationId}>
        <div className="weekly-clone-recent-main"><span className={`status-pill ${item.state === "completed" ? "status-pill-success" : "status-pill-pending"}`}>{stateLabel(item.state)}</span><strong>{formatDate(item.sourceWeekStart)} <ArrowRight aria-hidden="true" /> {formatDate(item.targetWeekStart)}</strong><small>{item.draftCount} {item.draftCount === 1 ? "draft" : "drafts"} · updated {timestamp(item.updatedAt)}</small>{item.undoState === "blocked" && <small className="weekly-clone-recent-warning">{undoBlockedMessage}</small>}</div>
        <button className="button button-outline" type="button" aria-label={`Open weekly operation ${item.operationId}`} disabled={running} onClick={() => void openOperation(item)}>Open<ArrowRight aria-hidden="true" /></button>
      </article>)}</div>}
      {history?.nextCursor && <div className="weekly-clone-load-more"><button className="button button-outline" type="button" onClick={() => void loadHistory(history.nextCursor)}>Show older<ArrowRight aria-hidden="true" /></button></div>}
    </section>

    <dialog className="weekly-clone-dialog" ref={dialogRef} aria-labelledby="weekly-clone-dialog-title" onCancel={(event) => { event.preventDefault(); setDialog(null); }} onClick={(event) => { if (event.target === dialogRef.current) setDialog(null); }}>
      {dialog === "clone" && preview && <><div className="weekly-clone-dialog-icon"><Copy aria-hidden="true" /></div><h2 id="weekly-clone-dialog-title">Copy {preview.eligibleCount} drafts to the week of {formatDate(preview.targetWeekStart)}?</h2><p>They’ll be drafts. Nothing goes live.</p><div className="weekly-clone-dialog-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-primary" type="button" disabled={running} onClick={() => void runClone({ operationId: crypto.randomUUID(), sourceWeekStart: preview.sourceWeekStart, targetWeekStart: preview.targetWeekStart })}><Copy aria-hidden="true" />Copy drafts</button></div></>}
      {dialog === "undo" && operation && <><div className="weekly-clone-dialog-icon"><Undo2 aria-hidden="true" /></div><h2 id="weekly-clone-dialog-title">Undo this copy?</h2><p>We’ll remove all {operation.draftCount} copied drafts. If any was edited or used, nothing is removed.</p><div className="weekly-clone-dialog-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Keep copies</button><button className="button button-primary" type="button" disabled={running} onClick={() => void runUndo()}><Undo2 aria-hidden="true" />Undo copy</button></div></>}
    </dialog>
  </div></AppShell>;
}
