import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { AppShell } from "../components/app-shell";
import { buttonClass } from "../components/ui/button";
import { PageHeader } from "../components/ui/page-header";
import { PageState } from "../components/ui/page-state";
import { StatusBadge } from "../components/ui/status-badge";
import { eventWhen } from "../format/datetime";

export const Route = createFileRoute("/member")({ component: MemberHomePage });

type HomeState = "loading" | "ready" | "unauthenticated" | "forbidden" | "error";
type ProfileStatus = "draft" | "submitted" | "approved" | "resubmission_required";
type Invite = Readonly<{ invitationId: string; title: string; when: string; neighborhood: string }>;
type Evening = Readonly<{ seatId: string; title: string; when: string; neighborhood: string; startsAt: string }>;
// null = that source failed to load. Home then skips what depends on it and never guesses.
type Extra = Readonly<{ profile: { status: ProfileStatus; firstName: string } | null; invite: Invite | null | undefined; evenings: Evening[] | null }>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
const dataOf = (body: unknown) => (isRecord(body) && isRecord(body.data) ? body.data : null);

async function loadExtra(signal: AbortSignal): Promise<Extra> {
  const [p, r, s] = await Promise.all([getJson("/api/member/profile", signal), getJson("/api/me/requests?limit=20", signal), getJson("/api/me/seats?limit=20", signal)]);
  const pd = dataOf(p) ?? (isRecord(p) && typeof p.identityStatus === "string" ? p : null);
  const status = pd ? str(pd.identityStatus) : "";
  const profile = pd && ["draft", "submitted", "approved", "resubmission_required"].includes(status) ? { status: status as ProfileStatus, firstName: str(pd.firstName) } : null;

  const rd = dataOf(r);
  let invite: Invite | null | undefined = undefined;
  if (rd && Array.isArray(rd.items)) {
    invite = null;
    for (const item of rd.items) {
      if (!isRecord(item) || !isRecord(item.tableInvitation) || item.tableInvitation.state !== "active" || !isRecord(item.table)) continue;
      invite = { invitationId: str(item.tableInvitation.invitationId), title: str(item.table.title), when: eventWhen(str(item.table.localDate), str(item.table.startLocalTime)), neighborhood: str(item.table.neighborhood) };
      break;
    }
  }

  const sd = dataOf(s);
  let evenings: Evening[] | null = null;
  if (sd && Array.isArray(sd.items)) {
    evenings = sd.items.flatMap((item): Evening[] => {
      if (!isRecord(item) || item.participationState !== "current" || (item.state !== "confirmed" && item.state !== "cancellation_requested") || !isRecord(item.table)) return [];
      return [{ seatId: str(item.seatId), title: str(item.table.title), when: eventWhen(str(item.table.localDate), str(item.table.startLocalTime)), neighborhood: str(item.table.neighborhood), startsAt: str(item.table.startsAt) }];
    }).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return { profile, invite, evenings };
}

type Step = Readonly<{ title: string; text: string; action?: { href: string; label: string } }>;
// Order: open invitation, profile changes, profile incomplete, profile in review, next evening, find a table.
function nextStep(x: Extra): Step | null {
  if (x.invite) return { title: `You’re invited to ${x.invite.title}`, text: `${x.invite.when} · ${x.invite.neighborhood}. Pay to confirm your seat.`, action: { href: `/invitations/${encodeURIComponent(x.invite.invitationId)}`, label: "Review invitation" } };
  if (x.profile?.status === "resubmission_required") return { title: "Update your profile", text: "We need a change before we can approve it.", action: { href: "/account/profile", label: "Open profile" } };
  if (x.profile?.status === "draft") return { title: "Complete your profile", text: "Add a few details and two photos so we can seat you well.", action: { href: "/account/profile", label: "Open profile" } };
  if (x.profile?.status === "submitted") return { title: "We’re reviewing your profile", text: "We’ll let you know when it’s approved." };
  const next = x.evenings?.[0];
  if (next) return { title: `Your next evening: ${next.title}`, text: `${next.when} · ${next.neighborhood}`, action: { href: `/my-seats/${encodeURIComponent(next.seatId)}`, label: "View seat" } };
  if (x.profile?.status === "approved") return { title: "Find a table", text: "Browse upcoming evenings and request a seat.", action: { href: "/tables", label: "Browse tables" } };
  return null;
}

function MemberHomePage() {
  const [state, setState] = useState<HomeState>("loading");
  const [email, setEmail] = useState("");
  const [extra, setExtra] = useState<Extra | null>(null);

  async function load(signal?: AbortSignal) {
    const controller = new AbortController();
    const s = signal ?? controller.signal;
    setState("loading");
    try {
      const response = await fetch("/api/member/home", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal: s });
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      if (!response.ok) throw new Error("member_home_unavailable");
      const body: unknown = await response.json();
      if (!isRecord(body) || !isRecord(body.member) || typeof body.member.email !== "string" || body.member.admissionState !== "activated") throw new Error("member_home_invalid");
      setEmail(body.member.email);
      setState("ready");
      setExtra(await loadExtra(s));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const step = extra ? nextStep(extra) : null;
  const evenings = extra?.evenings ?? null;
  const rows: ReadonlyArray<Readonly<{ key: string; href: string; title: string; meta: string; badge: "Invited" | "Confirmed" }>> = extra ? [
    ...(extra.invite ? [{ key: `i-${extra.invite.invitationId}`, href: `/invitations/${encodeURIComponent(extra.invite.invitationId)}`, title: extra.invite.title, meta: `${extra.invite.when} · ${extra.invite.neighborhood}`, badge: "Invited" as const }] : []),
    ...(evenings ?? []).slice(0, 3).map((e) => ({ key: e.seatId, href: `/my-seats/${encodeURIComponent(e.seatId)}`, title: e.title, meta: `${e.when} · ${e.neighborhood}`, badge: "Confirmed" as const })),
  ].slice(0, 3) : [];
  const firstName = extra?.profile?.firstName.trim();

  return <AppShell role="guest" active="home" contentClassName="member-home-content" labelledBy="member-home-heading">
    {state === "loading" && <PageState variant="loading" title="Loading…" />}
    {state === "unauthenticated" && <PageState variant="signed-out" title="Sign in to continue" message="Sign in with the email you used to join." action={<a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "forbidden" && <PageState variant="no-access" title="You don’t have access yet" message="If you’re on the waitlist, we’ll email you when you’re in." action={<a className="button button-outline" href="/sign-in">Return to sign in<ArrowRight aria-hidden="true" /></a>} />}
    {state === "error" && <PageState variant="error" title="Your home is unavailable" message="We couldn’t load your account. Try again shortly." action={<button className="button button-outline" type="button" onClick={() => void load()}>Try again<ArrowRight aria-hidden="true" /></button>} />}
    {state === "ready" && <>
      <PageHeader titleId="member-home-heading" title={firstName ? `Welcome back, ${firstName}.` : "Welcome back."} />
      {extra === null && <PageState variant="loading" title="Loading…" />}
      {extra !== null && <>
        {step && <section className="home-next-step" aria-label="Your next step">
          <div><h2>{step.title}</h2><p>{step.text}</p></div>
          {step.action && <a className={buttonClass("primary")} href={step.action.href}>{step.action.label}<ArrowRight aria-hidden="true" /></a>}
        </section>}
        {evenings !== null && extra.invite !== undefined && <section className="home-evenings" aria-labelledby="home-evenings-title">
          <h2 id="home-evenings-title">Your evenings</h2>
          {rows.length === 0
            ? <PageState variant="empty" title="No evenings yet" message="Browse tables and request a seat at any that suit you." action={<a className={buttonClass("secondary")} href="/tables">Browse tables</a>} />
            : <ul className="home-evening-list">{rows.map((r) => <li key={r.key}><a href={r.href}><span><strong>{r.title}</strong><small>{r.meta}</small></span><StatusBadge tone={r.badge === "Invited" ? "pending" : "success"}>{r.badge}</StatusBadge></a></li>)}</ul>}
        </section>}
        {!step && evenings === null && extra.invite === undefined && <p className="home-links"><a href="/tables">Tables</a> · <a href="/requests">Requests</a> · <a href="/my-seats">My Seats</a></p>}
      </>}
    </>}
  </AppShell>;
}
