/** Reads current host-to-Table UUID assignments from the private W05 relation. */

import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { TrustedAssignmentReader, TrustedResourceAssignments } from "./principal.server.ts";

type Fetcher = typeof fetch;
type Config = SupabaseServerConfig & Readonly<{ fetch?: Fetcher }>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SupplyTableAssignmentReaderError extends Error {
  readonly code: "configuration_invalid" | "request_failed" | "response_invalid";
  constructor(code: SupplyTableAssignmentReaderError["code"]) { super(code); this.name = "SupplyTableAssignmentReaderError"; this.code = code; }
}

function validateUrl(config: Config): URL {
  let url: URL;
  try { url = new URL(config.url); } catch { throw new SupplyTableAssignmentReaderError("configuration_invalid"); }
  if (!["https:", "http:"].includes(url.protocol) || (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    || !config.secretKey.trim() || !config.publishableKey.trim() || config.secretKey === config.publishableKey) {
    throw new SupplyTableAssignmentReaderError("configuration_invalid");
  }
  return url;
}

export function createSupplyTableAssignmentReader(config: Config): TrustedAssignmentReader {
  const baseUrl = validateUrl(config); const fetchImpl = config.fetch ?? fetch;
  return Object.freeze({
    async readForAuthUser(authUserId: string): Promise<TrustedResourceAssignments> {
      if (!uuidPattern.test(authUserId)) throw new SupplyTableAssignmentReaderError("response_invalid");
      const url = new URL("/rest/v1/app_supply_table_assignments", baseUrl);
      url.searchParams.set("select", "table_id,user_id");
      url.searchParams.set("user_id", `eq.${authUserId}`);
      let response: Response;
      try {
        response = await fetchImpl(url, { method: "GET", headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5_000) });
      } catch { throw new SupplyTableAssignmentReaderError("request_failed"); }
      if (!response.ok) throw new SupplyTableAssignmentReaderError("request_failed");
      let rows: unknown;
      try { rows = await response.json() as unknown; } catch { throw new SupplyTableAssignmentReaderError("response_invalid"); }
      if (!Array.isArray(rows) || rows.length > 500 || rows.some((row) => typeof row !== "object" || row === null || Array.isArray(row)
        || (row as Record<string, unknown>).user_id !== authUserId || typeof (row as Record<string, unknown>).table_id !== "string"
        || !uuidPattern.test((row as Record<string, string>).table_id))) throw new SupplyTableAssignmentReaderError("response_invalid");
      return Object.freeze({ tableIds: Object.freeze([...new Set(rows.map((row) => (row as Record<string, string>).table_id))]), venueIds: Object.freeze([]) });
    },
  });
}
