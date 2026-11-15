import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "./ui/page-header";
import { AppShell } from "./app-shell";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleAlert, Clock3, Copy, LoaderCircle, RefreshCw, ShieldCheck, Table2, Undo2, WifiOff } from "lucide-react";
import type {
  WeeklyCloneError, WeeklyCloneOperationDTO, WeeklyCloneOperationListDTO, WeeklyCloneOperationListItemDTO, WeeklyClonePreviewDTO, WeeklyCloneResponse,
} from "../supply.weekly-clone.contract.ts";
import "./admin-supply-weekly-clone.css";

type LoadState = "loading" | "ready" | "error" | "unauthenticated" | "forbidden";
type ActionState = "idle" | "running" | "error" | "unknown";
type OperationMemory = Readonly<{
  operationId: string;
  sourceWeekStart: string;
  targetWeekStart: string;
  expectedPlanHash: string;
  undoOperationId?: string;
}>;

const operationStorageKey = "fw.weekly-clone.operation.v1";
const clonePath = "/api/admin/supply/weekly-clone";
// Keep external-write controls locked until the actual endpoint recovery suite passes.
const weeklyCloneEndpointsVerified = true;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isProviderState(value: unknown): value is WeeklyClonePreviewDTO["providerState"] {
  return ["fixture", "disabled_unmapped", "ready", "unavailable"].includes(String(value));
}
function isPreview(value: unknown): value is WeeklyClonePreviewDTO {
  return isRecord(value) && isProviderState(value.providerState) && typeof value.mutationsEnabled === "boolean"
    && value.weekStartPolicy === "monday"
    && typeof value.sourceWeekStart === "string" && typeof value.targetWeekStart === "string"
    && Number.isSafeInteger(value.weekDelta) && typeof value.planHash === "string"
    && Array.isArray(value.items) && value.items.every((item) => isRecord(item)
      && typeof item.sourceTableId === "string" && typeof item.sourceRevisionId === "string"
      && Number.isSafeInteger(item.sourceRevision) && typeof item.sourceHash === "string"
      && typeof item.title === "string" && typeof item.sourceLocalDate === "string" && typeof item.targetLocalDate === "string"
      && ["eligible", "conflict"].includes(String(item.eligibility))
      && (typeof item.conflictCode === "string" || item.conflictCode === null))
    && Number.isSafeInteger(value.eligibleCount) && Number.isSafeInteger(value.conflictCount);
}
function isOperation(value: unknown): value is WeeklyCloneOperationDTO {
  const itemStates = ["pending", "creating", "created", "failed", "outcome_unknown", "undoing", "undone", "undo_unknown", "undo_refused"];
  const states = ["running", "partial", "outcome_unknown", "completed", "undoing", "undo_unknown", "undone", "undo_refused"];
  return isRecord(value) && isProviderState(value.providerState) && typeof value.mutationsEnabled === "boolean"
    && typeof value.operationId === "string" && states.includes(String(value.state))
    && Number.isSafeInteger(value.manifestRevision) && typeof value.sourceWeekStart === "string" && typeof value.targetWeekStart === "string"
    && typeof value.planHash === "string" && typeof value.startedAt === "string" && typeof value.updatedAt === "string"
    && (typeof value.finishedAt === "string" || value.finishedAt === null)
    && ["reconcile_first", "same_operation_after_no_write", "new_operation_required", "blocked"].includes(String(value.retryDisposition))
    && (typeof value.undoOperationId === "string" || value.undoOperationId === null)
    && (Number.isSafeInteger(value.undoExpectedManifestRevision) || value.undoExpectedManifestRevision === null)
    && (value.undoRetryDisposition === "reconcile_first" || value.undoRetryDisposition === "same_operation_after_no_delete" || value.undoRetryDisposition === "blocked" || value.undoRetryDisposition === null)
    && ["available", "blocked", "not_started", "unknown", "undone"].includes(String(value.undoState))
    && (typeof value.undoBlockedCode === "string" || value.undoBlockedCode === null)
    && Array.isArray(value.items) && value.items.every((item) => isRecord(item)
      && typeof item.sourceTableId === "string" && typeof item.sourceRevisionId === "string"
      && (typeof item.targetTableId === "string" || item.targetTableId === null)
      && (typeof item.targetRevisionId === "string" || item.targetRevisionId === null)
      && itemStates.includes(String(item.state))
      && (typeof item.safeCode === "string" || item.safeCode === null));
}
function isOperationListItem(value: unknown): value is WeeklyCloneOperationListItemDTO {
  const states = ["running", "partial", "outcome_unknown", "completed", "undoing", "undo_unknown", "undone", "undo_refused"];
  const undoStates = ["available", "blocked", "not_started", "unknown", "undone"];
  return isRecord(value) && typeof value.operationId === "string" && typeof value.sourceWeekStart === "string" && typeof value.targetWeekStart === "string"
    && states.includes(String(value.state)) && Number.isSafeInteger(value.manifestRevision)
    && typeof value.startedAt === "string" && typeof value.updatedAt === "string" && (typeof value.finishedAt === "string" || value.finishedAt === null)
    && ["reconcile_first", "same_operation_after_no_write", "new_operation_required", "blocked"].includes(String(value.retryDisposition))
    && undoStates.includes(String(value.undoState))
    && (typeof value.undoBlockedCode === "string" || value.undoBlockedCode === null)
    && isRecord(value.counts) && Number.isSafeInteger(value.counts.total) && Number.isSafeInteger(value.counts.created)
    && Number.isSafeInteger(value.counts.unresolved) && Number.isSafeInteger(value.counts.failed) && Number.isSafeInteger(value.counts.undone);
}
function isOperationList(value: unknown): value is WeeklyCloneOperationListDTO {
  return isRecord(value) && isProviderState(value.providerState) && typeof value.mutationsEnabled === "boolean"
    && Array.isArray(value.items) && value.items.every(isOperationListItem) && (typeof value.nextCursor === "string" || value.nextCursor === null);
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
  const delta = (weekday + 6) % 7;
  return addDays(today, -delta);
}
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Date unavailable";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function stateLabel(state: WeeklyCloneOperationDTO["state"]): string {
  const labels: Record<WeeklyCloneOperationDTO["state"], string> = {
    running: "Copying drafts", partial: "Some drafts copied", outcome_unknown: "Result needs a check", completed: "Drafts copied",
    undoing: "Removing copies", undo_unknown: "Removal needs a check", undone: "Copies removed", undo_refused: "Copies could not be removed",
  };
  return labels[state];
}
function itemStateLabel(state: WeeklyCloneOperationDTO["items"][number]["state"]): string {
  const labels: Record<WeeklyCloneOperationDTO["items"][number]["state"], string> = {
    pending: "Waiting", creating: "Copying", created: "Copied", failed: "Not copied", outcome_unknown: "Result needs a check",
    undoing: "Removing", undone: "Removed", undo_unknown: "Removal needs a check", undo_refused: "Could not be removed",
  };
  return labels[state];
}
function conflictLabel(code: string | null): string {
  const labels: Record<string, string> = {
    source_not_draft: "Only drafts can be copied.", source_missing: "The source draft is no longer available.", source_changed: "The source changed after this preview.",
    source_week_mismatch: "The source is outside the selected week.", target_invalid: "This draft cannot be placed in the selected target week.",
    provider_unavailable: "Airtable is unavailable.", protected_change: "This table has guests or payments, so it can’t be copied.",
    write_unknown: "We’re not sure this copied. Check what happened before trying again.",
    delete_unknown: "We’re not sure this was removed. Check what happened before trying again.",
  };
  return code ? labels[code] ?? "This source needs staff review." : "Can’t be copied.";
}
function undoBlockLabel(code: string | null): string {
  const labels: Record<string, string> = {
    target_changed: "A cloned draft has changed since it was created.", active_activity: "An invitation, Seat, or other protected activity now exists.",
    provider_unavailable: "Airtable is unavailable, so we can’t confirm the undo.", operation_unresolved: "Finish checking this copy before undoing it.",
  };
  return code ? labels[code] ?? "Undo is currently blocked." : "Undo is currently blocked.";
}
function readOperationMemory(): OperationMemory | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(operationStorageKey) ?? "null");
    if (!isRecord(value) || typeof value.operationId !== "string" || typeof value.sourceWeekStart !== "string"
      || typeof value.targetWeekStart !== "string" || typeof value.expectedPlanHash !== "string") return null;
    return { operationId: value.operationId, sourceWeekStart: value.sourceWeekStart, targetWeekStart: value.targetWeekStart,
      expectedPlanHash: value.expectedPlanHash, ...(typeof value.undoOperationId === "string" ? { undoOperationId: value.undoOperationId } : {}) };
  } catch { return null; }
}
function storeOperationMemory(value: OperationMemory | null): void {
  try {
    if (value) sessionStorage.setItem(operationStorageKey, JSON.stringify(value));
    else sessionStorage.removeItem(operationStorageKey);
  } catch { /* recovery remains available while this page is open */ }
}

export function AdminSupplyWeeklyClone() {
  const policy = "monday" as const;
  const [clientReady, setClientReady] = useState(false);
  const initialSource = useMemo(() => defaultWeekStart(), []);
  const [sourceWeekStart, setSourceWeekStart] = useState(initialSource);
  const [targetWeekStart, setTargetWeekStart] = useState(addDays(initialSource, 7));
  const [preview, setPreview] = useState<WeeklyClonePreviewDTO | null>(null);
  const [previewState, setPreviewState] = useState<LoadState>("ready");
  const [previewMessage, setPreviewMessage] = useState("");
  const [operation, setOperation] = useState<WeeklyCloneOperationDTO | null>(null);
  const [operationState, setOperationState] = useState<LoadState>("loading");
  const [operationList, setOperationList] = useState<WeeklyCloneOperationListDTO | null>(null);
  const [operationListState, setOperationListState] = useState<LoadState>("loading");
  const [operationListMessage, setOperationListMessage] = useState("");
  const [operationCursor, setOperationCursor] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [dialog, setDialog] = useState<"clone" | "undo" | null>(null);
  const [operationMemory, setOperationMemory] = useState<OperationMemory | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const activeOperationId = operationMemory?.operationId ?? null;
  const previewFixtureWritesEnabled = weeklyCloneEndpointsVerified && preview?.providerState === "fixture" && preview.mutationsEnabled;
  const operationFixtureWritesEnabled = weeklyCloneEndpointsVerified && operation?.providerState === "fixture" && operation.mutationsEnabled;

  const applyLoadFailure = useCallback((response: Response, fallback: string, setter: (state: LoadState) => void) => {
    if (response.status === 401) setter("unauthenticated");
    else if (response.status === 403) setter("forbidden");
    else setter("error");
    return response.status === 401 ? "Sign in with an authorized staff account to continue."
      : response.status === 403 ? "This workspace is restricted to authorized administrators."
        : fallback;
  }, []);

  const fetchOperation = useCallback(async (id: string) => {
    setOperationState("loading");
    setActionMessage("");
    try {
      const response = await fetch(`${clonePath}/operations/${encodeURIComponent(id)}`, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) { setOperationState(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : "error"); setActionMessage(applyLoadFailure(response, "The saved weekly operation could not be loaded.", setOperationState)); return null; }
      const result = parseResponse(await response.json().catch(() => null), isOperation);
      if (!result?.ok) { setOperationState("error"); setActionMessage(result && !result.ok ? result.error.message : "The saved weekly operation response was invalid."); return null; }
      setOperation(result.data); setOperationState("ready"); setActionState("idle"); setActionMessage("");
      const restored: OperationMemory = { operationId: result.data.operationId, sourceWeekStart: result.data.sourceWeekStart,
        targetWeekStart: result.data.targetWeekStart, expectedPlanHash: result.data.planHash,
        ...(result.data.undoOperationId ? { undoOperationId: result.data.undoOperationId } : {}) };
      setOperationMemory(restored); storeOperationMemory(restored);
      return result.data;
    } catch {
      setOperationState("error"); setActionMessage("The saved weekly operation could not be reached. Try again."); return null;
    }
  }, [applyLoadFailure]);

  const loadOperationList = useCallback(async (cursor?: string | null, append = false) => {
    if (!append) setOperationListState("loading");
    setOperationListMessage("");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`${clonePath}/operations?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) { setOperationList(null); setOperationListState(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : "error"); setOperationListMessage(applyLoadFailure(response, "Recent weekly operations could not be loaded.", setOperationListState)); return; }
      const result = parseResponse(await response.json().catch(() => null), isOperationList);
      if (!result?.ok) { setOperationList(null); setOperationListState("error"); setOperationListMessage(result && !result.ok ? result.error.message : "Recent weekly operation response was invalid."); return; }
      setOperationList((current) => append && current ? { ...result.data, items: [...current.items, ...result.data.items] } : result.data);
      setOperationCursor(result.data.nextCursor); setOperationListState("ready");
    } catch { setOperationList(null); setOperationListState("error"); setOperationListMessage("Recent weekly operations could not be reached. Try again."); }
  }, [applyLoadFailure]);

  useEffect(() => {
    setClientReady(true);
    const remembered = readOperationMemory();
    setOperationMemory(remembered);
    if (remembered) void fetchOperation(remembered.operationId);
    else setOperationState("ready");
    void loadOperationList();
  }, [fetchOperation, loadOperationList]);

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
    setPreviewState("loading"); setPreviewMessage(""); setActionState("idle");
    try {
      const response = await fetch(`${clonePath}/preview`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ sourceWeekStart, targetWeekStart }) });
      if (!response.ok) { setPreviewState(response.status === 401 ? "unauthenticated" : response.status === 403 ? "forbidden" : "error"); setPreview(null); setPreviewMessage(applyLoadFailure(response, "The weekly draft preview could not be loaded.", setPreviewState)); return; }
      const result = parseResponse(await response.json().catch(() => null), isPreview);
      if (!result?.ok) { setPreviewState("error"); setPreview(null); setPreviewMessage(result && !result.ok ? result.error.message : "The weekly preview response was invalid."); return; }
      if (result.data.weekStartPolicy !== policy) { setPreviewState("error"); setPreview(null); setPreviewMessage("The server week policy does not match this screen. Refresh and try again."); return; }
      setPreview(result.data); setPreviewState("ready"); setSourceWeekStart(result.data.sourceWeekStart); setTargetWeekStart(result.data.targetWeekStart);
    } catch { setPreview(null); setPreviewState("error"); setPreviewMessage("The weekly draft preview could not be reached. Try again."); }
  }

  async function runClone(memory: OperationMemory) {
    setOperationMemory(memory); storeOperationMemory(memory); setActionState("running"); setActionMessage("");
    try {
      const response = await fetch(clonePath, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ operationId: memory.operationId, sourceWeekStart: memory.sourceWeekStart, targetWeekStart: memory.targetWeekStart, expectedPlanHash: memory.expectedPlanHash }) });
      if (!response.ok) {
        const result = parseResponse(await response.json().catch(() => null), isOperation);
        if (response.status === 401 || response.status === 403) { setOperationState(response.status === 401 ? "unauthenticated" : "forbidden"); setActionState("error"); setActionMessage(response.status === 401 ? "Sign in with an authorized staff account to continue." : "This operation is restricted to authorized administrators."); return; }
        if (result && !result.ok) { setActionState(result.error.retryable ? "unknown" : "error"); setActionMessage(result.error.message); if (result.error.retryable) await fetchOperation(memory.operationId); return; }
        setActionState("unknown"); setActionMessage("We’re not sure the copy finished. Check what happened before trying again.");
        await fetchOperation(memory.operationId); return;
      }
      const result = parseResponse(await response.json().catch(() => null), isOperation);
      if (!result?.ok) { setActionState("unknown"); setActionMessage("We’re not sure the copy finished. Check what happened before trying again."); await fetchOperation(memory.operationId); return; }
      setOperation(result.data); setOperationState("ready"); setActionState("idle"); setActionMessage("");
      if (result.data.state === "outcome_unknown" || result.data.items.some((item) => item.state === "outcome_unknown")) setActionMessage("We’re not sure the copy finished. Check what happened before trying again.");
      void loadOperationList();
    } catch {
      setActionState("unknown"); setActionMessage("We’re not sure the copy finished. Check what happened before trying again."); await fetchOperation(memory.operationId);
    }
  }

  async function reconcile() {
    if (!activeOperationId) return;
    setActionState("running"); setActionMessage("");
    try {
      const response = await fetch(`${clonePath}/operations/${encodeURIComponent(activeOperationId)}/reconcile`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", "content-type": "application/json" }, body: "{}" });
      if (!response.ok) { const result = parseResponse(await response.json().catch(() => null), isOperation); setActionState("error"); setActionMessage(result && !result.ok ? result.error.message : "Couldn’t check. Nothing new was copied."); return; }
      const result = parseResponse(await response.json().catch(() => null), isOperation);
      if (!result?.ok) { setActionState("unknown"); setActionMessage("The reconciliation result could not be read. Reload this operation before retrying."); await fetchOperation(activeOperationId); return; }
      setOperation(result.data); setOperationState("ready"); setActionState("idle");
      setActionMessage(result.data.retryDisposition === "same_operation_after_no_write" ? "Nothing was copied. Safe to try again." : "Check complete. See each table below.");
      void loadOperationList();
    } catch { setActionState("unknown"); setActionMessage("Couldn’t check. Reload and try again."); await fetchOperation(activeOperationId); }
  }

  async function retrySameOperation() {
    if (!operationMemory || !operation || operation.retryDisposition !== "same_operation_after_no_write") return;
    await runClone(operationMemory);
  }

  async function runUndo() {
    if (!operation || !operationMemory || (operation.undoState !== "available" && operation.undoRetryDisposition !== "same_operation_after_no_delete") || !operationFixtureWritesEnabled) return;
    const undoOperationId = operation.undoOperationId ?? operationMemory.undoOperationId ?? crypto.randomUUID();
    const memory = { ...operationMemory, undoOperationId };
    setOperationMemory(memory); storeOperationMemory(memory); setDialog(null); setActionState("running"); setActionMessage("");
    try {
      const expectedManifestRevision = operation.undoOperationId ? operation.undoExpectedManifestRevision : operation.manifestRevision;
      if (!expectedManifestRevision) { setActionState("error"); setActionMessage("The original undo request could not be recovered. Reload the operation before retrying."); return; }
      const response = await fetch(`${clonePath}/operations/${encodeURIComponent(operation.operationId)}/undo`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ undoOperationId, expectedManifestRevision }) });
      if (!response.ok) { const result = parseResponse(await response.json().catch(() => null), isOperation); setActionState(result && !result.ok && !result.error.retryable ? "error" : "unknown"); setActionMessage(result && !result.ok ? result.error.message : "The undo response was interrupted. Reload its operation before another action."); await fetchOperation(operation.operationId); return; }
      const result = parseResponse(await response.json().catch(() => null), isOperation);
      if (!result?.ok) { setActionState("unknown"); setActionMessage("The undo may have started, but its result could not be read. Reload this operation."); await fetchOperation(operation.operationId); return; }
      setOperation(result.data); setOperationState("ready"); setActionState("idle"); setActionMessage("");
      if (result.data.undoOperationId) { const nextMemory = { ...memory, undoOperationId: result.data.undoOperationId }; setOperationMemory(nextMemory); storeOperationMemory(nextMemory); }
      void loadOperationList();
    } catch { setActionState("unknown"); setActionMessage("The undo response was lost. Reload this operation before another action."); await fetchOperation(operation.operationId); }
  }

  const statusTone = operation?.state === "completed" || operation?.state === "undone" ? "success"
    : operation?.state === "outcome_unknown" || operation?.state === "undo_unknown" || operation?.state === "partial" || operation?.state === "undo_refused" ? "warning" : "pending";
  const canClone = previewState === "ready" && previewFixtureWritesEnabled && preview?.eligibleCount !== undefined && preview.eligibleCount > 0 && actionState !== "running";
  const dayDelta = preview?.weekDelta ?? 0;

  function openOperation(item: WeeklyCloneOperationListItemDTO) {
    const memory: OperationMemory = { operationId: item.operationId, sourceWeekStart: item.sourceWeekStart, targetWeekStart: item.targetWeekStart, expectedPlanHash: "" };
    setOperationMemory(memory); storeOperationMemory(memory); setOperation(null); void fetchOperation(item.operationId);
  }

  return <AppShell role="admin" active="tables"><div className="weekly-clone-page" data-client-ready={clientReady ? "true" : "false"}>
    <div className="product-breadcrumb"><a href="/admin/tables"><ArrowLeft aria-hidden="true" />Tables</a><span>/</span>Copy a week</div>
    <PageHeader className="weekly-clone-heading" titleId="weekly-clone-heading" title="Copy a week" description="Copy draft tables from one week to another. Only drafts are copied."
      status={<span className="status-pill status-pill-neutral"><CalendarDays aria-hidden="true" />Atlanta calendar weeks</span>} />

    <aside className="weekly-clone-trust-note"><ShieldCheck aria-hidden="true" /><div><strong>Drafts only</strong><p>Only drafts are copied.</p></div></aside>

    <section className="weekly-clone-card weekly-clone-schedule" aria-labelledby="weekly-preview-title">
      <div className="weekly-clone-section-heading"><div><h2 id="weekly-preview-title">1 · Pick weeks</h2><p>Same day and time, different week.</p></div><span className="weekly-clone-timezone"><Clock3 aria-hidden="true" />America/New_York</span></div>
      <form className="weekly-clone-week-form" onSubmit={loadPreview}>
        <label className="weekly-clone-field"><span>Copy from (week of)</span><input type="date" value={sourceWeekStart} onChange={(event) => { setSourceWeekStart(event.currentTarget.value); setPreview(null); }} aria-describedby="weekly-source-hint" /><small id="weekly-source-hint">The preview includes draft records scheduled within this week.</small></label>
        <div className="weekly-clone-shift" aria-hidden="true"><ArrowRight /></div>
        <label className="weekly-clone-field"><span>Copy to (week of)</span><input type="date" value={targetWeekStart} onChange={(event) => { setTargetWeekStart(event.currentTarget.value); setPreview(null); }} aria-describedby="weekly-target-hint" /><small id="weekly-target-hint">The weekday and local start time are preserved.</small></label>
        <div className="weekly-clone-week-actions"><button className="button button-primary" type="submit" disabled={previewState === "loading"}>{previewState === "loading" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Preview</button></div>
      </form>
      {previewState === "loading" && <div className="weekly-clone-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Loading…</div>}
      {(previewState === "error" || previewState === "unauthenticated" || previewState === "forbidden") && <div className="weekly-clone-inline-state is-error" role="alert"><CircleAlert aria-hidden="true" /><span>{previewMessage}</span><button className="button button-outline" type="button" onClick={() => void loadPreview()}>Try again</button></div>}
    </section>

    {previewState === "ready" && preview && <section className="weekly-clone-card weekly-clone-preview" aria-labelledby="weekly-plan-title">
      <div className="weekly-clone-section-heading"><div><p className="eyebrow">02 / REVIEW PLAN</p><h2 id="weekly-plan-title">Drafts to review</h2><p>{formatDate(preview.sourceWeekStart)} through {formatDate(addDays(preview.sourceWeekStart, 6))} → {formatDate(preview.targetWeekStart)} through {formatDate(addDays(preview.targetWeekStart, 6))} <span className="weekly-clone-delta">{dayDelta > 0 ? "+" : ""}{dayDelta} {Math.abs(dayDelta) === 1 ? "week" : "weeks"}</span></p></div><div className="weekly-clone-counts"><span><strong>{preview.eligibleCount}</strong> eligible</span><span><strong>{preview.conflictCount}</strong> need review</span></div></div>
      <div className={`weekly-clone-provider ${preview.providerState === "fixture" ? "is-fixture" : ""}`} role="status">
        {preview.providerState === "fixture" ? <Check aria-hidden="true" /> : preview.providerState === "unavailable" ? <WifiOff aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        <span>{preview.providerState === "fixture" ? "Test mode: changes don’t reach Airtable" : preview.providerState === "disabled_unmapped" ? "Airtable isn’t set up yet" : preview.providerState === "ready" ? "Editing is turned off here" : "Airtable is unavailable"}</span>
      </div>
      {preview.items.length === 0 ? <div className="weekly-clone-empty"><Table2 aria-hidden="true" /><h3>No drafts found for this source week</h3><p>Pick another week or go back to Tables.</p><a className="button button-outline" href="/admin/tables">Back to Tables<ArrowRight aria-hidden="true" /></a></div> : <div className="weekly-clone-plan-list" role="list" aria-label="Weekly clone preview items">
        {preview.items.map((item) => <article className={`weekly-clone-plan-item ${item.eligibility === "conflict" ? "is-conflict" : ""}`} role="listitem" key={`${item.sourceTableId}:${item.sourceRevisionId}`}>
          <span className="weekly-clone-item-icon">{item.eligibility === "eligible" ? <Copy aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}</span>
          <div className="weekly-clone-item-main"><h3>{item.title || "Untitled draft"}</h3><p>{formatDate(item.sourceLocalDate)} <ArrowRight aria-hidden="true" /> {formatDate(item.targetLocalDate)}</p>{item.eligibility === "conflict" && <small>{conflictLabel(item.conflictCode)}</small>}</div>
          <span className={`status-pill ${item.eligibility === "eligible" ? "status-pill-success" : "status-pill-warning"}`}>{item.eligibility === "eligible" ? "Eligible draft" : "Needs review"}</span>
        </article>)}
      </div>}
      {preview.items.length > 0 && <footer className="weekly-clone-plan-footer"><p>This preview is tied to the draft versions shown. If any draft changes, create a new preview before copying.</p><button className="button button-primary" type="button" disabled={!canClone} onClick={() => setDialog("clone")}><Copy aria-hidden="true" />Review copy</button></footer>}
      {!previewFixtureWritesEnabled && <p className="weekly-clone-disabled-note"><WifiOff aria-hidden="true" />Copying is turned off here.</p>}
    </section>}

    <section className="weekly-clone-card weekly-clone-recent" aria-labelledby="weekly-recent-title">
      <div className="weekly-clone-section-heading"><div><h2 id="weekly-recent-title">Recent copies</h2></div><button className="button button-outline" type="button" disabled={operationListState === "loading"} onClick={() => void loadOperationList()}><RefreshCw aria-hidden="true" />Refresh list</button></div>
      {operationListState === "loading" && <div className="weekly-clone-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Loading…</div>}
      {(operationListState === "error" || operationListState === "unauthenticated" || operationListState === "forbidden") && <div className="weekly-clone-inline-state is-error" role="alert"><CircleAlert aria-hidden="true" /><span>{operationListMessage}</span><button className="button button-outline" type="button" onClick={() => void loadOperationList()}>Try again</button></div>}
      {operationListState === "ready" && operationList?.items.length === 0 && <div className="weekly-clone-empty weekly-clone-empty-compact"><Table2 aria-hidden="true" /><h3>None yet</h3><p></p></div>}
      {operationListState === "ready" && operationList && operationList.items.length > 0 && <div className="weekly-clone-recent-list" role="list" aria-label="Recent weekly clone operations">{operationList.items.map((item) => <article className="weekly-clone-recent-item" role="listitem" key={item.operationId}>
        <div className="weekly-clone-recent-main"><span className={`status-pill ${item.state === "completed" || item.state === "undone" ? "status-pill-success" : item.state === "partial" || item.state.includes("unknown") || item.state === "undo_refused" ? "status-pill-warning" : "status-pill-pending"}`}>{stateLabel(item.state)}</span><strong>{formatDate(item.sourceWeekStart)} <ArrowRight aria-hidden="true" /> {formatDate(item.targetWeekStart)}</strong><small>{item.counts.created} created · {item.counts.unresolved} unresolved · {item.counts.failed} failed · updated {formatTimestamp(item.updatedAt)}</small>{item.undoState === "blocked" && <small className="weekly-clone-recent-warning">Undo blocked: {undoBlockLabel(item.undoBlockedCode)}</small>}</div>
        <button className="button button-outline" type="button" aria-label={`Open weekly operation ${item.operationId}`} onClick={() => openOperation(item)}>Open<ArrowRight aria-hidden="true" /></button>
      </article>)}</div>}
      {operationCursor && <div className="weekly-clone-load-more"><button className="button button-outline" type="button" onClick={() => void loadOperationList(operationCursor, true)}>Show older<ArrowRight aria-hidden="true" /></button></div>}
    </section>

    {operationMemory && <section className="weekly-clone-card weekly-clone-operation" aria-labelledby="weekly-operation-title">
      <div className="weekly-clone-section-heading"><div><p className="eyebrow">COPY STATUS</p><h2 id="weekly-operation-title">Draft copy and recovery</h2><p>Run reference <code>{operationMemory.operationId}</code></p></div>
        {operation && <span className={`status-pill status-pill-${statusTone}`}>{operation.state === "running" || operation.state === "undoing" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : operation.state === "completed" || operation.state === "undone" ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}{stateLabel(operation.state)}</span>}
      </div>
      {operationState === "loading" && <div className="weekly-clone-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Loading…</div>}
      {(operationState === "error" || operationState === "unauthenticated" || operationState === "forbidden") && <div className="weekly-clone-inline-state is-error" role="alert"><CircleAlert aria-hidden="true" /><span>{actionMessage || "Couldn’t load this copy."}</span><button className="button button-outline" type="button" onClick={() => void fetchOperation(operationMemory.operationId)}>Reload</button>{actionState === "unknown" && <button className="button button-outline" type="button" onClick={() => void reconcile()}>Check what happened</button>}</div>}
      {operation && operationState === "ready" && <>
        {!operationFixtureWritesEnabled && <p className="weekly-clone-disabled-note"><WifiOff aria-hidden="true" />Copying is turned off here.</p>}
        <div className="weekly-clone-operation-meta"><span>From week <strong>{formatDate(operation.sourceWeekStart)}</strong></span><span>To week <strong>{formatDate(operation.targetWeekStart)}</strong></span><span>Saved plan version <strong>{operation.manifestRevision}</strong></span></div>
        <div className="weekly-clone-operation-list" role="list" aria-label="Clone operation item results">{operation.items.map((item) => <article className="weekly-clone-operation-item" role="listitem" key={`${item.sourceTableId}:${item.sourceRevisionId}`}><span className={`weekly-clone-result-mark state-${item.state}`}>{item.state === "created" || item.state === "undone" ? <Check aria-hidden="true" /> : item.state.includes("unknown") || item.state === "failed" || item.state === "undo_refused" ? <CircleAlert aria-hidden="true" /> : <LoaderCircle aria-hidden="true" />}</span><div><strong>{item.targetTableId ? "Draft clone" : "Source draft"}</strong><small>{itemStateLabel(item.state)}{item.safeCode ? ` · ${conflictLabel(item.safeCode)}` : ""}</small></div>{item.targetTableId && <a className="weekly-clone-target-id" href={`/admin/tables/${encodeURIComponent(item.targetTableId)}`}>Open copied draft<ArrowRight aria-hidden="true" /></a>}</article>)}</div>
        {operation.undoState === "blocked" && <div className="weekly-clone-inline-state is-warning" role="status"><CircleAlert aria-hidden="true" />{undoBlockLabel(operation.undoBlockedCode)}</div>}
        {(operation.state === "outcome_unknown" || operation.state === "undo_unknown" || operation.items.some((item) => item.state === "outcome_unknown" || item.state === "undo_unknown") || operation.retryDisposition === "reconcile_first") && <div className="weekly-clone-recovery"><div><strong>Check what happened before trying again.</strong><p>This check looks up the existing change. It will not copy or remove drafts again.</p></div><button className="button button-outline" type="button" disabled={actionState === "running"} onClick={() => void reconcile()}><RefreshCw aria-hidden="true" />Check what happened</button></div>}
        {operation.retryDisposition === "same_operation_after_no_write" && operationMemory.expectedPlanHash && <div className="weekly-clone-recovery"><div><strong>No draft copy was found for this run.</strong><p>Trying again will use the same saved plan.</p></div><button className="button button-primary" type="button" disabled={actionState === "running" || !operationFixtureWritesEnabled} onClick={() => void retrySameOperation()}><RefreshCw aria-hidden="true" />Try again</button></div>}
        {operation.undoState === "available" && <div className="weekly-clone-undo"><div><strong>Undo this copy?</strong><p>Copied drafts that haven’t been edited or used will be removed.</p></div><button className="button button-outline" type="button" disabled={!operationFixtureWritesEnabled || actionState === "running"} onClick={() => setDialog("undo")}><Undo2 aria-hidden="true" />Undo…</button></div>}
        {operation.undoRetryDisposition === "same_operation_after_no_delete" && <div className="weekly-clone-recovery"><div><strong>No drafts were removed.</strong><p>Trying again will repeat the same removal request.</p></div><button className="button button-primary" type="button" disabled={!operationFixtureWritesEnabled || actionState === "running"} onClick={() => void runUndo()}><RefreshCw aria-hidden="true" />Try removal again</button></div>}
        {operation.undoState === "undone" && <div className="weekly-clone-inline-state is-success" role="status"><Check aria-hidden="true" />The eligible clones have been undone. Source drafts and runtime records were not changed.</div>}
      </>}
      {actionMessage && operationState === "ready" && <p className={`weekly-clone-action-message ${actionState === "error" || actionState === "unknown" ? "is-warning" : ""}`} role={actionState === "error" || actionState === "unknown" ? "alert" : "status"}>{actionState === "unknown" && <CircleAlert aria-hidden="true" />}{actionMessage}</p>}
      {actionState === "running" && <div className="weekly-clone-inline-state" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />Working…</div>}
    </section>}

    <dialog className="weekly-clone-dialog" ref={dialogRef} aria-labelledby="weekly-clone-dialog-title" onCancel={(event) => { event.preventDefault(); setDialog(null); }} onClick={(event) => { if (event.target === dialogRef.current) setDialog(null); }}>
      {dialog === "clone" && <><div className="weekly-clone-dialog-icon"><Copy aria-hidden="true" /></div><h2 id="weekly-clone-dialog-title">Copy {preview?.eligibleCount ?? 0} drafts to the week of {preview ? formatDate(preview.targetWeekStart) : "the selected week"}?</h2><p>They’ll be drafts. Nothing goes live.</p><div className="weekly-clone-dialog-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Cancel</button><button className="button button-primary" type="button" disabled={!preview || !previewFixtureWritesEnabled || actionState === "running"} onClick={() => { if (!preview) return; const memory: OperationMemory = { operationId: crypto.randomUUID(), sourceWeekStart: preview.sourceWeekStart, targetWeekStart: preview.targetWeekStart, expectedPlanHash: preview.planHash }; setDialog(null); void runClone(memory); }}><Copy aria-hidden="true" />Copy drafts</button></div></>}
      {dialog === "undo" && operation && <><div className="weekly-clone-dialog-icon"><Undo2 aria-hidden="true" /></div><h2 id="weekly-clone-dialog-title">Undo this copy?</h2><p>We’ll remove copied drafts that haven’t been edited or used. Anything edited stays.</p><div className="weekly-clone-dialog-actions"><button className="button button-outline" type="button" onClick={() => setDialog(null)}>Keep copies</button><button className="button button-primary" type="button" disabled={!operationFixtureWritesEnabled || actionState === "running"} onClick={() => void runUndo()}><Undo2 aria-hidden="true" />Undo copy</button></div></>}
    </dialog>
  </div></AppShell>;
}
