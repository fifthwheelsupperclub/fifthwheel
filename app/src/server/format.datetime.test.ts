import assert from "node:assert/strict";
import test from "node:test";
import { calendarDate, clockAfter, eventDate, eventTime, eventWhen, instantDate, instantTime, monthDay, timestamp, todayInAtlanta, weekStart } from "../format/datetime.ts";

const now = new Date("2026-11-15T12:00:00Z");
test("event dates drop the year only when it is this year", () => {
  assert.equal(eventDate("2026-12-12", { now }), "Sat, Dec 12");
  assert.equal(eventDate("2027-01-02", { now }), "Sat, Jan 2, 2027");
  assert.equal(eventDate("2026-12-12", { long: true }), "Saturday, December 12, 2026");
  assert.equal(eventDate("2026-02-31"), "Date unavailable");
  assert.equal(calendarDate("1990-04-14"), "April 14, 1990");
});
test("times are 12-hour and never 24-hour", () => {
  assert.equal(eventTime("19:00"), "7:00 PM");
  assert.equal(eventTime("07:05:00"), "7:05 AM");
  assert.equal(eventTime("25:00"), "Time unavailable");
  assert.equal(clockAfter("19:00", 45), "7:45 PM");
  assert.equal(clockAfter("23:30", 60), "12:30 AM");
  assert.equal(eventWhen("2026-12-12", "19:00", { now }), "Sat, Dec 12 · 7:00 PM");
});
test("instants render in Atlanta time regardless of the machine zone", () => {
  assert.equal(instantTime("2026-11-13T15:00:00Z"), "10:00 AM");
  assert.equal(instantDate("2026-11-13T15:00:00Z", { now }), "Nov 13");
  assert.equal(timestamp("2026-11-13T15:00:00Z", { now }), "Nov 13, 10:00 AM");
  assert.equal(timestamp("2025-12-31T23:30:00Z", { now }), "Dec 31, 2025, 6:30 PM");
  assert.equal(timestamp(null), "Not available");
});

test("week helpers use Atlanta's calendar and Monday-based weeks", () => {
  assert.equal(monthDay("2026-12-14"), "Dec 14");
  assert.equal(weekStart("2026-12-12"), "2026-12-07");
  assert.equal(weekStart("2026-12-14"), "2026-12-14");
  assert.equal(weekStart("2026-12-13"), "2026-12-07");
  assert.equal(todayInAtlanta(new Date("2026-11-16T03:00:00Z")), "2026-11-15");
});
