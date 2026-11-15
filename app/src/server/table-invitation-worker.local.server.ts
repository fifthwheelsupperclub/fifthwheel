/** Guard the one-shot local delivery path before constructing its repository or provider. */

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLocalWorkerSupabaseUrl(value: string | undefined): void {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("local_worker_requires_loopback_supabase"); }
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("local_worker_requires_loopback_supabase");
  }
}

export async function runLocalTableInvitationWorker<T extends Readonly<{ deliverNext(): Promise<unknown> }>>(
  environment: Readonly<Record<string, string | undefined>>,
  createWorker: () => T,
): Promise<unknown> {
  // This check must precede runtime construction: constructors wire the service-role
  // repository, so an HTTPS hosted URL must never be accepted by the local worker.
  assertLocalWorkerSupabaseUrl(environment.SUPABASE_URL);
  const worker = createWorker();
  return worker.deliverNext();
}
