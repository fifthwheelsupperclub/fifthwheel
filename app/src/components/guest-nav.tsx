import { BadgeCheck, ClipboardList, House, Table2 } from "lucide-react";

// One sidebar for every signed-in guest screen. Add or rename a nav item here, nowhere else.
export type GuestNavKey = "home" | "tables" | "requests" | "seats";
const ITEMS: ReadonlyArray<readonly [GuestNavKey, string, string, typeof House]> = [
  ["home", "/member", "Home", House],
  ["tables", "/tables", "Tables", Table2],
  ["requests", "/requests", "Requests", ClipboardList],
  ["seats", "/my-seats", "My Seats", BadgeCheck],
];

export function GuestSidebar({ active }: Readonly<{ active?: GuestNavKey }>) {
  return <aside className="product-sidebar member-product-sidebar" aria-label="Member navigation">
    {ITEMS.map(([key, href, label, Icon]) => <a key={key} className={`member-nav-link${key === active ? " active" : ""}`} href={href} aria-current={key === active ? "page" : undefined}><Icon aria-hidden="true" />{label}</a>)}
  </aside>;
}

// Phone navigation: fixed bottom tab bar (the sidebar is hidden below 820px).
export function GuestTabs({ active }: Readonly<{ active?: GuestNavKey }>) {
  return <nav className="bottom-tabs" aria-label="Member navigation (mobile)">
    {ITEMS.map(([key, href, label, Icon]) => <a key={key} className={key === active ? "active" : undefined} href={href} aria-current={key === active ? "page" : undefined}><Icon aria-hidden="true" /><span>{label}</span></a>)}
  </nav>;
}
