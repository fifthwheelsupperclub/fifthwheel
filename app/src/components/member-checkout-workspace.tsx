import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js/pure";
import type { StripeEmbeddedCheckout } from "@stripe/stripe-js";
import { AlertCircle, CheckCircle2, Clock3, CreditCard, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import type {
  BeginCheckoutRequest, CheckoutAttemptDTO, CheckoutBeginDTO, CheckoutEligibilityDTO,
  CheckoutErrorCode, CheckoutRecoveryDTO, CheckoutResponse,
} from "../checkout.contract.ts";
import "./member-checkout-workspace.css";

type EligibilityForUI = CheckoutEligibilityDTO;
type LoadState = "loading" | "ready" | "unauthenticated" | "forbidden" | "not_found" | "error";
type ActionState = "idle" | "starting" | "opening";
type CheckoutEnvelope<T> = CheckoutResponse<T>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checkoutSessionPattern = /^cs_(?:test_|live_)[A-Za-z0-9]+$/;
const attemptStates = new Set<CheckoutAttemptDTO["state"]>(["creating", "open", "unknown", "processing", "expired", "released", "consumed"]);
const reasonCodes = new Set<NonNullable<CheckoutEligibilityDTO["eligibility"]["reasonCode"]>>([
  "disclosure_not_configured", "profile_review_required", "roster_stale", "invitation_closed", "table_closed",
  "seat_exists", "capacity_unavailable", "payment_unresolved", "attempt_recovery_required", "provider_unavailable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function isRevision(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }

function parseAttempt(value: unknown): CheckoutAttemptDTO | null {
  if (!isRecord(value) || typeof value.attemptId !== "string" || !uuidPattern.test(value.attemptId)
    || typeof value.invitationId !== "string" || !uuidPattern.test(value.invitationId)
    || !attemptStates.has(value.state as CheckoutAttemptDTO["state"])
    || !isDate(value.holdUntil) || !isDate(value.providerSessionExpiresAt)) return null;
  return {
    attemptId: value.attemptId,
    invitationId: value.invitationId,
    state: value.state as CheckoutAttemptDTO["state"],
    holdUntil: value.holdUntil,
    providerSessionExpiresAt: value.providerSessionExpiresAt,
  };
}

function parseEligibility(value: unknown, invitationId: string): EligibilityForUI | null {
  if (!isRecord(value) || value.invitationId !== invitationId
    || !isRevision(value.expectedProposalRevision) || !isRevision(value.expectedProfileRevision)
    || !isRecord(value.eligibility) || !["ready", "blocked"].includes(String(value.eligibility.status))
    || !(value.eligibility.reasonCode === null || reasonCodes.has(value.eligibility.reasonCode as NonNullable<CheckoutEligibilityDTO["eligibility"]["reasonCode"]>))
    || !isRecord(value.price) || value.price.amountCents !== 2500 || value.price.currency !== "USD"
    || !isRecord(value.disclosure) || !["ready", "not_configured"].includes(String(value.disclosure.status))) return null;

  let disclosure: CheckoutEligibilityDTO["disclosure"];
  if (value.disclosure.status === "not_configured") disclosure = { status: "not_configured" };
  else if (typeof value.disclosure.version === "string" && value.disclosure.version.length > 0 && value.disclosure.version.length <= 100
    && typeof value.disclosure.text === "string" && value.disclosure.text.trim().length > 0
    && typeof value.disclosure.requiresAcknowledgement === "boolean") {
    disclosure = { status: "ready", version: value.disclosure.version, text: value.disclosure.text,
      requiresAcknowledgement: value.disclosure.requiresAcknowledgement };
  } else return null;

  let activeAttempt: CheckoutAttemptDTO | null = null;
  if (value.activeAttempt !== null) {
    activeAttempt = parseAttempt(value.activeAttempt);
    if (!activeAttempt || activeAttempt.invitationId !== invitationId) return null;
  }

  if (!isRecord(value.provider) || typeof value.provider.ready !== "boolean"
    || !(value.provider.mode === "test" || value.provider.mode === "live" || value.provider.mode === null)
    || !(value.provider.publishableKey === null || typeof value.provider.publishableKey === "string"
      && value.provider.publishableKey.length <= 500 && value.provider.publishableKey.startsWith("pk_"))) return null;

  return {
    invitationId,
    expectedProposalRevision: value.expectedProposalRevision,
    expectedProfileRevision: value.expectedProfileRevision,
    eligibility: { status: value.eligibility.status as "ready" | "blocked", reasonCode: value.eligibility.reasonCode as CheckoutEligibilityDTO["eligibility"]["reasonCode"] },
    price: { amountCents: 2500, currency: "USD" },
    disclosure,
    activeAttempt,
    provider: { ready: value.provider.ready, mode: value.provider.mode, publishableKey: value.provider.publishableKey },
  };
}

function parseBegin(value: unknown, invitationId: string): CheckoutBeginDTO | null {
  if (!isRecord(value)) return null;
  const attempt = parseAttempt(value.attempt);
  if (!attempt || attempt.invitationId !== invitationId || !isRecord(value.price)
    || value.price.amountCents !== 2500 || value.price.currency !== "USD"
    || typeof value.checkoutClientSecret !== "string" || !value.checkoutClientSecret.startsWith("cs_")
    || value.checkoutClientSecret.length > 5000) return null;
  return { attempt, price: { amountCents: 2500, currency: "USD" }, checkoutClientSecret: value.checkoutClientSecret };
}

function parseRecovery(value: unknown, invitationId: string): CheckoutRecoveryDTO | null {
  if (!isRecord(value) || !["not_started", "processing", "confirmed", "refund_pending", "unknown"].includes(String(value.paymentState))
    || !(value.seatId === null || typeof value.seatId === "string" && uuidPattern.test(value.seatId))) return null;
  const attempt = parseAttempt(value.attempt);
  if (!attempt || attempt.invitationId !== invitationId) return null;
  return { attempt, paymentState: value.paymentState as CheckoutRecoveryDTO["paymentState"], seatId: value.seatId as string | null };
}

function decodeEnvelope<T>(value: unknown, decode: (data: unknown) => T | null): CheckoutEnvelope<T> | null {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.correlationId !== "string") return null;
  if (value.ok) {
    const data = decode(value.data);
    return data === null ? null : { ok: true, data, correlationId: value.correlationId };
  }
  if (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.safeMessage !== "string"
    || typeof value.error.retryable !== "boolean" || typeof value.error.correlationId !== "string") return null;
  return { ok: false, error: { code: value.error.code as CheckoutErrorCode, safeMessage: value.error.safeMessage,
    retryable: value.error.retryable, correlationId: value.error.correlationId }, correlationId: value.correlationId };
}

async function jsonEnvelope<T>(response: Response, decode: (data: unknown) => T | null): Promise<CheckoutEnvelope<T> | null> {
  const body: unknown = await response.json().catch(() => null);
  return decodeEnvelope(body, decode);
}

function reasonCopy(reason: CheckoutEligibilityDTO["eligibility"]["reasonCode"]): string {
  switch (reason) {
    case "disclosure_not_configured": return "Checkout is unavailable until an approved payment disclosure is configured.";
    case "profile_review_required": return "Your profile needs to be reviewed again before you can pay.";
    case "roster_stale": return "We’re checking this invitation. Check back soon.";
    case "invitation_closed": return "This Table invitation is no longer open.";
    case "table_closed": return "Checkout is closed for this Table.";
    case "seat_exists": return "You already have a seat at this table.";
    case "capacity_unavailable": return "Checkout capacity is not available right now.";
    case "payment_unresolved": return "We’re still confirming an earlier payment. Don’t pay again.";
    case "attempt_recovery_required": return "We’re still confirming an earlier payment. Don’t pay again.";
    case "provider_unavailable": return "Secure checkout is temporarily unavailable.";
    case null: return "Checkout is not available right now.";
  }
}

function publishableKeyFor(mode: "test" | "live" | null, key: string | null): string | null {
  if (!mode || !key) return null;
  if (mode === "test" && key.startsWith("pk_test_")) return key;
  if (mode === "live" && key.startsWith("pk_live_")) return key;
  return null;
}

function formatDeadline(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const operationStorageKey = (invitationId: string) => `fw.checkout.operation.${invitationId}`;

function operationIdFor(invitationId: string): string {
  const key = operationStorageKey(invitationId);
  try {
    const previous = sessionStorage.getItem(key);
    if (previous && uuidPattern.test(previous)) return previous;
    const next = crypto.randomUUID();
    sessionStorage.setItem(key, next);
    return next;
  } catch { return crypto.randomUUID(); }
}

function clearOperationId(invitationId: string): void {
  try { sessionStorage.removeItem(operationStorageKey(invitationId)); } catch { /* storage may be disabled */ }
}

export function MemberCheckoutWorkspace({ invitationId }: { invitationId: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [eligibility, setEligibility] = useState<EligibilityForUI | null>(null);
  const [recovery, setRecovery] = useState<CheckoutRecoveryDTO | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [action, setAction] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const checkoutRef = useRef<StripeEmbeddedCheckout | null>(null);
  const checkoutMountRef = useRef<HTMLDivElement | null>(null);
  const returnFlightRef = useRef<Readonly<{ key: string; promise: Promise<void> }> | null>(null);

  const loadRecovery = useCallback(async (attemptId: string) => {
    if (!uuidPattern.test(attemptId)) return;
    setAction("opening");
    try {
      const response = await fetch(`/api/me/checkout-attempts/${encodeURIComponent(attemptId)}`, {
        credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" },
      });
      const result = await jsonEnvelope(response, (data) => parseRecovery(data, invitationId));
      if (!response.ok || !result) throw new Error("Checkout status is temporarily unavailable. Try again.");
      if (!result.ok) {
        setMessage(result.error.safeMessage);
        setRecovery(null);
        return;
      }
      setRecovery(result.data);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout status is temporarily unavailable. Try again.");
      setRecovery(null);
    } finally { setAction("idle"); }
  }, [invitationId]);

  const reconcileReturn = useCallback(async (attemptId: string, sessionId: string) => {
    const key = `${attemptId}:${sessionId}`;
    if (returnFlightRef.current?.key === key) return returnFlightRef.current.promise;
    const promise = (async () => {
      try {
        const response = await fetch(`/api/me/table-invitations/${encodeURIComponent(invitationId)}/checkout/return`, {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json", accept: "application/json" },
          // Both values are untrusted lookup hints. Only the cookie-authenticated server result is rendered.
          body: JSON.stringify({ attemptId, sessionId }),
        });
        const result = await jsonEnvelope(response, (data) => parseRecovery(data, invitationId));
        if (response.ok && result?.ok) {
          setRecovery(result.data);
          setMessage("");
          return;
        }
      } catch { /* Fall back to the owner-scoped status read below. */ }
      await loadRecovery(attemptId);
    })();
    returnFlightRef.current = { key, promise };
    try { await promise; }
    finally { if (returnFlightRef.current?.promise === promise) returnFlightRef.current = null; }
  }, [invitationId, loadRecovery]);

  const load = useCallback(async () => {
    setState("loading"); setMessage(""); setCheckoutError(""); setAcknowledged(false);
    try {
      const response = await fetch(`/api/me/table-invitations/${encodeURIComponent(invitationId)}/checkout`, {
        credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" },
      });
      if (response.status === 401) { setState("unauthenticated"); return; }
      if (response.status === 403) { setState("forbidden"); return; }
      if (response.status === 404) { setState("not_found"); return; }
      const result = await jsonEnvelope(response, (data) => parseEligibility(data, invitationId));
      if (!response.ok || !result) throw new Error("Checkout eligibility is temporarily unavailable. Try again shortly.");
      if (!result.ok) {
        setState(result.error.code === "unauthenticated" ? "unauthenticated" : result.error.code === "forbidden" ? "forbidden" : result.error.code === "not_found" ? "not_found" : "error");
        setMessage(result.error.safeMessage);
        return;
      }
      setEligibility(result.data); setState("ready");

      const query = new URLSearchParams(window.location.search);
      // Return query values are untrusted hints only. Ask the cookie-authenticated
      // return handler to verify their binding; if that cannot run, use owner recovery.
      const returnAttemptId = query.get("checkout") === "return" ? query.get("attemptId") : null;
      const returnSessionId = query.get("session_id");
      if (returnAttemptId && uuidPattern.test(returnAttemptId)) {
        if (returnSessionId && checkoutSessionPattern.test(returnSessionId)) await reconcileReturn(returnAttemptId, returnSessionId);
        else await loadRecovery(returnAttemptId);
      } else if (result.data.activeAttempt?.attemptId) await loadRecovery(result.data.activeAttempt.attemptId);
      else setRecovery(null);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Checkout is temporarily unavailable. Try again shortly.");
    }
  }, [invitationId, loadRecovery, reconcileReturn]);

  useEffect(() => { void load(); }, [load]);

  const safePublishableKey = eligibility ? publishableKeyFor(eligibility.provider.mode, eligibility.provider.publishableKey) : null;
  const providerReady = eligibility?.provider?.ready === true && safePublishableKey !== null;
  const disclosureReady = eligibility?.disclosure.status === "ready";
  const consentReady = !disclosureReady || !eligibility.disclosure.requiresAcknowledgement || acknowledged;
  const activeAttempt = recovery?.attempt ?? eligibility?.activeAttempt ?? null;
  const isLiveAttempt = activeAttempt !== null && ["creating", "open", "unknown", "processing"].includes(activeAttempt.state)
    && Date.parse(activeAttempt.holdUntil) > Date.now();
  const canBegin = state === "ready" && eligibility?.eligibility.status === "ready" && disclosureReady
    && providerReady && consentReady && action === "idle" && !clientSecret && (!isLiveAttempt || recovery?.paymentState === "not_started");

  async function refreshStatus() {
    await load();
  }

  async function begin() {
    if (!eligibility || !canBegin || !disclosureReady) return;
    setAction("starting"); setMessage(""); setCheckoutError("");
    const request: BeginCheckoutRequest = {
      operationId: operationIdFor(invitationId),
      expectedProposalRevision: eligibility.expectedProposalRevision,
      expectedProfileRevision: eligibility.expectedProfileRevision,
      acceptedDisclosureVersion: eligibility.disclosure.version,
    };
    try {
      const response = await fetch(`/api/me/table-invitations/${encodeURIComponent(invitationId)}/checkout`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request),
      });
      const result = await jsonEnvelope(response, (data) => parseBegin(data, invitationId));
      if (!response.ok || !result) throw new Error("We couldn’t start checkout. Refresh the status before trying again.");
      if (!result.ok) {
        setMessage(result.error.safeMessage);
        if (result.error.retryable || result.error.code === "outcome_unknown") {
          setAction("idle");
          await load();
          return;
        }
        if (["conflict", "ineligible", "table_closed", "capacity_unavailable"].includes(result.error.code)) {
          clearOperationId(invitationId);
          setAction("idle");
          await load();
          return;
        }
        setAction("idle");
        return;
      }
      setRecovery({ attempt: result.data.attempt, paymentState: "not_started", seatId: null });
      setClientSecret(result.data.checkoutClientSecret);
      setAction("opening");
      clearOperationId(invitationId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout status is uncertain. Refresh before trying again.");
      setAction("idle");
      await load();
    }
  }

  const verifyFromStripe = useCallback(async () => {
    if (recovery?.attempt.attemptId) await loadRecovery(recovery.attempt.attemptId);
  }, [loadRecovery, recovery?.attempt.attemptId]);

  useEffect(() => {
    let cancelled = false;
    let instance: StripeEmbeddedCheckout | null = null;
    async function mountCheckout() {
      if (!clientSecret || !safePublishableKey || !providerReady || !checkoutMountRef.current) return;
      setAction("opening");
      try {
        const stripe = await loadStripe(safePublishableKey);
        if (!stripe) throw new Error("Stripe.js could not initialize.");
        const embedded = await stripe.createEmbeddedCheckoutPage({ clientSecret, onComplete: () => { void verifyFromStripe(); } });
        if (cancelled) { embedded.destroy(); return; }
        instance = embedded;
        checkoutRef.current = embedded;
        embedded.mount(checkoutMountRef.current);
        setAction("idle");
      } catch {
        if (cancelled) return;
        setCheckoutError("Secure checkout did not load. You can refresh payment status before retrying.");
        setAction("idle");
        await verifyFromStripe();
      }
    }
    void mountCheckout();
    return () => {
      cancelled = true;
      if (instance) instance.destroy();
      checkoutRef.current = null;
    };
  }, [clientSecret, providerReady, safePublishableKey, verifyFromStripe]);

  useEffect(() => () => { checkoutRef.current?.destroy(); }, []);

  const disclosure = eligibility?.disclosure.status === "ready" ? eligibility.disclosure : null;
  const price = eligibility?.price;
  const eligibilityBlocked = eligibility?.eligibility.status === "blocked";
  const status = checkoutStatus(recovery);

  return <div className="member-checkout-workspace" aria-live="polite">
    <div className="invitation-price-line"><span>Seat price</span><strong>{price ? `$${(price.amountCents / 100).toFixed(0)} ` : "— "}<small>{price?.currency ?? "USD"}</small></strong></div>

    {state === "loading" && <div className="checkout-state checkout-state-muted" role="status"><LoaderCircle className="spin" aria-hidden="true" /><span>Loading…</span></div>}
    {state === "unauthenticated" && <div className="checkout-state checkout-state-warning" role="status"><ShieldCheck aria-hidden="true" /><p>Sign in to view checkout for this invitation.</p><a href={`/sign-in?returnTo=${encodeURIComponent(`/invitations/${invitationId}`)}`}>Sign in to continue</a></div>}
    {state === "forbidden" && <div className="checkout-state checkout-state-warning" role="status"><ShieldCheck aria-hidden="true" /><p>This invitation is available only to its named member.</p></div>}
    {state === "not_found" && <div className="checkout-state checkout-state-warning" role="status"><AlertCircle aria-hidden="true" /><p>This invitation could not be found for this account.</p></div>}
    {state === "error" && <div className="checkout-state checkout-state-error" role="alert"><AlertCircle aria-hidden="true" /><div><p>{message || "Checkout eligibility is temporarily unavailable."}</p><button className="button button-outline" type="button" onClick={() => void load()}>Try again<RefreshCw aria-hidden="true" /></button></div></div>}

    {state === "ready" && eligibility && <>
      {disclosure && <section className="checkout-disclosure" aria-labelledby={`checkout-disclosure-${invitationId}`}>
        <div className="checkout-disclosure-heading"><ShieldCheck aria-hidden="true" /><div><p className="eyebrow">PAYMENT DISCLOSURE</p><span>Version {disclosure.version}</span></div></div>
        <div className="checkout-disclosure-copy">{disclosure.text}</div>
        {disclosure.requiresAcknowledgement && <label className="check-option checkout-acknowledgement">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.currentTarget.checked)} />
          <span>I acknowledge this disclosure, version {disclosure.version}.</span>
        </label>}
      </section>}

      {recovery && status && <section className={`checkout-state checkout-state-${status.tone}`} role="status">
        {status.tone === "good" ? <CheckCircle2 aria-hidden="true" /> : status.tone === "warning" ? <Clock3 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
        <div><strong>{status.title}</strong><p>{status.detail}</p>
          <dl className="checkout-deadline"><div><dt>Your seat is held until</dt><dd>{formatDeadline(recovery.attempt.holdUntil)}</dd></div></dl>
          {recovery.paymentState === "unknown" || recovery.attempt.state === "unknown" || recovery.paymentState === "processing"
            ? <button className="button button-outline" type="button" onClick={() => void loadRecovery(recovery.attempt.attemptId)} disabled={action !== "idle"}>{action === "opening" ? "Checking…" : "Check again"}<RefreshCw aria-hidden="true" /></button>
            : null}
        </div>
      </section>}

      {eligibilityBlocked && !recovery && <div className="checkout-state checkout-state-warning" role="status"><ShieldCheck aria-hidden="true" /><p>{reasonCopy(eligibility.eligibility.reasonCode)}{eligibility.eligibility.reasonCode === "disclosure_not_configured" ? " No payment has been started." : ""}</p></div>}
      {!disclosure && !eligibilityBlocked && <div className="checkout-state checkout-state-warning" role="status"><ShieldCheck aria-hidden="true" /><p>{reasonCopy("disclosure_not_configured")} No payment has been started.</p></div>}
      {disclosure && !providerReady && <div className="checkout-state checkout-state-warning" role="status"><ShieldCheck aria-hidden="true" /><p>Secure checkout is unavailable until the payment service and app configuration are ready. No payment has been started.</p></div>}
      {eligibility.eligibility.status === "ready" && disclosure && providerReady && recovery?.paymentState === "not_started" && recovery.attempt.state === "open" && isLiveAttempt && <div className="checkout-state checkout-state-muted" role="status"><CreditCard aria-hidden="true" /><p>Your payment attempt is open. Continue only if you want to resume this same checkout.</p></div>}

      {checkoutError && <div className="checkout-state checkout-state-error" role="alert"><AlertCircle aria-hidden="true" /><div><p>{checkoutError}</p><button className="button button-outline" type="button" onClick={() => void refreshStatus()}>Check again<RefreshCw aria-hidden="true" /></button></div></div>}
      {message && state === "ready" && <p className="checkout-safe-message" role="status">{message}</p>}

      {clientSecret && <div className="checkout-embedded-area">
        <div className="checkout-embedded-heading"><CreditCard aria-hidden="true" /><div><strong>Pay by card</strong><span>Payment is handled by Stripe. This page updates when your payment goes through.</span></div></div>
        <div className="checkout-embedded-mount" ref={checkoutMountRef} aria-label="Secure card checkout" />
      </div>}

      {eligibility.eligibility.status === "ready" && disclosure && providerReady && !recovery?.attempt.state.match(/^(?:unknown|processing|expired|released|consumed)$/)
        && !clientSecret && <div className="checkout-actions">
          <button className="button button-primary checkout-begin" type="button" onClick={() => void begin()} disabled={!canBegin}>
            {action === "starting" || action === "opening" ? <LoaderCircle className="spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
            {recovery?.attempt.state === "open" ? "Resume payment" : action === "starting" ? "Opening payment…" : "Continue to payment"}
          </button>
          <p>Your seat is confirmed once your payment goes through.</p>
        </div>}
    </>}
  </div>;
}

function checkoutStatus(value: CheckoutRecoveryDTO | null): Readonly<{ title: string; detail: string; tone: "good" | "warning" | "error" }> | null {
  if (!value) return null;
  if (value.paymentState === "confirmed" && value.seatId) return { title: "Seat confirmed", detail: "Payment is confirmed for this Seat.", tone: "good" };
  if (value.paymentState === "refund_pending") return { title: "Payment received; refund pending", detail: "Payment was received, but this checkout could not create a Seat. The refund status remains open until confirmed.", tone: "warning" };
  if (value.paymentState === "confirmed") return { title: "Payment confirmed; Seat status is updating", detail: "The payment service is confirming the Seat record. Refresh status before taking another action.", tone: "warning" };
  if (value.paymentState === "unknown" || value.attempt.state === "unknown") return { title: "Payment status is being confirmed", detail: "Do not start another payment while this attempt is unresolved.", tone: "warning" };
  if (value.paymentState === "processing" || value.attempt.state === "processing" || value.attempt.state === "creating") return { title: "Checkout is processing", detail: "Your payment has not yet been confirmed as a Seat. Refresh this status shortly.", tone: "warning" };
  if (value.attempt.state === "expired" || value.attempt.state === "released") return { title: "This checkout window ended", detail: "The invitation may remain active, but first confirm this attempt’s final payment status.", tone: "warning" };
  return { title: "Checkout is ready to continue", detail: "No payment is confirmed. Continue the existing attempt before its hold ends.", tone: "warning" };
}
