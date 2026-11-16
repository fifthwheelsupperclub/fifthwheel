import { CircleAlert } from "lucide-react";
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

// Label, control, hint and error wired together. Pass exactly one control (input, select, textarea) as child.
export function Field({ label, hint, error, children, className }: Readonly<{ label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactElement; className?: string }>) {
  const id = useId(); const hintId = `${id}-hint`; const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })
    : children;
  return <div className={`field${className ? ` ${className}` : ""}`}>
    <label htmlFor={id}>{label}</label>
    {control}
    {hint && <small id={hintId} className="field-hint">{hint}</small>}
    {error && <small id={errorId} className="field-error" role="alert"><CircleAlert aria-hidden="true" />{error}</small>}
  </div>;
}

// Announced list at the top of a form with more than a few fields; each item links to its field id.
export function ErrorSummary({ errors }: Readonly<{ errors: ReadonlyArray<Readonly<{ id: string; message: string }>> }>) {
  if (errors.length === 0) return null;
  return <div className="error-summary" role="alert"><strong>Fix {errors.length === 1 ? "this" : "these"} to continue</strong>
    <ul>{errors.map((e) => <li key={e.id}><a href={`#${e.id}`}>{e.message}</a></li>)}</ul></div>;
}
