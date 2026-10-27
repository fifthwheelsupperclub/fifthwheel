import { productionAppUrl } from "../data/site";

// Posts to the guest app. That route writes waitlist rows in Supabase.
const ENDPOINT =
  import.meta.env.PUBLIC_WAITLIST_URL ??
  `${productionAppUrl}/api/waitlist`;
const STATUS_ID = "formStatus";
const MINIMUM_AGE = 21;

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
const thanksSent = requireAs(
  thanksPanel.querySelector("[data-thanks='sent']"),
  (value): value is HTMLElement => value instanceof HTMLElement,
);
const thanksStored = requireAs(
  thanksPanel.querySelector("[data-thanks='stored']"),
  (value): value is HTMLElement => value instanceof HTMLElement,
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
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
  (value): value is HTMLSelectElement => value instanceof HTMLSelectElement,
);

function daysInMonth(year: number | null, month: number | null): number {
  if (month == null) return 31;
  const yearForLength = year ?? 2024;
  return new Date(yearForLength, month, 0).getDate();
}

function fillBirthYears(): void {
  const now = new Date().getFullYear();
  const oldest = now - 120;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Year";
  birthYear.replaceChildren(placeholder);
  for (let year = now; year >= oldest; year -= 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    birthYear.append(option);
  }
}

function rebuildBirthDays(): void {
  const selected = birthDay.value;
  const month = birthMonth.value ? Number(birthMonth.value) : null;
  const year = birthYear.value ? Number(birthYear.value) : null;
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

fillBirthYears();
rebuildBirthDays();
birthMonth.addEventListener("change", rebuildBirthDays);
birthYear.addEventListener("change", rebuildBirthDays);

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function emailWasAccepted(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("email" in body)) {
    return false;
  }
  return body.email === "sent";
}

function trackWaitlistLead(): void {
  const fbq = (
    window as Window & { fbq?: (...args: unknown[]) => void }
  ).fbq;
  if (typeof fbq === "function") {
    fbq("track", "Lead");
  }
}

function revealThanks(emailSent: boolean): void {
  thanksSent.hidden = !emailSent;
  thanksStored.hidden = emailSent;
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

  const today = startOfLocalDay(new Date());
  if (!birthMonthValue) {
    failField(
      "birth_month",
      "Add your date of birth so we know you’re 21 or older.",
    );
    return;
  }
  if (!birthDayValue) {
    failField(
      "birth_day",
      "Add your date of birth so we know you’re 21 or older.",
    );
    return;
  }
  if (!birthYearValue) {
    failField(
      "birth_year",
      "Add your date of birth so we know you’re 21 or older.",
    );
    return;
  }
  const birthdateValue = `${birthYearValue}-${birthMonthValue}-${birthDayValue}`;
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
    submitted_at: new Date().toISOString(),
    _gotcha: data.get("_gotcha") || "",
    looking_for: data.get("looking_for"),
    surprise_game: data.get("surprise_game"),
  };

  btn.disabled = true;
  btn.textContent = "Sending…";
  setStatus(statusEl, "");

  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error("bad response");
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      revealThanks(emailWasAccepted(body));
      if (!payload._gotcha) {
        trackWaitlistLead();
      }
    })
    .catch(() => {
      btn.disabled = false;
      btn.textContent = "Join the waitlist";
      setStatus(
        statusEl,
        "That didn’t go through. Try again, or email hello@fifthwheel.community and we’ll add you by hand.",
        "err",
      );
    });
});
