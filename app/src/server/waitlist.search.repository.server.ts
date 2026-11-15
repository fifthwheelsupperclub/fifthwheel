/** Server-only admin waitlist search with a minimal review projection. */

import { Buffer } from "node:buffer";
import type {
  DeliveryOperationState,
  MarketingOpenTo,
  WaitlistIdentity,
  WaitlistRepository,
  WaitlistReviewItem,
} from "./admission.contracts.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

export type WaitlistSearchErrorCode =
  | "configuration_invalid"
  | "validation_failed"
  | "provider_failed"
  | "provider_data_invalid";

/** Safe internal search error. No PostgREST body or searched values are included. */
export class WaitlistSearchRepositoryError extends Error {
  readonly code: WaitlistSearchErrorCode;

  constructor(code: WaitlistSearchErrorCode) {
    super(code);
    this.name = "WaitlistSearchRepositoryError";
    this.code = code;
  }
}

type Cursor = Readonly<{ receivedAt: string; id: string }>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;
const neighborhoods = new Set(["Inman Park", "Chamblee", "Virginia Highlands"]);
const identities = new Set<WaitlistIdentity>(["Woman", "Man", "Non-binary"]);
const openToValues = new Set<MarketingOpenTo>(["Women", "Men", "Non-binary people"]);
const deliveryStates = new Set<string>(["queued", "sending", "accepted", "delivered", "failed", "unknown"]);
const admissionStates = new Set(["invited", "activated", "deleted"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = timestampPattern.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > monthDays[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
    || (zone !== "Z" && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function validateConfig(config: SupabaseServerConfig): URL {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new WaitlistSearchRepositoryError("configuration_invalid");
  }
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    !["https:", "http:"].includes(url.protocol)
    || (url.protocol === "http:" && !loopbackHosts.has(url.hostname))
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || typeof config.publishableKey !== "string"
    || config.publishableKey.trim().length === 0
    || typeof config.secretKey !== "string"
    || config.secretKey.trim().length === 0
    || config.secretKey.trim() === config.publishableKey.trim()
  ) {
    throw new WaitlistSearchRepositoryError("configuration_invalid");
  }
  return url;
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;
  if (value.length === 0 || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new WaitlistSearchRepositoryError("validation_failed");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !isRecord(decoded)
      || Object.keys(decoded).length !== 2
      || !isTimestamp(decoded.receivedAt)
      || !isUuid(decoded.id)
    ) {
      throw new Error("invalid cursor");
    }
    return { receivedAt: decoded.receivedAt, id: decoded.id };
  } catch {
    throw new WaitlistSearchRepositoryError("validation_failed");
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function searchPattern(value: string): string {
  const likeEscaped = value.replace(/[\\%_]/g, "\\$&");
  const quoted = `%${likeEscaped}%`.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `or(${[
    `first_name.ilike."${quoted}"`,
    `last_name.ilike."${quoted}"`,
    `email_normalized.ilike."${quoted}"`,
  ].join(",")})`;
}

function parseWaitlistPageRow(value: unknown): Readonly<{
  id: string;
  firstName: string;
  lastName: string;
  emailNormalized: string;
  neighborhood: string;
  identity: WaitlistIdentity;
  openTo: readonly MarketingOpenTo[];
  receivedAt: string;
}> {
  if (!isRecord(value)) throw new WaitlistSearchRepositoryError("provider_data_invalid");
  if (
    !isUuid(value.id)
    || typeof value.first_name !== "string"
    || value.first_name.trim().length === 0
    || typeof value.last_name !== "string"
    || value.last_name.trim().length === 0
    || typeof value.email_normalized !== "string"
    || value.email_normalized !== value.email_normalized.trim().toLowerCase()
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email_normalized)
    || typeof value.neighborhood !== "string"
    || !neighborhoods.has(value.neighborhood)
    || typeof value.identity !== "string"
    || !identities.has(value.identity as WaitlistIdentity)
    || !Array.isArray(value.open_to)
    || value.open_to.length === 0
    || value.open_to.some((item) => typeof item !== "string" || !openToValues.has(item as MarketingOpenTo))
    || new Set(value.open_to).size !== value.open_to.length
    || !isTimestamp(value.received_at)
  ) {
    throw new WaitlistSearchRepositoryError("provider_data_invalid");
  }
  return {
    id: value.id,
    firstName: value.first_name,
    lastName: value.last_name,
    emailNormalized: value.email_normalized,
    neighborhood: value.neighborhood,
    identity: value.identity as WaitlistIdentity,
    openTo: value.open_to as MarketingOpenTo[],
    receivedAt: value.received_at,
  };
}

function parseDelivery(value: unknown, admissionId: string): WaitlistReviewItem["latestDelivery"] {
  if (!isRecord(value)) throw new WaitlistSearchRepositoryError("provider_data_invalid");
  if (
    !isUuid(value.id)
    || !isUuid(value.admission_id)
    || value.admission_id !== admissionId
    || !deliveryStates.has(String(value.state))
    || !isTimestamp(value.queued_at)
    || !isNullableTimestamp(value.accepted_at)
    || !isNullableTimestamp(value.delivered_at)
    || !isTimestamp(value.next_attempt_at)
  ) {
    throw new WaitlistSearchRepositoryError("provider_data_invalid");
  }
  if (
    ((value.state === "accepted" || value.state === "delivered") !== (value.accepted_at !== null))
    || ((value.state === "delivered") !== (value.delivered_at !== null))
    || (value.delivered_at !== null && Date.parse(value.accepted_at as string) > Date.parse(value.delivered_at as string))
  ) {
    throw new WaitlistSearchRepositoryError("provider_data_invalid");
  }
  // admissionId is currently used by the parent admission parser for linkage;
  // the child projection intentionally omits it from the minimal DTO.
  if (!isUuid(admissionId)) throw new WaitlistSearchRepositoryError("provider_data_invalid");
  return {
    id: value.id,
    state: value.state as DeliveryOperationState,
    queuedAt: value.queued_at,
    acceptedAt: value.accepted_at,
    deliveredAt: value.delivered_at,
    nextAttemptAt: value.next_attempt_at,
  };
}

export function createWaitlistSearchRepository(
  config: SupabaseServerConfig,
  fetcher: typeof fetch = globalThis.fetch,
): Pick<WaitlistRepository, "search"> {
  const baseUrl = validateConfig(config);

  async function getRows(url: URL): Promise<unknown[]> {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: {
          apikey: config.secretKey,
          authorization: `Bearer ${config.secretKey}`,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new WaitlistSearchRepositoryError("provider_failed");
    }
    if (!response.ok) throw new WaitlistSearchRepositoryError("provider_failed");
    let body: unknown;
    try {
      body = await response.json() as unknown;
    } catch {
      throw new WaitlistSearchRepositoryError("provider_data_invalid");
    }
    if (!Array.isArray(body)) throw new WaitlistSearchRepositoryError("provider_data_invalid");
    return body;
  }

  return Object.freeze({
    async search(input) {
      if (
        !Number.isInteger(input.limit)
        || input.limit < 1
        || input.limit > 100
        || (input.query !== undefined && typeof input.query !== "string")
        || (input.neighborhood !== undefined && typeof input.neighborhood !== "string")
      ) {
        throw new WaitlistSearchRepositoryError("validation_failed");
      }
      const query = input.query?.trim() ?? "";
      const neighborhood = input.neighborhood?.trim() ?? "";
      if (query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) {
        throw new WaitlistSearchRepositoryError("validation_failed");
      }
      if (neighborhood && !neighborhoods.has(neighborhood)) {
        throw new WaitlistSearchRepositoryError("validation_failed");
      }
      const cursor = decodeCursor(input.cursor);

      const pageUrl = new URL("/rest/v1/waitlist_signups", baseUrl);
      pageUrl.searchParams.set("select", "id,first_name,last_name,email_normalized,neighborhood,identity,open_to,received_at");
      pageUrl.searchParams.set("order", "received_at.desc,id.desc");
      pageUrl.searchParams.set("limit", String(input.limit + 1));
      if (neighborhood) pageUrl.searchParams.set("neighborhood", `eq.${neighborhood}`);
      const disjunctions: string[] = [];
      if (query) disjunctions.push(searchPattern(query));
      if (cursor) {
        disjunctions.push(`or(received_at.lt.${cursor.receivedAt},and(received_at.eq.${cursor.receivedAt},id.lt.${cursor.id}))`);
      }
      if (disjunctions.length === 1) {
        const [expression] = disjunctions;
        pageUrl.searchParams.set("or", expression.slice(2));
      } else if (disjunctions.length > 1) {
        pageUrl.searchParams.set("and", `(${disjunctions.join(",")})`);
      }

      const rawPage = await getRows(pageUrl);
      if (rawPage.length > input.limit + 1) throw new WaitlistSearchRepositoryError("provider_data_invalid");
      const parsedPage = rawPage.map(parseWaitlistPageRow);
      const hasMore = parsedPage.length > input.limit;
      const pageRows = parsedPage.slice(0, input.limit);
      const items: WaitlistReviewItem[] = pageRows.map((row) => ({
        ...row,
        admissionState: "none",
        latestDelivery: null,
      }));

      if (pageRows.length > 0) {
        const admissionUrl = new URL("/rest/v1/app_admissions", baseUrl);
        admissionUrl.searchParams.set(
          "select",
          "id,waitlist_signup_id,state,app_invitation_deliveries(id,admission_id,state,queued_at,accepted_at,delivered_at,next_attempt_at)",
        );
        admissionUrl.searchParams.set("waitlist_signup_id", `in.(${pageRows.map((row) => row.id).join(",")})`);
        admissionUrl.searchParams.set("app_invitation_deliveries.order", "queued_at.desc,id.desc");
        admissionUrl.searchParams.set("app_invitation_deliveries.limit", "2");

        const rawAdmissions = await getRows(admissionUrl);
        const itemById = new Map(items.map((item, index) => [item.id, index]));
        const seenSignupIds = new Set<string>();
        for (const value of rawAdmissions) {
          if (
            !isRecord(value)
            || !isUuid(value.id)
            || !isUuid(value.waitlist_signup_id)
            || !itemById.has(value.waitlist_signup_id)
            || seenSignupIds.has(value.waitlist_signup_id)
            || !admissionStates.has(String(value.state))
            || !Array.isArray(value.app_invitation_deliveries)
            || value.app_invitation_deliveries.length > 2
          ) {
            throw new WaitlistSearchRepositoryError("provider_data_invalid");
          }
          seenSignupIds.add(value.waitlist_signup_id);
          const itemIndex = itemById.get(value.waitlist_signup_id)!;
          items[itemIndex] = {
            ...items[itemIndex],
            admissionState: value.state as WaitlistReviewItem["admissionState"],
            latestDelivery: value.app_invitation_deliveries.length === 0
              ? null
              // The embedded query orders newest first; limiting to two keeps
              // the projection bounded while allowing ordering to be verified.
              : parseDelivery(value.app_invitation_deliveries[0], value.id),
          };
        }
      }

      const last = pageRows.at(-1);
      return {
        rows: items,
        nextCursor: hasMore && last ? encodeCursor({ receivedAt: last.receivedAt, id: last.id }) : null,
      };
    },
  });
}
