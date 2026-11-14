import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StaffSidebar } from "./staff-nav";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { SignOutButton } from "./sign-out-button.tsx";
import "./refund-workspaces.css";
import type {
  RefundActionDTO, RefundDetailDTO, RefundListDTO, RefundObligationSummaryDTO,
  RefundOperationDTO, RefundResponse,
} from "../refunds.contract.ts";

type ViewState = "loading" | "ready" | "empty" | "error" | "unauthenticated" | "forbidden" | "not_found";
type ActionKind = "dispatch" | "retry" | "reconcile";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obligationStates = new Set<RefundObligationSummaryDTO["state"]>(["open", "pending", "submitted", "unknown", "failed", "succeeded"]);
const sources = new Set<RefundObligationSummaryDTO["source"]>(["late_checkout_ineligible", "cancellation"]);
const operationStates = new Set<RefundOperationDTO["state"]>(["pending", "submitted", "unknown", "failed", "succeeded"]);
const blockedReasons = new Set<NonNullable<RefundObligationSummaryDTO["dispatchBlockedReason"]>>(["balance_reserved", "operation_in_progress", "manual_review", "settled", "provider_unavailable"]);

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function date(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function safeText(value: unknown, max = 180): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
function cents(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2500; }

function parseSummary(value: unknown): RefundObligationSummaryDTO | null {
  if (!isRecord(value) || !uuid.test(String(value.obligationId ?? ""))
    || !sources.has(value.source as RefundObligationSummaryDTO["source"])
    || !obligationStates.has(value.state as RefundObligationSummaryDTO["state"])
    || !cents(value.amountCents) || value.currency !== "USD" || !date(value.createdAt) || !date(value.updatedAt)
    || !safeText(value.memberName, 100) || !safeText(value.tableTitle, 150)
    || !cents(value.reservedCents) || !cents(value.availableCents)
    || !(value.latestSafeCode === null || safeText(value.latestSafeCode, 80)) || typeof value.canDispatch !== "boolean"
    || !(value.dispatchBlockedReason === null || blockedReasons.has(value.dispatchBlockedReason as NonNullable<RefundObligationSummaryDTO["dispatchBlockedReason"]>))) return null;
  return value as unknown as RefundObligationSummaryDTO;
}
function parseOperation(value: unknown): RefundOperationDTO | null {
  if (!isRecord(value) || !uuid.test(String(value.operationId ?? "")) || !cents(value.amountCents)
    || value.amountCents === 0 || !operationStates.has(value.state as RefundOperationDTO["state"])
    || !date(value.createdAt) || !date(value.updatedAt) || !(value.safeCode === null || safeText(value.safeCode, 80))
    || typeof value.canRetry !== "boolean" || typeof value.canReconcile !== "boolean") return null;
  return value as unknown as RefundOperationDTO;
}
function parseList(value: unknown): RefundListDTO | null {
  if (!isRecord(value) || !Array.isArray(value.items) || !(value.nextCursor === null || safeText(value.nextCursor, 1000))) return null;
  const items = value.items.map(parseSummary);
  if (items.some((item) => !item)) return null;
  return { items: items as RefundObligationSummaryDTO[], nextCursor: value.nextCursor as string | null };
}
function parseDetail(value: unknown): RefundDetailDTO | null {
  const summary = parseSummary(value);
  if (!summary || !isRecord(value) || !cents(value.paymentAmountCents) || !cents(value.refundedCents) || !Array.isArray(value.operations)) return null;
  const operations = value.operations.map(parseOperation);
  if (operations.some((item) => !item)) return null;
  return { ...summary, paymentAmountCents: value.paymentAmountCents, refundedCents: value.refundedCents, operations: operations as RefundOperationDTO[] };
}
function parseAction(value: unknown): RefundActionDTO | null {
  if (!isRecord(value)) return null;
  const operation = parseOperation(value.operation);
  const obligation = parseSummary(value.obligation);
  return operation && obligation ? { operation, obligation } : null;
}
function parseEnvelope<T>(value: unknown, parser: (data: unknown) => T | null): RefundResponse<T> | null {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.correlationId !== "string") return null;
  if (value.ok) {
    const data = parser(value.data);
    return data ? { ok: true, data, correlationId: value.correlationId } : null;
  }
  if (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.safeMessage !== "string"
    || typeof value.error.retryable !== "boolean" || typeof value.error.correlationId !== "string") return null;
  return value as unknown as RefundResponse<T>;
}
async function getJson<T>(url: string, parser: (data: unknown) => T | null) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  const envelope = parseEnvelope(await response.json().catch(() => null), parser);
  return { response, envelope };
}
function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 100);
}
function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
function stateLabel(state: RefundObligationSummaryDTO["state"]): string {
  switch (state) {
    case "open": return "Refund owed";
    case "pending": return "Refund queued";
    case "submitted": return "Refund processing";
    case "unknown": return "Refund status unclear";
    case "failed": return "Refund attempt failed";
    case "succeeded": return "Refund complete";
  }
}
function operationLabel(state: RefundOperationDTO["state"]): string {
  switch (state) {
    case "pending": return "Queued for processing";
    case "submitted": return "Submitted to payment provider";
    case "unknown": return "Outcome is being checked";
    case "failed": return "Refund attempt failed";
    case "succeeded": return "Confirmed complete";
  }
}
function sourceLabel(source: RefundObligationSummaryDTO["source"]): string {
  return source === "late_checkout_ineligible" ? "Late payment without a Seat" : "Approved cancellation";
}
function blockedCopy(reason: RefundObligationSummaryDTO["dispatchBlockedReason"]): string {
  switch (reason) {
    case "balance_reserved": return "This amount remains reserved while the refund is under review.";
    case "operation_in_progress": return "A refund operation is already being processed.";
    case "manual_review": return "This refund needs review; the amount remains owed.";
    case "settled": return "This obligation has been settled.";
    case "provider_unavailable": return "The refund provider is not available. The obligation remains recorded.";
    default: return "Dispatch is currently unavailable.";
  }
}
function safeCodeCopy(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "provider_unavailable": return "The payment provider is temporarily unavailable.";
    case "outcome_unknown": return "The provider outcome needs reconciliation.";
    case "balance_exhausted": return "No refundable balance is currently available.";
    case "provider_failed": return "The refund attempt failed. The amount is still owed.";
    default: return "The last attempt needs an administrator review.";
  }
}

export function AdminRefundsQueue() {
  const [state, setState] = useState<ViewState>("loading");
  const [items, setItems] = useState<readonly RefundObligationSummaryDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const load = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true); else { setState("loading"); setMessage(""); }
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const { response, envelope } = await getJson(`/api/admin/refunds?${query}`, parseList);
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok || !envelope) throw new Error("Refund obligations could not be read.");
      if (!envelope.ok) { setState(envelope.error.code === "unauthenticated" ? "unauthenticated" : envelope.error.code === "forbidden" ? "forbidden" : "error"); setMessage(envelope.error.safeMessage); return; }
      setItems((current) => cursor ? [...current, ...envelope.data.items] : envelope.data.items);
      setNextCursor(envelope.data.nextCursor);
      setState((cursor ? items.length : 0) + envelope.data.items.length ? "ready" : "empty");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Refund obligations are temporarily unavailable."); setState("error"); }
    finally { setLoadingMore(false); }
  }, [items.length]);
  useEffect(() => { void load(); }, []);
  return <RefundAdminShell active="queue"><main className="refund-page">
    <div className="product-breadcrumb"><span>ADMIN WORKSPACE</span><span>›</span><span>Refunds</span></div>
    <header className="refund-heading"><p className="eyebrow">MONEY · OPERATIONS</p><h1>Refund obligations</h1><p>Track amounts owed and queue or recover provider operations. A queued action is not a confirmed refund.</p></header>
    {state === "loading" && <RefundState icon={<LoaderCircle className="refund-spin" />} title="Loading refund obligations" detail="Reading the durable refund ledger." />}
    {state === "unauthenticated" && <RefundState icon={<ShieldCheck />} title="Sign in to continue" detail="Refund operations are available to authorized administrators only." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fadmin%2Frefunds">Sign in</a>} />}
    {state === "forbidden" && <RefundState icon={<ShieldCheck />} title="Administrator access is required" detail="This workspace is limited to authorized administrators." />}
    {state === "error" && <RefundState icon={<AlertCircle />} title="Refund obligations are unavailable" detail={message} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "empty" && <section className="refund-empty"><CheckCircle2 aria-hidden="true" /><h2>No refund obligations</h2><p>Amounts recorded for refund processing will appear here.</p></section>}
    {state === "ready" && <><section className="refund-list" aria-label="Refund obligations">{items.map((item) => <RefundSummaryCard key={item.obligationId} item={item} />)}</section>{nextCursor && <button className="button button-outline refund-load-more" type="button" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? "Loading…" : "Load more"}<ArrowRight aria-hidden="true" /></button>}</>}
  </main></RefundAdminShell>;
}

function RefundSummaryCard({ item }: { item: RefundObligationSummaryDTO }) {
  return <article className="refund-summary-card"><div className="refund-summary-main"><span className="refund-icon"><Wallet aria-hidden="true" /></span><div><p className="eyebrow">{sourceLabel(item.source)} · {dateLabel(item.createdAt)}</p><h2>{item.memberName}</h2><p>{item.tableTitle}</p><div className={`refund-status status-${item.state}`}><span>{stateLabel(item.state)}</span><strong>{money(item.amountCents, item.currency)}</strong></div>{safeCodeCopy(item.latestSafeCode) && <p className="refund-safe-note">{safeCodeCopy(item.latestSafeCode)}</p>}</div></div><Link className="button button-outline" to="/admin/refunds/$obligationId" params={{ obligationId: item.obligationId }}>Review obligation<ArrowRight aria-hidden="true" /></Link></article>;
}

export function AdminRefundDetail({ obligationId }: { obligationId: string }) {
  const [state, setState] = useState<ViewState>("loading");
  const [obligation, setObligation] = useState<RefundDetailDTO | null>(null);
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<ActionKind | null>(null);
  const [targetOperation, setTargetOperation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setState("loading"); setMessage("");
    try {
      const { response, envelope } = await getJson(`/api/admin/refunds/${encodeURIComponent(obligationId)}`, parseDetail);
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      if (response.status === 404) { setState("not_found"); return; }
      if (!response.ok || !envelope) throw new Error("Refund details could not be read.");
      if (!envelope.ok) {
        if (envelope.error.code === "unauthenticated") { setState("unauthenticated"); return; }
        if (envelope.error.code === "forbidden") { setState("forbidden"); return; }
        if (envelope.error.code === "not_found") { setState("not_found"); return; }
        throw new Error(envelope.error.safeMessage);
      }
      setObligation(envelope.data); setState("ready");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Refund details are temporarily unavailable."); setState("error"); }
  }, [obligationId]);
  useEffect(() => { void load(); }, [load]);
  const submitAction = async () => {
    if (!action || !obligation) return;
    setBusy(true); setMessage("");
    try {
      let path = ""; let body: Record<string, string>;
      if (action === "dispatch") { path = `/api/admin/refunds/${encodeURIComponent(obligation.obligationId)}/dispatch`; body = { operationId: crypto.randomUUID() }; }
      else {
        if (!targetOperation) return;
        path = `/api/admin/refund-operations/${encodeURIComponent(targetOperation)}/${action}`;
        body = { requestId: crypto.randomUUID() };
      }
      const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
      const envelope = parseEnvelope(await response.json().catch(() => null), parseAction);
      if (!response.ok || !envelope) throw new Error("We could not confirm that the refund action was queued. Refresh to check its saved status.");
      if (!envelope.ok) { setMessage(envelope.error.safeMessage); return; }
      setAction(null); setTargetOperation(null);
      await load();
      setMessage(action === "reconcile" ? "Status check queued. The saved refund state will update when provider evidence is available." : "Refund action queued. This does not confirm that money was returned.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The refund action could not be confirmed."); }
    finally { setBusy(false); }
  };
  return <RefundAdminShell active="detail"><main className="refund-page">
    <div className="product-breadcrumb"><Link to="/admin/refunds">Refunds</Link><span>›</span><span>Obligation</span></div>
    {state === "loading" && <RefundState icon={<LoaderCircle className="refund-spin" />} title="Loading refund details" detail="Checking the obligation ledger and its operations." />}
    {state === "unauthenticated" && <RefundState icon={<ShieldCheck />} title="Sign in to continue" detail="Refund details are available to authorized administrators only." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/admin/refunds/${obligationId}`)}`}>Sign in</a>} />}
    {state === "forbidden" && <RefundState icon={<ShieldCheck />} title="Administrator access is required" detail="This financial record is limited to authorized administrators." />}
    {state === "not_found" && <RefundState icon={<Wallet />} title="Refund obligation not found" detail="This obligation is not available in the current ledger." action={<Link className="button button-outline" to="/admin/refunds">Back to Refunds</Link>} />}
    {state === "error" && <RefundState icon={<AlertCircle />} title="Refund details are unavailable" detail={message} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && obligation && <>
      <header className="refund-heading"><p className="eyebrow">{sourceLabel(obligation.source)}</p><h1>{obligation.memberName}</h1><p>{obligation.tableTitle}</p></header>
      {message && <p className="refund-alert" role="status"><CheckCircle2 aria-hidden="true" />{message}</p>}
      <section className="refund-detail-overview"><div><p className="eyebrow">OBLIGATION STATUS</p><h2>{stateLabel(obligation.state)}</h2><p>{obligation.state === "succeeded" ? "The payment provider confirmed the full refund." : obligation.state === "unknown" ? "We can’t confirm whether this refund was processed. The amount remains owed. Check its status before trying again." : obligation.state === "submitted" ? "The payment provider accepted the refund request but has not confirmed it as processed." : obligation.state === "pending" ? "The refund is in the processing queue. The payment provider has not confirmed it yet." : obligation.state === "failed" ? obligation.operations.some((operation) => operation.canRetry) ? "The refund is still owed. You can try the same refund again." : "The refund is still owed and needs administrator review before another action." : "This amount is owed and has not been queued yet."}</p></div><div className="refund-detail-amount"><span>Recorded obligation</span><strong>{money(obligation.amountCents, obligation.currency)}</strong></div></section>
      <section className="refund-facts-grid" aria-label="Refund balance"><div><span>Verified payment</span><strong>{money(obligation.paymentAmountCents)}</strong></div><div><span>Confirmed refunded</span><strong>{money(obligation.refundedCents)}</strong></div><div><span>Total owed on this payment</span><strong>{money(obligation.reservedCents)}</strong></div><div><span>Available to refund</span><strong>{money(obligation.availableCents)}</strong></div></section>
      {obligation.latestSafeCode && <p className="refund-safe-note">{safeCodeCopy(obligation.latestSafeCode)}</p>}
      <section className="refund-operations"><div className="refund-section-title"><div><p className="eyebrow">REFUND HISTORY</p><h2>Refund attempts</h2></div><button className="button button-outline" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />Refresh status</button></div>
        {obligation.operations.length === 0 ? <p className="refund-empty-copy">No refund operation has been created. Queueing an action records intent; it does not directly send money.</p> : <ol className="refund-operation-list">{obligation.operations.map((operation) => <li key={operation.operationId}><div className="refund-operation-heading"><div><strong>{operationLabel(operation.state)}</strong><time dateTime={operation.createdAt}>{dateLabel(operation.createdAt)}</time></div><b>{money(operation.amountCents)}</b></div>{safeCodeCopy(operation.safeCode) && <p>{safeCodeCopy(operation.safeCode)}</p>}<div className="refund-operation-actions">{operation.canRetry && <button className="button button-outline" type="button" disabled={busy} onClick={() => { setTargetOperation(operation.operationId); setAction("retry"); }}>Try refund again<RefreshCw aria-hidden="true" /></button>}{operation.canReconcile && <button className="button button-outline" type="button" disabled={busy} onClick={() => { setTargetOperation(operation.operationId); setAction("reconcile"); }}>Check refund status<RefreshCw aria-hidden="true" /></button>}</div></li>)}</ol>}
      </section>
      {obligation.canDispatch && <button className="button button-primary refund-dispatch" type="button" disabled={busy} onClick={() => { setTargetOperation(null); setAction("dispatch"); }}>Queue refund for processing<ArrowRight aria-hidden="true" /></button>}
      {!obligation.canDispatch && obligation.dispatchBlockedReason && <p className="refund-blocked-note"><Clock3 aria-hidden="true" />{blockedCopy(obligation.dispatchBlockedReason)}</p>}
      {action && <section className="refund-confirm" role="group" aria-labelledby="refund-confirm-title"><h2 id="refund-confirm-title">{action === "dispatch" ? "Queue this refund?" : action === "retry" ? "Queue a retry?" : "Check provider status?"}</h2><p>{action === "dispatch" ? `This amount is owed and has not been queued yet. Queue up to ${money(obligation.availableCents)} for processing.` : action === "retry" ? "This queues another attempt using the same saved refund operation and provider idempotency key." : "This queues a provider status check only. It will not send a new refund."} The saved status changes only after server/provider evidence. This action does not itself confirm that money has been returned.</p><div><button className="button button-outline" type="button" disabled={busy} onClick={() => { setAction(null); setTargetOperation(null); }}>Cancel</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void submitAction()}>{busy ? "Queueing…" : "Confirm and queue"}</button></div></section>}
      <div className="refund-footer-actions"><Link className="button button-outline" to="/admin/refunds"><ArrowLeft aria-hidden="true" />Back to Refunds</Link></div>
    </>}
  </main></RefundAdminShell>;
}

function RefundState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <section className="refund-state" role="status"><span>{icon}</span><h2>{title}</h2><p>{detail}</p>{action}</section>;
}
function RefundAdminShell({ active, children }: { active: "queue" | "detail"; children: ReactNode }) {
  return <main className="product-page refund-admin-workspace"><header className="product-topbar"><a className="brand" href="/admin/refunds" aria-label="Fifth Wheel admin workspace"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a><div className="product-topbar-actions"><span className="product-workspace-label">ADMIN WORKSPACE</span><SignOutButton /></div></header><div className="product-layout"><StaffSidebar active="refunds" foot="Amounts remain owed until the payment provider confirms settlement." footIcon={<Wallet aria-hidden="true" />} /><section className="product-content refund-admin-content">{children}</section></div></main>;
}
