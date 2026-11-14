import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, CircleAlert, House, RotateCcw } from "lucide-react";
import css from "../styles.css?url";

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
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@400;500;600;700&display=swap",
      },
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
    label="PAGE NOT FOUND"
    title="This page isn’t here."
    message="The address may have changed. Return to Fifth Wheel home to continue."
  />;
}

function RouteErrorPage({ reset }: { reset: () => void }) {
  return <SystemStatePage
    kind="error"
    icon={CircleAlert}
    label="PAGE ERROR"
    title="We couldn’t load this page."
    message="Something unexpected interrupted this page. Try again, or return to the preview home."
    onRetry={reset}
  />;
}

function SystemStatePage({
  kind,
  icon: Icon,
  label,
  title,
  message,
  onRetry,
}: {
  kind: "error" | "not-found";
  icon: typeof CircleAlert;
  label: string;
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
      <p className="eyebrow">{label}</p>
      <h1 id="system-state-title">{title}</h1>
      <p className="system-state-message" role={kind === "error" ? "alert" : undefined}>{message}</p>
      <div className="system-state-actions">
        {onRetry && <button className="button button-outline" type="button" onClick={onRetry}><RotateCcw aria-hidden="true" />Try again</button>}
        <Link className="button button-primary" to="/"><House aria-hidden="true" />Return to preview home</Link>
      </div>
    <p className="system-state-footnote">FIFTH WHEEL · ATLANTA</p>
    </div>
  </main>;
}
