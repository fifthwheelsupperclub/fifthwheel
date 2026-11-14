import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, HeartHandshake, LoaderCircle, MapPin, ShieldAlert, Star } from "lucide-react";
import { MemberWorkspaceShell } from "./member-tables-workspace.tsx";
import "./tonight-workspace.css";

type Reply<T> = { ok: true; data: T } | { ok: false; status: number; reason: string | null; message: string };
async function call<T>(path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const response = await fetch(path, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: { reason?: string | null; safeMessage?: string } } | null;
    if (response.ok && json?.ok) return { ok: true, data: json.data as T };
    return { ok: false, status: response.status, reason: json?.error?.reason ?? null, message: json?.error?.safeMessage ?? "This is temporarily unavailable. Try again shortly." };
  } catch { return { ok: false, status: 0, reason: null, message: "The connection failed. Try again." }; }
}

type Tonight = { table: { tableId: string; title: string; localDate: string; startLocalTime: string; neighborhood: string; stops: { role: string; venueName: string; venueAddress: string; minutesFromStart: number; publicNotes: string | null }[] };
  attendance: { checkedInAt: string | null }; vote: { state: "unavailable" | "wait" | "open" | "closed"; opensAt: string; closesAt: string; eligible: boolean | null; submittedAt: string | null; candidates: { guestId: string; firstName: string }[] } };
type Reveal = { state: "pending" | "revealed" | "results_unavailable"; match: { guestId: string; firstName: string } | null };
type Recap = { tableTitle: string; canSubmit: boolean; venues: { venueId: string; name: string }[]; rating: { overall: number; venueScores: Record<string, number>; note: string | null } | null;
  attendees: { guestId: string; firstName: string }[]; reports: { reportId: string; createdAt: string; status: string }[] };

const clock = (iso: string) => new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "America/New_York" }).format(new Date(iso));
const stopTime = (date: string, time: string, minutes: number) => {
  const [h, m] = time.split(":").map(Number); const total = h * 60 + m + minutes;
  return new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, 0, total)));
};
const stateMessage = (status: number, reason: string | null, fallback: string) => reason === "voting_closed" ? "Voting has closed." : reason === "voting_not_open" ? "Voting has not opened yet."
  : reason === "ballot_conflict" ? "Your ballot is already submitted and cannot be changed." : reason === "feedback_not_open" ? "Feedback opens after voting closes for guests who attended."
  : status === 403 ? "Voting is limited to guests who were checked in before it opened." : fallback;

function Section({ title, icon, children }: Readonly<{ title: string; icon: ReactNode; children: ReactNode }>) {
  return <section className="tonight-section"><h2>{icon}{title}</h2>{children}</section>;
}

export function TonightWorkspace({ tableId }: Readonly<{ tableId: string }>) {
  const base = `/api/me/tables/${encodeURIComponent(tableId)}`;
  const [tonight, setTonight] = useState<{ state: "loading" } | { state: "ready"; data: Tonight } | { state: "error"; status: number; message: string }>({ state: "loading" });
  const load = useCallback(async () => {
    const result = await call<Tonight>(`${base}/tonight`);
    setTonight(result.ok ? { state: "ready", data: result.data } : { state: "error", status: result.status, message: result.message });
  }, [base]);
  useEffect(() => { void load(); }, [load]);
  // The server decides the phase; this only re-asks while a boundary is approaching.
  const phase = tonight.state === "ready" ? tonight.data.vote.state : null;
  useEffect(() => {
    if (phase !== "wait" && phase !== "open") return;
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [phase, load]);

  return <MemberWorkspaceShell active="seats"><div className="tonight-page">
    {tonight.state === "loading" && <p className="tonight-note" role="status"><LoaderCircle className="tonight-spin" aria-hidden="true" />Loading…</p>}
    {tonight.state === "error" && <section className="tonight-note" role="alert"><AlertCircle aria-hidden="true" /><h1>{tonight.status === 401 ? "Sign in to continue" : tonight.status === 404 || tonight.status === 403 ? "Not available" : "Unavailable right now"}</h1>
      <p>{tonight.status === 404 || tonight.status === 403 ? "Tonight is only available to guests with a paid Seat at this Table." : tonight.message}</p>
      {tonight.status === 401 ? <a className="button button-primary" href={`/sign-in?returnTo=${encodeURIComponent(`/tonight/${tableId}`)}`}>Sign in</a> : <a className="button button-outline" href="/my-seats">Back to My Seats</a>}</section>}
    {tonight.state === "ready" && <TonightBody data={tonight.data} base={base} reload={load} />}
  </div></MemberWorkspaceShell>;
}

function TonightBody({ data, base, reload }: Readonly<{ data: Tonight; base: string; reload: () => Promise<void> }>) {
  const { table, vote, attendance } = data;
  return <>
    <header className="tonight-heading"><p className="eyebrow">TONIGHT</p><h1>{table.title}</h1><p><MapPin aria-hidden="true" />{table.neighborhood} · {table.startLocalTime} Atlanta time</p></header>
    <Section title="Your evening" icon={<Clock3 aria-hidden="true" />}>
      <ol className="tonight-stops">{table.stops.map((stop) => <li key={`${stop.role}-${stop.minutesFromStart}`}><strong>{stopTime(table.localDate, table.startLocalTime, stop.minutesFromStart)} · {stop.role}</strong><span>{stop.venueName}</span><small>{stop.venueAddress}</small>{stop.publicNotes && <small>{stop.publicNotes}</small>}</li>)}</ol>
      <p className={`tonight-pill ${attendance.checkedInAt ? "ok" : ""}`}>{attendance.checkedInAt ? <><CheckCircle2 aria-hidden="true" />Checked in at {clock(attendance.checkedInAt)}</> : "Not checked in yet. Your host checks guests in when you arrive."}</p>
    </Section>
    <Section title="The vote" icon={<HeartHandshake aria-hidden="true" />}>
      {vote.state === "unavailable" && <p>Voting isn’t available for this Table.</p>}
      {vote.state === "wait" && <p>Voting opens at {clock(vote.opensAt)} for guests who were checked in by then, and closes at {clock(vote.closesAt)}. Nothing you do here changes who can vote.</p>}
      {vote.state === "open" && (vote.eligible ? (vote.submittedAt ? <p className="tonight-pill ok"><CheckCircle2 aria-hidden="true" />Your choice was recorded at {clock(vote.submittedAt)}. It can’t be changed. Results appear after voting closes at {clock(vote.closesAt)}.</p>
          : <BallotForm candidates={vote.candidates} closesAt={vote.closesAt} base={base} done={reload} />)
        : <p>Voting is limited to guests who were checked in before it opened at {clock(vote.opensAt)}.</p>)}
      {vote.state === "closed" && <Reveal base={base} eligible={vote.eligible === true} submitted={vote.submittedAt !== null} />}
    </Section>
    {vote.state === "closed" && <Feedback base={base} />}
  </>;
}

function BallotForm({ candidates, closesAt, base, done }: Readonly<{ candidates: { guestId: string; firstName: string }[]; closesAt: string; base: string; done: () => Promise<void> }>) {
  const [choice, setChoice] = useState<string | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  async function submit() {
    if (choice === undefined) return;
    setWorking(true); setMessage("");
    const result = await call(`${base}/ballot`, { choiceGuestId: choice });
    setWorking(false);
    if (result.ok) await done(); else { setConfirming(false); setMessage(stateMessage(result.status, result.reason, result.message)); if (result.reason === "ballot_conflict" || result.reason === "voting_closed") await done(); }
  }
  return <form className="tonight-form" onSubmit={(event) => { event.preventDefault(); if (choice !== undefined) setConfirming(true); }}>
    <fieldset><legend>Who would you like to meet again? Only a mutual choice is ever shown, and only to the two of you. Closes at {clock(closesAt)}.</legend>
      {candidates.map((c) => <label key={c.guestId}><input type="radio" name="choice" checked={choice === c.guestId} onChange={() => setChoice(c.guestId)} disabled={working} />{c.firstName}</label>)}
      <label><input type="radio" name="choice" checked={choice === null} onChange={() => setChoice(null)} disabled={working} />Nobody</label></fieldset>
    {message && <p role="alert" className="tonight-alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {confirming ? <div className="tonight-confirm"><p>Submit this choice? You can’t change it afterwards.</p>
        <button className="button button-primary" type="button" disabled={working} onClick={() => void submit()}>{working ? "Submitting…" : "Yes, submit"}</button>
        <button className="button button-outline" type="button" disabled={working} onClick={() => setConfirming(false)}>Back</button></div>
      : <button className="button button-primary" type="submit" disabled={choice === undefined}>Review choice</button>}
  </form>;
}

function Reveal({ base, eligible, submitted }: Readonly<{ base: string; eligible: boolean; submitted: boolean }>) {
  const [state, setState] = useState<{ state: "loading" } | { state: "ready"; data: Reveal } | { state: "denied" } | { state: "error"; message: string }>({ state: "loading" });
  useEffect(() => { void (async () => {
    if (!eligible) { setState({ state: "denied" }); return; }
    const result = await call<Reveal>(`${base}/reveal`);
    setState(result.ok ? { state: "ready", data: result.data } : result.status === 403 ? { state: "denied" } : { state: "error", message: result.message });
  })(); }, [base, eligible]);
  if (state.state === "loading") return <p role="status"><LoaderCircle className="tonight-spin" aria-hidden="true" />Loading your result…</p>;
  if (state.state === "denied") return <p>Voting has closed. Results are shown only to guests who were eligible to vote.</p>;
  if (state.state === "error") return <p role="alert" className="tonight-alert"><AlertCircle aria-hidden="true" />{state.message}</p>;
  const { data } = state;
  if (data.state === "results_unavailable") return <p>Results from this evening are no longer available.</p>;
  if (data.state === "pending") return <p>Results aren’t ready yet.</p>;
  return data.match ? <div className="tonight-match"><HeartHandshake aria-hidden="true" /><div><strong>You and {data.match.firstName} chose each other.</strong><p>That’s all that’s shared. There’s no chat or contact exchange in the app.</p></div></div>
    : <div className="tonight-match"><div><strong>No mutual connection this time.</strong><p>{submitted ? "Thank you for taking part." : "You didn’t submit a choice."}</p></div></div>;
}

function Feedback({ base }: Readonly<{ base: string }>) {
  const [recap, setRecap] = useState<{ state: "loading" } | { state: "ready"; data: Recap } | { state: "none" }>({ state: "loading" });
  const load = useCallback(async () => { const r = await call<Recap>(`${base}/recap`); setRecap(r.ok ? { state: "ready", data: r.data } : { state: "none" }); }, [base]);
  useEffect(() => { void load(); }, [load]);
  if (recap.state === "loading") return null;
  if (recap.state === "none") return null;
  if (!recap.data.canSubmit) return <Section title="Feedback" icon={<Star aria-hidden="true" />}><p>Feedback and reports are open to guests who were checked in to this evening.</p></Section>;
  return <>
    <Section title="How was the evening?" icon={<Star aria-hidden="true" />}><RatingForm recap={recap.data} base={base} saved={load} /></Section>
    <Section title="Report a concern" icon={<ShieldAlert aria-hidden="true" />}><ReportForm recap={recap.data} base={base} saved={load} /></Section>
  </>;
}

function RatingForm({ recap, base, saved }: Readonly<{ recap: Recap; base: string; saved: () => Promise<void> }>) {
  const [overall, setOverall] = useState<number>(recap.rating?.overall ?? 0);
  const [venues, setVenues] = useState<Record<string, number>>(recap.rating?.venueScores ?? {});
  const [note, setNote] = useState(recap.rating?.note ?? "");
  const [state, setState] = useState<"idle" | "working" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  async function save() {
    setState("working"); setMessage("");
    const result = await call(`${base}/rating`, { overall, venueScores: venues, note: note.trim() === "" ? null : note });
    if (result.ok) { setState("saved"); await saved(); } else { setState("error"); setMessage(stateMessage(result.status, result.reason, result.message)); }
  }
  return <form className="tonight-form" onSubmit={(event) => { event.preventDefault(); if (overall > 0) void save(); }}>
    <fieldset><legend>Overall (required)</legend><div className="tonight-scale">{[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name="overall" checked={overall === n} onChange={() => setOverall(n)} />{n}</label>)}</div></fieldset>
    {recap.venues.map((v) => <label key={v.venueId} className="tonight-venue">{v.name} (optional)
      <select value={venues[v.venueId] ?? ""} onChange={(event) => { const next = { ...venues }; if (event.currentTarget.value === "") delete next[v.venueId]; else next[v.venueId] = Number(event.currentTarget.value); setVenues(next); }}>
        <option value="">No score</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>)}
    <label>Anything you’d like to add? (optional)<textarea value={note} maxLength={2000} rows={3} onChange={(event) => setNote(event.currentTarget.value)} /></label>
    {state === "error" && <p role="alert" className="tonight-alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {state === "saved" && <p className="tonight-pill ok" role="status"><CheckCircle2 aria-hidden="true" />Saved. You can change it any time.</p>}
    <button className="button button-primary" type="submit" disabled={overall === 0 || state === "working"}>{state === "working" ? "Saving…" : recap.rating ? "Update feedback" : "Save feedback"}</button>
  </form>;
}

function ReportForm({ recap, base, saved }: Readonly<{ recap: Recap; base: string; saved: () => Promise<void> }>) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<"idle" | "working" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  async function send() {
    setState("working"); setMessage("");
    const result = await call(`${base}/conduct-report`, { operationId, subjectGuestId: subject === "" ? null : subject, body });
    if (result.ok) { setState("sent"); setBody(""); setSubject(""); setOperationId(crypto.randomUUID()); await saved(); } else { setState("error"); setMessage(stateMessage(result.status, result.reason, result.message)); }
  }
  return <form className="tonight-form" onSubmit={(event) => { event.preventDefault(); if (body.trim().length > 0) void send(); }}>
    <p>Reports are private to Fifth Wheel staff. Hosts and restaurants never see them. We review reports during business hours and can’t promise an immediate reply, and we don’t monitor evenings in real time. If you or someone else is in danger, call 911.</p>
    <label>About someone (optional)<select value={subject} onChange={(event) => setSubject(event.currentTarget.value)}><option value="">No one in particular</option>{recap.attendees.map((a) => <option key={a.guestId} value={a.guestId}>{a.firstName}</option>)}</select></label>
    <label>What happened?<textarea value={body} maxLength={4000} rows={5} onChange={(event) => setBody(event.currentTarget.value)} required /></label>
    {state === "error" && <p role="alert" className="tonight-alert"><AlertCircle aria-hidden="true" />{message}</p>}
    {state === "sent" && <p className="tonight-pill ok" role="status"><CheckCircle2 aria-hidden="true" />Your report was received. Keep this page for your records.</p>}
    {recap.reports.length > 0 && <ul className="tonight-receipts">{recap.reports.map((r) => <li key={r.reportId}>Report received {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(r.createdAt))} · status {r.status}</li>)}</ul>}
    <button className="button button-primary" type="submit" disabled={body.trim().length === 0 || state === "working"}>{state === "working" ? "Sending…" : "Send private report"}</button>
  </form>;
}
