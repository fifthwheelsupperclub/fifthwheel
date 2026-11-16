import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";

export const Route = createFileRoute("/")({ component: EntryRoute });

type Workspace = Readonly<{ key: "member" | "admin" | "host" | "restaurant"; available: boolean }>;
type EntryState = "loading" | "error" | "no-access" | "choose";
const workspaceLabels = {
  member: { label: "Your tables", href: "/member", description: "Profile, requests and seats." },
  admin: { label: "Admin", href: "/admin", description: "Waitlist, tables, payments and guests." },
  host: { label: "Host", href: "/host/assigned-tables", description: "Tables you’re hosting." },
  restaurant: { label: "Restaurant", href: "/restaurant", description: "Upcoming service times." },
} as const;

function EntryRoute() {
  const [state, setState] = useState<EntryState>("loading");
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/workspaces", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } })
      .then((response) => {
        if (!active) return;
        if (response.status === 401) { window.location.replace("/sign-in"); return; }
        if (response.status === 403) { setState("no-access"); return; }
        if (!response.ok) throw new Error("workspace_lookup_failed");
        return response.json().then((body: unknown) => {
          if (!active) return;
          if (typeof body !== "object" || body === null || !("workspaces" in body) || !Array.isArray(body.workspaces)) throw new Error("workspace_data_invalid");
          const valid = body.workspaces.filter((item): item is Workspace => typeof item === "object" && item !== null
            && "key" in item && (item.key === "member" || item.key === "admin" || item.key === "host" || item.key === "restaurant")
            && "available" in item && typeof item.available === "boolean");
          if (valid.length === 0 || valid.length !== body.workspaces.length) throw new Error("workspace_data_invalid");
          if (valid.length === 1 && valid[0].available) {
            window.location.replace(workspaceLabels[valid[0].key].href);
            return;
          }
          setWorkspaces(valid);
          setState("choose");
        });
      })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, []);

  if (state === "loading") return <main className="entry-loading" role="status" aria-live="polite"><span className="entry-loader" aria-hidden="true" /><p>Loading…</p></main>;

  if (state === "choose") return <main className="system-state-page workspace-entry-page" aria-labelledby="workspace-entry-title">
    <section className="system-state-card workspace-entry-card">
      <span className="system-state-icon" aria-hidden="true"><ShieldCheck /></span>
      <p className="eyebrow">FIFTH WHEEL</p>
      <h1 id="workspace-entry-title">Where to?</h1>
      <div className="workspace-choice-list">{workspaces.filter((workspace) => workspace.available).map((workspace) => {
        const details = workspaceLabels[workspace.key];
        return <a className="workspace-choice" key={workspace.key} href={details.href}><span className="workspace-choice-icon">{workspace.key === "admin" ? <ShieldCheck aria-hidden="true" /> : <UsersRound aria-hidden="true" />}</span><span><strong>{details.label}</strong><small>{details.description}</small></span><ArrowRight aria-hidden="true" /></a>;
      })}</div>
    </section>
  </main>;

  if (state === "no-access") return <main className="system-state-page" aria-labelledby="entry-error-title">
    <section className="system-state-card">
      <span className="system-state-icon" aria-hidden="true"><CircleAlert /></span>
      <p className="eyebrow">FIFTH WHEEL</p>
      <h1 id="entry-error-title">You don’t have access yet.</h1>
      <p className="system-state-message" role="status">If you joined the waitlist, we’ll email you when you’re in. Signed up with a different email? Sign in with that one.</p>
      <div className="system-state-actions"><a className="button button-primary" href="/sign-in">Back to sign in</a></div>
    </section>
  </main>;

  return <main className="system-state-page" aria-labelledby="entry-error-title">
    <section className="system-state-card">
      <span className="system-state-icon" aria-hidden="true"><CircleAlert /></span>
      <p className="eyebrow">FIFTH WHEEL</p>
      <h1 id="entry-error-title">We couldn’t load your account.</h1>
      <p className="system-state-message" role="alert">Check your connection and try again.</p>
      <div className="system-state-actions"><button className="button button-primary" type="button" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" />Try again</button><a className="button button-tertiary" href="/sign-in">Sign in with a different email</a></div>
    </section>
  </main>;
}
