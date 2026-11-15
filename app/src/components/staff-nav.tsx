import { Menu, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

// One sidebar for every staff screen. Add or rename a nav item here, nowhere else.
export type StaffNavKey =
  | "overview" | "waitlist" | "identity-review" | "seat-requests"
  | "tables" | "decisions" | "assignments"
  | "cancellations" | "refunds"
  | "emails" | "invitations" | "reports"
  | "host-tables" | "restaurant";

type Item = readonly [key: StaffNavKey, href: string, label: string];
const ADMIN_GROUPS: ReadonlyArray<readonly [group: string | null, items: readonly Item[]]> = [
  [null, [["overview", "/admin", "Overview"]]],
  ["GUESTS", [["waitlist", "/admin/waitlist", "Waitlist"], ["identity-review", "/admin/identity-review", "Profile review"], ["seat-requests", "/admin/seat-requests", "Seat requests"]]],
  ["TABLES", [["tables", "/admin/tables", "Tables"], ["decisions", "/admin/table-decisions", "Table decisions"], ["assignments", "/admin/staff-assignments", "Staff assignments"]]],
  ["MONEY", [["cancellations", "/admin/cancellations", "Cancellations"], ["refunds", "/admin/refunds", "Refunds"]]],
  ["MESSAGES", [["emails", "/admin/notices", "Guest emails"], ["invitations", "/admin/table-invitations", "Table invitation delivery"]]],
  ["SAFETY", [["reports", "/admin/conduct-reports", "Conduct reports"]]],
];
const OTHER_GROUPS: Record<"host" | "restaurant", ReadonlyArray<readonly [string | null, readonly Item[]]>> = {
  host: [[null, [["host-tables", "/host/assigned-tables", "Assigned tables"]]]],
  restaurant: [[null, [["restaurant", "/restaurant", "Service times"]]]],
};

export type StaffRole = "admin" | "host" | "restaurant";

function groupsFor(role: StaffRole) { return role === "admin" ? ADMIN_GROUPS : OTHER_GROUPS[role]; }
function Links({ role, active }: Readonly<{ role: StaffRole; active?: StaffNavKey }>) {
  return <>{groupsFor(role).map(([group, items]) => <Fragment key={group ?? "top"}>
    {group && <p className="group-label">{group}</p>}
    {items.map(([key, href, label]) => <a key={key} className={`member-nav-link${key === active ? " active" : ""}`} href={href} aria-current={key === active ? "page" : undefined}>{label}</a>)}
  </Fragment>)}</>;
}
const ROLE_NAME = { admin: "Admin", host: "Host", restaurant: "Restaurant" } as const;

export function StaffSidebar({ role = "admin", active }: Readonly<{ role?: StaffRole; active?: StaffNavKey }>) {
  return <aside className="product-sidebar" aria-label={`${ROLE_NAME[role]} navigation`}><Links role={role} active={active} /></aside>;
}

// Phone navigation: a Menu button in the top bar that opens the same grouped links in a drawer (shown below 820px).
export function StaffMenu({ role, active }: Readonly<{ role: StaffRole; active?: StaffNavKey }>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return <>
    <button className="menu-button" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"><Menu aria-hidden="true" />Menu</button>
    <dialog ref={ref} className="nav-drawer" aria-label={`${ROLE_NAME[role]} navigation`} onClose={() => setOpen(false)} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="nav-drawer-head"><strong>Menu</strong><button className="icon-action" type="button" onClick={() => setOpen(false)} aria-label="Close menu"><X aria-hidden="true" /></button></div>
      <nav className="nav-drawer-links"><Links role={role} active={active} /></nav>
    </dialog>
  </>;
}
