import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";

export const Route = createFileRoute("/")({ component: EntryRoute });

type Workspace = Readonly<{ key: "member" | "admin" | "host" | "restaurant"; available: boolean }>;
type EntryState = "loading" | "error" | "no-access" | "choose";
const workspaceLabels = {
  member: { label: "Member", href: "/member", description: "Your profile, requests and Seats." },
  admin: { label: "Admin", href: "/admin/waitlist", description: "Waitlist admission and staff operations." },
  host: { label: "Host", href: "/host/assigned-tables", description: "Your assigned Table operations." },
  restaurant: { label: "Restaurant", href: "/restaurant", description: "Your assigned venue service view." },
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

  if (state === "loading") return <main className="entry-loading" role="status" aria-live="polite"><span className="entry-loader" aria-hidden="true" /><p>Checking your Fifth Wheel access…</p></main>;

  if (state === "choose") return <main className="system-state-page workspace-entry-page" aria-labelledby="workspace-entry-title">
    <section className="system-state-card workspace-entry-card">
      <span className="system-state-icon" aria-hidden="true"><ShieldCheck /></span>
      <p className="eyebrow">FIFTH WHEEL</p>
      <h1 id="workspace-entry-title">Choose your workspace.</h1>
      <p className="system-state-message">Only workspaces authorized for your account are shown.</p>
      <div className="workspace-choice-list">{workspaces.map((workspace) => {
        const details = workspaceLabels[workspace.key];
        return workspace.available
          ? <a className="workspace-choice" key={workspace.key} href={details.href}><span className="workspace-choice-icon">{workspace.key === "admin" ? <ShieldCheck aria-hidden="true" /> : <UsersRound aria-hidden="true" />}</span><span><strong>{details.label}</strong><small>{details.description}</small></span><ArrowRight aria-hidden="true" /></a>
          : <div className="workspace-choice workspace-choice-disabled" key={workspace.key} aria-disabled="true"><span className="workspace-choice-icon"><UsersRound aria-hidden="true" /></span><span><strong>{details.label}</strong><small>{details.description} This workspace is not available yet.</small></span></div>;
      })}</div>
    </section>
  </main>;

  if (state === "no-access") return <main className="system-state-page" aria-labelledby="entry-error-title">
    <section className="system-state-card">
      <span className="system-state-icon" aria-hidden="true"><CircleAlert /></span>
      <p className="eyebrow">FIFTH WHEEL</p>
      <h1 id="entry-error-title">No workspace is available.</h1>
      <p className="system-state-message" role="status">This account does not currently have app admission or a staff role.</p>
      <div className="system-state-actions"><a className="button button-primary" href="/sign-in">Return to sign in</a></div>
    </section>
  </main>;

  return <main className="system-state-page" aria-labelledby="entry-error-title">
    <section className="system-state-card">
      <span className="system-state-icon" aria-hidden="true"><CircleAlert /></span>
      <p className="eyebrow">FIFTH WHEEL</p>
      <h1 id="entry-error-title">We couldn’t check your account.</h1>
      <p className="system-state-message" role="alert">Try again, or go to member sign in.</p>
      <div className="system-state-actions"><button className="button button-outline" type="button" onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" />Try again</button><a className="button button-primary" href="/sign-in">Go to sign in</a></div>
    </section>
  </main>;
}
