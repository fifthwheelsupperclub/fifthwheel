import { CircleAlert, CircleCheck, Clock3, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

// One status per object per view. Tone + icon + text, so state is never color-only.
export type BadgeTone = "neutral" | "pending" | "success" | "warning" | "danger";
const ICON: Record<BadgeTone, typeof Info> = { neutral: Info, pending: Clock3, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

export function StatusBadge({ tone = "neutral", children, icon }: Readonly<{ tone?: BadgeTone; children: ReactNode; icon?: ReactNode }>) {
  const Icon = ICON[tone];
  return <span className={`badge badge-${tone}`}>{icon ?? <Icon aria-hidden="true" />}{children}</span>;
}
