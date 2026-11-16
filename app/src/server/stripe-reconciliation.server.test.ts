import assert from "node:assert/strict";
import { test } from "node:test";
import { createStripeLister, reconcile, runReconciliation, type LedgerPayment, type LedgerRefund, type StripeRefund, type StripeSession } from "./stripe-reconciliation.server.ts";

const now = Date.parse("2026-11-15T12:00:00Z"), hoursAgo = (h: number) => now - h * 3_600_000;
const pay = (pi: string, h = 5): LedgerPayment => ({ paymentIntentId: pi, mode: "test", amountCents: 2500, currency: "USD", createdAt: new Date(hoursAgo(h)).toISOString() });
const sess = (pi: string, over: Partial<StripeSession> = {}): StripeSession => ({ paymentIntentId: pi, paid: true, amountCents: 2500, currency: "usd", created: hoursAgo(5) / 1000, ours: true, ...over });
const op = (id: string, refundId: string | null, state = "succeeded", h = 4): LedgerRefund => ({ operationId: id, refundId, paymentIntentId: "pi_1", state, amountCents: 2500, createdAt: new Date(hoursAgo(h)).toISOString() });
const ref = (id: string, operationId: string | null, over: Partial<StripeRefund> = {}): StripeRefund => ({ id, paymentIntentId: "pi_1", status: "succeeded", amountCents: 2500, created: hoursAgo(4) / 1000, operationId, ...over });
const run = (x: Partial<Parameters<typeof reconcile>[0]>) => reconcile({ payments: [], refunds: [], sessions: [], stripeRefunds: [], mode: "test", now, ...x }).map((f) => `${f.kind}:${f.ref}`);

test("clean books produce no findings", () => {
  assert.deepEqual(run({ payments: [pay("pi_1")], sessions: [sess("pi_1")], refunds: [op("o1", "re_1")], stripeRefunds: [ref("re_1", "o1")] }), []);
});

test("payment differences: unrecorded, wrong amount, not paid in Stripe, grace for fresh sessions, other products ignored", () => {
  assert.deepEqual(run({ sessions: [sess("pi_1")] }), ["paid_not_recorded:pi_1"]);
  assert.deepEqual(run({ sessions: [sess("pi_1", { created: hoursAgo(0.2) / 1000 })] }), []);
  assert.deepEqual(run({ sessions: [sess("pi_1", { ours: false })] }), []);
  assert.deepEqual(run({ payments: [pay("pi_1")], sessions: [sess("pi_1", { amountCents: 2000 })] }), ["payment_amount_mismatch:pi_1"]);
  assert.deepEqual(run({ payments: [pay("pi_1")] }), ["ledger_payment_not_in_stripe:pi_1"]);
  assert.deepEqual(run({ payments: [pay("pi_1", 90)] }), []); // older than the Stripe window: not comparable
  assert.deepEqual(run({ payments: [pay("pi_1")], sessions: [sess("pi_1", { paid: false })] }), ["ledger_payment_not_in_stripe:pi_1"]);
});

test("refund differences: dashboard refund, unrecorded, status mismatch, missing in Stripe, over-refund; failed Stripe refunds are not money out", () => {
  const base = { payments: [pay("pi_1")], sessions: [sess("pi_1")] };
  assert.deepEqual(run({ ...base, stripeRefunds: [ref("re_9", null)] }), ["refund_outside_app:re_9"]);
  assert.deepEqual(run({ ...base, stripeRefunds: [ref("re_9", "o-missing")] }), ["refund_unrecorded:re_9"]);
  assert.deepEqual(run({ ...base, refunds: [op("o1", "re_1", "submitted")], stripeRefunds: [ref("re_1", "o1")] }), ["refund_state_mismatch:re_1"]);
  assert.deepEqual(run({ ...base, refunds: [op("o1", "re_1", "succeeded")], stripeRefunds: [ref("re_1", "o1", { status: "failed" })] }), ["refund_state_mismatch:re_1"]);
  assert.deepEqual(run({ ...base, refunds: [op("o1", "re_1", "submitted")] }), ["ledger_refund_not_in_stripe:re_1"]);
  assert.deepEqual(run({ ...base, refunds: [op("o1", "re_1", "submitted", 100)] }), []);
  assert.deepEqual(run({ ...base, refunds: [op("o1", "re_1"), op("o2", "re_2")], stripeRefunds: [ref("re_1", "o1"), ref("re_2", "o2")] }), ["over_refunded:pi_1"]);
  assert.deepEqual(run({ ...base, stripeRefunds: [ref("re_9", null, { status: "failed" })] }), []);
  assert.deepEqual(run({ stripeRefunds: [{ ...ref("re_9", null), paymentIntentId: "pi_other" }] }), []);
});

function stripeFetch(pages: Record<string, unknown[]>, hasMoreForever = false): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input)); const key = url.pathname.split("/v1/")[1]!;
    const rows = pages[key] ?? []; const after = url.searchParams.get("starting_after");
    const index = after ? rows.findIndex((r) => (r as { id: string }).id === after) + 1 : 0;
    const data = hasMoreForever ? rows.slice(0, 1) : rows.slice(index, index + 2);
    return Response.json({ data, has_more: hasMoreForever || index + 2 < rows.length });
  }) as typeof fetch;
}

test("lister pages through results and maps only our sessions and refunds", async () => {
  const lister = createStripeLister({ secretKey: "sk_test_x", mode: "test", fetch: stripeFetch({
    "checkout/sessions": [1, 2, 3].map((n) => ({ id: `cs_${n}`, payment_intent: `pi_${n}`, payment_status: "paid", amount_total: 2500, currency: "usd", created: 10, metadata: n === 2 ? {} : { attempt_id: "a" } })),
    refunds: [{ id: "re_1", payment_intent: "pi_1", status: "succeeded", amount: 2500, created: 10, metadata: { app_refund_operation_id: "o1" } }] }) });
  const s = await lister.sessions(0);
  assert.equal(s.complete, true); assert.deepEqual(s.rows.map((r) => r.ours), [true, false, true]);
  assert.equal((await lister.refunds(0)).rows[0]!.operationId, "o1");
  assert.throws(() => createStripeLister({ secretKey: "sk_live_x", mode: "test" }));
});

test("run: not due skips Stripe; due records findings; an unreadable window is recorded as incomplete and resolves nothing", async () => {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const lister = createStripeLister({ secretKey: "sk_test_x", mode: "test", fetch: stripeFetch({ "checkout/sessions": [{ id: "cs_1", payment_intent: "pi_1", payment_status: "paid", amount_total: 2500, currency: "usd", created: hoursAgo(5) / 1000, metadata: { attempt_id: "a" } }] }) });
  const rpc = (due: boolean) => async (name: string, args?: Record<string, unknown>) => { calls.push([name, args]); return name === "claim_reconciliation_run" ? { due, payments: [], refunds: [] } : 1; };
  assert.equal(await runReconciliation({ rpc: rpc(false), stripe: lister, mode: "test", now: () => now }), "not_due");
  assert.deepEqual(calls.map((c) => c[0]), ["claim_reconciliation_run"]);
  assert.deepEqual(await runReconciliation({ rpc: rpc(true), stripe: lister, mode: "test", now: () => now }), { findings: 1, complete: true });
  assert.deepEqual(calls.at(-1)![1], { p_findings: [{ kind: "paid_not_recorded", ref: "pi_1", detail: { amountCents: 2500 } }], p_complete: true });
  const endless = createStripeLister({ secretKey: "sk_test_x", mode: "test", fetch: stripeFetch({ "checkout/sessions": [{ id: "cs_1", payment_intent: "pi_1", payment_status: "paid", amount_total: 2500, currency: "usd", created: 1 }, { id: "cs_2" }], refunds: [] }, true) });
  const result = await runReconciliation({ rpc: rpc(true), stripe: endless, mode: "test", now: () => now });
  assert.deepEqual(result, { findings: 1, complete: false });
  assert.equal((calls.at(-1)![1] as { p_complete: boolean }).p_complete, false);
});

test("run: more than 200 findings are recorded as 199 plus a truncation summary and never marked complete", async () => {
  const rows: StripeSession[] = Array.from({ length: 250 }, (_, i) => sess(`pi_${i}`));
  const stripe = { sessions: async () => ({ rows, complete: true }), refunds: async () => ({ rows: [], complete: true }) } as unknown as Parameters<typeof runReconciliation>[0]["stripe"];
  const calls: Array<Record<string, unknown> | undefined> = [];
  const rpc = async (name: string, args?: Record<string, unknown>) => { if (name === "claim_reconciliation_run") return { due: true, payments: [], refunds: [] }; calls.push(args); return 1; };
  const result = await runReconciliation({ rpc, stripe, mode: "test", now: () => now });
  assert.deepEqual(result, { findings: 250, complete: false });
  const sent = calls[0] as { p_findings: Array<{ kind: string; detail: { total?: number } }>; p_complete: boolean };
  assert.equal(sent.p_findings.length, 200);
  assert.equal(sent.p_findings.at(-1)!.kind, "findings_truncated");
  assert.equal(sent.p_findings.at(-1)!.detail.total, 250);
  assert.equal(sent.p_complete, false);
});
