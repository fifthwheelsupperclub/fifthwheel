import { CircleAlert, Inbox, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

// loading / empty / error / signed-out / no-access share one look. Errors say what is still safe in `message`.
type Variant = "loading" | "empty" | "error" | "signed-out" | "no-access";
const ICON = { loading: LoaderCircle, empty: Inbox, error: CircleAlert, "signed-out": CircleAlert, "no-access": ShieldAlert } as const;

export function PageState({ variant, title, message, action, icon, className }: Readonly<{
  variant: Variant;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}>) {
  const Icon = ICON[variant];
  const tone = variant === "error" || variant === "signed-out" || variant === "no-access" ? " page-state-error" : "";
  return <section className={`page-state${tone}${className ? ` ${className}` : ""}`} role={variant === "loading" ? "status" : variant === "error" ? "alert" : undefined} aria-live={variant === "loading" ? "polite" : undefined}>
    <span className="page-state-icon">{icon ?? <Icon className={variant === "loading" ? "is-spinning" : undefined} aria-hidden="true" />}</span>
    <h2>{title}</h2>
    {message && <p>{message}</p>}
    {action && <div className="page-state-action">{action}</div>}
  </section>;
}
