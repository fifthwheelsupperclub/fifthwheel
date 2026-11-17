import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Circle,
  CircleAlert,
  Clock3,
  ClipboardList,
  FileText,
  Flag,
  House,
  Mail,
  MessageSquareText,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Ticket,
  UserRound,
  UserRoundCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";

export const Route = createFileRoute("/preview")({
  head: () => ({
    meta: [
      { title: "Fifth Wheel · App preview" },
      { name: "description", content: "A design preview of the Fifth Wheel member and admin app." },
    ],
  }),
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound();
  },
  component: PreviewPage,
});

const screens = [
  { id: "sign-in", label: "Sign in", group: "MEMBER" },
  { id: "home", label: "Home", group: "MEMBER" },
  { id: "profile", label: "Profile", group: "MEMBER" },
  { id: "table", label: "Table details", group: "MEMBER" },
  { id: "waitlist", label: "Waitlist", group: "ADMIN" },
  { id: "roster", label: "Roster review", group: "ADMIN" },
];

function PreviewPage() {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  return (
    <main className="preview-root" data-device={device}>
      <header className="preview-banner">
        <span className="preview-dot" />
        <span>VISUAL PREVIEW</span>
        <span className="preview-divider">/</span>
        <span>Design screens · no live account, waitlist or Table data</span>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <a className="brand" href="#top" aria-label="Fifth Wheel preview home">
            <span className="brand-mark">FW</span>
            <span className="brand-name">fifth wheel<span className="brand-period">.</span></span>
          </a>
          <p className="sidebar-caption">SCREEN PREVIEW</p>
          <nav aria-label="Preview screens">
            {screens.map((screen, i) => (
              <a className="side-link" href={`#${screen.id}`} key={screen.id}>
                <span className="nav-index">{String(i + 1).padStart(2, "0")}</span>
                <span>{screen.label}</span>
              </a>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="preview-avatar">FW</div>
            <div><strong>Rewrite preview</strong><small>Visual milestone</small></div>
          </div>
        </aside>

        <div className="content-column" id="top">
          <header className="topbar">
            <div className="breadcrumb">Fifth Wheel <span>/</span> Product preview</div>
            <span className="preview-chip"><i /> Local design preview</span>
          </header>

          <section className="intro">
            <p className="eyebrow">A considered night out</p>
            <h1>Room for a<br /><em>good surprise.</em></h1>
            <p className="intro-copy">A first look at the new member and admin experience. Warm, personal, and easier to find your way around.</p>
            <div className="intro-meta"><span>06 SCREENS</span><span className="meta-line" /><span>MEMBER + ADMIN</span><span className="meta-line" /><span>PHONE + DESKTOP</span></div>
            <div className="device-switch" role="group" aria-label="Preview screen size">
              <span>VIEW TREATMENT</span>
              <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
              <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")}>Phone</button>
              <small>Preview only</small>
            </div>
          </section>

          <SectionHeader n="01" id="sign-in" label="MEMBER ACCESS" title="A clear way back in" />
          <PreviewFrame n="01" name="SIGN IN" alternateLabel="Expired or used link">
            <div className="frame-head"><span>01 / SIGN IN</span><span>DESKTOP · 1440</span></div>
            <div className="screen-default"><div className="sign-in-layout">
              <div className="sign-in-story">
                <div className="story-orbit orbit-one" /><div className="story-orbit orbit-two" />
                <span className="brand-mark large-mark">FW</span>
                <p className="eyebrow">Atlanta, around the table</p>
                <h2>Good nights<br />start <em>with hello.</em></h2>
                <p>Your invitation is the start. Sign in to see what’s next.</p>
                <div className="story-stamp">FIFTH WHEEL <span>·</span> ATLANTA</div>
              </div>
              <div className="sign-in-form">
                <span className="form-kicker">MEMBER SIGN IN</span>
                <h3>Welcome back.</h3>
                <p>Use the email on your invitation. We’ll send a secure sign-in link.</p>
                <label htmlFor="signin-email">Email address</label>
                <input id="signin-email" type="email" placeholder="you@example.com" disabled />
                <button className="button button-primary" disabled>Send me a sign-in link <ArrowUpRight aria-hidden="true" /></button>
                <p className="quiet-note">New here? <a href="https://fifthwheel.community/#waitlist" target="_blank" rel="noreferrer">Visit the marketing waitlist</a></p>
                <p className="signup-note">Waitlist signup does not grant app access. An admin invitation is still required.</p>
                <div className="inline-state"><Mail className="state-icon" aria-hidden="true" /><span><strong>Check your inbox</strong><small>When sign-in is connected, the next step appears here.</small></span></div>
              </div>
            </div></div>
            <div className="screen-alternate"><SignInRecoveryPreview /></div>
          </PreviewFrame>

          <SectionHeader n="02" id="home" label="MEMBER HOME" title="Know your next step" />
          <PreviewFrame n="02" name="MEMBER HOME" alternateLabel="Loading state">
            <div className="frame-head"><span>02 / MEMBER HOME</span><span>DESKTOP · 1440</span></div>
            <div className="screen-default"><div className="member-app">
              <MemberNav active="Home" />
              <div className="member-body">
                <div className="member-body-toolbar"><span>MEMBER WORKSPACE</span><MemberAccountAction /></div>
                <div className="member-top"><div><p className="eyebrow">YOUR FIFTH WHEEL</p><h2>A lovely evening<br /><em>takes shape here.</em></h2></div><span className="quiet-status"><i /> No account connected</span></div>
                <div className="notice-card"><span className="notice-spark"><Sparkles aria-hidden="true" /></span><div><p className="eyebrow">YOUR NEXT STEP</p><h3>Complete your profile</h3><p>Once you’re invited in, add a little about yourself. We’ll take it from there.</p></div><button className="button button-outline" disabled>Open profile <ArrowRight aria-hidden="true" /></button></div>
                <div className="member-lower"><div><p className="eyebrow">YOUR TABLES</p><h3>When a night is yours, it’ll show up here.</h3><p>Requests, invitations and paid Seats stay in their own places.</p></div><div className="quiet-empty"><Sparkles aria-hidden="true" /><p>No Tables to show yet</p><small>This preview has no member account or live data.</small></div></div>
              </div>
            </div></div>
            <div className="screen-alternate"><StatePanel tone="pending" label="LOADING HOME" title="Getting your next step" body="Your member home is loading. Table invitations and Seats appear only after they exist on your account." loading /></div>
          </PreviewFrame>

          <SectionHeader n="03" id="profile" label="PROFILE" title="Your details, your say" />
          <PreviewFrame n="03" name="PROFILE" alternateLabel="Save error">
            <div className="frame-head"><span>03 / PROFILE &amp; PREFERENCES</span><span>DESKTOP · 1440</span></div>
            <div className="screen-default"><div className="member-app"><MemberNav active="Account" />
              <div className="member-body profile-body">
                <div className="member-body-toolbar"><span>MEMBER WORKSPACE</span><MemberAccountAction active /></div>
                <p className="eyebrow">ACCOUNT / PROFILE</p><h2>A good introduction<br /><em>starts with you.</em></h2>
                <div className="synthetic-note"><Sparkles aria-hidden="true" /><span>Synthetic example selections · no member data</span></div>
                <p className="section-lede">Your preferences help us thoughtfully seat a compatible table. They’re private.</p>
                <div className="profile-grid"><label>First name<input disabled placeholder="First name" /></label><label>Last name<input disabled placeholder="Last name" /></label><label className="span-two">Email address<input disabled placeholder="Verified email" /></label><label>Date of birth<input disabled placeholder="MM / DD / YYYY" /></label><label>Neighborhood<input disabled placeholder="Choose a neighborhood" /></label></div>
                <fieldset className="preference-field"><legend>How do you identify?</legend><p>Choose one option.</p><div className="choice-row"><label className="check-option"><input type="radio" name="identity" checked disabled readOnly /> Woman</label><label className="check-option"><input type="radio" name="identity" disabled /> Man</label><label className="check-option"><input type="radio" name="identity" disabled /> Non-binary</label></div></fieldset>
                <fieldset className="preference-field"><legend>Who would you like to meet?</legend><p>Choose every group you’re open to.</p><div className="choice-row"><label className="check-option"><input type="checkbox" checked disabled readOnly /> Women</label><label className="check-option"><input type="checkbox" disabled /> Men</label><label className="check-option"><input type="checkbox" checked disabled readOnly /> Non-binary people</label></div></fieldset>
                <button className="button button-primary profile-submit" disabled>Save changes <ArrowRight aria-hidden="true" /></button>
              </div>
            </div></div>
            <div className="screen-alternate"><StatePanel tone="error" label="SAVE FAILED" title="Your profile is still here" body="Your changes did not save. Keep the form values and let the member retry when service is available." /></div>
          </PreviewFrame>

          <SectionHeader n="04" id="table" label="TABLE DETAILS" title="Make a night of it" />
          <PreviewFrame n="04" name="TABLE DETAILS" alternateLabel="Table unavailable">
            <div className="frame-head"><span>04 / TABLE DETAILS</span><span>DESKTOP · 1440</span></div>
            <div className="screen-default"><div className="member-app"><MemberNav active="Tables" />
              <div className="member-body table-body"><div className="member-body-toolbar"><span>MEMBER WORKSPACE</span><MemberAccountAction /></div><a className="back-link" href="#home"><ArrowLeft aria-hidden="true" />All Tables</a><div className="table-heading"><div><p className="eyebrow"><MapPin aria-hidden="true" /> CHAMBLEE · ATLANTA</p><h2>An evening that<br /><em>takes its time.</em></h2></div><span className="table-date"><small><CalendarDays aria-hidden="true" /> THURSDAY</small><strong>— / —</strong><span>Date unavailable in preview</span></span></div>
                <p className="section-lede">A welcoming table, three stops, and room for a little serendipity.</p>
                <div className="itinerary"><div className="stop"><div className="stop-marker">01</div><div><span>FIRST DRINK · TIME TO COME</span><h3>A first hello</h3><p>Venue and service details load from the published Table.</p></div></div><div className="stop"><div className="stop-marker">02</div><div><span>DINNER · TIME TO COME</span><h3>Settle in</h3><p>The itinerary appears once this Table is published.</p></div></div><div className="stop"><div className="stop-marker">03</div><div><span>DESSERT · TIME TO COME</span><h3>Stay awhile</h3><p>Three stops, one well-spent evening.</p></div></div></div>
                <div className="price-bar"><span>Seat price</span><strong>$25 <small>USD</small></strong></div>
                <div className="notice-inline">A Seat request is not a Table invitation or a booking.</div><button className="button button-primary full-button" disabled>Sign in to request a Seat <ArrowRight aria-hidden="true" /></button><p className="footnote">A published Table’s date and itinerary appear here. No example booking is shown.</p>
              </div>
            </div></div>
            <div className="screen-alternate"><StatePanel tone="empty" label="TABLE UNAVAILABLE" title="This Table is not available" body="It may have been unpublished or removed. No itinerary or request action is shown; return to Tables to choose an available option." /></div>
          </PreviewFrame>

          <SectionHeader n="05" id="waitlist" label="ADMIN · PEOPLE" title="Invite with care" />
          <PreviewFrame n="05" name="WAITLIST & APP ACCESS" alternateLabel="Invitation confirmation">
            <div className="frame-head"><span>05 / WAITLIST &amp; APP ACCESS</span><span>DESKTOP · 1440</span></div>
            <div className="screen-default"><div className="admin-app"><AdminNav active="Waitlist" />
              <div className="admin-body"><div className="admin-heading"><div><p className="eyebrow">PEOPLE / WAITLIST</p><h2>A thoughtful first<br /><em>invitation.</em></h2><p>App access starts here. A Table invitation comes later.</p></div><button className="button button-outline" disabled>Filters <ChevronDown aria-hidden="true" /></button></div>
                <div className="toolbar"><label className="search-box"><Search aria-hidden="true" /><input aria-label="Search waitlist preview" placeholder="Search by name or email" disabled /></label><span className="record-count">No live records connected</span></div>
                <div className="data-table"><div className="table-row table-labels"><span>PERSON</span><span>JOINED</span><span>NEIGHBORHOOD</span><span>APP ACCESS</span><span /></div><div className="empty-admin"><span className="empty-mark"><UsersRound aria-hidden="true" /></span><strong>Waitlist records will appear here</strong><p>The marketing signup service is not connected in this visual preview.</p><button className="button button-primary" disabled>Invite a member <ArrowRight aria-hidden="true" /></button></div></div>
                <p className="footnote">Inviting someone grants app access. It never selects a Table, approves a profile or creates a Seat.</p>
              </div>
            </div></div>
            <div className="screen-alternate"><InviteConfirmationPreview /></div>
          </PreviewFrame>

          <SectionHeader n="06" id="roster" label="ADMIN · TABLES" title="Build a table that fits" />
          <PreviewFrame n="06" name="ROSTER REVIEW" alternateLabel="Validation errors">
            <div className="frame-head"><span>06 / ROSTER REVIEW</span><span>DESKTOP · 1440</span></div>
            <div className="screen-default"><div className="admin-app"><AdminNav active="Tables" />
              <div className="admin-body"><div className="admin-heading roster-heading"><div><p className="eyebrow">TABLES / ROSTER REVIEW</p><h2>Every detail matters.</h2><p>Recommendations are checked against the same rules as approval.</p></div><span className="draft-pill">DRAFT · NOT APPROVED</span></div>
                <div className="roster-summary"><span className="roster-count"><UsersRound aria-hidden="true" /></span><div><strong>No roster loaded</strong><p>A selected draft Table and its eligible applicants will appear here.</p></div><span className="capacity">UP TO 5</span></div>
                <div className="rule-panel"><p className="eyebrow">COMPOSITION CHECK</p><ul><li><Circle aria-hidden="true" /> Choose 3–5 people</li><li><Circle aria-hidden="true" /> Everyone is 21 or older on the Table date</li><li><Circle aria-hidden="true" /> Mutual age preferences fit; age span is at most 12 years</li><li><Circle aria-hidden="true" /> Each person has at least one mutual connection</li></ul><div className="rule-note">Select an eligible applicant to see the current validation result.</div></div>
                <div className="roster-actions"><span>Approval sends a Table invitation to each selected person.</span><button className="button button-primary" disabled>Review recipients and approve <ArrowRight aria-hidden="true" /></button></div>
                <p className="footnote">Only an authorized admin can approve. Hosts can propose; they cannot send or approve invitations.</p>
              </div>
            </div></div>
            <div className="screen-alternate"><RosterValidationPreview /></div>
          </PreviewFrame>

          <footer className="preview-footer"><span>FIFTH WHEEL · A GOOD NIGHT STARTS AROUND THE TABLE</span><a href="#top">Back to top <ArrowUp aria-hidden="true" /></a></footer>
        </div>
      </div>
    </main>
  );
}

function SectionHeader({ n, id, label, title }: { n: string; id: string; label: string; title: string }) {
  return <div className="section-header" id={id}><span>{n}</span><div><p className="eyebrow">{label}</p><h2>{title}</h2></div></div>;
}

function PreviewFrame({ n, name, alternateLabel, children }: { n: string; name: string; alternateLabel: string; children: ReactNode }) {
  const [state, setState] = useState<"default" | "alternate">("default");
  return <div className={`preview-frame ${n === "01" ? "sign-in-frame" : ""} ${n === "05" || n === "06" ? "admin-frame" : ""}`} data-state={state}>
    <div className="preview-frame-tools">
      <span><b>{n}</b> {name} <small>VISUAL PREVIEW</small></span>
      <div role="group" aria-label={`${name} preview state`}>
        <button type="button" aria-pressed={state === "default"} onClick={() => setState("default")}>Default</button>
        <button type="button" aria-pressed={state === "alternate"} onClick={() => setState("alternate")}>{alternateLabel}</button>
      </div>
    </div>
    {children}
  </div>;
}

function StatePanel({ tone, label, title, body, loading = false }: { tone: "error" | "pending" | "empty"; label: string; title: string; body: string; loading?: boolean }) {
  const Icon = tone === "error" ? CircleAlert : tone === "pending" ? Clock3 : Sparkles;
  return <div className={`state-panel state-${tone}`}>
    <span className="state-label"><Icon aria-hidden="true" />{label}</span>
    <h3>{title}</h3><p>{body}</p>
    {loading && <div className="loading-lines" aria-label="Loading placeholders"><i /><i /><i /></div>}
    <small>Illustrative state · no records or actions are connected</small>
  </div>;
}

function SignInRecoveryPreview() {
  return <section className="state-panel state-error recovery-panel" aria-labelledby="link-recovery-title">
    <span className="state-label"><CircleAlert aria-hidden="true" />EXPIRED OR USED LINK</span>
    <h3 id="link-recovery-title">This sign-in link is no longer valid.</h3>
    <p>Links can expire or be used once. Request a fresh link using the email address on your app invitation.</p>
    <label className="recovery-field" htmlFor="recovery-email">Email used for your invitation<input id="recovery-email" type="email" placeholder="Your invited email address" disabled /></label>
    <button className="button button-primary recovery-submit" disabled>Request a new sign-in link <ArrowRight aria-hidden="true" /></button>
    <p className="recovery-help"><RefreshCw aria-hidden="true" /> If you already requested one, use the newest email. A fresh link does not grant app access without an admin invitation.</p>
    <small>Preview only · no email is sent and no account is changed</small>
  </section>;
}

function InviteConfirmationPreview() {
  return <section className="invite-panel" aria-labelledby="invite-confirm-title">
    <span className="state-label"><Mail aria-hidden="true" />INVITATION PREVIEW · NO SEND</span>
    <h3 id="invite-confirm-title">Review app invitation</h3>
    <div className="invite-recipient"><UsersRound aria-hidden="true" /><span><strong>Avery Chen</strong><small>Synthetic recipient · avery.chen@members.example</small></span><span className="synthetic-recipient-badge">SYNTHETIC</span></div>
    <div className="access-summary">
      <div><small>APP ACCESS</small><strong>Member sign-in link included</strong><span>Available after the admin confirms the invitation.</span></div>
      <div><small>TABLE INVITATION</small><strong>Separate, later decision</strong><span>This message does not offer a Table or create a Seat.</span></div>
    </div>
    <div className="email-preview"><p className="eyebrow">EMAIL PREVIEW</p><strong>Your invitation to Fifth Wheel</strong><p>Use your secure link to enter the member app and continue your profile.</p></div>
    <div className="invite-preview-actions"><button className="button button-primary" disabled>Confirm app invitation <ArrowRight aria-hidden="true" /></button><button className="button button-outline" disabled>Retry email <RefreshCw aria-hidden="true" /></button></div>
    <p className="recovery-help"><CircleAlert aria-hidden="true" /> For an uncertain delivery result, reconcile the attempt first. Retrying sends the invitation email again without creating another admission.</p>
    <small>Preview only · no recipient is selected and no email is sent</small>
  </section>;
}

function RosterValidationPreview() {
  return <section className="roster-preview-panel" aria-labelledby="roster-validation-title">
    <span className="state-label"><CircleAlert aria-hidden="true" />SYNTHETIC ROSTER · VALIDATION ERRORS</span>
    <div className="roster-preview-heading"><div><h3 id="roster-validation-title">Resolve these roster conflicts</h3><p>Made-up candidates and preferences shown for design review only.</p></div><span className="roster-preview-capacity"><UsersRound aria-hidden="true" /><strong>3 / 5</strong><small>selected · capacity</small></span></div>
    <div className="roster-rule-summary"><span>✓ 3–5 people selected</span><span>✓ Everyone is 21+</span><span className="has-error"><CircleAlert aria-hidden="true" /> Age preferences conflict</span><span className="has-error"><CircleAlert aria-hidden="true" /> No mutual connection</span></div>
    <div className="candidate-list">
      <article className="candidate-error-row"><div className="candidate-person"><span className="candidate-avatar">AC</span><span><strong>Avery Chen</strong><small>Age 24 · synthetic preference 21–30</small></span></div><p><CircleAlert aria-hidden="true" />Outside Jordan’s synthetic 36–44 range; roster age span is 16 years (maximum 12).</p></article>
      <article className="candidate-error-row"><div className="candidate-person"><span className="candidate-avatar">JD</span><span><strong>Jordan Davis</strong><small>Age 40 · synthetic preference 36–44</small></span></div><p><CircleAlert aria-hidden="true" />Outside Avery’s synthetic 21–30 range; roster age span is 16 years (maximum 12).</p></article>
      <article className="candidate-error-row"><div className="candidate-person"><span className="candidate-avatar">RM</span><span><strong>Riley Morgan</strong><small>Age 30 · synthetic profile</small></span></div><p><CircleAlert aria-hidden="true" />No mutual connection found with the other selected candidates.</p></article>
    </div>
    <div className="roster-preview-footer"><p>These illustrative conflicts do not represent real members or a real Table.</p><button className="button button-primary" disabled>Approval unavailable in preview <ArrowRight aria-hidden="true" /></button></div>
  </section>;
}

function MemberAccountAction({ active = false }: { active?: boolean }) {
  return <a className="account-action" href="#profile" aria-current={active ? "page" : undefined}><UserRound aria-hidden="true" />Account</a>;
}

function MemberNav({ active }: { active: string }) {
  return <aside className="member-nav"><div className="mini-brand"><span className="brand-mark">FW</span><span>Fifth Wheel</span></div><p className="sidebar-caption">YOUR EVENINGS</p>
    <a href="#home" aria-current={active === "Home" ? "page" : undefined} className={active === "Home" ? "member-nav-link active" : "member-nav-link"}><House aria-hidden="true" />Home</a>
    <a href="#table" aria-current={active === "Tables" ? "page" : undefined} className={active === "Tables" ? "member-nav-link active" : "member-nav-link"}><Table2 aria-hidden="true" />Tables</a>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><ClipboardList aria-hidden="true" />Requests</span>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><Ticket aria-hidden="true" />My Seats</span>
    <div className="member-nav-bottom"><span>INVITATION-ONLY MEMBER APP</span></div>
  </aside>;
}

function AdminNav({ active }: { active: string }) {
  return <aside className="admin-nav"><div className="mini-brand"><span className="brand-mark">FW</span><span>Fifth Wheel</span></div><p className="sidebar-caption">WORKSPACE</p>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><House aria-hidden="true" />Overview</span>
    <p className="group-label">PEOPLE</p>
    <a aria-current={active === "Waitlist" ? "page" : undefined} className={active === "Waitlist" ? "member-nav-link active" : "member-nav-link"} href="#waitlist"><UsersRound aria-hidden="true" />Waitlist</a>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><UserRoundCheck aria-hidden="true" />Identity review</span>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><ClipboardList aria-hidden="true" />Seat requests</span>
    <p className="group-label">TABLES</p>
    <a aria-current={active === "Tables" ? "page" : undefined} className={active === "Tables" ? "member-nav-link active" : "member-nav-link"} href="#roster"><Table2 aria-hidden="true" />Tables</a>
    <p className="group-label">MONEY</p>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><WalletCards aria-hidden="true" />Cancellations</span>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><RefreshCw aria-hidden="true" />Refunds</span>
    <p className="group-label">OPERATIONS</p>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><MessageSquareText aria-hidden="true" />Communications</span>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><Flag aria-hidden="true" />Conduct reports</span>
    <span className="member-nav-link is-preview-disabled" aria-disabled="true"><FileText aria-hidden="true" />Audit</span>
    <div className="member-nav-bottom"><span>ADMIN PREVIEW</span></div>
  </aside>;
}
