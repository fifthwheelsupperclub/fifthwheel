/** Scheduler entry: one authenticated pass over every durable queue the app owns. */

import { timingSafeEqual } from "node:crypto";
import { env } from "node:process";
import { deliverNotices } from "./notice-delivery.server.ts";
import { createNoticeSender } from "./notice-sender.server.ts";
import { createReconciliationRuntime } from "./stripe-reconciliation.server.ts";
import { createRefundWorkerRuntime } from "./refunds-runtime.server.ts";
import { createTableInvitationDeliveryWorkerRuntime } from "./table-invitations-runtime.server.ts";

type Environment = Readonly<Record<string, string | undefined>>;
export type WorkerDeps = Readonly<{
  deliverInvitation: () => Promise<{ state: string }>;
  runRefunds: () => Promise<unknown>;
  purgeVotes?: () => Promise<unknown>;
  deliverNotices?: () => Promise<unknown>;
  runRetention?: () => Promise<unknown>;
  reconcile?: () => Promise<unknown>;
  recordHeartbeat?: (ok: boolean, summary: Record<string, unknown>) => Promise<unknown>;
}>;

const MAX_INVITATIONS_PER_RUN = 20;

async function rpc(environment: Environment, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const url = environment.SUPABASE_URL?.trim(), key = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) throw new Error("rpc_unavailable");
  const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  if (!response.ok) throw new Error("rpc_failed");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function isAuthorized(request: Request, environment: Environment): boolean {
  const expected = environment.JOB_SECRET?.trim() ?? "";
  const presented = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(presented), b = Buffer.from(expected);
  return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}

export async function runWorkerPass(deps: WorkerDeps, refundsReady: boolean) {
  const summary: Record<string, unknown> = { invitations: { delivered: 0, other: 0 }, refunds: refundsReady ? "ran" : "disabled" };
  const inv = summary.invitations as { delivered: number; other: number };
  try {
    for (let i = 0; i < MAX_INVITATIONS_PER_RUN; i += 1) {
      const result = await deps.deliverInvitation();
      if (result.state === "idle") break;
      if (result.state === "accepted") inv.delivered += 1; else inv.other += 1;
    }
  } catch { summary.invitations = "error"; }
  if (refundsReady) {
    try { summary.refunds = await deps.runRefunds(); } catch { summary.refunds = "error"; }
  }
  if (deps.purgeVotes) {
    try { summary.votePurge = await deps.purgeVotes(); } catch { summary.votePurge = "error"; }
  }
  if (deps.deliverNotices) {
    try { summary.notices = await deps.deliverNotices(); } catch { summary.notices = "error"; }
  }
  if (deps.runRetention) {
    try { summary.retention = await deps.runRetention(); } catch { summary.retention = "error"; }
  }
  if (deps.reconcile) {
    // Reported but not part of `ok`: a Stripe outage must not make the five-minute heartbeat look unhealthy. The overview flags a stale check instead.
    try { summary.reconciliation = await deps.reconcile(); } catch { summary.reconciliation = "error"; }
  }
  summary.ok = summary.invitations !== "error" && summary.refunds !== "error" && summary.votePurge !== "error" && summary.retention !== "error" && summary.notices !== "error";
  if (deps.recordHeartbeat) {
    // The heartbeat records that a pass ran (and whether it was clean); counts only, never content.
    const compact = (v: unknown) => (typeof v === "string" ? v : "ran");
    const outcomes = Object.fromEntries(["invitations", "refunds", "votePurge", "notices", "retention", "reconciliation"].filter((k) => summary[k] !== undefined).map((k) => [k, compact(summary[k])]));
    try { await deps.recordHeartbeat(summary.ok === true, outcomes); }
    catch { summary.heartbeat = "error"; summary.ok = false; }
  }
  return summary;
}

export async function handleWorkerRequest(request: Request, environment: Environment = env, deps?: WorkerDeps): Promise<Response> {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (!isAuthorized(request, environment)) return Response.json({ ok: false }, { status: 401, headers });
  const reconcile = deps ? undefined : createReconciliationRuntime(environment, (name, args) => rpc(environment, name, args ?? {}));
  const resolved: WorkerDeps = deps ?? {
    deliverInvitation: () => createTableInvitationDeliveryWorkerRuntime(environment).deliverNext(),
    runRefunds: () => createRefundWorkerRuntime(environment.REFUND_WORKER_SECRET ?? "", environment).runOnce(10),
    deliverNotices: () => { const sender = createNoticeSender(environment); return deliverNotices({ rpc: (name, args) => rpc(environment, name, args ?? {}), send: sender.send, appOrigin: sender.appOrigin }); },
    purgeVotes: () => rpc(environment, "purge_vote_data"),
    runRetention: () => rpc(environment, "run_retention"),
    ...(reconcile ? { reconcile } : {}),
    recordHeartbeat: (ok, summary) => rpc(environment, "record_worker_heartbeat", { p_ok: ok, p_summary: summary }),
  };
  const summary = await runWorkerPass(resolved, environment.REFUND_WORKER_READY === "true");
  return Response.json(summary, { status: summary.ok ? 200 : 500, headers });
}
