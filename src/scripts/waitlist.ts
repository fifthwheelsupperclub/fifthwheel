// Posts to the product app. That route writes waitlist rows in Supabase.
const ENDPOINT =
  import.meta.env.PUBLIC_WAITLIST_URL ??
  "https://admin.fifthwheel.community/api/waitlist";
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
const heroEmail = requireAs(
  document.getElementById("hero-email"),
  (value): value is HTMLInputElement => value instanceof HTMLInputElement,
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

// Hero field is a hand-off, not a second form: copy the value into the real
// email input, scroll to #waitlist, then focus name (or email if the field was empty).
jump.addEventListener("click", () => {
  const value = heroEmail.value.trim();
  if (value) {
    const emailField = document.getElementById("f-email");
    if (emailField instanceof HTMLInputElement) {
      emailField.value = value;
    }
  }
  document.getElementById("waitlist")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
  window.setTimeout(() => {
    const target = document.getElementById(value ? "f-name" : "f-email");
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
    }
  }, 500);
});

heroEmail.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    jump.click();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const email = String(data.get("email") ?? "").trim();
  const name = String(data.get("first_name") ?? "").trim();
  const openTo = data.getAll("open_to").map(String);
  const birthdateValue = String(data.get("birthdate") ?? "").trim();
  const matchMinValue = String(data.get("match_age_min") ?? "").trim();
  const matchMaxValue = String(data.get("match_age_max") ?? "").trim();

  if (!name) {
    failField("first_name", "Add your first name so we know who we’re seating.");
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    failField("email", "That email address looks incomplete.");
    return;
  }

  const birthdate = parseIsoDate(birthdateValue);
  const today = startOfLocalDay(new Date());
  if (!birthdateValue) {
    failField("birthdate", "Add your date of birth so we know you’re 21 or older.");
    return;
  }
  if (!birthdate) {
    failField("birthdate", "That date isn’t a valid birthday.");
    return;
  }
  if (birthdate.getTime() > today.getTime()) {
    failField("birthdate", "Date of birth can’t be in the future.");
    return;
  }
  if (ageOn(birthdate, today) < MINIMUM_AGE) {
    failField("birthdate", "Fifth Wheel is for adults 21 and over.");
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
