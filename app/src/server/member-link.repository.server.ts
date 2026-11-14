/** Server-only, durable per-admission returning-link cooldown RPC adapter. */

import type { ReturningLinkRequestRepository } from "./admission.contracts.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

export class MemberLinkRepositoryError extends Error {
  readonly code = "temporarily_unavailable" as const;
  constructor() { super("member_link_repository_unavailable"); this.name = "MemberLinkRepositoryError"; }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateConfig(config: SupabaseServerConfig): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new MemberLinkRepositoryError(); }
  if (!((url.protocol === "https:") || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    || url.pathname !== "/" || url.search || url.hash || url.username || url.password
    || !config.secretKey || config.secretKey === config.publishableKey) throw new MemberLinkRepositoryError();
  return url;
}

export function createMemberLinkRepository(
  config: SupabaseServerConfig,
  fetcher: typeof fetch = globalThis.fetch,
): Pick<ReturningLinkRequestRepository, "claimRecipientCooldown"> {
  const baseUrl = validateConfig(config);
  return Object.freeze({
    async claimRecipientCooldown(input): Promise<boolean> {
      const requestedAt = Date.parse(input.requestedAt);
      if (!uuidPattern.test(input.admissionId) || !Number.isFinite(requestedAt)
        || !Number.isInteger(input.cooldownSeconds) || input.cooldownSeconds < 30 || input.cooldownSeconds > 3600) {
        throw new MemberLinkRepositoryError();
      }
      let response: Response;
      try {
        response = await fetcher(new URL("/rest/v1/rpc/claim_member_link_cooldown", baseUrl), {
          method: "POST",
          headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ p_admission_id: input.admissionId, p_requested_at: new Date(requestedAt).toISOString(), p_cooldown_seconds: input.cooldownSeconds }),
          cache: "no-store",
          redirect: "error",
        });
      } catch { throw new MemberLinkRepositoryError(); }
      if (!response.ok) throw new MemberLinkRepositoryError();
      const result: unknown = await response.json().catch(() => null);
      if (typeof result !== "boolean") throw new MemberLinkRepositoryError();
      return result;
    },
  });
}
