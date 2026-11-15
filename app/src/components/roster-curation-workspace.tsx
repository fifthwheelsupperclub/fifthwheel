import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "./ui/page-header";
import { AppShell } from "./app-shell";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CircleAlert, Clock3, LoaderCircle,
  MapPin, RefreshCw, Save, ShieldCheck, Table2, UsersRound, UserRoundCheck,
} from "lucide-react";
import type {
  AssignedCurationTableDTO, AssignedCurationTablesDTO, RosterApplicantDTO, RosterError,
  RosterProposalDTO, RosterResponse, RosterValidationIssue, TableRosterContextDTO,
} from "../roster.contract.ts";
import "./roster-curation-workspace.css";

type ApiError = RosterError;
type Result<T> = RosterResponse<T>;
type ProposalSummary = NonNullable<AssignedCurationTableDTO["currentProposal"]>;
type QueueTable = AssignedCurationTableDTO;
type QueueData = AssignedCurationTablesDTO;
type RosterApplicant = RosterApplicantDTO;
type ValidationIssue = RosterValidationIssue;
type CurrentProposal = RosterProposalDTO;
type RosterData = TableRosterContextDTO;
type ViewState = "loading" | "ready" | "unauthenticated" | "forbidden" | "not_found" | "error";
type Actor = "admin" | "host";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string { return typeof value === "string"; }
function isCount(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isProposalState(value: unknown): value is ProposalSummary["state"] { return value === "draft" || value === "submitted" || value === "approved" || value === "superseded"; }
function decodeQueueTable(value: unknown): QueueTable | null {
  if (!isRecord(value) || !isUuid(value.tableId) || !isText(value.title) || !isText(value.localDate)
    || !isText(value.startLocalTime) || !isText(value.neighborhood) || !isUuid(value.publishedRevisionId)
    || !isCount(value.pendingRequestCount)) return null;
  let proposal: ProposalSummary | null = null;
  if (value.currentProposal !== null) {
    const row = value.currentProposal;
    if (!isRecord(row) || !isUuid(row.proposalId) || !isCount(row.revision) || !isProposalState(row.state)
      || !isCount(row.selectedCount) || typeof row.valid !== "boolean") return null;
    proposal = { proposalId: row.proposalId, revision: row.revision, state: row.state, selectedCount: row.selectedCount, valid: row.valid };
  }
  return { tableId: value.tableId, title: value.title, localDate: value.localDate, startLocalTime: value.startLocalTime,
    neighborhood: value.neighborhood, publishedRevisionId: value.publishedRevisionId, pendingRequestCount: value.pendingRequestCount, currentProposal: proposal };
}
function decodeQueue(value: unknown): QueueData | null {
  if (!isRecord(value) || !Array.isArray(value.items) || !(value.nextCursor === null || isText(value.nextCursor))) return null;
  const items = value.items.map(decodeQueueTable);
  return items.some((item) => item === null) ? null : { items: items as QueueTable[], nextCursor: value.nextCursor };
}
function decodeRoster(value: unknown): RosterData | null {
  if (!isRecord(value) || !isRecord(value.table) || !isRecord(value.applicants) || !Array.isArray(value.applicants.items)
    || !(value.applicants.nextCursor === null || isText(value.applicants.nextCursor)) || !isRecord(value.permissions)) return null;
  const table = value.table;
  if (!isUuid(table.tableId) || !isText(table.title) || !isText(table.localDate) || !isText(table.startLocalTime)
    || !isText(table.neighborhood) || !(table.publishedRevisionId === null || isUuid(table.publishedRevisionId))
    || !(table.readOnlyReason === null || table.readOnlyReason === "past" || table.readOnlyReason === "unpublished" || table.readOnlyReason === "revision_changed")) return null;
  const applicants = value.applicants.items.map((item): RosterApplicant | null => {
    if (!isRecord(item) || !isUuid(item.requestId) || !isUuid(item.guestId) || !isText(item.displayName)
      || !isText(item.requestCreatedAt) || typeof item.eligible !== "boolean" || !Array.isArray(item.reasonCodes)
      || item.reasonCodes.some((code) => !isText(code)) || !(item.recommendationRank === null || isCount(item.recommendationRank))
      || typeof item.selected !== "boolean") return null;
    return { requestId: item.requestId, guestId: item.guestId, displayName: item.displayName, requestCreatedAt: item.requestCreatedAt,
      eligible: item.eligible, reasonCodes: item.reasonCodes as string[], recommendationRank: item.recommendationRank, selected: item.selected };
  });
  if (applicants.some((item) => item === null)) return null;
  let currentProposal: CurrentProposal | null = null;
  if (value.currentProposal !== null) {
    const proposal = value.currentProposal;
    if (!isRecord(proposal) || !isUuid(proposal.proposalId) || !isCount(proposal.revision) || !isProposalState(proposal.state)
      || !isUuid(proposal.supplyRevisionId) || !Array.isArray(proposal.selectedRequestIds)
      || proposal.selectedRequestIds.some((id) => !isUuid(id)) || !Array.isArray(proposal.selectedGuests)
      || !isRecord(proposal.validation)
      || typeof proposal.validation.valid !== "boolean" || !Array.isArray(proposal.validation.issues)
      || !isText(proposal.createdAt) || !isText(proposal.updatedAt)) return null;
    const selectedGuests = proposal.selectedGuests.map((guest): { guestId: string; displayName: string } | null => {
      if (!isRecord(guest) || !isUuid(guest.guestId) || !isText(guest.displayName)) return null;
      return { guestId: guest.guestId, displayName: guest.displayName };
    });
    if (selectedGuests.some((guest) => guest === null)) return null;
    const issues = proposal.validation.issues.map((issue): ValidationIssue | null => {
      if (!isRecord(issue) || !isText(issue.code) || (issue.guestIds !== undefined && (!Array.isArray(issue.guestIds) || issue.guestIds.some((id) => !isUuid(id))))) return null;
      return { code: issue.code as ValidationIssue["code"], ...(Array.isArray(issue.guestIds) ? { guestIds: issue.guestIds as string[] } : {}) };
    });
    if (issues.some((issue) => issue === null)) return null;
    currentProposal = { proposalId: proposal.proposalId, revision: proposal.revision, state: proposal.state,
      supplyRevisionId: proposal.supplyRevisionId, selectedRequestIds: proposal.selectedRequestIds as string[], selectedGuests: selectedGuests as { guestId: string; displayName: string }[],
      validation: { valid: proposal.validation.valid, issues: issues as ValidationIssue[] }, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt };
  }
  if (typeof value.permissions.canEditProposal !== "boolean" || typeof value.permissions.canSubmit !== "boolean"
    || typeof value.permissions.canApprove !== "boolean") return null;
  return { table: { tableId: table.tableId, title: table.title, localDate: table.localDate, startLocalTime: table.startLocalTime,
    neighborhood: table.neighborhood, publishedRevisionId: table.publishedRevisionId, readOnlyReason: table.readOnlyReason },
    applicants: { items: applicants as RosterApplicant[], nextCursor: value.applicants.nextCursor }, currentProposal,
    permissions: { canEditProposal: value.permissions.canEditProposal, canSubmit: value.permissions.canSubmit, canApprove: value.permissions.canApprove } };
}
function decodeResult<T>(value: unknown, decodeData: (data: unknown) => T | null): Result<T> | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok === true) {
    if (!isText(value.correlationId)) return null;
    const data = decodeData(value.data);
    return data === null ? null : { ok: true, data, correlationId: value.correlationId };
  }
  if (!isRecord(value.error) || !isText(value.error.code) || !isText(value.error.message)
    || typeof value.error.retryable !== "boolean" || !isText(value.error.correlationId)) return null;
  let details: ApiError["details"];
  if (value.error.details !== undefined) {
    if (!isRecord(value.error.details) || !Array.isArray(value.error.details.issues)) return null;
    const issues = value.error.details.issues.map((issue): ValidationIssue | null => {
      if (!isRecord(issue) || !isText(issue.code)) return null;
      if (issue.guestIds !== undefined && (!Array.isArray(issue.guestIds) || issue.guestIds.some((id) => !isUuid(id)))) return null;
      return { code: issue.code as ValidationIssue["code"], ...(Array.isArray(issue.guestIds) ? { guestIds: issue.guestIds as string[] } : {}) };
    });
    if (issues.some((issue) => issue === null)) return null;
    details = { issues: issues as ValidationIssue[] };
  }
  return { ok: false, error: { code: value.error.code as ApiError["code"], message: value.error.message, retryable: value.error.retryable, correlationId: value.error.correlationId, ...(details ? { details } : {}) } };
}
async function getApi<T>(url: string, decodeData: (data: unknown) => T | null): Promise<Result<T>> {
  const response = await fetch(url, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
  if (response.status === 401) throw Object.assign(new Error("unauthenticated"), { state: "unauthenticated" });
  if (response.status === 403) throw Object.assign(new Error("forbidden"), { state: "forbidden" });
  if (response.status === 404) throw Object.assign(new Error("not_found"), { state: "not_found" });
  const result = decodeResult(await response.json().catch(() => null), decodeData);
  if (result === null || (!response.ok && result.ok)) throw new Error("invalid_response");
  return result;
}
function stateFromApiError(error: ApiError): ViewState | null {
  if (error.code === "unauthenticated") return "unauthenticated";
  if (error.code === "forbidden") return "forbidden";
  if (error.code === "not_found") return "not_found";
  return null;
}
function apiErrorText(code: string, fallback: string) {
  const labels: Record<string, string> = {
    validation_failed: "The selected group needs changes. Review the rules below.",
    revision_conflict: "Something changed. Reload and try again.",
    stale_table: "The table’s details changed. Start a new roster.",
    stale_profile: "A guest changed their profile. Reload to recheck the group.",
    request_not_pending: "A selected Seat request is no longer active. Reload the applicant list.",
    proposal_not_submitted: "Send this roster for approval first.",
    operation_conflict: "Something changed. Reload and try again.",
    roster_already_active: "This Table already has an active roster.",
    capacity_conflict: "There is no longer enough room at this Table for the selected group.",
  };
  return labels[code] ?? fallback;
}
function fmtDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}
function fmtTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return value;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2020, 0, 1, hour, minute));
}
function fmtRequestDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "date unavailable" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
const issueLabels: Record<string, string> = {
  select_three_to_five: "Choose 3–5 people for the roster.", candidate_ineligible: "One or more selected people no longer meet the Table requirements.",
  candidate_not_found: "A selected person is no longer available.", request_not_pending: "A selected Seat request is no longer active.",
  member_not_admitted: "A selected member no longer has app access.", profile_not_approved: "A selected profile needs current administrator approval.",
  profile_incomplete: "A selected profile is missing required information.", stale_profile: "A selected person changed their profile after this roster was saved.",
  candidate_already_invited: "A selected guest already has an active Table invitation.", stale_table: "The published Table details changed.",
  age_under_21: "A selected guest will be under 21 on the Table date.", age_range_invalid: "A selected person’s preferred age range needs review.",
  pair_age_mismatch: "Some selected guests’ preferred age ranges do not overlap.", age_span_exceeded: "The oldest and youngest guest are more than 12 years apart.",
  missing_mutual_open_connection: "Each person needs at least one other person in the group who is open to meeting them, and vice versa.", duplicate_guest: "A guest appears more than once.",
};
const readOnlyLabels: Record<NonNullable<RosterData["table"]["readOnlyReason"]>, string> = {
  past: "This Table date has passed. The roster is available for review only.",
  unpublished: "This Table is no longer published. The roster is available for review only.",
  revision_changed: "The published Table details changed after this roster was saved. This saved roster is read-only; start a new roster using the current Table details.",
};
function issueText(code: string) { return issueLabels[code] ?? "The group needs review under a roster rule."; }

function StaffShell({ actor, children }: { actor: Actor; active: "queue" | "detail"; children: ReactNode }) {
  const admin = actor === "admin";
  return <AppShell role={admin ? "admin" : "host"} active={admin ? "seat-requests" : "host-tables"} className="roster-workspace">{children}</AppShell>;
}

export function AdminSeatRequestsQueue() { return <QueueWorkspace actor="admin" />; }
export function HostAssignedTablesQueue() { return <QueueWorkspace actor="host" />; }
function QueueWorkspace({ actor }: { actor: Actor }) {
  const [state, setState] = useState<ViewState>("loading");
  const [tables, setTables] = useState<QueueTable[]>([]);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const endpoint = actor === "admin" ? "/api/admin/seat-requests?limit=50" : "/api/curation/assigned-tables?limit=50";
  const load = useCallback(async (next?: string) => {
    setState("loading"); setError("");
    try {
      const result = await getApi(`${endpoint}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, decodeQueue);
      if (!result.ok) { setState(stateFromApiError(result.error) ?? "error"); setError(result.error.message); return; }
      setTables((previous) => next ? [...previous, ...result.data.items] : [...result.data.items]); setCursor(result.data.nextCursor); setState("ready");
    } catch (reason) {
      const view = isRecord(reason) && typeof reason.state === "string" ? reason.state as ViewState : "error";
      setState(view); setTables([]); setCursor(null); setError("We could not load assigned Tables. Try again in a moment.");
    }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const admin = actor === "admin";
  return <StaffShell actor={actor} active="queue">
    <div className="product-breadcrumb">{admin ? "People" : "Host tools"}<span>›</span>{admin ? "Seat requests" : "Assigned Tables"}</div>
    <PageHeader className="roster-heading" title={admin ? "Seat requests" : "Your tables"} description={admin ? "Pick a group of 3–5 for each table." : "Suggest a group for each table. An admin approves it."}
      actions={<button className="icon-action" type="button" onClick={() => void load()} aria-label="Refresh Tables" disabled={state === "loading"}><RefreshCw aria-hidden="true" /></button>} />
    {state === "loading" ? <div className="roster-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /><span>Loading Tables…</span></div>
      : state === "unauthenticated" ? <WorkspaceState icon={<ShieldCheck />} title="Sign in to continue" detail="This workspace is available to authorized staff only." action={<a className="button button-primary" href="/sign-in?returnTo=%2Fadmin%2Fseat-requests">Sign in<ArrowRight /></a>} />
      : state === "forbidden" ? <WorkspaceState icon={<ShieldCheck />} title="You do not have access to this workspace" detail="Ask an administrator to confirm your staff role or Table assignment." />
      : state === "error" ? <WorkspaceState icon={<CircleAlert />} title="Tables are temporarily unavailable" detail={error} action={<button className="button button-outline" onClick={() => void load()}><RefreshCw />Try again</button>} />
      : tables.length === 0 ? <WorkspaceState icon={<Table2 />} title="No upcoming Tables have Seat requests" detail="A Table appears here after it is published and someone requests a Seat. No sample records are shown." />
      : <>
        <div className="roster-queue-meta"><span><UsersRound aria-hidden="true" />{tables.length} {tables.length === 1 ? "Table" : "Tables"}</span><span>{admin ? "Published and upcoming" : "Your current assignments"}</span></div>
        <div className="roster-queue-list">{tables.map((table) => <article className="roster-queue-card" key={table.tableId}>
          <div className="roster-card-icon"><Table2 aria-hidden="true" /></div><div className="roster-card-copy">
            <div className="roster-card-title"><h2>{table.title}</h2><span className="status-pill status-pill-pending">{table.currentProposal ? table.currentProposal.state.replaceAll("_", " ") : "Needs a roster"}</span></div>
            <div className="roster-card-meta"><span><CalendarDays aria-hidden="true" />{fmtDate(table.localDate)}</span><span><Clock3 aria-hidden="true" />{fmtTime(table.startLocalTime)}</span><span><MapPin aria-hidden="true" />{table.neighborhood}</span></div>
            <p>{table.pendingRequestCount} {table.pendingRequestCount === 1 ? "request" : "requests"}{table.currentProposal ? ` · ${table.currentProposal.selectedCount} picked` : " · not started"}</p>
          </div>
          <Link className="button button-outline roster-open" to={admin ? "/admin/seat-requests/$tableId" : "/host/tables/$tableId/roster"} params={{ tableId: table.tableId }}>
            Open<ArrowRight aria-hidden="true" />
          </Link>
          <a className="button button-outline roster-open" href={`/host/attendance/${encodeURIComponent(table.tableId)}`}>Attendance</a>
        </article>)}</div>
        {cursor && <button className="button button-outline roster-more" onClick={() => void load(cursor)}>Load more<ArrowRight /></button>}
      </>}
  </StaffShell>;
}

function WorkspaceState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <section className="roster-workspace-state"><span className="roster-state-icon">{icon}</span><h2>{title}</h2><p>{detail}</p>{action}</section>;
}

export function AdminSeatRequestRoster({ tableId }: { tableId: string }) { return <RosterDetail actor="admin" tableId={tableId} />; }
export function HostTableRosterProposal({ tableId }: { tableId: string }) { return <RosterDetail actor="host" tableId={tableId} />; }

function RosterDetail({ actor, tableId }: { actor: Actor; tableId: string }) {
  const [state, setState] = useState<ViewState>("loading");
  const [data, setData] = useState<RosterData | null>(null);
  const [loadingMoreApplicants, setLoadingMoreApplicants] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"save" | "submit" | "approve" | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [confirmApproval, setConfirmApproval] = useState(false);
  const retryOperation = useRef<{ action: string; body: Record<string, unknown> } | null>(null);
  const approvalDialogRef = useRef<HTMLElement>(null);
  const cancelApprovalRef = useRef<HTMLButtonElement>(null);
  const retryStorageKey = `fifthwheel:roster-operation:${tableId}`;
  useEffect(() => {
    try {
      const value = sessionStorage.getItem(retryStorageKey);
      if (!value) return;
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed) && isText(parsed.action) && isRecord(parsed.body) && isUuid(parsed.body.operationId)) {
        retryOperation.current = { action: parsed.action, body: parsed.body };
      }
    } catch { /* Keep the current page usable if session storage is unavailable. */ }
  }, [retryStorageKey]);
  useEffect(() => {
    if (!confirmApproval) return;
    cancelApprovalRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setConfirmApproval(false); return; }
      if (event.key !== "Tab") return;
      const focusable = approvalDialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
      if (!focusable?.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmApproval]);
  const load = useCallback(async () => {
    setState("loading"); setNotice(null);
    try {
      const result = await getApi(`/api/curation/tables/${encodeURIComponent(tableId)}/roster?limit=50`, decodeRoster);
      if (!result.ok) { setState(stateFromApiError(result.error) ?? "error"); setNotice({ tone: "bad", text: result.error.message }); return; }
      setData(result.data);
      setSelected(new Set(result.data.currentProposal?.selectedRequestIds ?? []));
      setState("ready");
    } catch (reason) {
      const view = isRecord(reason) && typeof reason.state === "string" ? reason.state as ViewState : "error";
      setState(view); setData(null);
    }
  }, [tableId]);
  useEffect(() => { void load(); }, [load]);
  const selectedRows = useMemo(() => data?.applicants.items.filter((item) => selected.has(item.requestId)) ?? [], [data, selected]);
  const eligibleCount = data?.applicants.items.filter((item) => item.eligible).length ?? 0;

  async function loadMoreApplicants() {
    if (!data?.applicants.nextCursor || loadingMoreApplicants) return;
    const cursor = data.applicants.nextCursor;
    setLoadingMoreApplicants(true);
    try {
      const result = await getApi(`/api/curation/tables/${encodeURIComponent(tableId)}/roster?limit=50&cursor=${encodeURIComponent(cursor)}`, decodeRoster);
      if (!result.ok) {
        const permissionState = stateFromApiError(result.error);
        if (permissionState) setState(permissionState);
        else setNotice({ tone: "bad", text: result.error.message });
        return;
      }
      setData((current) => {
        if (!current) return current;
        const byRequestId = new Map(current.applicants.items.map((item) => [item.requestId, item]));
        for (const applicant of result.data.applicants.items) byRequestId.set(applicant.requestId, applicant);
        return { ...current, applicants: { items: [...byRequestId.values()], nextCursor: result.data.applicants.nextCursor } };
      });
    } catch (reason) {
      const view = isRecord(reason) && typeof reason.state === "string" ? reason.state as ViewState : "error";
      if (view === "unauthenticated" || view === "forbidden" || view === "not_found") setState(view);
      else setNotice({ tone: "bad", text: "We couldn’t load more requests. Your picks are unchanged." });
    } finally { setLoadingMoreApplicants(false); }
  }

  async function mutate(action: "save" | "submit" | "approve", body: Record<string, unknown>) {
    if (!data || busy) return;
    setBusy(action); setNotice(null);
    const path = action === "save" ? `/api/curation/tables/${tableId}/roster-proposal`
      : action === "submit" ? `/api/curation/tables/${tableId}/roster-proposal/submit` : `/api/admin/seat-requests/${tableId}/approve`;
    const method = action === "save" ? "PUT" : "POST";
    const saved = retryOperation.current?.action === action ? retryOperation.current.body : { ...body, operationId: crypto.randomUUID() };
    retryOperation.current = { action, body: saved };
    try { sessionStorage.setItem(retryStorageKey, JSON.stringify(retryOperation.current)); } catch { /* Retry remains stable during this page session. */ }
    const clearRetryOperation = () => {
      retryOperation.current = null;
      try { sessionStorage.removeItem(retryStorageKey); } catch { /* The server response still determines operation state. */ }
    };
    try {
      const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(saved) });
      const envelope: unknown = await response.json().catch(() => null);
      if (response.status === 401) { clearRetryOperation(); setState("unauthenticated"); return; }
      if (response.status === 403) { clearRetryOperation(); setState("forbidden"); return; }
      if (response.status === 404) { clearRetryOperation(); setState("not_found"); return; }
      if (!isRecord(envelope) || envelope.ok !== true) {
        const err = isRecord(envelope) && isRecord(envelope.error) ? envelope.error : null;
        const code = err && isText(err.code) ? err.code : "temporarily_unavailable";
        const fallback = err && isText(err.message) ? err.message : "The change could not be confirmed. Retry the same operation or reload its current state.";
        const details = err && isRecord(err.details) && Array.isArray(err.details.issues)
          ? err.details.issues.flatMap((item) => isRecord(item) && isText(item.code) ? [issueText(item.code)] : []) : [];
        const message = [apiErrorText(code, fallback), ...details].join(" ");
        if (!err || err.retryable !== true) clearRetryOperation();
        if (["validation_failed", "revision_conflict", "stale_table", "stale_profile", "request_not_pending", "roster_already_active"].includes(code)) await load();
        setNotice({ tone: "bad", text: message });
        return;
      }
      retryOperation.current = null;
      try { sessionStorage.removeItem(retryStorageKey); } catch { /* Operation is confirmed by the server. */ }
      if (action === "approve") {
        setNotice({ tone: "good", text: "Roster approved. Invitations are on their way. Track them in Table invitation delivery." });
      } else if (action === "submit") setNotice({ tone: "good", text: "Sent for approval." });
      else setNotice({ tone: "good", text: "Saved." });
      setConfirmApproval(false);
      await load();
    } catch {
      setNotice({ tone: "bad", text: "We’re not sure that worked. Try again (it’s safe) or reload." });
    } finally { setBusy(null); }
  }

  const proposal = data?.currentProposal ?? null;
  const permissions = data?.permissions;
  const admin = actor === "admin";
  const stale = !!data?.table.readOnlyReason || (!!proposal && proposal.supplyRevisionId !== data?.table.publishedRevisionId);
  const canEdit = !!permissions?.canEditProposal && !!data?.table.publishedRevisionId && !stale && proposal?.state !== "approved";
  const selectionMatchesProposal = !!proposal && proposal.selectedRequestIds.length === selected.size
    && proposal.selectedRequestIds.every((requestId) => selected.has(requestId));
  const canSubmit = !!permissions?.canSubmit && !!proposal && selectionMatchesProposal && !stale && selected.size >= 3 && selected.size <= 5;
  const canApprove = admin && !!permissions?.canApprove && !!proposal && proposal.state === "submitted" && proposal.validation.valid && !stale;

  return <StaffShell actor={actor} active="detail">
    <div className="product-breadcrumb"><Link to={admin ? "/admin/seat-requests" : "/host/assigned-tables"}>{admin ? "Seat requests" : "Assigned Tables"}</Link><span>›</span>{data?.table.title ?? "Roster"}</div>
    {state === "loading" ? <div className="roster-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /><span>Loading applicants…</span></div>
      : state === "unauthenticated" ? <WorkspaceState icon={<ShieldCheck />} title="Sign in to continue" detail="This workspace is available to authorized staff only." action={<a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(location.pathname)}`}>Sign in<ArrowRight /></a>} />
      : state === "forbidden" ? <WorkspaceState icon={<ShieldCheck />} title="This Table is not assigned to you" detail="You can only review rosters for Tables currently assigned to your host account." action={<Link className="button button-outline" to="/host/assigned-tables">Back to assigned Tables<ArrowLeft /></Link>} />
      : state === "not_found" ? <WorkspaceState icon={<Table2 />} title="Table unavailable" detail="This Table is not available in this workspace. It may no longer be published or assigned." action={<Link className="button button-outline" to={admin ? "/admin/seat-requests" : "/host/assigned-tables"}>Back to Tables<ArrowLeft /></Link>} />
      : state === "error" || !data ? <WorkspaceState icon={<CircleAlert />} title="Roster is temporarily unavailable" detail="We could not load the current applicants and proposal. Try again." action={<button className="button button-outline" onClick={() => void load()}><RefreshCw />Try again</button>} />
      : <>
        <PageHeader className="roster-heading" eyebrow={admin ? "ROSTER REVIEW" : "HOST PROPOSAL"} title={data.table.title}
          description={<>{fmtDate(data.table.localDate)} at {fmtTime(data.table.startLocalTime)} · {data.table.neighborhood}. {admin ? "Review Seat requests and approve a group that meets the Table rules." : "Suggest a group for this Table, then send it to an administrator for approval."}</>}
          actions={<button className="icon-action" type="button" onClick={() => void load()} aria-label="Refresh roster" disabled={busy !== null}><RefreshCw aria-hidden="true" /></button>} />
        {notice && <div className={`roster-notice ${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}><CircleAlert aria-hidden="true" />{notice.text}</div>}
        {data.table.readOnlyReason && <div className="roster-notice bad" role="status"><CircleAlert aria-hidden="true" />{readOnlyLabels[data.table.readOnlyReason]}</div>}
        {!data.table.readOnlyReason && stale && <div className="roster-notice bad" role="alert"><CircleAlert aria-hidden="true" />This roster uses older Table details. Reload and start a new roster before continuing.</div>}
        <div className="roster-summary-grid">
          <section className="roster-summary-card"><span className="roster-summary-icon"><UsersRound aria-hidden="true" /></span><span className="eyebrow">REQUESTS</span><strong>{data.applicants.items.length}</strong><small>{eligibleCount} can be picked</small></section>
          <section className="roster-summary-card"><span className="roster-summary-icon"><Table2 aria-hidden="true" /></span><span className="eyebrow">ROSTER</span><strong>{proposal ? proposal.state.replaceAll("_", " ") : "Not started"}</strong><small>{proposal ? "" : "Pick 3–5 people"}</small></section>
          <section className="roster-summary-card"><span className="roster-summary-icon"><ShieldCheck aria-hidden="true" /></span><span className="eyebrow">TABLE DETAILS</span><strong className="roster-revision">{data.table.readOnlyReason ? "Changed" : "Current"}</strong><small>{data.table.readOnlyReason ? readOnlyLabels[data.table.readOnlyReason] : ""}</small></section>
        </div>
        <section className="roster-section">
          <div className="roster-section-heading"><div><p className="eyebrow">SEAT REQUESTS</p><h2>People who asked to join</h2><p>Listed by request time. The selected group must meet the age and openness rules shown below.</p></div>
            <span className="status-pill">{selected.size} selected <span aria-hidden="true">·</span> choose 3–5</span></div>
          {data.applicants.items.length === 0 ? <div className="roster-empty-inline"><UsersRound aria-hidden="true" /><strong>No pending Seat requests</strong><span>When members request a Seat, their current eligibility will appear here.</span></div>
            : <div className="roster-applicants">{data.applicants.items.map((candidate) => {
              const checked = selected.has(candidate.requestId);
              const disabled = !canEdit || (!candidate.eligible && !checked) || (!checked && selected.size >= 5);
              return <label className={`roster-applicant ${checked ? "selected" : ""} ${!candidate.eligible ? "ineligible" : ""}`} key={candidate.requestId}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => setSelected((previous) => { const next = new Set(previous); checked ? next.delete(candidate.requestId) : next.add(candidate.requestId); return next; })} aria-label={`Select ${candidate.displayName}`} />
                <span className="roster-applicant-avatar"><UserRoundCheck aria-hidden="true" /></span>
                <span className="roster-applicant-main"><strong>{candidate.displayName}</strong><small>Requested {fmtRequestDate(candidate.requestCreatedAt)}{candidate.recommendationRank !== null ? ` · #${candidate.recommendationRank}` : ""}</small>
                  {candidate.reasonCodes.length > 0 && <span className="roster-reasons">{candidate.reasonCodes.map(issueText).join(" ")}</span>}</span>
                <span className={`status-pill ${candidate.eligible ? "status-pill-success" : "status-pill-warning"}`}>{candidate.eligible ? "Eligible" : "Needs review"}</span>
              </label>;
            })}</div>}
          {data.applicants.nextCursor && <button className="button button-outline roster-more-applicants" type="button" onClick={() => void loadMoreApplicants()} disabled={loadingMoreApplicants}>
            {loadingMoreApplicants ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
            {loadingMoreApplicants ? "Loading applicants…" : "Load more applicants"}
          </button>}
        </section>
        <section className="roster-section roster-proposal-section">
          <div className="roster-section-heading"><div><p className="eyebrow">ROSTER DRAFT</p><h2>{admin ? "Current roster draft" : "Roster"}</h2><p>Save the group as a draft, then submit it for an administrator to review.</p></div>
            {proposal && <span className="status-pill status-pill-pending">Version {proposal.revision} · {proposal.state.replaceAll("_", " ")}</span>}</div>
          {proposal?.validation && <div className={`roster-validation ${proposal.validation.valid ? "valid" : "invalid"}`}>
            <div><span className="roster-validation-icon">{proposal.validation.valid ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}</span><strong>{proposal.validation.valid ? "Group works" : "Group needs changes"}</strong><small>{proposal.validation.valid ? "The current group meets the rules for this Table." : "We check each person’s age, preferred age range, and who is open to meeting whom."}</small></div>
            {proposal.validation.issues.length > 0 && <ul>{proposal.validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issueText(issue.code)}{issue.guestIds?.length ? ` · ${issue.guestIds.length} affected` : ""}</li>)}</ul>}
          </div>}
          <div className="roster-selected-list" aria-live="polite">
            {selectedRows.length === 0 ? <p className="roster-selected-empty">Select people above to start this roster.</p> : selectedRows.map((row) => <div className="roster-selected-row" key={row.requestId}><span>{row.displayName}</span><span>{row.eligible ? "Works" : "No longer fits"}</span></div>)}
          </div>
          {data.table.readOnlyReason && proposal?.selectedGuests.length ? <div className="roster-historical-selection">
            <p className="eyebrow">SAVED ROSTER · VERSION {proposal.revision}</p>
            <h3>Selected guests</h3>
            <ul>{proposal.selectedGuests.map((guest) => <li key={guest.guestId}>{guest.displayName}</li>)}</ul>
            <small>This saved roster is read-only. It does not include current Seat requests.</small>
          </div> : null}
          <div className="roster-actions">
            {canEdit && <button className="button button-outline" type="button" disabled={busy !== null || selected.size < 3 || selected.size > 5}
              onClick={() => { if (data.table.publishedRevisionId) void mutate("save", { expectedProposalRevision: proposal?.revision ?? null, supplyRevisionId: data.table.publishedRevisionId, selectedRequestIds: Array.from(selected) }); }}>
              {busy === "save" ? <LoaderCircle className="spin" /> : <Save />}Save draft</button>}
            {canSubmit && <button className="button button-primary" type="button" disabled={busy !== null || !proposal || !proposal.validation.valid}
              onClick={() => void mutate("submit", { expectedProposalRevision: proposal!.revision })}>
              {busy === "submit" ? <LoaderCircle className="spin" /> : <ArrowRight />}Send for approval</button>}
            {canApprove && <button className="button button-primary" type="button" disabled={busy !== null} onClick={() => setConfirmApproval(true)}>
              <Check aria-hidden="true" />Approve roster</button>}
            <button className="icon-action" type="button" aria-label="Reload" onClick={() => void load()} disabled={busy !== null}><RefreshCw aria-hidden="true" /></button>
          </div>
          {proposal?.state === "approved" && <div className="roster-approved-note"><Check aria-hidden="true" /><span>This roster is approved. Separate Table invitations are queued, but this screen does not confirm that email was delivered or that anyone paid.</span></div>}
          {!permissions?.canEditProposal && proposal?.state !== "approved" && <p className="roster-permission-note">This proposal is read-only for your current workspace permissions.</p>}
        </section>
        {confirmApproval && <div className="roster-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmApproval(false); }}>
          <section ref={approvalDialogRef} className="roster-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="roster-approve-title">
            <span className="roster-state-icon"><ShieldCheck aria-hidden="true" /></span><h2 id="roster-approve-title">Approve this roster?</h2>
             <p>Each person gets an invitation by email. They pay to confirm their seat.</p>
            <div className="roster-confirm-list">{selectedRows.map((item) => <span key={item.requestId}>{item.displayName}</span>)}</div>
            <div className="roster-actions"><button ref={cancelApprovalRef} className="button button-outline" type="button" onClick={() => setConfirmApproval(false)} disabled={busy !== null}>Back</button>
              <button className="button button-primary" type="button" onClick={() => void mutate("approve", { expectedProposalRevision: proposal!.revision })} disabled={busy !== null || !canApprove}>{busy === "approve" ? <LoaderCircle className="spin" /> : <Check />}Approve and send invitations</button></div>
          </section>
        </div>}
      </>}
  </StaffShell>;
}
