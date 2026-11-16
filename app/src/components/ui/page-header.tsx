import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

// The one page title block. Back link on detail pages only; eyebrow only when it adds information.
export function PageHeader({ title, titleId, description, eyebrow, back, status, actions, className }: Readonly<{
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  back?: Readonly<{ href: string; label: string }>;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>) {
  return <header className={`page-header page-heading-row${className ? ` ${className}` : ""}`}>
    <div className="page-header-main">
      {back && <a className="page-header-back" href={back.href}><ArrowLeft aria-hidden="true" />{back.label}</a>}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 id={titleId}>{title}</h1>
      {description && <p className="page-intro">{description}</p>}
    </div>
    {(status || actions) && <div className="page-header-aside">{status}{actions}</div>}
  </header>;
}
