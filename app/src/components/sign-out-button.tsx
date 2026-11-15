import { useState } from "react";
import { CircleAlert, LogOut } from "lucide-react";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const body: unknown = await response.json().catch(() => null);
      if (typeof body === "object" && body !== null && "signedOut" in body && body.signedOut === true) {
        const uncertain = "sessionRevocation" in body && body.sessionRevocation === "unknown";
        window.location.replace(uncertain ? "/sign-in?signout=uncertain" : "/sign-in");
        return;
      }
      setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return <span className="sign-out-control">
    <button className="button button-outline account-action" type="button" onClick={() => void signOut()} disabled={busy}>
      <LogOut aria-hidden="true" />{busy ? "Signing out…" : "Sign out"}
    </button>
    {error && <span className="sign-out-error" role="alert"><CircleAlert aria-hidden="true" />Couldn’t sign out. Try again.</span>}
  </span>;
}
