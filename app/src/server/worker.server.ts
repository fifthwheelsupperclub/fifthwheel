/** Scheduler entry: one authenticated pass over every durable queue the app owns. */

import { timingSafeEqual } from "node:crypto";
import { env } from "node:process";
import { createRefundWorkerRuntime } from "./refunds-runtime.server.ts";
import { createTableInvitationDeliveryWorkerRuntime } from "./table-invitations-runtime.server.ts";

type Environment = Readonly<Record<string, string | undefined>>;
export type WorkerDeps = Readonly<{
  deliverInvitation: () => Promise<{ state: string }>;
  runRefunds: () => Promise<unknown>;
  purgeVotes?: () => Promise<unknown>;
}>;

const MAX_INVITATIONS_PER_RUN = 20;

/** Ballots 30 days after the Table and results after 90 days; idempotent, so every pass may call it. */
async function purgeVoteData(environment: Environment): Promise<unknown> {
  const url = environment.SUPABASE_URL?.trim(), key = (environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) throw new Error("purge_unavailable");
  const response = await fetch(new URL("/rest/v1/rpc/purge_vote_data", url), { method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: "{}" });
  if (!response.ok) throw new Error("purge_failed");
  return response.json();
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
  summary.ok = summary.invitations !== "error" && summary.refunds !== "error" && summary.votePurge !== "error";
  return summary;
}

export async function handleWorkerRequest(request: Request, environment: Environment = env, deps?: WorkerDeps): Promise<Response> {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (!isAuthorized(request, environment)) return Response.json({ ok: false }, { status: 401, headers });
  const resolved: WorkerDeps = deps ?? {
    deliverInvitation: () => createTableInvitationDeliveryWorkerRuntime(environment).deliverNext(),
    runRefunds: () => createRefundWorkerRuntime(environment.REFUND_WORKER_SECRET ?? "", environment).runOnce(10),
    purgeVotes: () => purgeVoteData(environment),
  };
  const summary = await runWorkerPass(resolved, environment.REFUND_WORKER_READY === "true");
  return Response.json(summary, { status: summary.ok ? 200 : 500, headers });
}
