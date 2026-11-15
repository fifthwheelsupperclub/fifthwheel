import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CircleAlert, Mail, ShieldCheck } from "lucide-react";

function validateSearch(search: Record<string, unknown>) {
  return {
    signout: search.signout === "uncertain" ? "uncertain" as const : undefined,
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  };
}

const memberReturnToPattern = /^\/(?:tables(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?|requests|my-seats(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/cancellation)?)?|invitations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const Route = createFileRoute("/sign-in")({ validateSearch, component: SignInPage });

type RequestLinkState = "idle" | "sending" | "accepted" | "error";

function SignInPage() {
  const search = Route.useSearch();
  const signedOutUncertain = search.signout === "uncertain";
  const returnTo = search.returnTo && memberReturnToPattern.test(search.returnTo) ? search.returnTo : "/member";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<RequestLinkState>("idle");
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    setClientReady(true);
  }, []);

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientReady || state === "sending") return;
    setState("sending");
    try {
      const response = await fetch("/api/auth/request-link", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), safeReturnTo: returnTo }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (response.ok && typeof result === "object" && result !== null && "accepted" in result && result.accepted === true) {
        setState("accepted");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  return <main className="auth-page">
    <section className="auth-story" aria-label="Fifth Wheel">
      <a className="brand" href="/" aria-label="Fifth Wheel home">
        <span className="brand-mark">FW</span>
        <span className="brand-name">fifth wheel<span className="brand-period">.</span></span>
      </a>
      <div className="auth-story-copy">
        <p className="eyebrow">Atlanta, around the table</p>
        <h1>Good nights<br />start <em>with hello.</em></h1>
        <p>Sign in to see your tables.</p>
      </div>
    </section>

    <section className="auth-card-wrap">
      <div className="auth-card">
        <span className="auth-icon"><Mail aria-hidden="true" /></span>
        <p className="eyebrow">SIGN IN</p>
        <h2>Welcome back.</h2>
        <p className="auth-intro">Enter the email you used to join the waitlist. If you have access, we’ll send you a sign-in link.</p>
        {returnTo !== "/member" && <p className="auth-boundary">We’ll bring you back to this page after you sign in.</p>}
        {signedOutUncertain && <div className="auth-feedback auth-feedback-error" role="status"><CircleAlert aria-hidden="true" /><span><strong>Your saved sign-in was cleared.</strong><small>We couldn’t confirm that sign-out finished on our server. You can still request a new link.</small></span></div>}
        <form onSubmit={requestLink} data-client-ready={clientReady ? "true" : "false"}>
          <label htmlFor="sign-in-email">Email address</label>
          <input
            autoComplete="email"
            id="sign-in-email"
            name="email"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => { setEmail(event.currentTarget.value); if (state !== "sending") setState("idle"); }}
            placeholder="you@example.com"
          />
          <button className="button button-primary auth-submit" type="submit" disabled={!clientReady || state === "sending"}>
            {state === "sending" ? "Sending link…" : "Send sign-in link"}<ArrowRight aria-hidden="true" />
          </button>
        </form>

        {state === "accepted" && <div className="auth-feedback auth-feedback-success" role="status" aria-live="polite">
          <ShieldCheck aria-hidden="true" /><span><strong>Check your email.</strong><small>If you have access, a sign-in link is on its way. It can take a minute.</small></span>
        </div>}
        {state === "error" && <div className="auth-feedback auth-feedback-error" role="alert">
          <CircleAlert aria-hidden="true" /><span><strong>We couldn’t send a link.</strong><small>Check your connection and try again.</small></span>
        </div>}

        <p className="auth-footnote">New here? <a href="https://fifthwheel.community/#waitlist" target="_blank" rel="noreferrer">Join the Atlanta waitlist</a>.</p>
        <p className="auth-boundary">Joining the waitlist doesn’t give you access right away. We’ll email you when you’re in.</p>
      </div>
    </section>
  </main>;
}
