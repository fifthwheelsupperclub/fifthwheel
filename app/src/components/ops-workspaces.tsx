import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, Flag, LoaderCircle, MapPin, RefreshCw, UserCheck, UtensilsCrossed } from "lucide-react";
import { SignOutButton } from "./sign-out-button.tsx";
import "./ops-workspaces.css";

type Area = "admin-decisions" | "admin-staff" | "host" | "restaurant";
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
      {admin ? <><a className={`member-nav-link ${area === "admin-decisions" ? "active" : ""}`} href="/admin/table-decisions">Table decisions</a>
        <a className={`member-nav-link ${area === "admin-staff" ? "active" : ""}`} href="/admin/staff-assignments">Staff assignments</a>
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
