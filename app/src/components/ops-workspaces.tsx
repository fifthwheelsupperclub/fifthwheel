import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, Flag, LoaderCircle, MapPin, RefreshCw, UserCheck, UtensilsCrossed } from "lucide-react";
import { SignOutButton } from "./sign-out-button.tsx";
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
  const admin = area.startsWith("admin");
  return <main className="product-page ops-workspace"><header className="product-topbar"><a className="brand" href="/" aria-label="Fifth Wheel"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
    <div className="product-topbar-actions"><span className="product-workspace-label">{admin ? "ADMIN WORKSPACE" : area === "host" ? "HOST WORKSPACE" : "RESTAURANT WORKSPACE"}</span><SignOutButton /></div></header>
    <div className="product-layout"><aside className="product-sidebar" aria-label="Navigation"><span className="sidebar-caption">WORKSPACE</span>
      {admin ? <><a className={`member-nav-link ${area === "admin-overview" ? "active" : ""}`} href="/admin">Overview</a>
        <a className={`member-nav-link ${area === "admin-decisions" ? "active" : ""}`} href="/admin/table-decisions">Table decisions</a>
        <a className={`member-nav-link ${area === "admin-staff" ? "active" : ""}`} href="/admin/staff-assignments">Staff assignments</a>
        <a className={`member-nav-link ${area === "admin-notices" ? "active" : ""}`} href="/admin/notices">Email problems</a>
        <a className={`member-nav-link ${area === "admin-feedback" ? "active" : ""}`} href="/admin/conduct-reports">Reports &amp; ratings</a>
        <a className="member-nav-link" href="/admin/seat-requests">Seat requests</a><a className="member-nav-link" href="/admin/tables">Tables</a><a className="member-nav-link" href="/admin/cancellations">Cancellations</a><a className="member-nav-link" href="/admin/refunds">Refunds</a></>
        : area === "host" ? <a className="member-nav-link active" href="/host/assigned-tables">Assigned Tables</a> : <a className="member-nav-link active" href="/restaurant">Service times</a>}
    </aside><div className="ops-content">{children}</div></div></main>;
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
    <header className="ops-heading"><p className="eyebrow">NEXT 24 HOURS</p><h1>Table decisions</h1><p>Within 24 hours of the start, new checkout pauses until you record a decision. Fewer than three paid guests must be cancelled; three to five valid guests can proceed.</p></header>
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.items.length === 0 ? <section className="ops-state"><CheckCircle2 aria-hidden="true" /><h2>No Tables need a decision</h2><p>Tables appear here 24 hours before they start, or when a proceeding Table is suspended.</p></section>
      : <ul className="ops-list">{load.data.items.map((t) => <li className="ops-card" key={t.tableId}>
        <div><h2>{t.title}</h2><p><MapPin aria-hidden="true" />{t.neighborhood} · {when(t.localDate, t.startLocalTime)}</p>
          <p className="ops-meta"><span className={`status-pill ${t.status === "proceeding" ? "status-pill-success" : "status-pill-warning"}`}>{t.status === "proceeding" ? "Proceeding" : t.status === "suspended" ? "Suspended — needs review" : "Needs decision"}</span><span>{t.paidCount} paid guest{t.paidCount === 1 ? "" : "s"}</span></p>
          {t.blockers.length > 0 && <ul className="ops-blockers">{t.blockers.map((b) => <li key={b}>{blockerText[b] ?? b}</li>)}</ul>}</div>
        <div className="ops-actions">
          {t.status !== "proceeding" && (confirm?.tableId === t.tableId
            ? <><button className="button button-primary" type="button" disabled={busy === t.tableId} onClick={() => void proceed()}>{busy === t.tableId ? "Recording…" : "Confirm proceed"}</button><button className="button button-outline" type="button" onClick={() => setConfirm(null)}>Back</button></>
            : <button className="button button-primary" type="button" disabled={!t.canProceed} onClick={() => setConfirm({ tableId: t.tableId, operationId: crypto.randomUUID() })}>Record proceed</button>)}
          <a className="button button-outline" href={`/admin/tables/${t.tableId}`}>Manage or cancel</a></div></li>)}</ul>}
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
    if (result.ok) await reload(); else setMessage(result.reason === "table_not_proceeding" ? "Check-in opens once staff record that this Table is proceeding." : result.status === 0 ? fallback : result.message);
  }
  return <Status area="host" load={load} retry={() => void reload()}>{load.state === "ready" && <Shell area="host">
    <header className="ops-heading"><p className="eyebrow">ATTENDANCE</p><h1>{load.data.table.title}</h1><p><MapPin aria-hidden="true" />{load.data.table.neighborhood} · {when(load.data.table.localDate, load.data.table.startLocalTime)}</p></header>
    {!load.data.canCheckIn && <p className="ops-alert" role="status"><Clock3 aria-hidden="true" />Check-in opens once staff record that this Table is proceeding. A suspended or cancelled Table cannot check guests in.</p>}
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.guests.length === 0 ? <section className="ops-state"><h2>No paid guests yet</h2><p>Only guests with a paid Seat appear here.</p></section>
      : <ul className="ops-list">{load.data.guests.map((g) => <li className="ops-card" key={g.seatId}>
        <div><h2>{g.firstName}</h2><p className="ops-meta">{g.checkedInAt ? <span className="status-pill status-pill-success"><UserCheck aria-hidden="true" />Checked in {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(g.checkedInAt))}</span> : <span className="status-pill">Not checked in</span>}
          {g.cancellationRequestId && <span className="status-pill status-pill-warning">Cancellation requested{g.cancellationFlagged ? " · flagged for admin" : ""}</span>}</p></div>
        <div className="ops-actions">
          {!g.checkedInAt && <button className="button button-primary" type="button" disabled={!load.data.canCheckIn || busy === g.seatId} onClick={() => void act(g.seatId, `/api/host/tables/${encodeURIComponent(tableId)}/check-in`, { seatId: g.seatId }, "Check-in failed. Try again.")}>{busy === g.seatId ? "Checking in…" : "Check in"}</button>}
          {g.cancellationRequestId && !g.cancellationFlagged && <button className="button button-outline" type="button" disabled={busy === g.cancellationRequestId} onClick={() => void act(g.cancellationRequestId as string, `/api/host/cancellations/${g.cancellationRequestId}/flag`, {}, "Flagging failed. Try again.")}><Flag aria-hidden="true" />Flag for admin</button>}</div></li>)}</ul>}
    <p className="ops-footnote">Hosts can flag a cancellation request for admin attention. Only admins approve removals or decide refunds.</p>
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
    <header className="ops-heading"><p className="eyebrow">ACCESS</p><h1>Staff assignments</h1><p>Hosts see only the Tables assigned here. Restaurant users see only their venues’ service times, counts and the host contact below. Roles themselves are provisioned separately.</p></header>
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.staff.length === 0 ? <section className="ops-state"><h2>No host or restaurant users yet</h2><p>Provision a host or restaurant role first; they will appear here.</p></section>
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
    <header className="ops-heading"><p className="eyebrow">SERVICE</p><h1>Upcoming service times</h1><p>Counts and timing only. Guest names, payments and private notes are never shown here.</p></header>
    {load.data.venues.length > 1 && <label className="ops-venue">Venue<select value={load.data.selected ?? ""} onChange={(event) => setVenueId(event.currentTarget.value)}>{load.data.venues.map((v) => <option key={v.venueId} value={v.venueId}>{v.name}</option>)}</select></label>}
    {load.data.selected === null ? <section className="ops-state"><UtensilsCrossed aria-hidden="true" /><h2>No venue assigned</h2><p>Ask Fifth Wheel staff to assign your venue.</p></section>
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
        <p className="eyebrow">REMOVE FROM TABLE</p>
        {outcome ? <>
          <h2 id={`remove-${invitationId}`}>{guestName} was removed</h2>
          <p>{outcome.removal.seatCancelled ? (outcome.removal.refundCents > 0 ? `Their Seat was cancelled and a ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(outcome.removal.refundCents / 100)} refund is owed; send it from Refunds.` : "Their Seat was cancelled with no refund.") : "Their invitation was revoked."}</p>
          <p>{outcome.replacement.state === "sent" ? "One replacement invitation was queued." : outcome.replacement.state === "stale" ? "The suggested guest was no longer eligible, so no invitation was sent." : "No replacement invitation was sent."}</p>
          {outcome.roster.needsReview && <p className="ops-alert" role="status"><AlertCircle aria-hidden="true" />The remaining group no longer meets the roster rules. Review this Table before it starts; a Table with fewer than three valid paid guests cannot proceed.</p>}
          <div className="ops-modal-actions"><a className="button button-outline" href="/admin/refunds">Open Refunds</a><button className="button button-primary" type="button" onClick={close}>Close</button></div>
        </> : <>
          <h2 id={`remove-${invitationId}`}>Remove {guestName}?</h2>
          {suggestion.state === "loading" && <p role="status"><LoaderCircle className="ops-spin" aria-hidden="true" /> Checking for a replacement…</p>}
          {suggestion.state === "error" && <p role="alert" className="ops-alert"><AlertCircle aria-hidden="true" />{suggestion.message}</p>}
          {suggestion.state === "ready" && <>
            <p>Their invitation is revoked and any unfinished checkout is released. If they already paid, their Seat is cancelled and the refund below becomes owed.</p>
            <label className="ops-field">Refund if they have paid ($0–$25)<input inputMode="decimal" value={refund} onChange={(event) => setRefund(event.currentTarget.value)} disabled={working} /></label>
            {candidate ? <p><strong>Replace with {candidate.displayName} from the waitlist?</strong> They have asked for this Table, are approved and keep the group valid. Choosing Yes checks that again before anything is sent.</p>
              : <p>No eligible replacement is available. Removing still goes ahead.</p>}
            {message && <p role="alert" className="ops-alert"><AlertCircle aria-hidden="true" />{message}</p>}
            <div className="ops-modal-actions">
              <button className="button button-outline" type="button" disabled={working} onClick={() => setOpen(false)}>Keep guest</button>
              {candidate && <button className="button button-primary" type="button" disabled={working} onClick={() => void remove(candidate.requestId)}>{working ? "Removing…" : "Yes, remove and invite"}</button>}
              <button className={`button ${candidate ? "button-outline" : "button-primary"}`} type="button" disabled={working} onClick={() => void remove(null)}>{candidate ? "No, remove only" : working ? "Removing…" : "Remove"}</button>
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
  async function update(r: Report, status: Report["status"], held: boolean) {
    setMessage("");
    const result = await call(`/api/admin/conduct-reports/${r.reportId}`, { status, held });
    if (result.ok) await reports.reload(); else setMessage(result.message);
  }
  return <Status area="admin-feedback" load={reports.load} retry={() => void reports.reload()}>{reports.load.state === "ready" && <Shell area="admin-feedback">
    <header className="ops-heading"><p className="eyebrow">PRIVATE</p><h1>Conduct reports</h1><p>Visible to admins only. Hosts, restaurants and other guests never see these, and report text is kept out of audit logs. Fifth Wheel does not monitor evenings in real time.</p></header>
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {reports.load.data.items.length === 0 ? <section className="ops-state"><h2>No reports</h2><p>Reports from guests who attended appear here.</p></section>
      : <ul className="ops-list">{reports.load.data.items.map((r) => <li className="ops-card ops-card-stack" key={r.reportId}>
        <div><h2>{r.tableTitle}</h2><p className="ops-meta"><span className={`status-pill ${r.status === "new" ? "status-pill-warning" : ""}`}>{r.status}</span>{r.held && <span className="status-pill status-pill-warning">On hold</span>}<span>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(r.createdAt))}</span></p>
          <p>From {r.author}{r.subject ? ` about ${r.subject}` : ""}</p><p className="ops-report-body">{r.body}</p></div>
        <div className="ops-actions"><label className="ops-field">Status<select value={r.status} onChange={(event) => void update(r, event.currentTarget.value as Report["status"], r.held)}><option value="new">New</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></select></label>
          <label className="ops-check"><input type="checkbox" checked={r.held} onChange={(event) => void update(r, r.status, event.currentTarget.checked)} />Hold (do not delete)</label>
          {!r.held && Date.now() - new Date(r.createdAt).getTime() > 365 * 86_400_000 && <button className="button button-outline" type="button" onClick={() => { if (window.confirm("Delete this report permanently? This cannot be undone.")) void (async () => { setMessage(""); const result = await call(`/api/admin/conduct-reports/${r.reportId}/delete`, {}); if (result.ok) await reports.reload(); else setMessage(result.reason === "case_held" ? "This report is on hold." : result.reason === "review_not_due" ? "This report is not yet due for deletion review." : result.message); })(); }}>Delete (review due)</button>}</div></li>)}</ul>}
    <header className="ops-heading ops-heading-gap"><p className="eyebrow">AGGREGATE ONLY</p><h1>Ratings</h1><p>Averages appear once at least three guests have responded. Free-text notes are never shown here.</p></header>
    {ratings.load.state === "ready" && (ratings.load.data.tables.length === 0 ? <section className="ops-state"><h2>No ratings yet</h2></section>
      : <ul className="ops-list">{ratings.load.data.tables.map((t) => <li className="ops-card" key={t.tableId}><div><h2>{t.title}</h2><p>{t.localDate} · {t.responses} response{t.responses === 1 ? "" : "s"}</p></div>
        <span className="status-pill">{t.overallAverage === null ? "Fewer than 3 responses" : `${t.overallAverage.toFixed(2)} overall`}</span></li>)}</ul>)}
  </Shell>}</Status>;
}

// ---- Admin: overview ------------------------------------------------------------------------------------------------
type Overview = { generatedAt: string; heartbeat: { lastRunAt: string | null; ageMinutes: number | null; healthy: boolean }; counts: Record<string, number | null> };
type Queue = { key: string; label: string; help: string; href: string; alert?: boolean };
const queues: Queue[] = [
  { key: "decisionsSuspended", label: "Suspended Tables", help: "A removal left a proceeding Table invalid. Review before voting.", href: "/admin/table-decisions", alert: true },
  { key: "decisionsNeeded", label: "Tables needing a T−24 decision", help: "Checkout is paused until you record proceed or cancel.", href: "/admin/table-decisions", alert: true },
  { key: "paymentsUnaccounted", label: "Payments with no Seat or refund", help: "Investigate before anything else; money is unaccounted for.", href: "/admin/refunds", alert: true },
  { key: "refundsNeedingAttention", label: "Refunds failed or unconfirmed", help: "Retry or reconcile; never resend without provider evidence.", href: "/admin/refunds", alert: true },
  { key: "votesNotFinalized", label: "Vote results not finalized", help: "A closed vote has no results after a day. Ask engineering to run the finalizer.", href: "/admin", alert: true },
  { key: "noticeProblems", label: "Guest emails failed or unconfirmed", help: "Check the provider’s logs, then send again or dismiss.", href: "/admin/notices", alert: true },
  { key: "refundsOpen", label: "Refunds owed", help: "Open refund obligations.", href: "/admin/refunds" },
  { key: "cancellationsPending", label: "Cancellation requests", help: "Guests waiting for a decision.", href: "/admin/cancellations" },
  { key: "cancellationsFlagged", label: "Flagged by a host", help: "Hosts asked for your attention on these cancellation requests.", href: "/admin/cancellations" },
  { key: "tableInvitationDeliveryProblems", label: "Table invitation emails failed or unconfirmed", help: "Retry, or check the existing attempt first.", href: "/admin/table-invitations" },
  { key: "admissionDeliveryProblems", label: "App invitation emails failed or unconfirmed", help: "Open the waitlist to retry or reconcile.", href: "/admin/waitlist" },
  { key: "identityReviews", label: "Profiles awaiting identity review", help: "Review and approve or ask for corrections.", href: "/admin/identity-review" },
  { key: "seatRequests", label: "Seat requests waiting", help: "Applicants not yet on a roster.", href: "/admin/seat-requests" },
  { key: "rostersAwaitingApproval", label: "Rosters awaiting approval", help: "A host submitted a roster for you to approve.", href: "/admin/seat-requests" },
  { key: "waitlistAwaitingInvite", label: "Waitlist people not yet invited", help: "No app invitation has been sent.", href: "/admin/waitlist" },
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
      <header className="ops-heading"><p className="eyebrow">TODAY</p><h1>Overview</h1><p>Everything that needs a person, in order of urgency. Counts and ages only; nothing private is shown here.</p></header>
      <p className={`ops-alert ${heartbeat.healthy ? "ops-ok" : ""}`} role={heartbeat.healthy ? "status" : "alert"}>{heartbeat.healthy ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
        {heartbeat.lastRunAt === null ? "The background worker has never reported in. Emails and refunds will not send until it runs." : heartbeat.healthy ? `Background worker last ran ${heartbeat.ageMinutes ?? 0} minute${heartbeat.ageMinutes === 1 ? "" : "s"} ago.` : `Background worker last ran ${heartbeat.ageMinutes} minutes ago or has been failing. Emails and refunds may be stuck; check the scheduler.`}</p>
      {typeof oldest === "number" && oldest >= 15 && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />The oldest queued Table invitation email has waited {oldest} minutes.</p>}
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
    <header className="ops-heading"><p className="eyebrow">EMAIL</p><h1>Guest emails that need a person</h1><p>The system never sends an uncertain email twice on its own. For “unconfirmed”, check the email provider’s logs for this guest first. If it was not sent, send again; if it was, dismiss it.</p></header>
    {message && <p className="ops-alert" role="alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {load.data.items.length === 0 ? <section className="ops-state"><CheckCircle2 aria-hidden="true" /><h2>No email problems</h2><p>Failed and unconfirmed guest emails appear here.</p></section>
      : <ul className="ops-list">{load.data.items.map((n) => <li className="ops-card" key={n.noticeId}>
        <div><h2>{kindLabels[n.kind] ?? n.kind} · {n.firstName}</h2><p>{n.tableTitle ?? "Table"} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(n.createdAt))}</p>
          <p className="ops-meta"><span className={`status-pill ${n.state === "unknown" ? "status-pill-warning" : ""}`}>{n.state === "unknown" ? "Unconfirmed" : "Failed"}</span><span>{n.attempts} attempt{n.attempts === 1 ? "" : "s"}</span>{n.errorCode && <span>{n.errorCode.replaceAll("_", " ")}</span>}</p></div>
        <div className="ops-actions"><button className="button button-outline" type="button" onClick={() => void resolve(n, "retry")}>Send again</button><button className="button button-outline" type="button" onClick={() => void resolve(n, "dismiss")}>Dismiss</button></div></li>)}</ul>}
  </Shell>}</Status>;
}
