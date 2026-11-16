/** Scheduler entry: one authenticated pass over every durable queue the app owns. */

import { timingSafeEqual } from "node:crypto";
import { env } from "node:process";
import { deliverNotices } from "./notice-delivery.server.ts";
import { createNoticeSender } from "./notice-sender.server.ts";
import { createSupabaseProfileStorage } from "./profile.storage.supabase.server.ts";
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
  cleanupEvidence?: () => Promise<unknown>;
  reconcile?: () => Promise<unknown>;
  recordHeartbeat?: (ok: boolean, summary: Record<string, unknown>) => Promise<unknown>;
}>;

const MAX_INVITATIONS_PER_RUN = 20;

async function rpc(environment: Environment, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const url = environment.SUPABASE_URL?.trim(), key = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) throw new Error("rpc_unavailable");
  const response = await fetch(new URL(`/rest/v1/rpc/${name}`, url), { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw Object.assign(new Error("rpc_failed"), { stale: body.includes("cleanup_claim_stale") || body.includes('"40001"') });
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const CLEANUP_BATCH = 25;
type CleanupRow = { file_id: string; quarantine_key: string | null; normalized_key: string | null; cleanup_claimed_at: string };

/** Claim due identity-photo files, delete the objects, then mark them deleted. Counts only. */
export async function cleanupEvidenceFiles(
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  storage: { remove(keys: readonly string[]): Promise<void> },
): Promise<{ claimed: number; deleted: number; stale: number }> {
  const rows = (await call("claim_due_profile_evidence_cleanup", { p_limit: CLEANUP_BATCH }) ?? []) as CleanupRow[];
  const result = { claimed: rows.length, deleted: 0, stale: 0 };
  let failed = 0;
  for (const row of rows) {
    try {
      await storage.remove([row.quarantine_key, row.normalized_key].filter((k): k is string => !!k));
    } catch { failed += 1; continue; } // no finish: the claim expires after 10 minutes and the file is retried
    try {
      await call("finish_profile_evidence_cleanup", { p_file_id: row.file_id, p_claimed_at: row.cleanup_claimed_at });
      result.deleted += 1;
    } catch (error) {
      if ((error as { stale?: boolean }).stale) result.stale += 1; else failed += 1;
    }
  }
  if (failed) throw new Error("cleanup_failed");
  return result;
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
  if (deps.cleanupEvidence) {
    try { summary.evidenceCleanup = await deps.cleanupEvidence(); } catch { summary.evidenceCleanup = "error"; }
  }
  if (deps.reconcile) {
    // Reported but not part of `ok`: a Stripe outage must not make the five-minute heartbeat look unhealthy. The overview flags a stale check instead.
    try { summary.reconciliation = await deps.reconcile(); } catch { summary.reconciliation = "error"; }
  }
  summary.ok = summary.invitations !== "error" && summary.refunds !== "error" && summary.votePurge !== "error" && summary.retention !== "error" && summary.notices !== "error" && summary.evidenceCleanup !== "error";
  if (deps.recordHeartbeat) {
    // The heartbeat records that a pass ran (and whether it was clean); counts only, never content.
    const compact = (v: unknown) => (typeof v === "string" ? v : "ran");
    const outcomes = Object.fromEntries(["invitations", "refunds", "votePurge", "notices", "retention", "evidenceCleanup", "reconciliation"].filter((k) => summary[k] !== undefined).map((k) => [k, compact(summary[k])]));
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
    cleanupEvidence: () => cleanupEvidenceFiles((name, args) => rpc(environment, name, args), createSupabaseProfileStorage({ url: environment.SUPABASE_URL?.trim() ?? "", publishableKey: "", secretKey: (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim() ?? "" })),
    ...(reconcile ? { reconcile } : {}),
    recordHeartbeat: (ok, summary) => rpc(environment, "record_worker_heartbeat", { p_ok: ok, p_summary: summary }),
  };
  const summary = await runWorkerPass(resolved, environment.REFUND_WORKER_READY === "true");
  return Response.json(summary, { status: summary.ok ? 200 : 500, headers });
}
