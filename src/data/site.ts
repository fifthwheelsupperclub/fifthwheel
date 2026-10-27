export const siteUrl = "https://fifthwheel.community";

// Guest app on the product Render service. Email, Stripe return, and the waitlist POST use this host.
export const productionAppUrl = "https://app.fifthwheel.community";

// Staff console, same Render service.
export const adminAppUrl = "https://admin.fifthwheel.community";

export const organization = {
  name: "Fifth Wheel",
  legalName: "Fifth Wheel Supper Club, LLC",
  email: "hello@fifthwheel.community",
  city: "Atlanta",
  region: "GA",
  country: "US",
};

export const landingMeta = {
  title: "Fifth Wheel — One table. Five people.",
  description:
    "A curated night out in Atlanta for five single strangers. Drinks, dinner, dessert — three walkable stops in one neighborhood. Join the waitlist.",
  ogDescription:
    "A curated night out in Atlanta for five single strangers. Three walkable stops, one table, one private vote at dessert.",
  path: "/",
};

export const termsMeta = {
  title: "Terms of Service — Fifth Wheel",
  description:
    "The agreement between you and Fifth Wheel — reservations, cancellations, conduct at the table, and how disputes are handled.",
  path: "/terms/",
};

export const privacyMeta = {
  title: "Privacy Policy — Fifth Wheel",
  description:
    "What Fifth Wheel collects, who sees it, how long we keep it, and the rights you have over it.",
  path: "/privacy/",
};

export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL;
  const clean = path.replace(/^\//, "");
  return `${base}${clean}`;
}

export function absoluteUrl(path: string): string {
  const origin = siteUrl.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${suffix}`;
}
