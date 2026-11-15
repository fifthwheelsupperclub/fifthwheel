import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// variant: primary (one per view region) · secondary (outline) · tertiary (text) · danger (destructive).
type Variant = "primary" | "secondary" | "tertiary" | "danger";
const CLASS: Record<Variant, string> = {
  primary: "button button-primary",
  secondary: "button button-outline",
  tertiary: "button button-tertiary",
  danger: "button button-danger",
};

export function buttonClass(variant: Variant = "secondary", extra?: string) {
  return extra ? `${CLASS[variant]} ${extra}` : CLASS[variant];
}

export function Button({ variant = "secondary", loading, icon, children, className, disabled, type = "button", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  return <button {...rest} type={type} className={buttonClass(variant, className)} disabled={disabled || loading} aria-busy={loading || undefined}>
    {loading ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : icon}{children}
  </button>;
}
