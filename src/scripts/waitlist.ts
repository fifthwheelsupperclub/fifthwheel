import { productionAppUrl } from "../data/site";
import { captureAttribution, captureTestMode, shouldTrackLead } from "./attribution";

let attributionStorage: Storage | undefined;
let testStorage: Storage | undefined;
try { attributionStorage = window.localStorage; } catch { /* Optional. */ }
try { testStorage = window.sessionStorage; } catch { /* Optional. */ }
const signupAttribution = captureAttribution(new URL(window.location.href), document.referrer, attributionStorage);
const testSignup = captureTestMode(new URL(window.location.href), testStorage);

// Posts to the guest app. That route writes waitlist rows in Supabase.
const ENDPOINT =
  import.meta.env.PUBLIC_WAITLIST_URL ??
  `${productionAppUrl}/api/waitlist`;
const STATUS_ID = "formStatus";
const MINIMUM_AGE = 21;
const MAXIMUM_MATCH_AGE = 120;
const SUBMIT_TIMEOUT_MS = 15_000;
const FAILURE_MESSAGE =
  "That didn’t go through. Try again, or email hello@fifthwheel.community and we’ll add you by hand.";
const TIMEOUT_MESSAGE =
  "That’s taking too long. Try again, or email hello@fifthwheel.community and we’ll add you by hand.";

function requireAs<T extends HTMLElement>(
  el: unknown,
  predicate: (value: unknown) => value is T,
): T {
  if (!predicate(el)) {
    throw new Error("Waitlist form markup is incomplete.");
  }
  return el;
}

const form = requireAs(
  document.getElementById("waitlistForm"),
  (value): value is HTMLFormElement => value instanceof HTMLFormElement,
);
const statusEl = requireAs(
  document.getElementById("formStatus"),
  (value): value is HTMLElement => value instanceof HTMLElement,
);
const btn = requireAs(
  document.getElementById("submitBtn"),
  (value): value is HTMLButtonElement => value instanceof HTMLButtonElement,
);
const formPanel = requireAs(
  document.getElementById("formPanel"),
  (value): value is HTMLElement => value instanceof HTMLElement,
);
const thanksPanel = requireAs(
  document.getElementById("thanksPanel"),
  (value): value is HTMLElement => value instanceof HTMLElement,
);
const jump = requireAs(
  document.querySelector("[data-jump]"),
  (value): value is HTMLElement => value instanceof HTMLElement,
);

const birthMonth = requireAs(
  document.getElementById("f-birth-month"),
  (value): value is HTMLSelectElement => value instanceof HTMLSelectElement,
);
const birthDay = requireAs(
  document.getElementById("f-birth-day"),
  (value): value is HTMLSelectElement => value instanceof HTMLSelectElement,
);
const birthYear = requireAs(
  document.getElementById("f-birth-year"),
  (value): value is HTMLInputElement => value instanceof HTMLInputElement,
);

function setStatus(el: HTMLElement, msg: string, kind?: "err" | "ok"): void {
  el.textContent = msg;
  el.className = "form-status" + (kind ? ` ${kind}` : "");
}

let describedField: HTMLElement | null = null;
let describedByBefore: string | null = null;

function clearFieldError(): void {
  if (!describedField) return;
  describedField.removeAttribute("aria-invalid");
  if (describedByBefore) {
    describedField.setAttribute("aria-describedby", describedByBefore);
  } else {
    describedField.removeAttribute("aria-describedby");
  }
  describedField = null;
  describedByBefore = null;
}

function firstNamedControl(name: string): HTMLElement | null {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLElement) return el;
  if (el instanceof RadioNodeList) {
    const first = el.item(0);
    return first instanceof HTMLElement ? first : null;
  }
  return null;
}

function failField(name: string, message: string): void {
  clearFieldError();
  setStatus(statusEl, message, "err");
  const control = firstNamedControl(name);
  if (!control) return;
  describedByBefore = control.getAttribute("aria-describedby");
  const describedIds = new Set(
    (describedByBefore ?? "").split(/\s+/).filter(Boolean),
  );
  describedIds.add(STATUS_ID);
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-describedby", [...describedIds].join(" "));
  describedField = control;
  control.focus();
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function startOfAtlantaDay(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((item) => item.type === type)?.value);
  return new Date(part("year"), part("month") - 1, part("day"));
}

function ageOn(birth: Date, on: Date): number {
  let age = on.getFullYear() - birth.getFullYear();
  const monthDelta = on.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function parseWholeAge(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function daysInMonth(year: number | null, month: number | null): number {
  if (month == null) return 31;
  const yearForLength = year ?? 2024;
  const lastDay = new Date(0);
  lastDay.setFullYear(yearForLength, month, 0);
  return lastDay.getDate();
}

function rebuildBirthDays(): void {
  const selected = birthDay.value;
  const month = birthMonth.value ? Number(birthMonth.value) : null;
  const yearValue = birthYear.value.trim();
  const year = /^\d{1,4}$/.test(yearValue) ? Number(yearValue) : null;
  const max = daysInMonth(year, month);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Day";
  birthDay.replaceChildren(placeholder);
  for (let day = 1; day <= max; day += 1) {
    const option = document.createElement("option");
    option.value = String(day).padStart(2, "0");
    option.textContent = String(day);
    birthDay.append(option);
  }
  birthDay.value = selected && Number(selected) <= max ? selected : "";
}

rebuildBirthDays();
birthMonth.addEventListener("change", rebuildBirthDays);
birthYear.addEventListener("input", rebuildBirthDays);
birthYear.addEventListener("change", rebuildBirthDays);

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function trackWaitlistLead(): void {
  const win = window as Window & {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
  };
  if (typeof win.fbq === "function") {
    win.fbq("track", "Lead");
  }
  if (typeof win.gtag === "function") {
    win.gtag("event", "generate_lead");
  }
}

function revealThanks(): void {
  const scrollBehavior: ScrollBehavior = prefersReducedMotion()
    ? "auto"
    : "smooth";
  const show = (): void => {
    formPanel.hidden = true;
    thanksPanel.hidden = false;
    thanksPanel.scrollIntoView({
      behavior: scrollBehavior,
      block: "center",
    });
  };

  if (prefersReducedMotion()) {
    show();
    return;
  }

  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    show();
  };

  formPanel.classList.add("is-leaving");
  formPanel.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, 320);
}

// Hero button is a jump to the waitlist form, the only place an email is collected.
jump.addEventListener("click", () => {
  document.getElementById("waitlist")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  window.setTimeout(() => {
    const target = document.getElementById("f-email");
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
    }
  }, 500);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const email = String(data.get("email") ?? "").trim();
  const name = String(data.get("first_name") ?? "").trim();
  const lastName = String(data.get("last_name") ?? "").trim();
  const openTo = data.getAll("open_to").map(String);
  const birthMonthValue = String(data.get("birth_month") ?? "").trim();
  const birthDayValue = String(data.get("birth_day") ?? "").trim();
  const birthYearValue = String(data.get("birth_year") ?? "").trim();
  const matchMinValue = String(data.get("match_age_min") ?? "").trim();
  const matchMaxValue = String(data.get("match_age_max") ?? "").trim();

  if (!name) {
    failField("first_name", "Add your first name so we know who we’re seating.");
    return;
  }
  if (!lastName) {
    failField("last_name", "Add your last name so we know who we’re seating.");
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    failField("email", "That email address looks incomplete.");
    return;
  }

  const today = startOfAtlantaDay(new Date());
  if (!birthMonthValue) {
    failField("birth_month", "Add your date of birth so we know you’re 21 or older.");
    return;
  }
  if (!birthDayValue) {
    failField("birth_day", "Add your date of birth so we know you’re 21 or older.");
    return;
  }
  const birthYearNumber = parseWholeAge(birthYearValue);
  if (birthYearNumber === null || birthYearNumber < 1 || birthYearNumber > today.getFullYear()) {
    failField("birth_year", "Add a valid year of birth.");
    return;
  }
  const birthdateValue = `${String(birthYearNumber).padStart(4, "0")}-${birthMonthValue}-${birthDayValue}`;
  const birthdate = parseIsoDate(birthdateValue);
  if (!birthdate) {
    failField("birth_day", "That date isn’t a valid birthday.");
    return;
  }
  if (birthdate.getTime() > today.getTime()) {
    failField("birth_year", "Date of birth can’t be in the future.");
    return;
  }
  if (ageOn(birthdate, today) < MINIMUM_AGE) {
    failField("birth_year", "Fifth Wheel is for adults 21 and over.");
    return;
  }

  if (!data.get("identity")) {
    failField(
      "identity",
      "Let us know how you identify — it’s how we balance the table.",
    );
    return;
  }
  if (openTo.length === 0) {
    failField("open_to", "Choose at least one option under “Seat you with.”");
    return;
  }

  const matchMin = parseWholeAge(matchMinValue);
  const matchMax = parseWholeAge(matchMaxValue);
  if (matchMin === null) {
    failField("match_age_min", "Add the youngest age you want to meet.");
    return;
  }
  if (matchMax === null) {
    failField("match_age_max", "Add the oldest age you want to meet.");
    return;
  }
  if (matchMin < MINIMUM_AGE) {
    failField("match_age_min", "Ages you want to meet have to be 21 or older.");
    return;
  }
  if (matchMax < MINIMUM_AGE) {
    failField("match_age_max", "Ages you want to meet have to be 21 or older.");
    return;
  }
  if (matchMin > MAXIMUM_MATCH_AGE) {
    failField("match_age_min", "Choose an age from 21 to 120.");
    return;
  }
  if (matchMax > MAXIMUM_MATCH_AGE) {
    failField("match_age_max", "Choose an age from 21 to 120.");
    return;
  }
  if (matchMax < matchMin) {
    failField(
      "match_age_max",
      "The oldest age has to be at least as high as the youngest.",
    );
    return;
  }

  if (!data.get("looking_for")) {
    failField("looking_for", "Tell us what you’re looking for.");
    return;
  }
  if (!data.get("surprise_game")) {
    failField(
      "surprise_game",
      "Let us know if you’d like a surprise game at the table.",
    );
    return;
  }
  if (!data.get("neighborhood")) {
    failField("neighborhood", "Pick a neighborhood you’d walk to.");
    return;
  }

  clearFieldError();

  // Collapse multi-selects so they land as readable text.
  // Empty nights stay "Not specified". `_gotcha` is the honeypot.
  const payload = {
    first_name: name,
    last_name: lastName,
    email,
    birthdate: birthdateValue,
    match_age_min: matchMin,
    match_age_max: matchMax,
    neighborhood: data.get("neighborhood"),
    identity: data.get("identity"),
    open_to: openTo.join(", "),
    nights: data.getAll("nights").join(", ") || "Not specified",
    referral: String(data.get("referral") ?? "").trim(),
    source: "landing-page",
    attribution: signupAttribution,
    is_test: testSignup,
    submitted_at: new Date().toISOString(),
    _gotcha: data.get("_gotcha") || "",
    looking_for: data.get("looking_for"),
    surprise_game: data.get("surprise_game"),
  };

  btn.disabled = true;
  btn.textContent = "Sending…";
  setStatus(statusEl, "");

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, SUBMIT_TIMEOUT_MS);

  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error("bad response");
      let body: unknown = null;
      try {
        body = await res.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
      // Every 2xx response uses the same copy so duplicates and honeypots
      // cannot reveal whether an address is already on the waitlist.
      revealThanks();
      if (!payload._gotcha && !payload.is_test && shouldTrackLead(body)) {
        trackWaitlistLead();
      }
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = "Join the waitlist";
      setStatus(
        statusEl,
        controller.signal.aborted ? TIMEOUT_MESSAGE : FAILURE_MESSAGE,
        "err",
      );
    })
    .finally(() => {
      window.clearTimeout(timeoutId);
    });
});

