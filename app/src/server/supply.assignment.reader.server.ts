/** Trusted host Table assignments loaded server-side; errors fail closed. */

import type { SupabaseServerConfig } from "./supabase.server.ts";
import type { TrustedAssignmentReader, TrustedResourceAssignments } from "./principal.server.ts";

type Fetcher = typeof fetch;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSupplyAssignmentReader(config: SupabaseServerConfig, fetchImpl: Fetcher = fetch): TrustedAssignmentReader {
  const url = new URL(config.url);
  if (!config.secretKey.trim()) throw new Error("configuration_invalid");
  return Object.freeze({
    async readForAuthUser(authUserId: string): Promise<TrustedResourceAssignments> {
      if (!uuidPattern.test(authUserId)) throw new Error("assignment_input_invalid");
      let response: Response;
      try {
        const endpoint = new URL("/rest/v1/app_supply_table_assignments", url);
        endpoint.searchParams.set("select", "table_id");
        endpoint.searchParams.set("user_id", `eq.${authUserId}`);
        response = await fetchImpl(endpoint, { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` }, cache: "no-store" });
      } catch { throw new Error("assignment_read_unavailable"); }
      if (!response.ok) throw new Error("assignment_read_unavailable");
      let rows: unknown;
      try { rows = await response.json() as unknown; } catch { throw new Error("assignment_response_invalid"); }
      if (!Array.isArray(rows) || rows.some((row) => typeof row !== "object" || row === null || !uuidPattern.test(String((row as Record<string, unknown>).table_id)))) {
        throw new Error("assignment_response_invalid");
      }
      return { tableIds: rows.map((row) => (row as { table_id: string }).table_id), venueIds: [] };
    },
  });
}
