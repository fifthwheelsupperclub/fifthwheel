import { UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { GuestSidebar, type GuestNavKey } from "./guest-nav";
import { SignOutButton } from "./sign-out-button";
import { StaffSidebar, type StaffNavKey, type StaffRole } from "./staff-nav";

// The one signed-in page frame: skip link, top bar, navigation and the single <main> landmark.
// Every signed-in route renders through this; do not hand-roll a top bar or sidebar elsewhere.
type Props = Readonly<{
  children: ReactNode;
  /** Page-specific classes kept so existing feature CSS keeps applying. */
  className?: string;
  contentClassName?: string;
  labelledBy?: string;
}> & (
  | Readonly<{ role: "guest"; active?: GuestNavKey; accountActive?: boolean }>
  | Readonly<{ role: StaffRole; active?: StaffNavKey; accountActive?: never }>
);

const HOME = { guest: "/member", admin: "/admin", host: "/host/assigned-tables", restaurant: "/restaurant" } as const;

export function AppShell(props: Props) {
  const { role, children, className, contentClassName, labelledBy } = props;
  return <div className={`product-page${className ? ` ${className}` : ""}`}>
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="product-topbar">
      <a className="brand" href={HOME[role]} aria-label="Fifth Wheel home"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions">
        {role === "guest" && <a className={`account-action${props.accountActive ? " account-action-active" : ""}`} href="/account/profile" aria-current={props.accountActive ? "page" : undefined}><UserRound aria-hidden="true" />Account</a>}
        <SignOutButton />
      </div>
    </header>
    <div className="product-layout">
      {role === "guest" ? <GuestSidebar active={props.active} /> : <StaffSidebar role={role} active={props.active} />}
      <main id="content" className={`product-content${contentClassName ? ` ${contentClassName}` : ""}`} aria-labelledby={labelledBy}>{children}</main>
    </div>
  </div>;
}
