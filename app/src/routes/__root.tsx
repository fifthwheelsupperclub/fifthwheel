import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, CircleAlert, House, RotateCcw } from "lucide-react";
import css from "../styles.css?url";
import componentsCss from "../styles/components.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Fifth Wheel · A seat at the table" },
      { name: "description", content: "A thoughtful Atlanta dining community." },
    ],
    links: [
      { rel: "stylesheet", href: css },
      // Loaded after styles.css so shared components win ties with legacy page rules.
      { rel: "stylesheet", href: componentsCss },
      { rel: "preload", href: "/fonts/fraunces-roman-latin.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
      { rel: "preload", href: "/fonts/inter-latin.woff2", as: "font", type: "font/woff2", crossOrigin: "anonymous" },
    ],
  }),
  component: Root,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteErrorPage,
});

function Root() {
  return <Document><Outlet /></Document>;
}

function Document({ children }: { children: ReactNode }) {
  return <html lang="en"><head><HeadContent /></head><body>{children}<Scripts /></body></html>;
}

function NotFoundPage() {
  return <SystemStatePage
    kind="not-found"
    icon={ArrowLeft}
    title="This page isn’t here."
    message="This link may be old or mistyped."
  />;
}

function RouteErrorPage({ reset }: { reset: () => void }) {
  return <SystemStatePage
    kind="error"
    icon={CircleAlert}
    title="We couldn’t load this page."
    message="Something went wrong on our end. Try again, or go to the home page."
    onRetry={reset}
  />;
}

function SystemStatePage({
  kind,
  icon: Icon,
  title,
  message,
  onRetry,
}: {
  kind: "error" | "not-found";
  icon: typeof CircleAlert;
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    pageRef.current?.focus();
  }, []);

  return <main
    ref={pageRef}
    className={`system-state-page system-state-${kind}`}
    tabIndex={-1}
    aria-labelledby="system-state-title"
  >
    <div className="system-state-card">
      <span className="system-state-icon" aria-hidden="true"><Icon /></span>
      <h1 id="system-state-title">{title}</h1>
      <p className="system-state-message" role={kind === "error" ? "alert" : undefined}>{message}</p>
      <div className="system-state-actions">
        {onRetry && <button className="button button-outline" type="button" onClick={onRetry}><RotateCcw aria-hidden="true" />Try again</button>}
        <Link className="button button-primary" to="/"><House aria-hidden="true" />Go to home</Link>
      </div>
    <p className="system-state-footnote">FIFTH WHEEL · ATLANTA</p>
    </div>
  </main>;
}
