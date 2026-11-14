/** W07.3 member Seat reads; no cancellation, payment or refund mutations. */

import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";
import type {
  SeatDetailInput, SeatListInput, SeatReadFailure, SeatReadResult, SeatRepository,
  SeatService, SeatServiceDependencies,
} from "./seats.contract.server.ts";
import type { MemberSeatDetailDTO, MemberSeatErrorCode, MemberSeatListDTO, SeatStatusReaderResult } from "../seats.contract.ts";
import { SeatRepositoryError } from "./seats.repository.server.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = <T>(code: MemberSeatErrorCode, safeMessage: string, retryable = false): SeatReadResult<T> =>
  ({ ok: false, error: { code, safeMessage, retryable } });
function mapRepositoryFailure<T>(error: unknown): SeatReadResult<T> {
  if (error instanceof SeatRepositoryError && error.code === "not_found") return fail("not_found", "This Seat could not be found.");
  if (error instanceof SeatRepositoryError && error.code === "invalid_input") return fail("invalid_input", "Check the Seat link and try again.");
  if (error instanceof SeatRepositoryError && error.code === "forbidden") return fail("forbidden", "Member access is not active for this account.");
  return fail("temporarily_unavailable", "Seat information is temporarily unavailable.", true);
}
function encodeCursor(value: Readonly<{ createdAt: string; seatId: string }>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function decodeCursor(value: string | null | undefined): Readonly<{ createdAt: string; seatId: string }> | null | false {
  if (value == null || value === "") return null;
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
      || typeof record.seatId !== "string" || !uuid.test(record.seatId)) return false;
    return Object.freeze({ createdAt: new Date(record.createdAt).toISOString(), seatId: record.seatId });
  } catch { return false; }
}
function seatActor<T>(token: string | null | undefined, resolve: SeatServiceDependencies["resolvePrincipal"]): Promise<
  | Readonly<{ ok: true; principal: ServerVerifiedPrincipal }>
  | Readonly<{ ok: false; result: SeatReadResult<T> }>
> {
  if (typeof token !== "string" || token.trim() === "") return Promise.resolve({ ok: false, result: fail("unauthenticated", "Sign in to view your Seats.") });
  return resolve(token).then((principal) => {
    if (!principal) return { ok: false as const, result: fail<T>("unauthenticated", "Sign in to view your Seats.") };
    if (!authorize(principal, { workspace: "member", action: "member:read-own" }).allowed) {
      return { ok: false as const, result: fail<T>("forbidden", "Member access is not active for this account.") };
    }
    return { ok: true as const, principal };
  }).catch(() => ({ ok: false as const, result: fail<T>("temporarily_unavailable", "Seat information is temporarily unavailable.", true) }));
}
function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function utcIcsDate(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z") : null;
}
function calendarText(seat: MemberSeatDetailDTO, now: number): string | null {
  const startsAt = utcIcsDate(seat.table.startsAt);
  if (!startsAt) return null;
  const stops = seat.table.itinerary.map((stop) =>
    `${stop.role.toUpperCase()} (+${stop.minutesFromStart} min): ${stop.venueName}, ${stop.venueAddress}${stop.publicNotes ? ` — ${stop.publicNotes}` : ""}`);
  const description = [`${seat.table.neighborhood} · ${seat.table.startLocalTime} ${seat.table.timeZone}`, ...stops].join("\n");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fifth Wheel//My Seats//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${seat.seatId}@fifthwheel.app`, `DTSTAMP:${new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
    `DTSTART:${startsAt}`, `SUMMARY:${escapeIcs(seat.table.title)}`,
    `LOCATION:${escapeIcs(seat.table.itinerary[0].venueAddress)}`, `DESCRIPTION:${escapeIcs(description)}`,
    "END:VEVENT", "END:VCALENDAR", "",
  ];
  return lines.join("\r\n");
}

export function createSeatService(deps: SeatServiceDependencies): SeatService {
  return Object.freeze({
    async list(input: SeatListInput): Promise<SeatReadResult<MemberSeatListDTO>> {
      const cursor = decodeCursor(input.cursor);
      if (cursor === false || (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50))) {
        return fail("invalid_input", "Check the Seat list filters and try again.");
      }
      const actor = await seatActor<MemberSeatListDTO>(input.accessToken, deps.resolvePrincipal);
      if (!actor.ok) return actor.result;
      try {
        const result = await deps.repository.listMySeats(actor.principal.userId, cursor, input.limit ?? 20);
        return { ok: true, value: result };
      } catch (error) { return mapRepositoryFailure(error); }
    },
    async read(input: SeatDetailInput): Promise<SeatReadResult<MemberSeatDetailDTO>> {
      if (!uuid.test(input.seatId)) return fail("invalid_input", "Check the Seat link and try again.");
      const actor = await seatActor<MemberSeatDetailDTO>(input.accessToken, deps.resolvePrincipal);
      if (!actor.ok) return actor.result;
      try { return { ok: true, value: await deps.repository.readMySeat(actor.principal.userId, input.seatId) }; }
      catch (error) { return mapRepositoryFailure(error); }
    },
    async calendar(input: SeatDetailInput): Promise<SeatReadResult<string>> {
      const detail = await this.read(input);
      if (!detail.ok) return detail;
      if (!detail.value.calendar.available) return fail("conflict", "Calendar export is available for future active Seats only.");
      const body = calendarText(detail.value, (deps.now ?? Date.now)());
      if (!body) return fail("temporarily_unavailable", "The calendar file is temporarily unavailable.", true);
      return { ok: true, value: body };
    },
    async readInvitationSeatStatus(input: Readonly<{ invitationId: string }>): Promise<SeatStatusReaderResult> {
      if (!uuid.test(input.invitationId)) return Object.freeze({ status: "unknown" });
      try { return await deps.repository.readInvitationSeatStatus(input.invitationId); }
      catch { return Object.freeze({ status: "unknown" }); }
    },
  });
}
