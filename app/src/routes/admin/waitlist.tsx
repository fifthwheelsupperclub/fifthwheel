import { createFileRoute } from "@tanstack/react-router";
import { StaffSidebar } from "../../components/staff-nav";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SignOutButton } from "../../components/sign-out-button.tsx";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  FileCheck2,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  UsersRound,
  X,
} from "lucide-react";

export const Route = createFileRoute("/admin/waitlist")({ component: AdminWaitlistPage });

type DeliveryState = "queued" | "sending" | "accepted" | "delivered" | "failed" | "unknown";
type WaitlistItem = Readonly<{
  id: string;
  firstName: string;
  lastName: string;
  emailNormalized: string;
  neighborhood: string;
  identity: "Woman" | "Man" | "Non-binary";
  openTo: readonly string[];
  receivedAt: string;
  admissionState: "none" | "invited" | "activated" | "deleted";
  latestDelivery: Readonly<{ id: string; state: DeliveryState; queuedAt: string; acceptedAt: string | null; deliveredAt: string | null }> | null;
}>;
type WaitlistResponse = Readonly<{ items: readonly WaitlistItem[]; nextCursor: string | null }>;
type LoadState = "loading" | "ready" | "error" | "unauthenticated" | "forbidden";
type InviteState = "idle" | "pending" | "admitting" | "sending" | "reconciling" | "accepted" | "failed" | "unknown" | "error";
type InviteOperationIds = Readonly<{ admissionOperationId: string | null; deliveryOperationId: string | null; deliveryId: string | null }>;

const neighborhoods = ["Inman Park", "Chamblee", "Virginia Highlands"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function AdminWaitlistPage() {
  const [items, setItems] = useState<readonly WaitlistItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<WaitlistItem | null>(null);
  const [inviteState, setInviteState] = useState<InviteState>("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [admissionOperationId, setAdmissionOperationId] = useState<string | null>(null);
  const [deliveryOperationId, setDeliveryOperationId] = useState<string | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const queryRef = useRef("");
  const neighborhoodRef = useRef("");

  const loadWaitlist = useCallback(async (pageCursor?: string) => {
    setLoadState("loading");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (queryRef.current.trim()) params.set("query", queryRef.current.trim());
      if (neighborhoodRef.current) params.set("neighborhood", neighborhoodRef.current);
      if (pageCursor) params.set("cursor", pageCursor);
      const response = await fetch(`/api/admin/waitlist?${params}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      if (response.status === 401) { setLoadState("unauthenticated"); setItems([]); return; }
      if (response.status === 403) { setLoadState("forbidden"); setItems([]); return; }
      if (!response.ok) throw new Error("waitlist_unavailable");
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.items) || !(body.nextCursor === null || typeof body.nextCursor === "string")) {
        throw new Error("waitlist_data_invalid");
      }
      setItems(body.items as WaitlistItem[]);
      setNextCursor(body.nextCursor);
      setLoadState("ready");
    } catch {
      setItems([]);
      setNextCursor(null);
      setLoadState("error");
    }
  }, []);

  useEffect(() => { void loadWaitlist(); }, [loadWaitlist]);
  useEffect(() => {
    if (selected) {
      closeButtonRef.current?.focus();
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeInvite();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
    returnFocusRef.current?.focus();
  }, [selected]);

  const rows = useMemo(() => items.map((item) => ({
    ...item,
    fullName: `${item.firstName} ${item.lastName}`,
  })), [items]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    queryRef.current = query;
    neighborhoodRef.current = neighborhood;
    setCursor(undefined);
    void loadWaitlist();
  }

  function openInvite(item: WaitlistItem) {
    const newAdmission = item.admissionState === "none";
    const recoverableDelivery = item.admissionState === "invited"
      && item.latestDelivery !== null
      && (item.latestDelivery.state === "queued" || item.latestDelivery.state === "failed" || item.latestDelivery.state === "unknown");
    if (!newAdmission && !recoverableDelivery) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(item);
    const stored = readInviteOperations(item.id);
    setAdmissionOperationId(stored.admissionOperationId);
    setDeliveryOperationId(stored.deliveryOperationId);
    setDeliveryId(item.latestDelivery?.id ?? stored.deliveryId);
    if (newAdmission) {
      const uncertainAdmission = stored.admissionOperationId !== null;
      setInviteState(uncertainAdmission ? "unknown" : "idle");
      setInviteMessage(uncertainAdmission ? "We’re not sure this went through. Try again. It’s safe and won’t approve twice." : "");
    } else if (item.latestDelivery?.state === "queued") {
      setInviteState("pending");
      setInviteMessage("Already approved. Send the link without approving again.");
    } else if (item.latestDelivery?.state === "failed") {
      setInviteState("failed");
      setInviteMessage("Already approved. Send the link again; this won’t approve twice.");
    } else {
      setInviteState("unknown");
      setInviteMessage("Already approved. We don’t know if the email was sent. Check status before sending again.");
    }
  }

  function closeInvite() {
    setSelected(null);
  }

  async function confirmInvite() {
    if (!selected || inviteState === "admitting" || inviteState === "sending" || inviteState === "reconciling" || (inviteState === "unknown" && deliveryId !== null)) return;
    let currentDeliveryId = deliveryId;
    if (selected.admissionState === "none") {
      const operationId = admissionOperationId ?? crypto.randomUUID();
      setAdmissionOperationId(operationId);
      persistInviteOperations(selected.id, { admissionOperationId: operationId, deliveryOperationId, deliveryId: currentDeliveryId });
      setInviteState("admitting");
      setInviteMessage("");
      try {
        const response = await fetch("/api/admin/waitlist", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ signupId: selected.id, operationId }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !isRecord(body) || body.ok !== true || !isRecord(body.value)
          || typeof body.value.deliveryId !== "string" || !uuidPattern.test(body.value.deliveryId)
          || !["queued", "sending"].includes(String(body.value.deliveryState))) {
          const error = isRecord(body) && isRecord(body.error) ? body.error : null;
          setInviteState(error?.code === "provider_outcome_unknown" ? "unknown" : "error");
          setInviteMessage(typeof error?.safeMessage === "string" ? error.safeMessage : "We’re not sure this went through. Try again. It’s safe and won’t approve twice.");
          void loadWaitlist(cursor);
          return;
        }
        currentDeliveryId = body.value.deliveryId;
        setDeliveryId(currentDeliveryId);
        persistInviteOperations(selected.id, { admissionOperationId: operationId, deliveryOperationId, deliveryId: currentDeliveryId });
        setSelected({
          ...selected,
          admissionState: "invited",
          latestDelivery: { id: currentDeliveryId, state: "queued", queuedAt: new Date().toISOString(), acceptedAt: null, deliveredAt: null },
        });
      } catch {
        setInviteState("unknown");
        setInviteMessage("We’re not sure this went through. Try again. It’s safe and won’t approve twice.");
        return;
      }
    }

    if (!currentDeliveryId) {
      setInviteState("error");
      setInviteMessage("We couldn’t load the email status. Refresh the page and try again.");
      return;
    }
    const operationId = inviteState === "failed" ? crypto.randomUUID() : deliveryOperationId ?? crypto.randomUUID();
    setDeliveryOperationId(operationId);
    persistInviteOperations(selected.id, { admissionOperationId, deliveryOperationId: operationId, deliveryId: currentDeliveryId });
    setInviteState("sending");
    setInviteMessage("");
    try {
      const response = await fetch(`/api/admin/invitation-deliveries/${encodeURIComponent(currentDeliveryId)}/attempts`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ operationId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isRecord(body) && body.deliveryId === currentDeliveryId
        && ["accepted", "failed", "unknown"].includes(String(body.state))) {
        const state = body.state as "accepted" | "failed" | "unknown";
        setInviteState(state);
        setInviteMessage(typeof body.safeMessage === "string" ? body.safeMessage : state === "accepted"
          ? "Sent. (Delivery isn’t confirmed.)"
          : state === "failed" ? "Not sent. Safe to send again."
            : "We don’t know if this was sent. Check status before sending again.");
      } else {
        const error = isRecord(body) && isRecord(body.error) ? body.error : null;
        const unknown = error?.code === "provider_outcome_unknown" || response.status >= 500;
        setInviteState(unknown ? "unknown" : "error");
        setInviteMessage(typeof error?.safeMessage === "string" ? error.safeMessage : "We don’t know if this was sent. Check status before sending again.");
      }
      void loadWaitlist(cursor);
    } catch {
      setInviteState("unknown");
      setInviteMessage("We don’t know if this was sent. Check status before sending again.");
    }
  }

  async function reconcileDelivery() {
    if (!selected || !deliveryId || inviteState !== "unknown") return;
    setInviteState("reconciling");
    setInviteMessage("");
    try {
      const response = await fetch(`/api/admin/invitation-deliveries/${encodeURIComponent(deliveryId)}/reconcile`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isRecord(body) && body.deliveryId === deliveryId
        && ["accepted", "failed", "unknown"].includes(String(body.state))) {
        const state = body.state as "accepted" | "failed" | "unknown";
        setInviteState(state);
        setInviteMessage(typeof body.safeMessage === "string" ? body.safeMessage : state === "unknown"
          ? "Still unconfirmed. Don’t send again yet."
          : state === "accepted" ? "Sent. (Delivery isn’t confirmed.)"
            : "Not sent. Safe to send again.");
      } else {
        setInviteState("unknown");
        setInviteMessage("We couldn’t check the email status. Don’t send again until we can.");
      }
      void loadWaitlist(cursor);
    } catch {
      setInviteState("unknown");
      setInviteMessage("We couldn’t check the email status. Don’t send again until we can.");
    }
  }

  return <main className="product-page">
    <header className="product-topbar">
      <a className="brand" href="/admin/waitlist" aria-label="Fifth Wheel admin waitlist"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions"><span className="product-workspace-label">ADMIN WORKSPACE</span><SignOutButton /></div>
    </header>
    <div className="product-layout">
      <StaffSidebar active="waitlist" />

      <section className="product-content" aria-labelledby="waitlist-heading">
        <div className="product-breadcrumb">People <span>/</span> Waitlist</div>
        <div className="page-heading-row">
          <div><h1 id="waitlist-heading">Waitlist</h1><p className="page-intro">People who signed up on the website. Approve them to send a sign-in link.</p></div>
          <span className="status-pill status-pill-neutral"><UsersRound aria-hidden="true" />{loadState === "ready" ? `${items.length} on this page` : "Live list"}</span>
        </div>

        <form className="waitlist-filters" onSubmit={submitSearch}>
          <label className="search-control" htmlFor="waitlist-search"><span className="visually-hidden">Search waitlist</span><Search aria-hidden="true" /><input id="waitlist-search" type="search" value={query} maxLength={120} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search name or email" /></label>
          <label className="filter-select-label" htmlFor="waitlist-neighborhood">Neighborhood<select id="waitlist-neighborhood" value={neighborhood} onChange={(event) => setNeighborhood(event.currentTarget.value)}><option value="">All neighborhoods</option>{neighborhoods.map((place) => <option key={place} value={place}>{place}</option>)}</select></label>
          <button className="button button-outline" type="submit" disabled={loadState === "loading"}><Search aria-hidden="true" />Search</button>
          <button className="icon-button" type="button" aria-label="Refresh waitlist" onClick={() => void loadWaitlist(cursor)} disabled={loadState === "loading"}><RefreshCw aria-hidden="true" /></button>
        </form>

        {loadState === "loading" && <section className="data-state" role="status" aria-live="polite"><span className="data-state-icon"><Clock3 aria-hidden="true" /></span><h2>Loading…</h2></section>}
        {loadState === "unauthenticated" && <section className="data-state data-state-error"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Sign in to continue</h2><p>This admin page requires a verified staff account.</p><a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a></section>}
        {loadState === "forbidden" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Admin access required</h2><p>Your account is not assigned to the admin workspace.</p></section>}
        {loadState === "error" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Waitlist unavailable</h2><p>The list could not be loaded. Try again in a moment.</p><button className="button button-outline" type="button" onClick={() => void loadWaitlist(cursor)}>Try again<RefreshCw aria-hidden="true" /></button></section>}
        {loadState === "ready" && items.length === 0 && <section className="data-state"><span className="data-state-icon"><UsersRound aria-hidden="true" /></span><h2>No matching signups</h2><p>Try a different name, email or neighborhood.</p></section>}
        {loadState === "ready" && items.length > 0 && <>
          <div className="waitlist-table-wrap">
            <table className="waitlist-table">
              <thead><tr><th scope="col">Person</th><th scope="col">Neighborhood</th><th scope="col">Joined</th><th scope="col">Access</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>{rows.map((item) => <tr key={item.id}>
                <td data-label="Person"><strong>{item.fullName}</strong><span>{item.emailNormalized}</span></td>
                <td data-label="Neighborhood">{item.neighborhood}</td>
                <td data-label="Joined">{safeDate(item.receivedAt)}</td>
                <td data-label="Access"><AccessState item={item} /></td>
                <td data-label="Action">{item.admissionState === "none"
                  ? <button className="button button-primary button-small" type="button" onClick={() => openInvite(item)}>Review<ArrowRight aria-hidden="true" /></button>
                  : item.admissionState === "deleted"
                    ? <span className="delivery-summary">Access removed</span>
                    : item.admissionState === "invited" && (item.latestDelivery?.state === "queued" || item.latestDelivery?.state === "unknown" || item.latestDelivery?.state === "failed")
                      ? <button className="button button-outline button-small" type="button" onClick={() => openInvite(item)}>{item.latestDelivery.state === "unknown" ? "Check status" : item.latestDelivery.state === "failed" ? "Send again" : "Send link"}<ArrowRight aria-hidden="true" /></button>
                  : <span className="delivery-summary">{deliveryLabel(item.latestDelivery?.state, item.admissionState)}</span>}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="pagination-row"><span>{nextCursor ? "More signups are available." : "You’re at the end of this list."}</span><button type="button" className="button button-outline" disabled={!nextCursor} onClick={() => { setCursor(nextCursor ?? undefined); void loadWaitlist(nextCursor ?? undefined); }}>Next page<ArrowRight aria-hidden="true" /></button></div>
        </>}
      </section>
    </div>

    {selected && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeInvite(); }}>
      <section ref={dialogRef} className="invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-dialog-title" aria-describedby="invite-dialog-description" tabIndex={-1}>
        <div className="invite-dialog-head"><span className="auth-icon"><Mail aria-hidden="true" /></span><button ref={closeButtonRef} className="icon-button" type="button" aria-label="Close invitation review" onClick={closeInvite}><X aria-hidden="true" /></button></div>
        <h2 id="invite-dialog-title">Approve {selected.firstName} {selected.lastName}?</h2>
        <div className="selected-recipient"><span className="recipient-initials">{selected.firstName.slice(0, 1)}{selected.lastName.slice(0, 1)}</span><span><strong>{selected.firstName} {selected.lastName}</strong><small>{selected.emailNormalized}</small></span></div>
        <div className="access-summary">
          <div><strong>{selected.admissionState === "invited" ? "Already approved" : "They’ll get an email with a sign-in link."}</strong><span>{selected.admissionState === "invited" ? "This guest already has access." : "They can then complete their profile and request seats."}</span></div>
        </div>
        <p id="invite-dialog-description" className="invite-queue-note">{inviteState === "unknown" && deliveryId
          ? "Checking won’t send another email."
          : selected.admissionState === "invited"
            ? "This sends the link again. It won’t approve access twice."
            : "This approves access and sends a sign-in link."}</p>
        {inviteMessage && <div className={`auth-feedback ${inviteState === "accepted" || inviteState === "pending" ? "auth-feedback-success" : "auth-feedback-error"}`} role={inviteState === "accepted" || inviteState === "pending" ? "status" : "alert"}>
          {inviteState === "accepted" || inviteState === "pending" ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}<span><strong>{inviteState === "accepted" ? "Sent" : inviteState === "pending" ? "Already approved" : inviteState === "unknown" ? (deliveryId ? "Email status unconfirmed" : "Approval not confirmed") : inviteState === "failed" ? "Not sent" : "Not confirmed"}</strong><small>{inviteMessage}</small></span>
        </div>}
        <div className="dialog-actions"><button className="button button-outline" type="button" onClick={closeInvite}>Close</button><button className="button button-primary" type="button" disabled={inviteState === "admitting" || inviteState === "sending" || inviteState === "reconciling" || inviteState === "accepted"} onClick={() => { if (inviteState === "unknown" && deliveryId) void reconcileDelivery(); else void confirmInvite(); }}>{inviteState === "admitting" ? "Approving…" : inviteState === "sending" ? "Sending…" : inviteState === "reconciling" ? "Checking…" : inviteState === "accepted" ? "Sent" : inviteState === "failed" ? "Send again" : inviteState === "unknown" ? deliveryId ? "Check status" : "Try again" : selected.admissionState === "invited" ? "Send link" : "Approve and send link"}<ArrowRight aria-hidden="true" /></button></div>
      </section>
    </div>}
  </main>;
}

function AccessState({ item }: { item: WaitlistItem }) {
  if (item.admissionState === "activated") return <span className="status-pill status-pill-success"><Check aria-hidden="true" />Signed in</span>;
  if (item.admissionState === "invited") return <span className={`status-pill ${item.latestDelivery?.state === "failed" || item.latestDelivery?.state === "unknown" ? "status-pill-warning" : "status-pill-pending"}`}><Clock3 aria-hidden="true" />Access approved</span>;
  if (item.admissionState === "deleted") return <span className="status-pill status-pill-warning"><CircleAlert aria-hidden="true" />Access removed</span>;
  return <span className="status-pill status-pill-neutral">Not approved</span>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function inviteOperationStorageKey(signupId: string): string {
  return `fw.invite-operations.${signupId}`;
}

function readInviteOperations(signupId: string): InviteOperationIds {
  try {
    const raw = window.sessionStorage.getItem(inviteOperationStorageKey(signupId));
    if (!raw) return { admissionOperationId: null, deliveryOperationId: null, deliveryId: null };
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return { admissionOperationId: null, deliveryOperationId: null, deliveryId: null };
    return {
      admissionOperationId: typeof value.admissionOperationId === "string" && uuidPattern.test(value.admissionOperationId) ? value.admissionOperationId : null,
      deliveryOperationId: typeof value.deliveryOperationId === "string" && uuidPattern.test(value.deliveryOperationId) ? value.deliveryOperationId : null,
      deliveryId: typeof value.deliveryId === "string" && uuidPattern.test(value.deliveryId) ? value.deliveryId : null,
    };
  } catch {
    return { admissionOperationId: null, deliveryOperationId: null, deliveryId: null };
  }
}

function persistInviteOperations(signupId: string, value: InviteOperationIds): void {
  try {
    window.sessionStorage.setItem(inviteOperationStorageKey(signupId), JSON.stringify(value));
  } catch {
    // The in-memory operation ID still survives dialog close/reopen if storage is unavailable.
  }
}

function deliveryLabel(state: DeliveryState | undefined, admissionState: string): string {
  if (admissionState === "activated") return "Signed in";
  switch (state) {
    case "queued": return "Waiting to send";
    case "sending": return "Sending";
    case "accepted": return "Sent";
    case "delivered": return "Delivered";
    case "failed": return "Not sent";
    case "unknown": return "Unconfirmed";
    default: return "Approved";
  }
}
