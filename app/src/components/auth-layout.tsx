import type { ReactNode } from "react";
import { LegalFooter } from "./legal-footer";

// Shared frame for sign-in and the sign-in link page: brand panel on the left (a short headline on phones), card on the right.
export function AuthLayout({ className, eyebrow, headline, lead, children }: Readonly<{ className?: string; eyebrow: string; headline: ReactNode; lead: string; children: ReactNode }>) {
  return <main className={`auth-page${className ? ` ${className}` : ""}`}>
    <section className="auth-story" aria-label="Fifth Wheel">
      <a className="brand" href="/" aria-label="Fifth Wheel home">
        <span className="brand-mark">FW</span>
        <span className="brand-name">fifth wheel<span className="brand-period">.</span></span>
      </a>
      <div className="auth-story-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{headline}</h1>
        <p>{lead}</p>
      </div>
    </section>
    <section className="auth-card-wrap">{children}<LegalFooter /></section>
  </main>;
}
