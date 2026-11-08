export const ATTRIBUTION_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "campaign_id", "adset_id", "ad_id", "campaign_name", "adset_name", "ad_name",
  "placement", "site_source_name",
] as const;
export type Attribution = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>> & {
  captured_at?: string; landing_path?: string; referrer_host?: string;
};
const STORAGE_KEY = "fw_signup_attribution_v1";
const TEST_KEY = "fw_signup_test";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function captureAttribution(url: URL, referrer: string, storage?: StorageLike, now = Date.now()): Attribution {
  const current: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = url.searchParams.get(key)?.trim();
    if (value && !/[{}]/.test(value)) current[key] = value.slice(0, 200);
  }
  // A fresh tagged visit replaces the whole touch; never mix campaign IDs across visits.
  if (Object.keys(current).length) {
    current.captured_at = new Date(now).toISOString();
    current.landing_path = url.pathname.slice(0, 200);
    try { current.referrer_host = new URL(referrer).hostname; } catch { /* Direct visit. */ }
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* Storage can be blocked. */ }
    return current;
  }
  try {
    const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const record = saved as Attribution;
      const age = now - Date.parse(record.captured_at ?? "");
      if (age >= 0 && age < MAX_AGE) {
        const clean: Attribution = {};
        for (const key of [...ATTRIBUTION_KEYS, "captured_at", "landing_path", "referrer_host"] as const) {
          const v = record[key];
          if (typeof v === "string" && !/[{}]/.test(v)) clean[key] = v.slice(0, 200);
        }
        return clean;
      }
    }
    storage?.removeItem(STORAGE_KEY);
  } catch { /* No persistence available; signup still works. */ }
  return {};
}

export function captureTestMode(url: URL, storage?: StorageLike): boolean {
  const requested = url.searchParams.get("fw_test");
  try {
    if (requested === "1") storage?.setItem(TEST_KEY, "1");
    if (requested === "0") storage?.removeItem(TEST_KEY);
    return requested === "1" || (requested !== "0" && storage?.getItem(TEST_KEY) === "1");
  } catch { return requested === "1"; }
}

export function shouldTrackLead(body: unknown): boolean {
  return typeof body === "object" && body !== null && "track_lead" in body && body.track_lead === true;
}
