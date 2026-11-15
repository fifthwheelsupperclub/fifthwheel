/** Nightly Stripe-vs-ledger comparison. Read-only against Stripe; findings carry ids and amounts only. */

type Mode = "test" | "live";
export type LedgerPayment = Readonly<{ paymentIntentId: string; mode: Mode; amountCents: number; currency: string; createdAt: string }>;
export type LedgerRefund = Readonly<{ operationId: string; refundId: string | null; paymentIntentId: string; state: string; amountCents: number; createdAt: string }>;
export type StripeSession = Readonly<{ paymentIntentId: string; paid: boolean; amountCents: number; currency: string; created: number; ours: boolean }>;
export type StripeRefund = Readonly<{ id: string; paymentIntentId: string; status: string; amountCents: number; created: number; operationId: string | null }>;
export type Finding = Readonly<{ kind: string; ref: string; detail: Record<string, unknown> }>;

const GRACE_MS = 3_600_000, WINDOW_MS = 72 * 3_600_000, LIVE = new Set(["pending", "requires_action", "succeeded"]);

export function reconcile(input: { payments: readonly LedgerPayment[]; refunds: readonly LedgerRefund[]; sessions: readonly StripeSession[]; stripeRefunds: readonly StripeRefund[]; mode: Mode; now: number }): Finding[] {
  const { now } = input, out: Finding[] = [];
  const ledger = new Map(input.payments.map((p) => [p.paymentIntentId, p]));
  const ours = new Set(input.sessions.filter((s) => s.ours).map((s) => s.paymentIntentId));
  const paidIntents = new Set(input.sessions.filter((s) => s.paid).map((s) => s.paymentIntentId));
  const ops = new Map(input.refunds.map((r) => [r.operationId, r]));
  const stripeRefunds = new Map(input.stripeRefunds.map((r) => [r.id, r]));

  for (const s of input.sessions) {
    if (!s.paid || !s.ours || s.created * 1000 > now - GRACE_MS) continue;
    const p = ledger.get(s.paymentIntentId);
    if (!p) out.push({ kind: "paid_not_recorded", ref: s.paymentIntentId, detail: { amountCents: s.amountCents } });
    else if (p.amountCents !== s.amountCents || p.currency.toLowerCase() !== s.currency.toLowerCase()) {
      out.push({ kind: "payment_amount_mismatch", ref: s.paymentIntentId, detail: { stripeCents: s.amountCents, ledgerCents: p.amountCents } });
    }
  }
  for (const p of input.payments) {
    if (p.mode === input.mode && Date.parse(p.createdAt) >= now - WINDOW_MS && !paidIntents.has(p.paymentIntentId)) {
      out.push({ kind: "ledger_payment_not_in_stripe", ref: p.paymentIntentId, detail: { amountCents: p.amountCents } });
    }
  }
  const refunded = new Map<string, number>();
  for (const r of input.stripeRefunds) {
    if (!ledger.has(r.paymentIntentId) && !ours.has(r.paymentIntentId)) continue;
    if (LIVE.has(r.status)) refunded.set(r.paymentIntentId, (refunded.get(r.paymentIntentId) ?? 0) + r.amountCents);
    const op = r.operationId ? ops.get(r.operationId) : undefined;
    if (LIVE.has(r.status) && !r.operationId) out.push({ kind: "refund_outside_app", ref: r.id, detail: { amountCents: r.amountCents, status: r.status } });
    else if (LIVE.has(r.status) && !op) out.push({ kind: "refund_unrecorded", ref: r.id, detail: { amountCents: r.amountCents, status: r.status } });
    else if (op && r.status === "succeeded" && op.state !== "succeeded" && r.created * 1000 < now - GRACE_MS) {
      out.push({ kind: "refund_state_mismatch", ref: r.id, detail: { stripe: r.status, ledger: op.state } });
    }
  }
  for (const [pi, total] of refunded) {
    const paid = ledger.get(pi)?.amountCents ?? input.sessions.find((s) => s.paymentIntentId === pi)?.amountCents ?? 0;
    if (total > paid) out.push({ kind: "over_refunded", ref: pi, detail: { refundedCents: total, paidCents: paid } });
  }
  for (const op of input.refunds) {
    if (!op.refundId || Date.parse(op.createdAt) < now - WINDOW_MS) continue;
    const r = stripeRefunds.get(op.refundId);
    if (!r) out.push({ kind: "ledger_refund_not_in_stripe", ref: op.refundId, detail: { ledger: op.state } });
    else if (op.state === "succeeded" && !LIVE.has(r.status)) out.push({ kind: "refund_state_mismatch", ref: r.id, detail: { stripe: r.status, ledger: op.state } });
  }
  return out;
}

type Rec = Record<string, unknown>;
const rec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" ? x : rec(x) && typeof x.id === "string" ? x.id : null);

export function createStripeLister(config: { secretKey: string; mode: Mode; fetch?: typeof fetch }) {
  if (!config.secretKey.startsWith(config.mode === "test" ? "sk_test_" : "sk_live_")) throw new Error("stripe_unavailable");
  const fetcher = config.fetch ?? globalThis.fetch, MAX_PAGES = 20;
  async function list(path: string, params: Record<string, string>): Promise<{ rows: Rec[]; complete: boolean }> {
    const rows: Rec[] = []; let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`https://api.stripe.com/v1/${path}`);
      for (const [k, v] of Object.entries({ ...params, limit: "100", ...(after ? { starting_after: after } : {}) })) url.searchParams.set(k, v);
      const response = await fetcher(url, { headers: { authorization: `Bearer ${config.secretKey}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
      const body: unknown = await response.json();
      if (!response.ok || !rec(body) || !Array.isArray(body.data) || typeof body.has_more !== "boolean") throw new Error("stripe_list_failed");
      const data = body.data.filter(rec); rows.push(...data);
      if (!body.has_more) return { rows, complete: true };
      after = typeof data.at(-1)?.id === "string" ? data.at(-1)!.id as string : null;
      if (!after) break;
    }
    return { rows, complete: false };
  }
  return Object.freeze({
    async sessions(sinceSeconds: number): Promise<{ rows: StripeSession[]; complete: boolean }> {
      const { rows, complete } = await list("checkout/sessions", { "created[gte]": String(sinceSeconds), status: "complete" });
      return { complete, rows: rows.flatMap((s) => {
        const pi = str(s.payment_intent);
        return pi && typeof s.amount_total === "number" && typeof s.created === "number"
          ? [{ paymentIntentId: pi, paid: s.payment_status === "paid", amountCents: s.amount_total, currency: String(s.currency ?? ""), created: s.created, ours: rec(s.metadata) && typeof s.metadata.attempt_id === "string" }] : [];
      }) };
    },
    async refunds(sinceSeconds: number): Promise<{ rows: StripeRefund[]; complete: boolean }> {
      const { rows, complete } = await list("refunds", { "created[gte]": String(sinceSeconds) });
      return { complete, rows: rows.flatMap((r) => {
        const pi = str(r.payment_intent);
        return typeof r.id === "string" && pi && typeof r.amount === "number" && typeof r.created === "number"
          ? [{ id: r.id, paymentIntentId: pi, status: String(r.status), amountCents: r.amount, created: r.created,
            operationId: rec(r.metadata) && typeof r.metadata.app_refund_operation_id === "string" ? r.metadata.app_refund_operation_id : null }] : [];
      }) };
    },
  });
}

type Deps = Readonly<{ rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>; stripe: ReturnType<typeof createStripeLister>; mode: Mode; now?: () => number }>;

/** One claimed run. Returns "not_due" without touching Stripe when a recent successful run exists. */
export async function runReconciliation(deps: Deps): Promise<"not_due" | { findings: number; complete: boolean }> {
  const claim = await deps.rpc("claim_reconciliation_run") as { due?: boolean; payments?: LedgerPayment[]; refunds?: LedgerRefund[] } | null;
  if (!claim?.due) return "not_due";
  const now = (deps.now ?? Date.now)(), since = Math.floor((now - WINDOW_MS) / 1000);
  const [sessions, stripeRefunds] = await Promise.all([deps.stripe.sessions(since), deps.stripe.refunds(since)]);
  const complete = sessions.complete && stripeRefunds.complete;
  const findings = reconcile({ payments: claim.payments ?? [], refunds: claim.refunds ?? [], sessions: sessions.rows, stripeRefunds: stripeRefunds.rows, mode: deps.mode, now });
  if (!complete) findings.push({ kind: "reconciliation_incomplete", ref: "stripe", detail: { reason: "more_than_20_pages" } });
  await deps.rpc("record_reconciliation_findings", { p_findings: findings, p_complete: complete });
  return { findings: findings.length, complete };
}

export function createReconciliationRuntime(environment: Readonly<Record<string, string | undefined>>, rpc: Deps["rpc"]): (() => ReturnType<typeof runReconciliation>) | null {
  const mode = environment.STRIPE_MODE?.trim(), key = environment.STRIPE_SECRET_KEY?.trim() ?? "";
  if ((mode !== "test" && mode !== "live") || !key.startsWith(mode === "test" ? "sk_test_" : "sk_live_")) return null;
  const stripe = createStripeLister({ secretKey: key, mode });
  return () => runReconciliation({ rpc, stripe, mode });
}
