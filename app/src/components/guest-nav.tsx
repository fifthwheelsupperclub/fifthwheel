import { BadgeCheck, ClipboardList, House, Table2 } from "lucide-react";
import type { ReactNode } from "react";

// One sidebar for every signed-in guest screen. Add or rename a nav item here, nowhere else.
export type GuestNavKey = "home" | "tables" | "requests" | "seats";
const ITEMS: ReadonlyArray<readonly [GuestNavKey, string, string, typeof House]> = [
  ["home", "/member", "Home", House],
  ["tables", "/tables", "Tables", Table2],
  ["requests", "/requests", "Requests", ClipboardList],
  ["seats", "/my-seats", "My Seats", BadgeCheck],
];

export function GuestSidebar({ active, foot }: Readonly<{ active?: GuestNavKey; foot: ReactNode }>) {
  return <aside className="product-sidebar member-product-sidebar" aria-label="Member navigation">
    <p className="sidebar-caption">YOUR EVENINGS</p>
    {ITEMS.map(([key, href, label, Icon]) => <a key={key} className={`member-nav-link${key === active ? " active" : ""}`} href={href} aria-current={key === active ? "page" : undefined}><Icon aria-hidden="true" />{label}</a>)}
    <div className="product-sidebar-foot">{foot}</div>
  </aside>;
}
