import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageState } from "./ui/page-state";
import { instantDate } from "../format/datetime";
import { PageHeader } from "./ui/page-header";
import { AppShell } from "./app-shell";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
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
const dateLabel = (value: string) => instantDate(value);
function stateLabel(state: RefundObligationSummaryDTO["state"]): string {
  switch (state) {
    case "open": return "Owed, not sent";
    case "pending": return "Queued";
    case "submitted": return "Sent to Stripe";
    case "unknown": return "Unconfirmed";
    case "failed": return "Failed";
    case "succeeded": return "Refunded";
  }
}
function operationLabel(state: RefundOperationDTO["state"]): string {
  switch (state) {
    case "pending": return "Queued";
    case "submitted": return "Sent to Stripe";
    case "unknown": return "Checking";
    case "failed": return "Failed";
    case "succeeded": return "Refunded";
  }
}
function sourceLabel(source: RefundObligationSummaryDTO["source"]): string {
  return source === "late_checkout_ineligible" ? "Paid after the table filled" : "Cancellation";
}
function blockedCopy(reason: RefundObligationSummaryDTO["dispatchBlockedReason"]): string {
  switch (reason) {
    case "balance_reserved": return "Being reviewed.";
    case "operation_in_progress": return "Already in progress.";
    case "manual_review": return "Needs an admin to look at it.";
    case "settled": return "Already refunded.";
    case "provider_unavailable": return "Can’t reach Stripe. Still owed.";
    default: return "Sending is unavailable right now.";
  }
}
function safeCodeCopy(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "provider_unavailable": return "Can’t reach Stripe right now.";
    case "outcome_unknown": return "Check status with Stripe first.";
    case "balance_exhausted": return "Nothing left to refund.";
    case "provider_failed": return "The refund failed. It’s still owed.";
    default: return "Needs an admin to look at it.";
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
  return <RefundAdminShell active="queue"><div className="refund-page">
    <PageHeader title="Refunds" description="Money we owe guests, and its status with Stripe." />
    {state === "loading" && <RefundState icon={<LoaderCircle className="refund-spin" />} title="Loading refunds…" />}
    {state === "unauthenticated" && <RefundState icon={<ShieldCheck />} title="Sign in to continue" detail="Sign in to see this page." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fadmin%2Frefunds">Sign in</a>} />}
    {state === "forbidden" && <RefundState icon={<ShieldCheck />} title="You don’t have access to this page" detail="Only admins can manage refunds." />}
    {state === "error" && <RefundState icon={<AlertCircle />} title="We couldn’t load refunds" detail={message} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "empty" && <section className="refund-empty"><CheckCircle2 aria-hidden="true" /><h2>No refunds owed.</h2></section>}
    {state === "ready" && <><section className="refund-list" aria-label="Refund obligations">{items.map((item) => <RefundSummaryCard key={item.obligationId} item={item} />)}</section>{nextCursor && <button className="button button-outline refund-load-more" type="button" disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? "Loading…" : "Show more"}<ArrowRight aria-hidden="true" /></button>}</>}
  </div></RefundAdminShell>;
}

function RefundSummaryCard({ item }: { item: RefundObligationSummaryDTO }) {
  return <article className="refund-summary-card"><div className="refund-summary-main"><span className="refund-icon"><Wallet aria-hidden="true" /></span><div><p className="eyebrow">{sourceLabel(item.source)} · {dateLabel(item.createdAt)}</p><h2>{item.memberName}</h2><p>{item.tableTitle}</p><div className={`refund-status status-${item.state}`}><span>{stateLabel(item.state)}</span><strong>{money(item.amountCents, item.currency)}</strong></div>{safeCodeCopy(item.latestSafeCode) && <p className="refund-safe-note">{safeCodeCopy(item.latestSafeCode)}</p>}</div></div><Link className="button button-outline" to="/admin/refunds/$obligationId" params={{ obligationId: item.obligationId }}>Open<ArrowRight aria-hidden="true" /></Link></article>;
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
      if (!response.ok || !envelope) throw new Error("We’re not sure that worked. Check again before trying again.");
      if (!envelope.ok) { setMessage(envelope.error.safeMessage); return; }
      setAction(null); setTargetOperation(null);
      await load();
      setMessage(action === "reconcile" ? "Checking with Stripe. This updates when we hear back." : "Refund queued. It’ll be sent to Stripe shortly.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The refund action could not be confirmed."); }
    finally { setBusy(false); }
  };
  return <RefundAdminShell active="detail"><div className="refund-page">
    <Link to="/admin/refunds" className="page-header-back"><ArrowLeft aria-hidden="true" />Refunds</Link>
    {state === "loading" && <RefundState icon={<LoaderCircle className="refund-spin" />} title="Loading…" />}
    {state === "unauthenticated" && <RefundState icon={<ShieldCheck />} title="Sign in to continue" detail="Sign in to see this page." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/admin/refunds/${obligationId}`)}`}>Sign in</a>} />}
    {state === "forbidden" && <RefundState icon={<ShieldCheck />} title="You don’t have access to this page" detail="Only admins can manage refunds." />}
    {state === "not_found" && <RefundState icon={<Wallet />} title="Refund not found" action={<Link className="button button-outline" to="/admin/refunds">Back to Refunds</Link>} />}
    {state === "error" && <RefundState icon={<AlertCircle />} title="We couldn’t load this refund" detail={message} action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button>} />}
    {state === "ready" && obligation && <>
      <PageHeader eyebrow={sourceLabel(obligation.source)} title={obligation.memberName} description={obligation.tableTitle} />
      {message && <p className="refund-alert" role="status"><CheckCircle2 aria-hidden="true" />{message}</p>}
      <section className="refund-detail-overview"><div><p className="eyebrow">STATUS</p><h2>{stateLabel(obligation.state)}</h2><p>{obligation.state === "succeeded" ? "Stripe confirmed the full refund." : obligation.state === "unknown" ? "We don’t know if this was sent. It’s still owed. Check status before sending again." : obligation.state === "submitted" ? "Sent to Stripe. Waiting for Stripe to confirm." : obligation.state === "pending" ? "Queued. It’ll go to Stripe shortly." : obligation.state === "failed" ? obligation.operations.some((operation) => operation.canRetry) ? "Still owed. You can try again." : "Still owed. Needs an admin to look at it first." : "Owed, and not sent yet."}</p></div><div className="refund-detail-amount"><span>Refund</span><strong>{money(obligation.amountCents, obligation.currency)}</strong></div></section>
      <dl className="seat-facts refund-balance" aria-label="Refund balance"><div><dt>Paid</dt><dd>{money(obligation.paymentAmountCents)}</dd></div><div><dt>Refunded so far</dt><dd>{money(obligation.refundedCents)}</dd></div><div><dt>Total owed</dt><dd>{money(obligation.reservedCents)}</dd></div><div><dt>Left to send</dt><dd><strong>{money(obligation.availableCents)}</strong></dd></div></dl>
      {obligation.latestSafeCode && obligation.latestSafeCode !== "provider_failed" && <p className="refund-safe-note">{safeCodeCopy(obligation.latestSafeCode)}</p>}
      <section className="refund-operations"><div className="refund-section-title"><div><h2>Attempts</h2></div><button className="button button-outline" type="button" onClick={() => void load()}><RefreshCw aria-hidden="true" />Check again</button></div>
        {obligation.operations.length === 0 ? <p className="refund-empty-copy">No attempts yet.</p> : <ol className="refund-operation-list">{obligation.operations.map((operation) => <li key={operation.operationId}><div className="refund-operation-heading"><div><strong>{operationLabel(operation.state)}</strong><time dateTime={operation.createdAt}>{dateLabel(operation.createdAt)}</time></div><b>{money(operation.amountCents)}</b></div>{safeCodeCopy(operation.safeCode) && <p>{safeCodeCopy(operation.safeCode)}</p>}<div className="refund-operation-actions">{operation.canRetry && <button className="button button-outline" type="button" disabled={busy} onClick={() => { setTargetOperation(operation.operationId); setAction("retry"); }}>Try again<RefreshCw aria-hidden="true" /></button>}{operation.canReconcile && <button className="button button-outline" type="button" disabled={busy} onClick={() => { setTargetOperation(operation.operationId); setAction("reconcile"); }}>Check status<RefreshCw aria-hidden="true" /></button>}</div></li>)}</ol>}
      </section>
      {obligation.canDispatch && <button className="button button-primary refund-dispatch" type="button" disabled={busy} onClick={() => { setTargetOperation(null); setAction("dispatch"); }}>Send refund<ArrowRight aria-hidden="true" /></button>}
      {!obligation.canDispatch && obligation.dispatchBlockedReason && <p className="refund-blocked-note"><Clock3 aria-hidden="true" />{blockedCopy(obligation.dispatchBlockedReason)}</p>}
      {action && <section className="refund-confirm" role="group" aria-labelledby="refund-confirm-title"><h2 id="refund-confirm-title">{action === "dispatch" ? `Send ${money(obligation.availableCents)} refund?` : action === "retry" ? "Try again?" : "Check with Stripe?"}</h2><p>{action === "dispatch" ? "This sends the refund through Stripe. The status updates when Stripe confirms." : action === "retry" ? "This retries the same refund. It can’t pay out twice." : "This only checks. It won’t send another refund."}</p><div><button className="button button-outline" type="button" disabled={busy} onClick={() => { setAction(null); setTargetOperation(null); }}>Cancel</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void submitAction()}>{busy ? "Working…" : action === "dispatch" ? "Send refund" : action === "retry" ? "Try again" : "Check status"}</button></div></section>}
    </>}
  </div></RefundAdminShell>;
}

function RefundState({ title, detail, action }: { icon?: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  const variant = /^Loading/.test(title) ? "loading" : /couldn’t/i.test(title) ? "error" : /^Sign in/.test(title) ? "signed-out" : /access/i.test(title) ? "no-access" : "empty";
  return <PageState variant={variant} title={title} message={detail} action={action} />;
}
function RefundAdminShell({ children }: { active: "queue" | "detail"; children: ReactNode }) {
  return <AppShell role="admin" active="refunds" className="refund-admin-workspace" contentClassName="refund-admin-content">{children}</AppShell>;
}
