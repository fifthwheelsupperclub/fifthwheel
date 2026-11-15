import { createFileRoute } from "@tanstack/react-router";
import { GuestSidebar } from "../components/guest-nav";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, ClipboardList, House, Table2, Ticket, UserRound } from "lucide-react";
import { SignOutButton } from "../components/sign-out-button.tsx";

export const Route = createFileRoute("/member")({ component: MemberHomePage });

type MemberHomeState = "loading" | "ready" | "unauthenticated" | "forbidden" | "error";
type MemberHomeData = Readonly<{ member: Readonly<{ email: string; admissionState: "activated" }> }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function MemberHomePage() {
  const [state, setState] = useState<MemberHomeState>("loading");
  const [member, setMember] = useState<MemberHomeData["member"] | null>(null);

  async function loadHome(signal?: AbortSignal) {
    setState("loading");
    try {
      const response = await fetch("/api/member/home", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (response.status === 401) { setState("unauthenticated"); setMember(null); return; }
      if (response.status === 403) { setState("forbidden"); setMember(null); return; }
      if (!response.ok) throw new Error("member_home_unavailable");
      const body: unknown = await response.json();
      if (!isRecord(body) || !isRecord(body.member) || typeof body.member.email !== "string" || body.member.admissionState !== "activated") {
        throw new Error("member_home_invalid");
      }
      setMember({ email: body.member.email, admissionState: "activated" });
      setState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error");
      setMember(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadHome(controller.signal);
    return () => controller.abort();
  }, []);

  return <main className="product-page">
    <header className="product-topbar">
      <a className="brand" href="/member" aria-label="Fifth Wheel member home"><span className="brand-mark">FW</span><span className="brand-name">fifth wheel<span className="brand-period">.</span></span></a>
      <div className="product-topbar-actions"><span className="product-workspace-label">MEMBER WORKSPACE</span><a className="account-action" href="/account/profile"><UserRound aria-hidden="true" />Account</a><SignOutButton /></div>
    </header>
    <div className="product-layout">
      <GuestSidebar active="home" foot="Your admission is separate from Table invitations and payment." />

      <section className="product-content member-home-content" aria-labelledby="member-home-heading">
        <div className="product-breadcrumb">Member <span>/</span> Home</div>
        {state === "loading" && <section className="data-state" role="status" aria-live="polite"><span className="data-state-icon"><span className="entry-loader small" /></span><h2>Loading…</h2></section>}
        {state === "unauthenticated" && <section className="data-state data-state-error"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Sign in to continue</h2><p>Use the email address connected to your app invitation.</p><a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a></section>}
        {state === "forbidden" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>You don’t have access yet</h2><p>If you’re on the waitlist, we’ll email you when you’re in.</p><a className="button button-outline" href="/sign-in">Return to sign in<ArrowRight aria-hidden="true" /></a></section>}
        {state === "error" && <section className="data-state data-state-error" role="alert"><span className="data-state-icon"><CircleAlert aria-hidden="true" /></span><h2>Your home is unavailable</h2><p>We couldn’t verify your member access. Try again shortly.</p><button className="button button-outline" type="button" onClick={() => void loadHome()}>Try again<ArrowRight aria-hidden="true" /></button></section>}
        {state === "ready" && member && <>
          <div className="page-heading-row member-home-heading"><div><p className="eyebrow">YOUR FIFTH WHEEL</p><h1 id="member-home-heading">A lovely evening<br /><em>takes shape here.</em></h1><p className="page-intro">Signed in as <strong>{member.email}</strong>.</p></div></div>
        <section className="member-next-step">
            <span className="auth-icon"><UserRound aria-hidden="true" /></span>
            <div><p className="eyebrow">YOUR NEXT STEP</p><h2>Complete your profile</h2><p>Add your details and private review evidence. Profile review is separate from app access and Table invitations.</p></div>
            <a className="button button-primary" href="/account/profile">Open profile<ArrowRight aria-hidden="true" /></a>
          </section>
          <section className="member-home-empty"><span className="data-state-icon"><Table2 aria-hidden="true" /></span><h2>Your Tables will appear here</h2><p>Table invitations and Seats are separate from app access. Nothing is shown until it exists on your account.</p></section>
        </>}
      </section>
    </div>
  </main>;
}
