import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
import "./member-tables-workspace.css";

export function MemberWorkspaceShell({ active, children }: { active: "home" | "seats"; children: ReactNode }) {
  return <AppShell role="guest" active={active} className="member-tables-page" contentClassName="member-tables-content">{children}</AppShell>;
}
