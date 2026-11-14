import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, LogOut, MailCheck, ShieldCheck } from "lucide-react";

type CallbackSearch = Readonly<{ token_hash?: string; type?: "invite" | "magiclink"; safeReturnTo?: string; next?: string }>;
type VerifyState = "ready" | "verifying" | "error" | "session-conflict" | "signing-out" | "sign-out-error" | "signed-out" | "signed-out-uncertain";

const alreadySignedInMessage = "You are already signed in. Sign out first, then reopen this same link. Your current session was kept.";

function safeInternalPath(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 2048
    && value.startsWith("/")
    && !value.startsWith("//")
    && !/[\\\u0000-\u001f\u007f]/.test(value);
}

function validateSearch(search: Record<string, unknown>): CallbackSearch {
  return {
    ...(typeof search.token_hash === "string" ? { token_hash: search.token_hash } : {}),
    ...(search.type === "invite" || search.type === "magiclink" ? { type: search.type } : {}),
    ...(typeof search.safeReturnTo === "string" ? { safeReturnTo: search.safeReturnTo } : {}),
    ...(typeof search.next === "string" ? { next: search.next } : {}),
  };
}

export const Route = createFileRoute("/auth/callback")({
  validateSearch,
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const search = Route.useSearch();
  // Copy the one-time callback values into component state on the first render.
  // Scrubbing the URL below can trigger TanStack search revalidation, so the
  // confirmation must use this captured snapshot rather than live route search.
  const [callback] = useState(() => ({
    tokenHash: search.token_hash,
    kind: search.type,
    safeReturnTo: safeInternalPath(search.safeReturnTo)
      ? search.safeReturnTo
      : safeInternalPath(search.next) ? search.next : undefined,
  }));
  const { tokenHash, kind, safeReturnTo } = callback;
  const [state, setState] = useState<VerifyState>("ready");
  const [clientReady, setClientReady] = useState(false);

  useEffect(() => {
    // Keep the single-use token hash out of the address bar after capture.
    // Verification still requires the user's explicit confirmation below.
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
    setClientReady(true);
  }, []);

  const validCallback = typeof tokenHash === "string"
    && tokenHash.length >= 16
    && tokenHash.length <= 512
    && /^[A-Za-z0-9_-]+$/.test(tokenHash)
    && (kind === "invite" || kind === "magiclink");

  async function verifyLink() {
    if (!validCallback || state === "verifying") return;
    setState("verifying");
    try {
      const response = await fetch("/api/auth/verify-link", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ tokenHash, kind, safeReturnTo }),
      });
      const result: unknown = await response.json().catch(() => null);
      const nextPath = typeof result === "object" && result !== null && "nextPath" in result
        ? result.nextPath
        : null;
      if (
        response.ok
        && typeof nextPath === "string"
        && nextPath.startsWith("/")
        && !nextPath.startsWith("//")
      ) {
        window.location.replace(nextPath);
        return;
      }
      const error = typeof result === "object" && result !== null && "error" in result
        ? result.error
        : null;
      const errorCode = typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null;
      const errorMessage = typeof error === "object" && error !== null && "message" in error
        ? error.message
        : null;
      if (response.status === 409 && errorCode === "conflict" && errorMessage === alreadySignedInMessage) {
        setState("session-conflict");
        return;
      }
      setState("error");
    } catch {
      setState("error");
    }
  }

  async function signOutAndKeepLink() {
    if (!clientReady || (state !== "session-conflict" && state !== "sign-out-error")) return;
    setState("signing-out");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const result: unknown = await response.json().catch(() => null);
      const signedOut = typeof result === "object" && result !== null && "signedOut" in result
        ? result.signedOut === true
        : false;
      const revocation = typeof result === "object" && result !== null && "sessionRevocation" in result
        ? result.sessionRevocation
        : null;
      if (signedOut) {
        setState(revocation === "unknown" ? "signed-out-uncertain" : "signed-out");
        return;
      }
      setState("sign-out-error");
    } catch {
      setState("sign-out-error");
    }
  }

  return <main className="auth-page callback-page">
    <section className="auth-story" aria-label="Fifth Wheel">
      <a className="brand" href="/" aria-label="Fifth Wheel home">
        <span className="brand-mark">FW</span>
        <span className="brand-name">fifth wheel<span className="brand-period">.</span></span>
      </a>
      <div className="auth-story-copy">
        <p className="eyebrow">A seat at the table</p>
        <h1>Your next<br />chapter <em>starts here.</em></h1>
        <p>Confirm your secure sign-in link to enter Fifth Wheel.</p>
      </div>
      <p className="story-stamp">FIFTH WHEEL <span>·</span> ATLANTA</p>
    </section>

    <section className="auth-card-wrap">
      <div className="auth-card callback-card">
        {!validCallback ? <>
          <span className="auth-icon auth-icon-error"><CircleAlert aria-hidden="true" /></span>
          <p className="eyebrow">LINK NOT AVAILABLE</p>
          <h2>This link can’t be used.</h2>
          <p className="auth-intro">It may have expired, already been used, or be incomplete. Request a fresh sign-in link to continue.</p>
          <a className="button button-primary auth-submit callback-link" href="/sign-in">Request a new link<ArrowRight aria-hidden="true" /></a>
        </> : state === "session-conflict" || state === "signing-out" || state === "sign-out-error" ? <>
          <span className="auth-icon auth-icon-error"><CircleAlert aria-hidden="true" /></span>
          <p className="eyebrow">SESSION ALREADY ACTIVE</p>
          <h2>Sign out to use this link.</h2>
          <div className="auth-feedback auth-feedback-error" role="alert">
            <CircleAlert aria-hidden="true" /><span><strong>You are already signed in.</strong><small>Sign out before using this link. Your current sign-in is still active, and you can continue with this same link.</small></span>
          </div>
          <button
            className="button button-primary auth-submit"
            type="button"
            onClick={() => void signOutAndKeepLink()}
            disabled={!clientReady || state === "signing-out"}
            data-action="sign-out-and-continue"
          >
            <LogOut aria-hidden="true" />{state === "signing-out" ? "Signing out…" : "Sign out and continue"}
          </button>
          {state === "sign-out-error" && <div className="auth-feedback auth-feedback-error" role="alert">
            <CircleAlert aria-hidden="true" /><span><strong>We couldn’t finish signing you out.</strong><small>Your current sign-in is still active. Try again, or return to sign in.</small></span>
          </div>}
          <a className="button button-outline callback-link" href="/sign-in">Return to sign in<ArrowRight aria-hidden="true" /></a>
        </> : <>
          <span className="auth-icon"><MailCheck aria-hidden="true" /></span>
          <p className="eyebrow">SECURE SIGN IN</p>
          <h2>{state === "signed-out" || state === "signed-out-uncertain" ? "Continue with your link." : "Ready when you are."}</h2>
          <p className="auth-intro">{state === "signed-out" || state === "signed-out-uncertain"
            ? "You are signed out in this browser. Continue to use this one-time link and open your member account."
            : "Continue to use this one-time link and open your member account. Your sign-in won’t finish until you continue."}</p>
          {state === "signed-out-uncertain" && <div className="auth-feedback auth-feedback-error" role="status">
            <CircleAlert aria-hidden="true" /><span><strong>Your saved sign-in was cleared.</strong><small>We couldn’t confirm that sign-out finished on our server. You can still try this link here.</small></span>
          </div>}
          <button
            className="button button-primary auth-submit"
            type="button"
            onClick={verifyLink}
            disabled={!clientReady || state === "verifying"}
            data-client-ready={clientReady ? "true" : "false"}
          >
            {state === "verifying" ? "Verifying link…" : "Continue to Fifth Wheel"}<ArrowRight aria-hidden="true" />
          </button>
          {state === "error" && <div className="auth-feedback auth-feedback-error" role="alert">
            <CircleAlert aria-hidden="true" /><span><strong>This sign-in link could not be verified.</strong><small>It may have expired or already been used. Request a fresh link.</small></span>
          </div>}
          {(state === "signed-out" || state === "signed-out-uncertain") && <a className="button button-outline callback-link" href="/sign-in">Return to sign in<ArrowRight aria-hidden="true" /></a>}
          <p className="auth-boundary"><ShieldCheck aria-hidden="true" /> App access does not include a Table invitation or payment.</p>
        </>}
      </div>
    </section>
  </main>;
}
