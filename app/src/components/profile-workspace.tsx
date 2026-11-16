import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { PageState } from "./ui/page-state";
import { AppShell } from "./app-shell";
import { PageHeader } from "./ui/page-header";
import { ArrowRight, BadgeCheck, CircleAlert, LoaderCircle } from "lucide-react";
import type { MemberProfileDTO, W04Error } from "../profile.contract.ts";

type LoadState = "loading" | "ready" | "unauthenticated" | "forbidden" | "error";
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type Identity = MemberProfileDTO["identity"];
type LookingFor = MemberProfileDTO["lookingFor"];
type SurpriseGame = MemberProfileDTO["surpriseGame"];

type Draft = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: Identity | "";
  openTo: Identity[];
  matchAgeMin: string;
  matchAgeMax: string;
  neighborhood: string;
  nights: string[];
  lookingFor: LookingFor | "";
  surpriseGame: SurpriseGame | "";
  phone: string;
  oneLiner: string;
};

type ApiOutcome<T> = Readonly<{ data: T; error: null }> | Readonly<{ data: null; error: W04Error | null }>;
type PendingOperation = Readonly<{ fingerprint: string; id: string }>;

const identityOptions: ReadonlyArray<Readonly<{ value: Identity; label: string }>> = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non_binary", label: "Non-binary" },
];
const openToOptions: ReadonlyArray<Readonly<{ value: Identity; label: string }>> = [
  { value: "woman", label: "Women" },
  { value: "man", label: "Men" },
  { value: "non_binary", label: "Non-binary people" },
];
const neighborhoods = ["Inman Park", "Chamblee", "Virginia Highlands"] as const;
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const lookingForOptions: LookingFor[] = ["Casual", "Open", "Relationship"];
const surpriseOptions: SurpriseGame[] = ["Yes, surprise me", "I'd rather keep it conversational"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isW04Error(value: unknown): value is W04Error {
  return isRecord(value)
    && typeof value.code === "string"
    && typeof value.message === "string"
    && typeof value.retryable === "boolean"
    && typeof value.correlationId === "string";
}

function isProfile(value: unknown): value is MemberProfileDTO {
  return isRecord(value)
    && Number.isSafeInteger(value.profileRevision)
    && typeof value.firstName === "string"
    && typeof value.lastName === "string"
    && typeof value.dateOfBirth === "string"
    && ["woman", "man", "non_binary"].includes(String(value.identity))
    && Array.isArray(value.openTo)
    && value.openTo.every((entry) => ["woman", "man", "non_binary"].includes(String(entry)))
    && Number.isSafeInteger(value.matchAgeMin)
    && Number.isSafeInteger(value.matchAgeMax)
    && typeof value.neighborhood === "string"
    && Array.isArray(value.nights)
    && typeof value.lookingFor === "string"
    && typeof value.surpriseGame === "string"
    && (typeof value.phone === "string" || value.phone === null)
    && (typeof value.oneLiner === "string" || value.oneLiner === null);
}

function responseData<T>(body: unknown, isExpected: (value: unknown) => value is T): ApiOutcome<T> {
  if (!isRecord(body)) return { data: null, error: null };
  if (body.ok === true && isExpected(body.data)) return { data: body.data, error: null };
  if (body.ok === false && isW04Error({ ...body, code: body.code, message: body.message })) {
    return { data: null, error: body as W04Error };
  }
  return { data: null, error: null };
}

async function readApi<T>(response: Response, isExpected: (value: unknown) => value is T): Promise<ApiOutcome<T>> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = responseData(body, isExpected);
  return response.ok ? parsed : { data: null, error: parsed.error };
}

function draftFromProfile(profile: MemberProfileDTO): Draft {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    dateOfBirth: profile.dateOfBirth,
    identity: profile.identity,
    openTo: [...profile.openTo],
    matchAgeMin: String(profile.matchAgeMin),
    matchAgeMax: String(profile.matchAgeMax),
    neighborhood: profile.neighborhood,
    nights: [...profile.nights],
    lookingFor: profile.lookingFor,
    surpriseGame: profile.surpriseGame,
    phone: profile.phone ?? "",
    oneLiner: profile.oneLiner ?? "",
  };
}

function fieldMessage(fields: Record<string, string>, key: string): string | undefined {
  return fields[key] ?? fields[key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase())];
}

function operationIdFor(ref: { current: PendingOperation | null }, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (ref.current?.fingerprint === fingerprint) return ref.current.id;
  const id = crypto.randomUUID();
  ref.current = { fingerprint, id };
  return id;
}

function profileValidation(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.firstName.trim()) errors.firstName = "Enter your first name.";
  if (!draft.lastName.trim()) errors.lastName = "Enter your last name.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dateOfBirth)) errors.dateOfBirth = "Enter your date of birth.";
  if (!draft.identity) errors.identity = "Choose how you identify.";
  if (draft.openTo.length === 0) errors.openTo = "Choose at least one group you are open to meeting.";
  const min = Number(draft.matchAgeMin);
  const max = Number(draft.matchAgeMax);
  if (!Number.isSafeInteger(min) || min < 21 || min > 120) errors.matchAgeMin = "Choose a whole number from 21 to 120.";
  if (!Number.isSafeInteger(max) || max < 21 || max > 120) errors.matchAgeMax = "Choose a whole number from 21 to 120.";
  else if (Number.isSafeInteger(min) && max < min) errors.matchAgeMax = "The oldest age must be at least the youngest age.";
  if (!neighborhoods.includes(draft.neighborhood as typeof neighborhoods[number])) errors.neighborhood = "Choose a neighborhood.";
  if (!lookingForOptions.includes(draft.lookingFor as LookingFor)) errors.lookingFor = "Choose what you are looking for.";
  if (!surpriseOptions.includes(draft.surpriseGame as SurpriseGame)) errors.surpriseGame = "Choose an option.";
  return errors;
}

function profilePayload(draft: Draft) {
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    dateOfBirth: draft.dateOfBirth,
    identity: draft.identity as Identity,
    openTo: draft.openTo,
    matchAgeMin: Number(draft.matchAgeMin),
    matchAgeMax: Number(draft.matchAgeMax),
    neighborhood: draft.neighborhood,
    nights: draft.nights,
    lookingFor: draft.lookingFor as LookingFor,
    surpriseGame: draft.surpriseGame as SurpriseGame,
    phone: draft.phone.trim() || null,
    oneLiner: draft.oneLiner.trim() || null,
  };
}

export function ProfileWorkspace() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [profile, setProfile] = useState<MemberProfileDTO | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formMessage, setFormMessage] = useState("");
  const saveOperation = useRef<PendingOperation | null>(null);
  const dirty = useMemo(() => profile && draft ? JSON.stringify(profilePayload(draft)) !== JSON.stringify(profilePayload(draftFromProfile(profile))) : false, [profile, draft]);


  async function loadProfile(signal?: AbortSignal) {
    setLoadState("loading");
    try {
      const response = await fetch("/api/member/profile", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      if (response.status === 401) { setLoadState("unauthenticated"); setProfile(null); setDraft(null); return; }
      if (response.status === 403 || response.status === 404) { setLoadState("forbidden"); setProfile(null); setDraft(null); return; }
      const result = await readApi(response, isProfile);
      if (!response.ok || !result.data) { setLoadState("error"); setProfile(null); setDraft(null); return; }
      setProfile(result.data);
      setDraft(draftFromProfile(result.data));
      setServerErrors({});
      setFormMessage("");
      setSaveState("idle");
      setLoadState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoadState("error");
      setProfile(null);
      setDraft(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, []);

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setSaveState("idle");
    setFormMessage("");
    setServerErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function saveProfile() {
    if (!profile || !draft) return;
    const errors = profileValidation(draft);
    setServerErrors(errors);
    if (Object.keys(errors).length) {
      setSaveState("error");
      setFormMessage("Review the highlighted fields before saving.");
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }

    const payload = { expectedProfileRevision: profile.profileRevision, ...profilePayload(draft) };
    const operationId = operationIdFor(saveOperation, payload);
    setSaveState("saving");
    setFormMessage("");
    try {
      const response = await fetch("/api/member/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ...payload, operationId }),
      });
      const result = await readApi(response, isProfile);
      if (response.status === 409 || result.error?.code === "conflict") {
        setSaveState("conflict");
        setFormMessage("Your profile was changed in another tab or device. Reload to see the latest, then save again.");
        return;
      }
      if (!response.ok || !result.data) {
        if (result.error?.fields) setServerErrors(result.error.fields);
        setSaveState("error");
        setFormMessage(result.error?.message ?? "Your changes could not be saved. Your entries are still here; try again.");
        return;
      }
      saveOperation.current = null;
      setProfile(result.data);
      setDraft(draftFromProfile(result.data));
      setServerErrors({});
      setSaveState("saved");
      setFormMessage("Saved.");
    } catch {
      setSaveState("error");
      setFormMessage("Your changes could not be saved. Your entries are still here; try again.");
    }
  }

  return <AppShell role="guest" accountActive contentClassName="profile-content" labelledBy="profile-heading">
        {loadState === "loading" && <PageState variant="loading" title="Loading your profile" message="Your saved details are loading." />}
        {loadState === "unauthenticated" && <PageState variant="signed-out" title="Sign in to view your profile" message="Sign in with the email you used to join." action={<a className="button button-primary" href="/sign-in">Go to sign in<ArrowRight aria-hidden="true" /></a>} />}
        {loadState === "forbidden" && <PageState variant="no-access" title="You don’t have access yet" message="If you’re on the waitlist, we’ll email you when you’re in." action={<a className="button button-outline" href="/member">Back to home<ArrowRight aria-hidden="true" /></a>} />}
        {loadState === "error" && <PageState variant="error" title="Your profile could not load" message="Your saved information has not been changed. Try again when service is available." action={<button className="button button-outline" type="button" onClick={() => void loadProfile()}>Try again<ArrowRight aria-hidden="true" /></button>} />}
        {loadState === "ready" && profile && draft && <>
          <PageHeader titleId="profile-heading" title="Your profile" description="Only you and the Fifth Wheel team can see this." />
          <form className="profile-form" onSubmit={(event) => { event.preventDefault(); void saveProfile(); }} noValidate>
            <section className="profile-section" aria-labelledby="profile-basics-heading">
              <h2 className="profile-section-title" id="profile-basics-heading">About you</h2>
              <div className="profile-form-grid">
                <Field id="firstName" label="First name" error={fieldMessage(serverErrors, "firstName")}><input id="firstName" name="firstName" autoComplete="given-name" maxLength={100} value={draft.firstName} onChange={(event) => updateDraft("firstName", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "firstName"))} /></Field>
                <Field id="lastName" label="Last name" error={fieldMessage(serverErrors, "lastName")}><input id="lastName" name="lastName" autoComplete="family-name" maxLength={100} value={draft.lastName} onChange={(event) => updateDraft("lastName", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "lastName"))} /></Field>
                <Field id="dateOfBirth" label="Date of birth" hint="You must be 21 or older." error={fieldMessage(serverErrors, "dateOfBirth")}><input id="dateOfBirth" name="dateOfBirth" type="date" autoComplete="bday" value={draft.dateOfBirth} onChange={(event) => updateDraft("dateOfBirth", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "dateOfBirth"))} /></Field>
                <Field id="neighborhood" label="Neighborhood" error={fieldMessage(serverErrors, "neighborhood")}><select id="neighborhood" name="neighborhood" value={draft.neighborhood} onChange={(event) => updateDraft("neighborhood", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "neighborhood"))}><option value="">Choose a neighborhood</option>{neighborhoods.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              </div>
              <ChoiceGroup id="identity" legend="How do you identify?" description="Choose one option." error={fieldMessage(serverErrors, "identity")}>
                {identityOptions.map((item) => <label className="choice-card" key={item.value}><input type="radio" name="identity" value={item.value} checked={draft.identity === item.value} onChange={() => updateDraft("identity", item.value)} /><span>{item.label}</span></label>)}
              </ChoiceGroup>
            </section>

            <section className="profile-section" aria-labelledby="profile-preferences-heading">
              <h2 className="profile-section-title" id="profile-preferences-heading">Who you’d like to meet</h2>
              <ChoiceGroup id="openTo" legend="I’m open to meeting" description="Choose all that apply." error={fieldMessage(serverErrors, "openTo")}>
                {openToOptions.map((item) => <label className="choice-card" key={item.value}><input type="checkbox" name="openTo" value={item.value} checked={draft.openTo.includes(item.value)} onChange={(event) => updateDraft("openTo", event.currentTarget.checked ? [...draft.openTo, item.value] : draft.openTo.filter((value) => value !== item.value))} /><span>{item.label}</span></label>)}
              </ChoiceGroup>
              <div className="profile-form-grid match-age-grid">
                <Field id="matchAgeMin" label="Youngest" hint="21–120" error={fieldMessage(serverErrors, "matchAgeMin")}><input id="matchAgeMin" name="matchAgeMin" type="number" inputMode="numeric" min={21} max={120} step={1} value={draft.matchAgeMin} onChange={(event) => updateDraft("matchAgeMin", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "matchAgeMin"))} /></Field>
                <Field id="matchAgeMax" label="Oldest" hint="Must be at least the youngest age." error={fieldMessage(serverErrors, "matchAgeMax")}><input id="matchAgeMax" name="matchAgeMax" type="number" inputMode="numeric" min={21} max={120} step={1} value={draft.matchAgeMax} onChange={(event) => updateDraft("matchAgeMax", event.currentTarget.value)} aria-invalid={Boolean(fieldMessage(serverErrors, "matchAgeMax"))} /></Field>
              </div>
              <ChoiceGroup id="nights" legend="Which nights usually work?" description="Optional. Choose any that suit you.">
                <div className="choice-grid choice-grid-weekdays">{weekdays.map((day) => <label className="choice-card choice-card-compact" key={day}><input type="checkbox" name="nights" value={day} checked={draft.nights.includes(day)} onChange={(event) => updateDraft("nights", event.currentTarget.checked ? [...draft.nights, day] : draft.nights.filter((value) => value !== day))} /><span>{day}</span></label>)}</div>
              </ChoiceGroup>
              <div className="profile-form-grid">
                <Field id="lookingFor" label="What are you looking for?" error={fieldMessage(serverErrors, "lookingFor")}><select id="lookingFor" name="lookingFor" value={draft.lookingFor} onChange={(event) => updateDraft("lookingFor", event.currentTarget.value as LookingFor | "")}><option value="">Choose an option</option>{lookingForOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
                <Field id="surpriseGame" label="Surprise game" error={fieldMessage(serverErrors, "surpriseGame")}><select id="surpriseGame" name="surpriseGame" value={draft.surpriseGame} onChange={(event) => updateDraft("surpriseGame", event.currentTarget.value as SurpriseGame | "")}><option value="">Choose an option</option>{surpriseOptions.map((item) => <option key={item}>{item}</option>)}</select></Field>
              </div>
            </section>

            <section className="profile-section" aria-labelledby="profile-details-heading">
              <h2 className="profile-section-title" id="profile-details-heading">More about you (optional)</h2>
              <div className="profile-form-grid">
                <Field id="phone" label="Phone number" hint="Optional."><input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={40} value={draft.phone} onChange={(event) => updateDraft("phone", event.currentTarget.value)} /></Field>
                <Field id="oneLiner" label="One-line introduction" hint="Optional."><input id="oneLiner" name="oneLiner" maxLength={240} value={draft.oneLiner} onChange={(event) => updateDraft("oneLiner", event.currentTarget.value)} /></Field>
              </div>
            </section>

            {formMessage && <div className={`profile-feedback ${saveState === "error" || saveState === "conflict" ? "profile-feedback-error" : ""}`} role={saveState === "error" || saveState === "conflict" ? "alert" : "status"} aria-live="polite">{saveState === "error" || saveState === "conflict" ? <CircleAlert aria-hidden="true" /> : <BadgeCheck aria-hidden="true" />}{formMessage}{saveState === "conflict" && <button className="text-action" type="button" onClick={() => void loadProfile()}>Reload current profile</button>}</div>}
            <div className="profile-form-actions profile-action-bar">
              <button className="button button-primary" type="button" onClick={() => void saveProfile()} disabled={!dirty || saveState === "saving"}>
                {saveState === "saving" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}{saveState === "saving" ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </>}
      </AppShell>;
}

function Field(props: Readonly<{ id: string; label: string; hint?: string; error?: string; children: ReactNode }>) {
  const hintId = props.hint ? `${props.id}-hint` : undefined;
  const errorId = props.error ? `${props.id}-error` : undefined;
  const child = Children.only(props.children);
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<Record<string, unknown>>, { "aria-describedby": describedBy, "aria-invalid": Boolean(props.error) })
    : child;
  return <div className="profile-field">
    <label htmlFor={props.id}>{props.label}</label>
    {control}
    {props.hint && <small id={hintId} className="field-hint">{props.hint}</small>}
    {props.error && <small id={errorId} className="field-error" role="alert">{props.error}</small>}
  </div>;
}

function ChoiceGroup(props: Readonly<{ id: string; legend: string; description: string; error?: string; children: React.ReactNode }>) {
  const describedBy = [props.description ? `${props.id}-description` : null, props.error ? `${props.id}-error` : null].filter(Boolean).join(" ") || undefined;
  return <fieldset className="profile-choice-group" aria-describedby={describedBy} aria-invalid={Boolean(props.error)}>
    <legend>{props.legend}</legend>
    <p id={`${props.id}-description`}>{props.description}</p>
    <div className="profile-choice-options">{props.children}</div>
    {props.error && <small id={`${props.id}-error`} className="field-error" role="alert">{props.error}</small>}
  </fieldset>;
}

