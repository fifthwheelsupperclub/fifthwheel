import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "./ui/page-header";
import { AppShell } from "./app-shell";
import { ArrowRight, Ban, Check, CircleAlert, Clock3, Database, FileWarning, LoaderCircle, RefreshCw, ShieldCheck, Table2, WifiOff } from "lucide-react";
import type { SupplyProviderState, SupplySyncAdminSummaryDTO, SupplySyncConflict, SupplySyncError, SupplySyncResponse, SupplySyncRunDTO } from "../supply.contract.ts";
import "./admin-supply-sync-workspace.css";

type ViewState = "loading" | "ready" | "error" | "unauthenticated" | "forbidden";
type ActionState = "idle" | "running" | "error" | "unknown";
const OPERATION_STORAGE_KEY = "fw.supply.sync.operation.v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConflict(value: unknown): value is SupplySyncConflict {
  return isRecord(value)
    && (value.entityKind === "table" || value.entityKind === "venue")
    && Number.isSafeInteger(value.recordOrdinal)
    && ["source", "title", "schedule", "neighborhood", "stops", "venue"].includes(String(value.field))
    && typeof value.code === "string"
    && typeof value.message === "string"
    && (value.stopRole === undefined || ["drinks", "dinner", "dessert"].includes(String(value.stopRole)));
}

function isRun(value: unknown): value is SupplySyncRunDTO {
  if (!isRecord(value) || !isRecord(value.counts) || !Array.isArray(value.conflicts)) return false;
  const counts = value.counts;
  return typeof value.runId === "string"
    && ["running", "staged", "no_change", "incomplete", "conflict", "failed"].includes(String(value.state))
    && typeof value.startedAt === "string"
    && (typeof value.finishedAt === "string" || value.finishedAt === null)
    && [counts.tablePages, counts.venuePages, counts.tables, counts.venues].every(Number.isSafeInteger)
    && (typeof value.candidateRevisionId === "string" || value.candidateRevisionId === null)
    && (typeof value.candidateSourceHash === "string" || value.candidateSourceHash === null)
    && Number.isSafeInteger(value.conflictCount)
    && value.conflicts.every(isConflict)
    && ["safe_to_retry", "new_operation_required", "blocked"].includes(String(value.retryDisposition))
    && (typeof value.safeMessage === "string" || value.safeMessage === null);
}

function isSummary(value: unknown): value is SupplySyncAdminSummaryDTO {
  if (!isRecord(value) || !["disabled_unmapped", "fixture", "ready", "unavailable"].includes(String(value.providerState))) return false;
  const lastGood = value.lastGoodPublished;
  const validLastGood = lastGood === null || (isRecord(lastGood) && typeof lastGood.revisionId === "string" && typeof lastGood.publishedAt === "string");
  return validLastGood && (value.latestRun === null || isRun(value.latestRun));
}

function isError(value: unknown): value is SupplySyncError {
  return isRecord(value) && ["unauthenticated", "forbidden", "invalid_input", "conflict", "temporarily_unavailable"].includes(String(value.code))
    && typeof value.message === "string" && typeof value.retryable === "boolean" && typeof value.correlationId === "string";
}

function parseResponse<T>(body: unknown, isData: (value: unknown) => value is T): SupplySyncResponse<T> | null {
  if (!isRecord(body)) return null;
  if (body.ok === true && isData(body.data) && typeof body.correlationId === "string") {
    return { ok: true, data: body.data, correlationId: body.correlationId };
  }
  if (body.ok === false && isError(body.error)) return { ok: false, error: body.error };
  return null;
}

function safeDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date) + " ET"
    : "Date unavailable";
}

function providerCopy(state: SupplyProviderState): Readonly<{ title: string; detail: string; className: string; icon: typeof Database }> {
  switch (state) {
    case "ready": return { title: "Airtable is connected", detail: "You can check Airtable for new Table and venue details.", className: "supply-provider-ready", icon: Database };
    case "fixture": return { title: "Test mode", detail: "Changes don’t reach Airtable.", className: "supply-provider-fixture", icon: Database };
    case "unavailable": return { title: "Airtable is unavailable", detail: "We can’t reach Airtable. Guests still see the live tables.", className: "supply-provider-unavailable", icon: WifiOff };
    case "disabled_unmapped": return { title: "Airtable isn’t set up yet", detail: "Ask the operations owner to connect the Airtable fields. Checking is paused until then.", className: "supply-provider-disabled", icon: Ban };
  }
}

function runLabel(state: SupplySyncRunDTO["state"]): string {
  switch (state) {
    case "running": return "Checking";
    case "staged": return "Changes to review";
    case "no_change": return "No changes";
    case "incomplete": return "Didn’t finish";
    case "conflict": return "Needs review";
    case "failed": return "Check failed";
  }
}

function runTone(state: SupplySyncRunDTO["state"]): string {
  switch (state) {
    case "staged": case "no_change": return "supply-tone-good";
    case "incomplete": case "conflict": return "supply-tone-warn";
    case "failed": return "supply-tone-error";
    case "running": return "supply-tone-pending";
  }
}

function getPendingOperationId(): string | null {
  try {
    const value = window.sessionStorage.getItem(OPERATION_STORAGE_KEY);
    return value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
  } catch { return null; }
}

function storeOperationId(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(OPERATION_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(OPERATION_STORAGE_KEY);
  } catch { /* The operation remains available in memory for this page. */ }
}

export function AdminSupplySyncWorkspace() {
  const [view, setView] = useState<ViewState>("loading");
  const [summary, setSummary] = useState<SupplySyncAdminSummaryDTO | null>(null);
  const [loadMessage, setLoadMessage] = useState("");
  const [action, setAction] = useState<ActionState>("idle");
  const [actionMessage, setActionMessage] = useState("");
  const operationIdRef = useRef<string | null>(null);

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    setView("loading");
    setLoadMessage("");
    try {
      const response = await fetch("/api/admin/supply/sync", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal });
      if (response.status === 401) { setSummary(null); setView("unauthenticated"); return; }
      if (response.status === 403) { setSummary(null); setView("forbidden"); return; }
      const body: unknown = await response.json().catch(() => null);
      const result = parseResponse(body, isSummary);
      if (!response.ok || !result?.ok) {
        setSummary(null);
        setLoadMessage(result && !result.ok ? result.error.message : "We couldn’t load Airtable status. Try again in a moment.");
        setView("error");
        return;
      }
      setSummary(result.data);
      setView("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSummary(null);
      setLoadMessage("We couldn’t load Airtable status. Try again in a moment.");
      setView("error");
    }
  }, []);

  useEffect(() => {
    operationIdRef.current = getPendingOperationId();
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  }, [loadSummary]);

  async function runSync() {
    if (!summary || action === "running" || !["fixture", "ready"].includes(summary.providerState)) return;
    let operationId = operationIdRef.current;
    if (!operationId) {
      operationId = crypto.randomUUID();
      operationIdRef.current = operationId;
      storeOperationId(operationId);
    }
    setAction("running");
    setActionMessage("");
    try {
      const response = await fetch("/api/admin/supply/sync", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operationId }),
      });
      if (response.status === 401) { setView("unauthenticated"); setAction("error"); setActionMessage("Your staff session has ended. Sign in again to continue."); return; }
      if (response.status === 403) { setView("forbidden"); setAction("error"); setActionMessage("You don’t have permission to do this."); return; }
      const body: unknown = await response.json().catch(() => null);
      const result = parseResponse(body, isRun);
      if (!response.ok || !result?.ok) {
        const error: SupplySyncError | null = result && !result.ok ? result.error : null;
        setAction(error?.retryable ? "unknown" : "error");
        setActionMessage(error?.message ?? "We couldn’t confirm this check. Try again to check the same request.");
        if (!error?.retryable) { operationIdRef.current = null; storeOperationId(null); }
        return;
      }
      setSummary((current) => current ? { ...current, latestRun: result.data } : current);
      setActionMessage(result.data.safeMessage ?? "The latest check is saved. Published Tables were not changed.");
      if (result.data.retryDisposition === "safe_to_retry") {
        setAction("unknown");
      } else {
        setAction("idle");
        operationIdRef.current = null;
        storeOperationId(null);
      }
    } catch {
      setAction("unknown");
      setActionMessage("We couldn’t confirm this check. Try again to check the same request.");
    }
  }

  const provider = summary ? providerCopy(summary.providerState) : null;
  const ProviderIcon = provider?.icon ?? Database;
  const canSync = view === "ready" && summary !== null && ["fixture", "ready"].includes(summary.providerState) && action !== "running";
  const retryLabel = action === "unknown" ? "Check again" : "Check Airtable";

  return <AppShell role="admin" active="tables" className="supply-workspace" contentClassName="supply-content" labelledBy="supply-title">
        <div className="product-breadcrumb">Tables <span>/</span> Check Airtable</div>
        <PageHeader className="supply-heading" eyebrow="AIRTABLE" titleId="supply-title" title="Check Airtable" description="See what’s new in Airtable before adding it. Nothing goes live from here."
          status={<span className="status-pill status-pill-neutral"><Clock3 aria-hidden="true" />{summary?.latestRun ? "Last check " + safeDate(summary.latestRun.startedAt) : "No check yet"}</span>} />

        {view === "loading" && <section className="supply-state" role="status" aria-live="polite"><span className="supply-state-icon"><LoaderCircle className="is-spinning" aria-hidden="true" /></span><div><h2>Loading…</h2></div></section>}
        {view === "unauthenticated" && <section className="supply-state supply-state-error" role="alert"><span className="supply-state-icon"><CircleAlert aria-hidden="true" /></span><div><h2>Sign in to see this page</h2><p>This workspace requires a verified staff account.</p><a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a></div></section>}
        {view === "forbidden" && <section className="supply-state supply-state-error" role="alert"><span className="supply-state-icon"><ShieldCheck aria-hidden="true" /></span><div><h2>You can’t check Airtable here</h2><p>Your account does not have access to view or check Table updates.</p><a className="button button-outline" href="/admin/waitlist">Return to admin workspace<ArrowRight aria-hidden="true" /></a></div></section>}
        {view === "error" && <section className="supply-state supply-state-error" role="alert"><span className="supply-state-icon"><CircleAlert aria-hidden="true" /></span><div><h2>We couldn’t load Airtable status</h2><p>{loadMessage}</p><button className="button button-outline" type="button" onClick={() => void loadSummary()}>Try again<RefreshCw aria-hidden="true" /></button></div></section>}

        {view === "ready" && summary && provider && <>
          <section className={`supply-provider-card ${provider.className}`} aria-label="Supply provider status">
            <span className="supply-provider-icon"><ProviderIcon aria-hidden="true" /></span>
            <div className="supply-provider-copy"><p className="eyebrow">AIRTABLE STATUS</p><h2>{provider.title}</h2><p>{provider.detail}</p></div>
            <button className="button button-primary supply-sync-button" type="button" onClick={() => void runSync()} disabled={!canSync} aria-busy={action === "running"}>
              {action === "running" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : action === "unknown" ? <RefreshCw aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
              {action === "running" ? "Checking…" : retryLabel}
            </button>
          </section>
          {actionMessage && <p className={`supply-action-message ${action === "error" ? "supply-action-error" : action === "unknown" ? "supply-action-warning" : ""}`} role={action === "error" || action === "unknown" ? "alert" : "status"} aria-live="polite">{action === "error" ? <CircleAlert aria-hidden="true" /> : action === "unknown" ? <Clock3 aria-hidden="true" /> : <Check aria-hidden="true" />}{actionMessage}</p>}

          <div className="supply-summary-grid">
            <section className="supply-card supply-last-good"><div className="supply-card-top"><span className="supply-card-icon"><Check aria-hidden="true" /></span><span className="supply-card-kicker">WHAT GUESTS SEE</span></div><h2>Live tables</h2>{summary.lastGoodPublished ? <><p className="supply-revision">Version <code>{summary.lastGoodPublished.revisionId}</code></p><p className="supply-card-meta">Published {safeDate(summary.lastGoodPublished.publishedAt)}</p></> : <div className="supply-empty-inline"><p>No Tables have been published yet.</p><small>Checking Airtable does not publish new Tables.</small></div>}</section>
          <section className="supply-card supply-latest-run"><div className="supply-card-top"><span className="supply-card-icon"><Database aria-hidden="true" /></span><span className="supply-card-kicker">LAST CHECK</span></div>{summary.latestRun ? <><div className="supply-run-title"><h2>{runLabel(summary.latestRun.state)}</h2><span className={`supply-run-badge ${runTone(summary.latestRun.state)}`}>{runLabel(summary.latestRun.state)}</span></div><p className="supply-card-meta">Started {safeDate(summary.latestRun.startedAt)}{summary.latestRun.finishedAt ? ` · Finished ${safeDate(summary.latestRun.finishedAt)}` : " · Still in progress"}</p><dl className="supply-counts"><div><dt>Tables checked</dt><dd>{summary.latestRun.counts.tables}</dd></div><div><dt>Venues checked</dt><dd>{summary.latestRun.counts.venues}</dd></div><div><dt>Issues</dt><dd>{summary.latestRun.conflictCount}</dd></div></dl><p className="supply-card-meta">Pages checked: {summary.latestRun.counts.tablePages} Table · {summary.latestRun.counts.venuePages} venue</p>{summary.latestRun.candidateRevisionId && <p className="supply-candidate-revision">New details ready <code>{summary.latestRun.candidateRevisionId}</code></p>}{summary.latestRun.state === "staged" && <p className="supply-candidate-note"><Clock3 aria-hidden="true" />New details are ready for staff review. They are not accepted or published yet.</p>}{summary.latestRun.safeMessage && <p className="supply-latest-message">{summary.latestRun.safeMessage}</p>}</> : <div className="supply-empty-inline"><p>Airtable hasn’t been checked yet.</p><small>Check for updates when Airtable is available and connected.</small></div>}</section>
          </div>

          {summary.latestRun && summary.latestRun.conflicts.length > 0 && <section className="supply-conflicts" aria-labelledby="supply-conflicts-title"><div className="supply-conflicts-heading"><span className="supply-card-icon supply-conflict-icon"><FileWarning aria-hidden="true" /></span><div><p className="eyebrow">NEEDS ATTENTION</p><h2 id="supply-conflicts-title">Review sync conflicts</h2><p>{summary.latestRun.conflictCount} issue{summary.latestRun.conflictCount === 1 ? "" : "s"} in this scan. Live tables are unchanged.</p></div></div><ul>{summary.latestRun.conflicts.map((conflict, index) => <li key={`${conflict.entityKind}-${conflict.recordOrdinal}-${conflict.field}-${index}`}><span className="supply-conflict-kind">{conflict.entityKind === "table" ? "Table" : "Venue"} {conflict.recordOrdinal}</span><span className="supply-conflict-field">{conflict.field}{conflict.stopRole ? ` · ${conflict.stopRole}` : ""}</span><span className="supply-conflict-message">{conflict.message}</span></li>)}</ul>{summary.latestRun.conflictCount > summary.latestRun.conflicts.length && <p className="supply-truncated-note">Showing {summary.latestRun.conflicts.length} of {summary.latestRun.conflictCount} conflicts. Contact the operations owner for the remaining items.</p>}</section>}

          <section className="supply-scope-note"><span><ShieldCheck aria-hidden="true" /></span><div><h2>Checking is safe</h2><p>Checking Airtable never changes live tables, guests or payments.</p></div></section>
        </>}
  </AppShell>;
}
