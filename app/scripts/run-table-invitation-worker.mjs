// One-shot local delivery worker. Its runtime refuses non-loopback Supabase/Mailpit URLs.
import { createTableInvitationDeliveryWorkerRuntime } from "../src/server/table-invitations-runtime.server.ts";
import { runLocalTableInvitationWorker } from "../src/server/table-invitation-worker.local.server.ts";

try {
  const result = await runLocalTableInvitationWorker(process.env, () => createTableInvitationDeliveryWorkerRuntime());
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  process.stderr.write("Local Table invitation worker unavailable. Check local Supabase, Mailpit and APP_ORIGIN configuration.\n");
  process.exitCode = 1;
}
