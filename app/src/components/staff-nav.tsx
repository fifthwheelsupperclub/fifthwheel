import { ShieldCheck } from "lucide-react";
import { Fragment, type ReactNode } from "react";

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
  ["GUESTS", [["waitlist", "/admin/waitlist", "Waitlist"], ["identity-review", "/admin/identity-review", "Identity review"], ["seat-requests", "/admin/seat-requests", "Seat requests"]]],
  ["TABLES", [["tables", "/admin/tables", "Tables"], ["decisions", "/admin/table-decisions", "Table decisions"], ["assignments", "/admin/staff-assignments", "Staff assignments"]]],
  ["MONEY", [["cancellations", "/admin/cancellations", "Cancellations"], ["refunds", "/admin/refunds", "Refunds"]]],
  ["MESSAGES", [["emails", "/admin/notices", "Guest emails"], ["invitations", "/admin/table-invitations", "Table invitation delivery"]]],
  ["SAFETY", [["reports", "/admin/conduct-reports", "Conduct reports"]]],
];
const OTHER_GROUPS: Record<"host" | "restaurant", ReadonlyArray<readonly [string | null, readonly Item[]]>> = {
  host: [[null, [["host-tables", "/host/assigned-tables", "Assigned tables"]]]],
  restaurant: [[null, [["restaurant", "/restaurant", "Service times"]]]],
};
const WORKSPACE_LABEL = { admin: "ADMIN WORKSPACE", host: "HOST WORKSPACE", restaurant: "RESTAURANT WORKSPACE" } as const;

export type StaffRole = keyof typeof WORKSPACE_LABEL;
export const staffWorkspaceLabel = (role: StaffRole) => WORKSPACE_LABEL[role];

export function StaffSidebar({ role = "admin", active, foot, footIcon }: Readonly<{ role?: StaffRole; active?: StaffNavKey; foot?: ReactNode; footIcon?: ReactNode }>) {
  const groups = role === "admin" ? ADMIN_GROUPS : OTHER_GROUPS[role];
  return <aside className="product-sidebar" aria-label={`${role === "admin" ? "Admin" : role === "host" ? "Host" : "Restaurant"} navigation`}>
    <p className="sidebar-caption">WORKSPACE</p>
    {groups.map(([group, items]) => <Fragment key={group ?? "top"}>
      {group && <p className="group-label">{group}</p>}
      {items.map(([key, href, label]) => <a key={key} className={`member-nav-link${key === active ? " active" : ""}`} href={href} aria-current={key === active ? "page" : undefined}>{label}</a>)}
    </Fragment>)}
    {foot && <div className="product-sidebar-foot">{footIcon ?? <ShieldCheck aria-hidden="true" />}<span>{foot}</span></div>}
  </aside>;
}
