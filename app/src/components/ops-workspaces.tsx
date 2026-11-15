import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Field } from "./ui/field";
import { StatusBadge } from "./ui/status-badge";
import { PageHeader } from "./ui/page-header";
import { AppShell } from "./app-shell";
import { type StaffNavKey } from "./staff-nav";
import { AlertCircle, CheckCircle2, Clock3, Flag, LoaderCircle, MapPin, RefreshCw, UserCheck, UtensilsCrossed } from "lucide-react";
import "./ops-workspaces.css";

type Area = "admin-notices" | "admin-overview" | "admin-decisions" | "admin-staff" | "admin-feedback" | "host" | "restaurant";
type Reply<T> = { ok: true; data: T } | { ok: false; status: number; reason: string | null; message: string };
type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; status: number; message: string };

async function call<T>(path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const response = await fetch(path, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: { reason?: string | null; safeMessage?: string } } | null;
    if (response.ok && json?.ok) return { ok: true, data: json.data as T };
    return { ok: false, status: response.status, reason: json?.error?.reason ?? null, message: json?.error?.safeMessage ?? "This is temporarily unavailable. Try again shortly." };
  } catch { return { ok: false, status: 0, reason: null, message: "The connection failed. Try again." }; }
}
function useLoad<T>(path: string) {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const reload = useCallback(async () => {
    const result = await call<T>(path);
    setLoad(result.ok ? { state: "ready", data: result.data } : { state: "error", status: result.status, message: result.message });
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { load, reload };
}
const when = (date: string, time: string) => `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))} · ${time} Atlanta time`;
const blockerText: Record<string, string> = { select_three_to_five: "Needs 3–5 paid guests", age_under_21: "A paid guest is under 21", profile_not_approved: "A paid guest’s profile needs review",
  pair_age_mismatch: "Two guests are outside each other’s age range", missing_mutual_open_connection: "A guest has no mutual connection", age_span_exceeded: "Ages span more than 12 years" };

function Shell({ area, children }: Readonly<{ area: Area; children: ReactNode }>) {
  const role = area.startsWith("admin") ? "admin" : area === "host" ? "host" : "restaurant";
  const active = { "admin-overview": "overview", "admin-decisions": "decisions", "admin-staff": "assignments", "admin-notices": "emails", "admin-feedback": "reports", host: "host-tables", restaurant: "restaurant" }[area as string] as StaffNavKey | undefined;
  return <AppShell role={role} active={active} className="ops-workspace"><div className="ops-content">{children}</div></AppShell>;
}
function Status({ area, load, retry, children }: Readonly<{ area: Area; load: Load<unknown>; retry: () => void; children: ReactNode }>) {
  if (load.state === "loading") return <Shell area={area}><p className="ops-state" role="status"><LoaderCircle className="ops-spin" aria-hidden="true" />Loading…</p></Shell>;
  if (load.state === "error") {
    const denied = load.status === 401 || load.status === 403;
    return <Shell area={area}><section className="ops-state" role="alert"><AlertCircle aria-hidden="true" /><h2>{load.status === 401 ? "Sign in to continue" : denied ? "You don’t have access to this" : load.status === 404 ? "Not found" : "Unavailable right now"}</h2>
      <p>{load.message}</p>{load.status === 401 ? <a className="button button-primary" href="/sign-in">Sign in</a> : !denied && <button className="button button-outline" type="button" onClick={retry}><RefreshCw aria-hidden="true" />Try again</button>}</section></Shell>;
  }
  return <>{children}</>;
}

// ---- Admin: T-24 decisions -------------------------------------------------------------------------------------------
type Decision = { tableId: string; title: string; localDate: string; startLocalTime: string; neighborhood: string; status: "needs_decision" | "suspended" | "proceeding"; paidCount: number; canProceed: boolean; blockers: string[] };
export function AdminTableDecisions() {
  const { load, reload } = useLoad<{ items: Decision[] }>("/api/admin/table-decisions");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ tableId: string; operationId: string } | null>(null);
  const [message, setMessage] = useState("");
  async function proceed() {
    if (!confirm) return;
    setBusy(confirm.tableId); setMessage("");
    const result = await call(`/api/admin/tables/${confirm.tableId}/proceed`, { operationId: confirm.operationId });
    setBusy(null);
    if (result.ok) { setConfirm(null); await reload(); } else setMessage(result.reason === "group_invalid" ? "This paid group no longer meets the rules, so it cannot proceed." : result.message);
  }
  return <Status area="admin-decisions" load={load} retry={() => void reload()}>{load.state === "ready" && <Shell area="admin-decisions">
    <PageHeader title="Table decisions" description="Tables starting in the next 24 hours. Guests can’t pay for these until you decide. Confirm tables with 3–5 paid guests. Cancel any with fewer than 3." />
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.items.length === 0 ? <section className="ops-state"><CheckCircle2 aria-hidden="true" /><h2>No decisions needed</h2><p>Tables show up here 24 hours before they start.</p></section>
      : <ul className="ops-list">{load.data.items.map((t) => <li className="ops-card" key={t.tableId}>
        <div><h2>{t.title}</h2><p><MapPin aria-hidden="true" />{t.neighborhood} · {when(t.localDate, t.startLocalTime)}</p>
          <p className="ops-meta"><span className={`status-pill ${t.status === "proceeding" ? "status-pill-success" : "status-pill-warning"}`}>{t.status === "proceeding" ? "Confirmed" : t.status === "suspended" ? "On hold, needs review" : "Needs a decision"}</span><span>{t.paidCount} paid guest{t.paidCount === 1 ? "" : "s"}</span></p>
          {t.blockers.length > 0 && <ul className="ops-blockers">{t.blockers.map((b) => <li key={b}>{blockerText[b] ?? b}</li>)}</ul>}</div>
        <div className="ops-actions">
          {t.status !== "proceeding" && (confirm?.tableId === t.tableId
            ? <><button className="button button-primary" type="button" disabled={busy === t.tableId} onClick={() => void proceed()}>{busy === t.tableId ? "Confirming…" : "Confirm"}</button><button className="button button-outline" type="button" onClick={() => setConfirm(null)}>Back</button></>
            : <button className="button button-primary" type="button" disabled={!t.canProceed} onClick={() => setConfirm({ tableId: t.tableId, operationId: crypto.randomUUID() })}>Confirm table</button>)}
          <a className="button button-outline" href={`/admin/tables/${t.tableId}`}>Manage</a></div></li>)}</ul>}
  </Shell>}</Status>;
}

// ---- Host / admin: attendance ----------------------------------------------------------------------------------------
type Attendance = { table: { tableId: string; title: string; localDate: string; startLocalTime: string; neighborhood: string; runtimeState: string };
  guests: { seatId: string; firstName: string; seatState: string; checkedInAt: string | null; cancellationRequestId: string | null; cancellationFlagged: boolean }[]; canCheckIn: boolean };
export function HostTableAttendance({ tableId }: Readonly<{ tableId: string }>) {
  const { load, reload } = useLoad<Attendance>(`/api/host/tables/${encodeURIComponent(tableId)}/attendance`);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  async function act(key: string, path: string, body: unknown, fallback: string) {
    setBusy(key); setMessage("");
    const result = await call(path, body);
    setBusy(null);
    if (result.ok) await reload(); else setMessage(result.reason === "table_not_proceeding" ? "Check-in opens once an admin confirms this table." : result.status === 0 ? fallback : result.message);
  }
  return <Status area="host" load={load} retry={() => void reload()}>{load.state === "ready" && <Shell area="host">
    <PageHeader back={{ href: "/host/assigned-tables", label: "Your tables" }} title={load.data.table.title} description={<>{load.data.table.neighborhood} · {when(load.data.table.localDate, load.data.table.startLocalTime)}</>} />
    {!load.data.canCheckIn && <p className="ops-alert" role="status"><Clock3 aria-hidden="true" />Check-in opens once staff record that this Table is proceeding. A suspended or cancelled Table cannot check guests in.</p>}
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.guests.length === 0 ? <section className="ops-state"><h2>No paid guests yet</h2><p>Only guests with a paid Seat appear here.</p></section>
      : <ul className="ops-list">{load.data.guests.map((g) => <li className="ops-card" key={g.seatId}>
        <div><h2>{g.firstName}</h2><p className="ops-meta">{g.checkedInAt ? <span className="status-pill status-pill-success"><UserCheck aria-hidden="true" />Checked in {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(g.checkedInAt))}</span> : <span className="status-pill">Not checked in</span>}
          {g.cancellationRequestId && <span className="status-pill status-pill-warning">Cancellation requested{g.cancellationFlagged ? " · flagged for admin" : ""}</span>}</p></div>
        <div className="ops-actions">
          {!g.checkedInAt && <button className="button button-primary" type="button" disabled={!load.data.canCheckIn || busy === g.seatId} onClick={() => void act(g.seatId, `/api/host/tables/${encodeURIComponent(tableId)}/check-in`, { seatId: g.seatId }, "Check-in failed. Try again.")}>{busy === g.seatId ? "Checking in…" : "Check in"}</button>}
          {g.cancellationRequestId && !g.cancellationFlagged && <button className="button button-outline" type="button" disabled={busy === g.cancellationRequestId} onClick={() => void act(g.cancellationRequestId as string, `/api/host/cancellations/${g.cancellationRequestId}/flag`, {}, "Flagging failed. Try again.")}><Flag aria-hidden="true" />Flag for admin</button>}</div></li>)}</ul>}
    <p className="ops-footnote">Flag a cancellation request to bring it to an admin’s attention.</p>
  </Shell>}</Status>;
}

// ---- Admin: staff assignments ----------------------------------------------------------------------------------------
type Staff = { staff: { userId: string; role: "host" | "restaurant"; email: string; displayName: string | null; businessContact: string | null; tableIds: string[]; venueIds: string[] }[];
  tables: { tableId: string; title: string; localDate: string }[]; venues: { venueId: string; name: string }[] };
export function AdminStaffAssignments() {
  const { load, reload } = useLoad<Staff>("/api/admin/staff-assignments");
  const [message, setMessage] = useState("");
  async function post(path: string, body: unknown) {
    setMessage("");
    const result = await call(path, body);
    if (result.ok) await reload(); else setMessage(result.message);
  }
  return <Status area="admin-staff" load={load} retry={() => void reload()}>{load.state === "ready" && <Shell area="admin-staff">
    <PageHeader title="Staff assignments" description="Choose which tables each host sees, and which venues each restaurant sees." />
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.staff.length === 0 ? <section className="ops-state"><h2>No hosts or restaurants yet</h2><p>Add the role first; they’ll appear here.</p></section>
      : <ul className="ops-list">{load.data.staff.map((s) => <li className="ops-card ops-card-stack" key={s.userId}>
        <div><h2>{s.displayName ?? s.email}</h2><p className="ops-meta"><span className="status-pill">{s.role === "host" ? "Host" : "Restaurant"}</span><span>{s.email}</span></p></div>
        <form className="ops-contact" onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); void post("/api/admin/staff-assignments/contact", { userId: s.userId, displayName: String(f.get("name") ?? ""), businessContact: String(f.get("contact") ?? "") }); }}>
          <label>Display name<input name="name" defaultValue={s.displayName ?? ""} maxLength={120} required /></label>
          <label>Business contact<input name="contact" defaultValue={s.businessContact ?? ""} maxLength={200} required /></label>
          <button className="button button-outline" type="submit">Save contact</button></form>
        <fieldset className="ops-checks"><legend>{s.role === "host" ? "Assigned Tables" : "Assigned venues"}</legend>
          {(s.role === "host" ? load.data.tables.map((t) => ({ id: t.tableId, label: `${t.title} · ${t.localDate}`, on: s.tableIds.includes(t.tableId) })) : load.data.venues.map((v) => ({ id: v.venueId, label: v.name, on: s.venueIds.includes(v.venueId) }))).map((o) =>
            <label key={o.id}><input type="checkbox" checked={o.on} onChange={(event) => void post(s.role === "host" ? "/api/admin/staff-assignments/host" : "/api/admin/staff-assignments/venue",
              s.role === "host" ? { tableId: o.id, userId: s.userId, assigned: event.currentTarget.checked } : { venueId: o.id, userId: s.userId, assigned: event.currentTarget.checked })} />{o.label}</label>)}
        </fieldset></li>)}</ul>}
  </Shell>}</Status>;
}

// ---- Restaurant ------------------------------------------------------------------------------------------------------
type Workspace = { venues: { venueId: string; name: string }[]; selected: string | null;
  services: { tableId: string; title: string; role: string; serviceLocalDate: string; serviceLocalTime: string; paidCount: number; status: string; notes: string | null; hostContacts: { displayName: string; businessContact: string }[] }[] };
export function RestaurantWorkspace() {
  const [venueId, setVenueId] = useState<string | null>(null);
  const { load, reload } = useLoad<Workspace>(venueId ? `/api/restaurant/workspace?venueId=${encodeURIComponent(venueId)}` : "/api/restaurant/workspace");
  return <Status area="restaurant" load={load} retry={() => void reload()}>{load.state === "ready" && <Shell area="restaurant">
    <PageHeader title="Upcoming service times" description="Party size and timing for your venue." />
    {load.data.venues.length > 1 && <label className="ops-venue">Venue<select value={load.data.selected ?? ""} onChange={(event) => setVenueId(event.currentTarget.value)}>{load.data.venues.map((v) => <option key={v.venueId} value={v.venueId}>{v.name}</option>)}</select></label>}
    {load.data.selected === null ? <section className="ops-state"><UtensilsCrossed aria-hidden="true" /><h2>No venue yet</h2><p>Ask Fifth Wheel to add your venue.</p></section>
      : load.data.services.length === 0 ? <section className="ops-state"><h2>No upcoming services</h2><p>When a Table includes your venue, its service time appears here.</p></section>
      : <ul className="ops-list">{load.data.services.map((s) => <li className="ops-card" key={`${s.tableId}-${s.role}`}>
        <div><h2>{s.serviceLocalTime} · {s.role}</h2><p>{when(s.serviceLocalDate, s.serviceLocalTime)}</p>
          <p className="ops-meta"><span className="status-pill">{s.paidCount} guest{s.paidCount === 1 ? "" : "s"} expected</span>{s.status === "review_required" && <span className="status-pill status-pill-warning">Under review</span>}</p>
          {s.notes && <p>{s.notes}</p>}
          {s.hostContacts.length > 0 && <p className="ops-contact-line">Host: {s.hostContacts.map((c) => `${c.displayName} · ${c.businessContact}`).join("; ")}</p>}</div></li>)}</ul>}
  </Shell>}</Status>;
}

// ---- Admin: remove a guest, optionally replace ----------------------------------------------------------------------
type Suggestion = { expectedRevision: number; remainingValid: boolean; candidate: { requestId: string; guestId: string; displayName: string; requestCreatedAt: string } | null };
type Removal = { removal: { seatCancelled: boolean; refundCents: number }; replacement: { state: "sent" | "none" | "stale" }; roster: { revision: number; valid: boolean; needsReview: boolean } };
const removalErrors: Record<string, string> = { revision_conflict: "The roster changed. Close this and reopen it.", invitation_not_removable: "This guest was already removed.",
  table_not_active: "This Table is cancelled or completed.", refund_amount_exceeds_balance: "That refund is more than this guest has paid." };

/** Removal always commits. The replacement is revalidated on the server at the moment of "Yes". */
export function RemoveGuestAction({ invitationId, guestName, onDone }: Readonly<{ invitationId: string; guestName: string; onDone: () => void }>) {
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<Load<Suggestion>>({ state: "loading" });
  const [refund, setRefund] = useState("0");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [outcome, setOutcome] = useState<Removal | null>(null);
  const [operationId, setOperationId] = useState("");
  async function start() {
    setOpen(true); setOutcome(null); setMessage(""); setRefund("0"); setOperationId(crypto.randomUUID()); setSuggestion({ state: "loading" });
    const result = await call<Suggestion>(`/api/admin/invitations/${encodeURIComponent(invitationId)}/replacement-suggestion`);
    setSuggestion(result.ok ? { state: "ready", data: result.data } : { state: "error", status: result.status, message: result.message });
  }
  async function remove(replaceRequestId: string | null) {
    if (suggestion.state !== "ready") return;
    const cents = Math.round(Number(refund) * 100);
    if (!Number.isFinite(cents) || cents < 0 || cents > 2500) { setMessage("Enter a refund between $0 and $25."); return; }
    setWorking(true); setMessage("");
    const result = await call<Removal>(`/api/admin/invitations/${encodeURIComponent(invitationId)}/remove`,
      { operationId, expectedRevision: suggestion.data.expectedRevision, refundCents: cents, replaceRequestId });
    setWorking(false);
    if (result.ok) setOutcome(result.data); else setMessage(removalErrors[result.reason ?? ""] ?? result.message);
  }
  function close() { setOpen(false); if (outcome) onDone(); }
  const candidate = suggestion.state === "ready" ? suggestion.data.candidate : null;
  return <>
    <button className="button button-outline ops-remove" type="button" onClick={() => void start()}>Remove from Table…</button>
    {open && <div className="ops-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) close(); }}>
      <section className="ops-modal" role="dialog" aria-modal="true" aria-labelledby={`remove-${invitationId}`}>
        
        {outcome ? <>
          <h2 id={`remove-${invitationId}`}>{guestName} was removed</h2>
          <p>{outcome.removal.seatCancelled ? (outcome.removal.refundCents > 0 ? `Seat cancelled. ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(outcome.removal.refundCents / 100)} refund owed. Send it from Refunds.` : "Seat cancelled. No refund owed.") : "Invitation withdrawn."}</p>
          <p>{outcome.replacement.state === "sent" ? "The replacement has been invited." : outcome.replacement.state === "stale" ? "That guest no longer fits the group, so no invitation was sent." : "No replacement was invited."}</p>
          {outcome.roster.needsReview && <p className="ops-alert" role="status"><AlertCircle aria-hidden="true" />The remaining group no longer meets the roster rules. Review this Table before it starts; a Table with fewer than three valid paid guests cannot proceed.</p>}
          <div className="ops-modal-actions"><a className="button button-outline" href="/admin/refunds">Open Refunds</a><button className="button button-primary" type="button" onClick={close}>Close</button></div>
        </> : <>
          <h2 id={`remove-${invitationId}`}>Remove {guestName} from this table?</h2>
          {suggestion.state === "loading" && <p role="status"><LoaderCircle className="ops-spin" aria-hidden="true" /> Checking for a replacement…</p>}
          {suggestion.state === "error" && <p role="alert" className="ops-alert"><AlertCircle aria-hidden="true" />{suggestion.message}</p>}
          {suggestion.state === "ready" && <>
            <p>Their invitation ends. If they paid, their seat is cancelled and you’ll owe the refund below.</p>
            <label className="ops-field">Refund ($0–$25)<input inputMode="decimal" value={refund} onChange={(event) => setRefund(event.currentTarget.value)} disabled={working} /></label>
            {candidate ? <p><strong>Invite {candidate.displayName} instead?</strong> They asked to join this table and still fit the group. We’ll check again before anything is sent.</p>
              : <p>No eligible replacement is available. Removing still goes ahead.</p>}
            {message && <p role="alert" className="ops-alert"><AlertCircle aria-hidden="true" />{message}</p>}
            <div className="ops-modal-actions">
              <button className="button button-outline" type="button" disabled={working} onClick={() => setOpen(false)}>Keep {guestName}</button>
              {candidate && <button className="button button-primary" type="button" disabled={working} onClick={() => void remove(candidate.requestId)}>{working ? "Removing…" : `Remove and invite ${candidate.displayName}`}</button>}
              <button className={`button ${candidate ? "button-outline" : "button-primary"}`} type="button" disabled={working} onClick={() => void remove(null)}>{candidate ? "Remove only" : working ? "Removing…" : "Remove"}</button>
            </div></>}
        </>}
      </section></div>}
  </>;
}

// ---- Admin: conduct reports and rating aggregates -------------------------------------------------------------------
type Report = { reportId: string; tableId: string; tableTitle: string; status: "new" | "reviewing" | "resolved"; held: boolean; createdAt: string; author: string; subject: string | null; body: string };
type Aggregates = { tables: { tableId: string; title: string; localDate: string; responses: number; overallAverage: number | null }[] };
export function AdminConductReports() {
  const reports = useLoad<{ items: Report[] }>("/api/admin/conduct-reports");
  const ratings = useLoad<Aggregates>("/api/admin/rating-aggregates");
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Report | null>(null);
  const [deleting, setDeleting] = useState(false);
  async function remove(r: Report) {
    setDeleting(true); setMessage("");
    const result = await call(`/api/admin/conduct-reports/${r.reportId}/delete`, {});
    setDeleting(false); setPendingDelete(null);
    if (result.ok) await reports.reload(); else setMessage(result.reason === "case_held" ? "This report is on hold." : result.reason === "review_not_due" ? "Not due for deletion yet." : result.message);
  }
  async function update(r: Report, status: Report["status"], held: boolean) {
    setMessage("");
    const result = await call(`/api/admin/conduct-reports/${r.reportId}`, { status, held });
    if (result.ok) await reports.reload(); else setMessage(result.message);
  }
  return <Status area="admin-feedback" load={reports.load} retry={() => void reports.reload()}>{reports.load.state === "ready" && <Shell area="admin-feedback">
    <PageHeader title="Conduct reports" description="Only admins can see reports." />
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {reports.load.data.items.length === 0 ? <section className="ops-state"><h2>No reports</h2><p>Reports from guests who attended appear here.</p></section>
      : <ul className="ops-list">{reports.load.data.items.map((r) => <li className="ops-card ops-card-stack" key={r.reportId}>
        <div><h2>{r.tableTitle}</h2><p className="ops-meta"><StatusBadge tone={r.status === "new" ? "pending" : r.status === "resolved" ? "success" : "neutral"}>{r.status === "new" ? "New" : r.status === "reviewing" ? "Reviewing" : "Resolved"}</StatusBadge>{r.held && <StatusBadge tone="warning">On hold</StatusBadge>}<span>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(r.createdAt))}</span></p>
          <p>From {r.author}{r.subject ? ` about ${r.subject}` : ""}</p><p className="ops-report-body">{r.body}</p></div>
        <div className="ops-actions"><Field label="Status" className="ops-field"><select value={r.status} onChange={(event) => void update(r, event.currentTarget.value as Report["status"], r.held)}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></select></Field>
          <label className="ops-check"><input type="checkbox" checked={r.held} onChange={(event) => void update(r, r.status, event.currentTarget.checked)} />Keep (don’t delete)</label>
          {!r.held && Date.now() - new Date(r.createdAt).getTime() > 365 * 86_400_000 && <Button variant="danger" onClick={() => setPendingDelete(r)}>Delete report…</Button>}</div></li>)}</ul>}
    <ConfirmDialog open={pendingDelete !== null} title="Delete report?" confirmLabel="Delete report" destructive busy={deleting} onCancel={() => setPendingDelete(null)} onConfirm={() => pendingDelete && void remove(pendingDelete)}>This permanently deletes the report from {pendingDelete?.tableTitle}. This can’t be undone.</ConfirmDialog>
    <PageHeader title="Ratings" description="Averages show once 3 or more guests respond." />
    {ratings.load.state === "ready" && (ratings.load.data.tables.length === 0 ? <section className="ops-state"><h2>No ratings yet</h2></section>
      : <ul className="ops-list">{ratings.load.data.tables.map((t) => <li className="ops-card" key={t.tableId}><div><h2>{t.title}</h2><p>{t.localDate} · {t.responses} response{t.responses === 1 ? "" : "s"}</p></div>
        <span className="status-pill">{t.overallAverage === null ? "Not enough responses yet" : `${t.overallAverage.toFixed(2)} overall`}</span></li>)}</ul>)}
  </Shell>}</Status>;
}

// ---- Admin: overview ------------------------------------------------------------------------------------------------
type Overview = { generatedAt: string; heartbeat: { lastRunAt: string | null; ageMinutes: number | null; healthy: boolean }; counts: Record<string, number | null> };
type Queue = { key: string; label: string; help: string; href: string; alert?: boolean };
const queues: Queue[] = [
  { key: "decisionsSuspended", label: "Tables on hold", help: "A removal left a confirmed table invalid. Review before voting.", href: "/admin/table-decisions", alert: true },
  { key: "decisionsNeeded", label: "Tables needing a decision", help: "Guests can’t pay until you confirm or cancel.", href: "/admin/table-decisions", alert: true },
  { key: "paymentsUnaccounted", label: "Payments with no seat or refund", help: "Look into these first. Money isn’t accounted for.", href: "/admin/refunds", alert: true },
  { key: "refundsNeedingAttention", label: "Refunds failed or unconfirmed", help: "Check status with Stripe before sending again.", href: "/admin/refunds", alert: true },
  { key: "votesNotFinalized", label: "Vote results not finalized", help: "A closed vote still has no results after a day. Tell the operations owner.", href: "/admin", alert: true },
  { key: "noticeProblems", label: "Guest emails not sent or unconfirmed", help: "Check Resend first, then send again or dismiss.", href: "/admin/notices", alert: true },
  { key: "refundsOpen", label: "Refunds owed", help: "Refunds waiting to be sent.", href: "/admin/refunds" },
  { key: "cancellationsPending", label: "Cancellation requests", help: "Guests waiting for a decision.", href: "/admin/cancellations" },
  { key: "cancellationsFlagged", label: "Flagged by a host", help: "Hosts want you to look at these cancellation requests.", href: "/admin/cancellations" },
  { key: "tableInvitationDeliveryProblems", label: "Invitation emails not sent or unconfirmed", help: "Check status first, then send again.", href: "/admin/table-invitations" },
  { key: "admissionDeliveryProblems", label: "Sign-in link emails not sent or unconfirmed", help: "Open the waitlist to send again or check status.", href: "/admin/waitlist" },
  { key: "identityReviews", label: "Profiles waiting for review", help: "Approve, or ask for changes.", href: "/admin/identity-review" },
  { key: "seatRequests", label: "Seat requests waiting", help: "Guests who asked and aren’t on a roster yet.", href: "/admin/seat-requests" },
  { key: "rostersAwaitingApproval", label: "Rosters awaiting approval", help: "A host sent a roster for you to approve.", href: "/admin/seat-requests" },
  { key: "waitlistAwaitingInvite", label: "Waitlist people not yet approved", help: "No sign-in link has been sent.", href: "/admin/waitlist" },
  { key: "conductReportsNew", label: "New conduct reports", help: "Private. Triage them.", href: "/admin/conduct-reports" },
  { key: "conductReportsReviewDue", label: "Reports due for 12-month review", help: "Delete unless on hold.", href: "/admin/conduct-reports" },
  { key: "supplyNeedsAttention", label: "Tables whose source changed or went missing", help: "Review supply before accepting or publishing.", href: "/admin/tables" },
  { key: "unstaffedWithinSevenDays", label: "Tables in the next 7 days with no host", help: "Assign a host.", href: "/admin/staff-assignments" },
];
export function AdminOverview() {
  const { load, reload } = useLoad<Overview>("/api/admin/overview");
  return <Status area="admin-overview" load={load} retry={() => void reload()}>{load.state === "ready" && (() => {
    const { counts, heartbeat } = load.data;
    const active = queues.filter((q) => (counts[q.key] ?? 0) > 0);
    const clear = queues.filter((q) => (counts[q.key] ?? 0) === 0);
    const oldest = counts.oldestPendingDeliveryMinutes;
    return <Shell area="admin-overview">
      <PageHeader title="Today" description="What needs attention, most urgent first." />
      <p className={`ops-alert ${heartbeat.healthy ? "ops-ok" : ""}`} role={heartbeat.healthy ? "status" : "alert"}>{heartbeat.healthy ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
        {heartbeat.lastRunAt === null ? "Emails and refunds aren’t sending. Tell the operations owner now." : heartbeat.healthy ? `Emails and refunds are sending normally. (Last checked ${heartbeat.ageMinutes ?? 0} min ago.)` : "Emails and refunds aren’t sending. Tell the operations owner now."}</p>
      {typeof oldest === "number" && oldest >= 15 && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />The oldest invitation email has been waiting {oldest} minutes.</p>}
      {active.length === 0 ? <section className="ops-state"><CheckCircle2 aria-hidden="true" /><h2>Nothing needs attention</h2><p>Every queue is empty.</p></section>
        : <ul className="ops-list">{active.map((q) => <li className="ops-card" key={q.key}><div><h2>{counts[q.key]} · {q.label}</h2><p>{q.help}</p></div>
          <a className={`button ${q.alert ? "button-primary" : "button-outline"}`} href={q.href}>Open</a></li>)}</ul>}
      {clear.length > 0 && <details className="ops-clear"><summary>{clear.length} queues are clear</summary><ul>{clear.map((q) => <li key={q.key}><a href={q.href}>{q.label}</a></li>)}</ul></details>}
      <p className="ops-footnote">Need help? Email <a href="mailto:hello@fifthwheel.community">hello@fifthwheel.community</a>. Terms and privacy: <a href="https://fifthwheel.community/terms">Terms</a> · <a href="https://fifthwheel.community/privacy">Privacy</a>.</p>
    </Shell>;
  })()}</Status>;
}

// ---- Admin: guest email problems ------------------------------------------------------------------------------------
type NoticeProblem = { noticeId: string; kind: string; state: "failed" | "unknown"; attempts: number; errorCode: string | null; createdAt: string; firstName: string; tableTitle: string | null };
const kindLabels: Record<string, string> = { seat_confirmed: "Seat confirmed", cancellation_decision: "Cancellation decision", table_cancelled: "Table cancelled", member_removed: "Removed from Table", t48_reminder: "Invitation reminder" };
export function AdminNoticeProblems() {
  const { load, reload } = useLoad<{ items: NoticeProblem[] }>("/api/admin/notices");
  const [message, setMessage] = useState("");
  async function resolve(item: NoticeProblem, action: "retry" | "dismiss") {
    setMessage("");
    const result = await call(`/api/admin/notices/${item.noticeId}/resolve`, { action });
    if (result.ok) await reload(); else setMessage(result.message);
  }
  return <Status area="admin-notices" load={load} retry={() => void reload()}>{load.state === "ready" && <Shell area="admin-notices">
    <PageHeader title="Guest emails" description="Emails that didn’t send, or that we couldn’t confirm. For unconfirmed ones, check Resend first. If it didn’t go out, send again. If it did, dismiss." />
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.items.length === 0 ? <section className="ops-state"><CheckCircle2 aria-hidden="true" /><h2>No email problems</h2></section>
      : <ul className="ops-list">{load.data.items.map((n) => <li className="ops-card" key={n.noticeId}>
        <div><h2>{kindLabels[n.kind] ?? n.kind} · {n.firstName}</h2><p>{n.tableTitle ?? "Table"} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(n.createdAt))}</p>
          <p className="ops-meta"><span className={`status-pill ${n.state === "unknown" ? "status-pill-warning" : ""}`}>{n.state === "unknown" ? "Unconfirmed" : "Failed"}</span><span>{n.attempts} attempt{n.attempts === 1 ? "" : "s"}</span>{n.errorCode && <span>{n.errorCode.replaceAll("_", " ")}</span>}</p></div>
        <div className="ops-actions"><button className="button button-outline" type="button" onClick={() => void resolve(n, "retry")}>Send again</button><button className="button button-outline" type="button" onClick={() => void resolve(n, "dismiss")}>Dismiss</button></div></li>)}</ul>}
  </Shell>}</Status>;
}
