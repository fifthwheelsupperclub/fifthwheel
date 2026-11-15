---
id: ux-design-refactor-plan
type: design-audit-and-plan
status: proposal — audit and planning only; no UI, code, styling or copy changed
date: 2026-11-15
scope: app/ (the Fifth Wheel product app, branch codex/app-rewrite at 6292735). Marketing site (src/, Astro) is out of scope except where noted.
builds_on:
  - app/docs/implementation/interface-direction.md (visual direction, tokens, IA)
  - app/docs/implementation/language-refactor-plan.md (voice, vocabulary, D0–D13 copy map, decisions D-1…D-21)
  - app/docs/flow-ui-brief.md, app/docs/PRD.md
---

# Fifth Wheel — UX and visual design refactor plan

This is the source of truth for the next design refactor. It covers every route in `app/src/routes`, its main states, the shared shell, and the styling system. It **does not repeat** the language audit. Where copy is involved, it cites the existing language-plan IDs (`LP §D3`, `D-12`) and adds only what that plan missed or what is still unapplied in the rendered app.

## How to read this document

**IDs.** Each ID is stable. Implementation PRs should cite them.

| Prefix | Meaning |
|---|---|
| `G-nn` | Global, application-wide recommendation |
| `DS-nn` | Component or design-system change |
| `P-<PAGE>-nn` | Page-specific recommendation |
| `C-nn` | Copy change (exact before → after) |
| `R-nn` | Element to remove or consolidate |
| `T-nn` | Roadmap task |
| `AC-…` | Acceptance criterion |
| `Q-nn` | Open question or tradeoff |

**Evidence tags.** Every finding carries one:

- **[V-render]**: seen in a current render (2026-11-15) of this branch. Mock-data screens were captured by re-running the repo's `*.mock-only.spec.ts` suites (43/43 passed) against a private dev server. Error and empty states were captured by loading all 24 page routes without a configured backend, at 1440×900 and 390×844.
- **[V-legacy]**: seen in a committed real-stack screenshot in `app/docs/implementation/screenshots/` dated 2026-11-14. That date is before the language refactor commit `11958a3`, so layout is reliable but some copy may have changed since. Copy claims for these screens come from the code.
- **[V-code]**: verified by reading the source at the cited file.
- **[A]**: assumption or reviewer judgment. Not observed behavior. Nothing here comes from user research.

**Priority.** P1 means it blocks clarity on a primary journey or is an accessibility failure. P2 means a clear quality or efficiency gain. P3 means polish.

---

## 1. Executive summary

### Overall assessment

The brand foundation is strong. The warm near-black ground, the brass accent, the Fraunces/Inter pairing and the hairline surfaces read as one product, and they make it feel like a considered dining club rather than a SaaS dashboard. Most screens also already have honest loading, empty and error states, and role-scoped navigation exists.

The problems are structural, and they compound:

1. **The type is too small to read comfortably.** Across the CSS, 450 declarations set text at 7–11px, against 87 at 12px and only 36 at 13px [V-code]. Body copy, labels, nav items, metadata and footnotes sit at 8–12px. Later override blocks raise some of them, so the size you see depends on which of three cascading rule sets wins. This is the single largest visual-quality and accessibility problem.
2. **There is no shared page system.** I found 10 different page-header implementations (`page-heading-row`, `ops-heading`, `refund-heading`, `cancellation-heading`, `tonight-heading`, and others) and 14 copies of the top bar in 12 files [V-code]. As a result, titles range from 30px to 55px. Some pages have breadcrumbs, eyebrows and a two-line italic tagline. Others have none. Left edges and content widths vary from page to page [V-render].
3. **Tokens exist but aren't used.** The app CSS has 330 distinct hex colors, 17 border radii, 31 font sizes, 20 different breakpoints and 30 `!important` overrides [V-code]. Only 9 color tokens are defined. Meanwhile the marketing site already has a clean, documented brand kit (`src/styles/tokens.css`) and self-hosted fonts that the app doesn't reuse.
4. **Too many things carry equal weight.** Seat detail ends with five equal-weight buttons [V-render]. A request card shows four status labels [V-legacy]. Most cards stack an icon tile, an uppercase eyebrow, a serif heading and a description, even where the eyebrow just repeats the heading ("REQUEST HISTORY / Request history") [V-render].
5. **Home doesn't do anything.** `/member` always says "Complete your profile" and "Your Tables will appear here", whatever the guest's actual state [V-code, `routes/member.tsx:67-73`]. The most-visited guest screen doesn't show the guest's next evening or open invitation. This is `D-12`. **Decided 2026-11-15: Option A, a Home that reflects the guest's actual state** (Q-01).
6. **The shell has real bugs.** Copy a week renders with no app shell, flush to the window edge [V-render]. The Cancel Table panel renders outside the shell [V-legacy, V-code]. The admin Tables page falls back to the host's navigation and a "SUPPLY WORKSPACE" label whenever its data fails to load [V-render, V-code]. The "Check Airtable" workspace isn't routed at all [V-code]. Staff navigation on phones is a horizontal strip of 13 items, and most of them are off-screen [V-code].
7. **Disclaimers are still everywhere.** The language plan decided to remove "this is not X" statements (`D-1`, `D-2`, `D-5`). Twelve sidebar footnote strings still render, along with several in-page disclaimers [V-render, V-code].

### Highest-impact opportunities

| Rank | Change | IDs |
|---|---|---|
| 1 | Replace the font-size sprawl with a 9-step type scale and a 12px floor | G-01, DS-01 |
| 2 | One `AppShell` and one `PageHeader` for every route, so pages share edges, widths and title sizes | G-02, G-03, DS-03, DS-04 |
| 3 | Adopt the marketing brand kit's tokens in the app and collapse 330 colors to about 20 semantic tokens | G-04, DS-02 |
| 4 | Make Home show the guest's real next step (decided: Option A) | P-HOME-01, Q-01 |
| 5 | One primary action per view, plus a real destructive button style | G-06, DS-05 |
| 6 | One `PageState` for loading, empty, error, signed-out and no-access states | G-08, DS-08 |
| 7 | Remove all sidebar footnotes, duplicate eyebrows and repeated status labels | R-01–R-12 |
| 8 | Mobile: a bottom tab bar for guests and a menu drawer for staff | G-10 |

---

## 2. Design principles

These are the refactor's working standards. Each one is specific enough to settle a disagreement.

1. **One focal point per screen.** Each screen has one H1 and one primary (brass) button. Everything else steps down in size, weight or color. If two actions compete, one becomes secondary.
2. **Say it once.** A state or fact appears once per view, where it matters. No sidebar footnotes. No eyebrow that repeats its heading. No banner that repeats a card.
3. **Utility pages are quiet, brand moments are deliberate.** The display serif and the italic brass flourish belong on sign-in, the link callback, and Home's greeting. Working pages (lists, forms, admin tools) use plain titles.
4. **Readable first.** Body text is at least 15px for guests and 14px for staff. Nothing is smaller than 12px. Contrast meets WCAG 2.2 AA, including the 3:1 minimum for input borders and focus indicators.
5. **Same thing, same look, same place.** Back links, page actions, status badges, dates and confirmations each have one implementation and one position.
6. **Show what the person can do next.** Every state, including empty, error and pending, ends with the useful next action or a plain statement that none is needed.
7. **Staff screens can be dense, never cryptic.** Staff get tighter spacing and tables. They don't get engineering vocabulary or raw keys (`lease expired`, `new_table`, `2026-12-12`).
8. **Preserve meaning.** Simplifying never changes money, consent or state semantics. Approved legal text (`CHECKOUT_DISCLOSURE`) changes only with owner sign-off.

---

## 3. Global recommendations

Phase 1 implements these. Page sections assume they're done.

| ID | Area | Current issue (evidence) | Proposed change | Rationale | Priority |
|---|---|---|---|---|---|
| **G-01** | Typography | 450 declarations at 7–11px. Nav links are 9–11px, eyebrows 7–9px, metadata 7–8px, body 9–12px. Three cascading blocks redefine the same selectors (`styles.css` base at line 1, overrides from about line 340, then line 560 onward) [V-code] | Adopt the DS-01 scale. Minimum 12px (uppercase labels 11px with +0.08em tracking only). Guest body 15px, staff body 14px. Delete the superseded base and preview rule blocks rather than overriding them | Legibility. WCAG 1.4.4 and 1.4.12 resilience. Removes cascade guesswork | P1 |
| **G-02** | App shell | 14 top-bar copies in 12 files. Weekly clone has no shell. The Table cancel panel renders outside the shell. Admin Tables shows host nav and "SUPPLY WORKSPACE" on load failure (`admin-supply-management-workspace.tsx:156-158`) [V-code, V-render] | One `AppShell role="guest"|"admin"|"host"|"restaurant"` (DS-03) used by every authenticated route through a layout route. Role comes from `/api/workspaces`, not from per-page data | Fixes three layout bugs at once and makes navigation predictable | P1 |
| **G-03** | Page header | 10 header patterns. H1 sizes 30–55px. Some pages use breadcrumb + eyebrow + H1 + intro + pill (My Seats, Profile). Others use H1 + paragraph only (Overview, Decisions) [V-render] | One `PageHeader` (DS-04): optional back link (detail pages only), H1, optional one-line description, optional status badge, actions on the right. No breadcrumb on top-level pages. No eyebrow unless it carries new information | Consistent first read. Removes about 40 redundant labels | P1 |
| **G-04** | Tokens | 9 tokens defined, 330 raw hex values, 17 radii [V-code]. Marketing has a documented kit (`src/styles/tokens.css`) | Port the marketing kit's names and values into `app/src/styles/tokens.css` and add semantic aliases (DS-02). Lint for raw hex outside the tokens file | One brand, one source. Makes theme and contrast fixes one-line changes | P1 |
| **G-05** | Spacing and layout | Gaps are arbitrary (13, 17, 23, 27, 33px). Content width is unconstrained on desktop, so forms and text run to about 1000px. Left edges differ between pages (for example, Overview vs. My Seats) [V-render] | 4px-based spacing scale (DS-01). Content max widths: `--w-read` 720px (guest detail, forms, dialogs), `--w-wide` 1120px (lists, admin tables). Page padding 32px desktop, 16px phone | Balanced compositions, comfortable line length, aligned edges | P1 |
| **G-06** | Action hierarchy | Several views have two or more brass buttons: Checkout (Continue to payment + View Table details), Seat detail (Add to calendar alongside four outline buttons), Overview (urgent "Open" in brass). Destructive actions are styled primary or outline: "Cancel table" is gold, Conduct "Delete" is outline [V-render, V-code] | One primary per view region. Secondary = outline. Tertiary = text link. Destructive = DS-05 `danger`. Overview urgency moves to the badge, not the button color | Predictable next action. Destructive actions look different from routine ones | P1 |
| **G-07** | Status display | Labels come in mixed casing ("SEAT REQUEST · PENDING", "Cancellation Requested", raw "new"). One card can repeat a status 2–4 times. There are about 7 pill class families (`status-pill-*`, `draft-pill`, `tonight-pill`, …) [V-code, V-render] | One `StatusBadge` (DS-06): tone + icon + sentence-case label from `copy/states.ts`. One status per object per view. Never render raw enum values | Scannable state. Not color-only (WCAG 1.4.1) | P1 |
| **G-08** | Page states | Each page hand-rolls loading, empty and error states. Errors show a dashed wine border. Filters and toolbars stay visible above a failed load. Some pages show the full nav and "Account / Sign out" while signed out. Parser errors leak to users ("The Seat list returned an unexpected response.", shown twice) [V-render] | One `PageState` (DS-08) with variants `loading` (skeleton shaped like the page), `empty`, `error`, `signed-out`, `no-access`. Hide list controls when there's no data to act on. Never show parser or internal messages | Consistent recovery. Less noise on failure | P1 |
| **G-09** | Dates and times | 17 local date helpers across 11 components. Output includes `2026-11-21 · 19:00`, `Sat, Dec 12 · 19:00 Atlanta time`, `Friday, November 13, 2026 at 10:00 AM`, `America/New_York` and raw ISO dates in staff UI [V-code, V-render] | One `app/src/format/datetime.ts`: `eventDate` → "Sat, Dec 12", `eventTime` → "7:00 PM", `eventWhen` → "Sat, Dec 12 · 7:00 PM", `timestamp` → "Nov 13, 10:00 AM" (adds the year when it isn't the current year). State the time zone once per page ("Times are Atlanta time"), not on every line | Removes 24-hour vs. 12-hour mixing and ISO leakage | P2 |
| **G-10** | Responsive navigation | Guest phone nav is a horizontal scroll strip under the top bar ("My Seats" is clipped at 390px). Staff phone nav is a horizontal strip of 13 links with group labels hidden. Host attendance has about 120px of dead space above the title at 390px [V-render] | Guest: fixed bottom tab bar with 4 items (Home, Tables, Requests, My Seats) using icon + label; Account stays in the top bar. Staff: "Menu" button in the top bar that opens a drawer with the grouped nav. Remove the dead space | Familiar patterns. Every destination reachable without hidden scrolling | P1 |
| **G-11** | Icons and decoration | Most cards have a 34px bordered icon tile beside an eyebrow. There's a decorative fork-and-knife tile on Tables and a clipboard tile on Requests, decorative orbit circles, and gradient cards (`notice-card`, `state-panel`) [V-render, V-code] | Use an icon only when it identifies a type in a list (seat, payment, refund) or a state (success, warning). Remove icon tiles from section headings. Remove gradients from working surfaces and keep them only on sign-in/callback | Lowers visual noise without losing meaning | P2 |
| **G-12** | Forms | Inputs are 42–48px with 11–13px text. Border contrast is 1.85:1, below the 3:1 minimum. Native `<select>` is unstyled in Conduct reports. Error summaries exist on Profile only. Labels sit cramped against the helper text above them [V-render, V-code] | `Field` (DS-07): 14px label, 15px input text, 13px hint, inline error with icon, `aria-describedby` wiring, 3:1 border. Every form with more than 3 fields gets an error summary. Style native selects and checkboxes consistently | Accessibility and polish. WCAG 1.4.11, 3.3.1, 3.3.3 | P1 |
| **G-13** | Confirmations | Dialogs exist in 6 files with different layouts. Conduct deletion uses `window.confirm` (`ops-workspaces.tsx:238`) [V-code] | One `ConfirmDialog` (DS-09): title says the action and object, body says the consequence, buttons read "Cancel" and the verb + object ("Delete report"). Focus trap and restore, Escape closes. Destructive verb uses `danger` | Consistent, accessible consequences | P2 |
| **G-14** | Refresh controls | 8 icon-only refresh buttons ("Refresh My Seats", "Refresh roster", …), plus "Check again", "Check status", "Refresh list" and "Reload" [V-code] | Guest screens drop manual refresh. Data refreshes on focus and after actions; pending payment states poll on their own. Staff screens keep one text button, "Refresh", in the page header actions slot | Removes ambiguous icon buttons and duplicate verbs | P2 |
| **G-15** | Disclaimers and footnotes | 12 sidebar footnote strings and many in-page "this is separate" sentences [V-code] | Remove all sidebar footnotes (R-01). Keep a disclaimer only where it changes a decision at that moment (for example, near a payment button) | Applies `LP §A1-5` and decisions D-1/D-2/D-5 that the render doesn't yet follow | P1 |
| **G-16** | Terminology still in UI | Decided but not yet rendered: "member" (D-1), "app invitation" (D-2), email delivery status shown to guests (D-5), "Identity review" for photo review (`LP §A1-2`). Examples: "MEMBER WORKSPACE", "Member / Home", "Use the email address connected to your app invitation.", "Email provider accepted" [V-render, V-code] | Apply the decided vocabulary in the same pass as G-02/G-03, because the shell and header carry most of these strings. Details in §6 | Removes contradictions with the agreed glossary | P1 |
| **G-17** | Fonts | The app loads Fraunces/Inter from Google at runtime. If that fails, Fraunces falls back to Georgia, which changes the look (seen in mock renders, where external requests were blocked) [V-render, V-code `__root.tsx`] | Self-host the same woff2 files the marketing site uses, with `font-display: swap` and metric-matched fallbacks | Consistent rendering, privacy, no third-party dependency | P2 |
| **G-18** | Keyboard and focus | No skip link. Focus outline is defined only for `button`, `a` and `input`, not `select`, `textarea` or custom choice cards [V-code] | Add "Skip to content". Apply `:focus-visible` to every interactive element through a token. Keep the 44px touch target rule | WCAG 2.4.1, 2.4.7 | P1 |
| **G-19** | Motion | The shimmer animation is declared, and reduced-motion is handled 10 times in separate places [V-code] | One reduced-motion rule in the tokens file. Skeletons use a static tone when reduced motion is requested | Less duplication | P3 |
| **G-20** | Internal surfaces | **Correction 2026-11-15 [V-code]:** `/preview` already returns 404 in production (`routes/preview.tsx` `beforeLoad`, confirmed on a production build), and the "Test mode" banner is driven by provider state, not a build flag. Remaining work is only to move the ~250 lines of `.preview-*` CSS out of the production stylesheet (R-18) | Move preview CSS to a dev-only stylesheet loaded by the preview route | Smaller production CSS | P3 |

---

## 4. Page inventory

Routes from `app/src/routes` (TanStack file routes). "States reviewed" lists what I actually saw.

| # | Route | Page ID | Audience | States reviewed | Evidence |
|---|---|---|---|---|---|
| 1 | `/sign-in` | P-SIGNIN | Public | default, `?error=expired` (renders as default), desktop + 390 | V-render |
| 2 | `/auth/callback` | P-CALLBACK | Public | invalid/expired link | V-render |
| 3 | `/` | P-ENTRY | Any signed-in user | error. "Where to?" chooser and no-access read from code | V-render, V-code |
| 4 | `/member` | P-HOME | Guest | signed-out, populated (new guest) | V-render, V-legacy |
| 5 | `/account/profile` | P-PROFILE | Guest | load error, incomplete form, submitted, correction requested | V-render, V-legacy |
| 6 | `/tables` | P-TABLES | Guest | load error, populated | V-render, V-legacy |
| 7 | `/tables/$tableId` | P-TABLE | Guest / public share | load error, populated, shared preview (signed out) | V-render, V-legacy |
| 8 | `/requests` | P-REQUESTS | Guest | load error, request + offer card | V-render, V-legacy |
| 9 | `/invitations/$invitationId` | P-INVITE | Guest | load error, checkout awaiting acknowledgment, acknowledged, blocked, signed out, unknown | V-render |
| 10 | `/my-seats` | P-SEATS | Guest | load error, payments in progress + upcoming + past | V-render |
| 11 | `/my-seats/$seatId` | P-SEAT | Guest | confirmed + cancellation pending, cancelled, refund failed, foreign seat denied | V-render |
| 12 | `/my-seats/$seatId/cancellation` | P-CANCEL | Guest | form, pending, completed, cancelled | V-render |
| 13 | `/tonight/$tableId` | P-TONIGHT | Guest with seat | error, before voting, ballot, recorded, closed match / no match, expired, not eligible, no seat | V-render |
| 14 | `/admin` | P-OVERVIEW | Admin | error, healthy worker, stale worker, no access | V-render |
| 15 | `/admin/waitlist` | P-WAITLIST | Admin | signed-out, populated, invite dialog (legacy) | V-render, V-legacy |
| 16 | `/admin/identity-review`, `/$guestId` | P-IDREVIEW | Admin | list error, queue, detail | V-render, V-legacy |
| 17 | `/admin/seat-requests`, `/$tableId`; `/host/tables/$tableId/roster` | P-ROSTER | Admin / host | list error, roster detail, approval dialog, removal dialog | V-render |
| 18 | `/admin/tables` | P-SUPPLY | Admin (also host fallback) | error, populated list | V-render, V-legacy |
| 19 | `/admin/tables/$tableId` | P-SUPPLYDETAIL | Admin | draft, published, save uncertain, cancel panel | V-legacy, V-code |
| 20 | `/admin/tables/weekly-clone` | P-WEEKLY | Admin | default + history error. Preview/complete/undone from legacy | V-render, V-legacy |
| 21 | `/admin/table-decisions` | P-DECISIONS | Admin | populated with blocker, confirm | V-render |
| 22 | `/admin/staff-assignments` | P-ASSIGN | Admin | populated | V-render |
| 23 | `/admin/cancellations`, `/$requestId` | P-CANCELS | Admin | queue, detail, confirm, denial | V-render |
| 24 | `/admin/refunds`, `/$obligationId` | P-REFUNDS | Admin | queue, detail failed, unknown, dispatch | V-render |
| 25 | `/admin/notices` | P-EMAILS | Admin | populated (unknown vs. failed) | V-render |
| 26 | `/admin/table-invitations` | P-INVDELIVERY | Admin | load error, accepted, failed | V-render, V-legacy |
| 27 | `/admin/conduct-reports` | P-REPORTS | Admin | populated reports + ratings | V-render |
| 28 | `/host/assigned-tables` | P-HOSTTABLES | Host | load error | V-render |
| 29 | `/host/attendance/$tableId` | P-ATTEND | Host | closed, open, checked in, flagged, denied | V-render |
| 30 | `/restaurant` | P-RESTAURANT | Restaurant | error, populated, no venue | V-render |
| 31 | (unmatched) | P-404 | Any | default | V-render |
| 32 | (route error) | P-ERROR | Any | code only | V-code |
| 33 | `/preview` | P-PREVIEW | Internal | default | V-render |
| 34 | ~~`AdminSupplySyncWorkspace` "Check Airtable"~~ | P-SYNC | Admin | deleted 2026-11-15 (was unreachable; the Tables page has an inline check) | V-code |

### Not inspected (limitations)

- **Populated states that need a signed-in backend** were not re-rendered today: Home, Profile, Tables, Table detail, Requests, Waitlist, Identity review, Supply list/detail, Weekly-clone preview, host Assigned tables. I used the real-stack screenshots from 2026-11-14 plus current code. Copy on those screens may differ slightly from the legacy images. Recommendations quote current code strings.
- **Tablet (768–1024px)** wasn't captured for any screen. The breakpoint findings come from CSS. QA in Phase 4 must cover it.
- **Mock renders use fallback fonts** (Georgia/system), because the specs block external origins. Type-scale observations account for that.
- **Stripe-hosted checkout**, Supabase auth emails, the guest email templates and the marketing site weren't reviewed visually.
- **Screen readers** weren't tested. Accessibility findings come from code inspection and contrast math.

---

## 5. Page-by-page recommendations

Each page assumes the global G-items and DS-components are in place. A table row that only says "apply G-03" is left out unless the page needs something specific.

### Guest journey

#### Page: Sign in — `/sign-in` (P-SIGNIN)

**Purpose.** A returning guest gets a sign-in link. A newcomer learns how to get access.

**Current assessment.** [V-render] This is the most polished screen. The split brand panel and form, single input and single primary button work well. There are three issues. On phones, the brand panel pushes the form below the fold, so the input starts at about 580px of an 844px viewport. `?error=expired` renders the same as the default screen, so a guest who arrives from a dead link gets no explanation. And the body text is 12px.

**Intended attention flow.** 1) "Welcome back." 2) Email field. 3) "Send sign-in link". 4) "New here? Join the waitlist."

| ID | Element / area | Current issue | Proposed change | Rationale | Priority |
|---|---|---|---|---|---|
| P-SIGNIN-01 | Phone layout | Brand panel is about 300px tall, so the form is low on the screen [V-render] | At widths under 640px, reduce the brand panel to the logo plus the one-line headline (about 140px). Hide "Sign in to see your tables." and the "FIFTH WHEEL · ATLANTA" stamp | The input is visible without scrolling | P1 |
| P-SIGNIN-02 | Error query | `?error=expired` shows nothing [V-render] | If the query is present, show an inline notice above the field: "That link has expired. Enter your email and we'll send a new one." Verify the callback actually redirects with this parameter (Q-08) | Recovery in context | P2 |
| P-SIGNIN-03 | Submitted state | Not seen live | Make sure the "check your email" state replaces the form in the same card and focuses its heading. Copy per `LP §D1` | Clear confirmation | P2 |
| P-SIGNIN-04 | Type | 12px intro, 10–11px footnote [V-code] | 15px intro, 13px footnote (DS-01) | Legibility | P1 |

**Remove or combine.** Remove the "FIFTH WHEEL · ATLANTA" stamp on the left panel (R-09); the eyebrow "Atlanta, around the table" already places the city. Keep "Joining the waitlist doesn't give you access right away." It answers a real question at the moment someone might click "Join".

**Language.** Current copy follows `LP §D1`. No further change.

**Layout.** Keep the 50/50 split down to 900px, then stack.

**Dependencies.** DS-01, DS-02. Q-08.

**Expected outcome.** A phone user can sign in without scrolling, and expired-link arrivals know what happened.

---

#### Page: Link callback — `/auth/callback` (P-CALLBACK)

**Purpose.** Exchange the magic link, or recover from a bad one.

**Current assessment.** [V-render] The invalid state is clear ("This link doesn't work.", "Send a new link"). The brand panel headline "Your next chapter starts here. One more step to sign in." contradicts the failure message beside it.

| ID | Element | Current issue | Proposed change | Priority |
|---|---|---|---|---|
| P-CALLBACK-01 | Brand panel copy in failure state | Upbeat "One more step to sign in." beside a failure | In the failed state, use the same brand panel as Sign in. Keep the welcome copy only for the in-progress state | P2 |
| P-CALLBACK-02 | Layout | Reuses a separate auth layout from Sign in [V-code] | Share one `AuthLayout` component with P-SIGNIN | P2 |

**Expected outcome.** No mixed signals during recovery.

---

#### Page: Workspace entry — `/` (P-ENTRY)

**Purpose.** Send each person to their workspace. Multi-role staff choose one.

**Current assessment.** [V-render, V-code] The error state reads "We couldn't load your account." followed by "Try again." That's a heading plus an instruction with no information. Then there are two buttons: "Try again" (outline) and "Go to sign in" (primary). The primary is the less likely recovery. The chooser shows unavailable workspaces with "Coming soon." [V-code `index.tsx:56-60`].

| ID | Element | Current issue | Proposed change | Priority |
|---|---|---|---|---|
| P-ENTRY-01 | Error actions | The primary button is "Go to sign in" | Primary "Try again", secondary text link "Sign in with a different email" | P2 |
| P-ENTRY-02 | Chooser | Disabled "Coming soon" choices | Hide workspaces the person can't use. Never show placeholders (interface-direction rule) | P2 |
| P-ENTRY-03 | Single role | Covered in code | Keep the auto-redirect. Show the chooser only when there are two or more workspaces | — |

**Language.** C-01.

---

#### Page: Home — `/member` (P-HOME)

**Purpose.** Answer "What should I do next, and what's coming up?"

**Current assessment.** [V-legacy, V-code] The page is static. Every guest sees the same thing: a two-line italic hero ("A lovely evening / takes shape here."), "Signed in as {email}", an "APP ACCESS ACTIVE" pill, a "Complete your profile" card, and an empty "Your Tables will appear here" box. That holds even for approved guests with paid seats, because `/api/member/home` returns only identity. The page therefore misleads an approved guest, which is a Quality-maxim failure, and it wastes the most-visited screen. The sidebar footnote "Your admission is separate from Table invitations and payment." is noise.

**Intended attention flow.** 1) Greeting with first name. 2) The one next-step card (state-dependent). 3) Upcoming evening(s) or open invitation(s). 4) Secondary link to browse Tables.

| ID | Element | Current issue | Proposed change | Rationale | Priority |
|---|---|---|---|---|---|
| P-HOME-01 | Content model | Static next step and empty state [V-code] | **Decided (Q-01 / D-12, 2026-11-15): Option A.** A state-aware next step, chosen from data the client can already fetch (`/api/member/profile`, `/api/me/requests`, `/api/me/seats`). Order of precedence: open Table invitation → "Pay for your seat at {Table}". Profile correction requested → "Update your profile". Profile incomplete → "Complete your profile". Profile submitted → "We're reviewing your profile" (no button). Upcoming seat → "Your next evening: {Table}, {eventWhen}". Otherwise → "Find a table". If a request fails, Home skips the step that depends on it and still shows the rest. It never falls back to "Complete your profile" by default. Option B (simplify) was rejected | Removes a false statement and turns Home into the dashboard it was meant to be | P1 |
| P-HOME-02 | Hero | 55px two-line italic tagline + email + pill [V-legacy] | Greeting H1 at 32px: "Good evening, {firstName}." (time-of-day greeting optional, Q-09). Remove the "Signed in as" line and the "APP ACCESS ACTIVE" pill | The email belongs on Account. The pill tells a signed-in person they're signed in | P2 |
| P-HOME-03 | Upcoming list | Empty box with disclaimer text | Up to 3 compact rows (Table title, `eventWhen`, neighborhood, status badge), each linking to its seat or invitation. Empty state: "No evenings yet. Browse tables to find one." with a "Browse tables" button | Real content. A useful empty state | P1 |

**Remove or combine.** R-01 (sidebar footnote). R-02 ("Signed in as"). R-03 (APP ACCESS ACTIVE pill). Remove the empty-state disclaimer "Table invitations and Seats are separate from app access. Nothing is shown until it exists on your account."

**Language.** C-02, C-03, C-04.

**Layout.** Single column within `--w-read`. The next-step card is the only brass-bordered surface on the page.

**Responsive.** The next-step button goes full width under 640px.

**Dependencies.** Q-01 (D-12) is decided. Q-09 (greeting wording) is still open. DS-04, DS-06, DS-08. Changes the copy assertions in `w03-admission.spec.ts`.

**Expected outcome.** An approved guest sees their next evening or invitation within a second of signing in.

---

#### Page: Profile — `/account/profile` (P-PROFILE)

**Purpose.** Complete or update the profile and photos, then submit for review.

**Current assessment.** [V-legacy, V-code] This is the longest screen, at about 1,550px tall on desktop. Problems: a two-line hero ("A good introduction / starts with you."), two stacked info banners before the first field, four numbered section cards that each carry an icon, a "0N / LABEL" eyebrow, a serif heading and a description, cramped label spacing (for example, "How do you identify?" sits about 4px under the date-of-birth hint), and Save/Submit only at the very bottom. The "STILL NEEDED" list helps, but it only appears at the end. The form's logic and validation are good.

**Intended attention flow.** 1) Title + status badge ("Incomplete", "In review", "Approved", "Changes requested"). 2) A correction reason, if any. 3) What's still needed. 4) Sections in order. 5) Submit.

| ID | Element | Current issue | Proposed change | Rationale | Priority |
|---|---|---|---|---|---|
| P-PROFILE-01 | Header | Hero tagline + "ACCOUNT / PROFILE" eyebrow + breadcrumb [V-legacy] | `PageHeader`: H1 "Your profile", description "Only you and the Fifth Wheel team can see this.", status badge right | One title. The privacy reassurance moves here from the sidebar footnote | P1 |
| P-PROFILE-02 | Top banners | Two banners: "Complete your profile / Finish the required details…" and "Changing your date of birth, gender, photos or selfie means we'll review your profile again. Other changes don't." [V-code] | Replace both with one "Still needed" checklist at the top (moved from the bottom). Move the re-review rule to a field hint shown only when the profile is approved, under DOB/gender/photos | Shows remaining work up front. The rule appears where it applies | P1 |
| P-PROFILE-03 | Section headers | "01 / ABOUT YOU" + icon + "The essentials" + "Required for a complete member profile." [V-legacy] | H2 only: "About you", "Who you'd like to meet", "More about you (optional)", "Photos". Drop the numbers, icons and descriptions, except Photos keeps its one privacy sentence | Removes 12 decorative elements | P2 |
| P-PROFILE-04 | Field rhythm | Labels crowd the previous hint. Choice groups and inputs have different vertical gaps [V-legacy] | DS-07 spacing: 24px between fields, 8px label→control, 6px control→hint. Two-column grid on desktop only for short paired fields (first/last name, age range) | Even rhythm | P1 |
| P-PROFILE-05 | Actions | Save + Submit at the bottom only. Submit is disabled with no adjacent reason [V-legacy] | Sticky action bar at the bottom of the viewport: "Save" (secondary) and "Submit for review" (primary). When Submit is disabled, the bar shows "{n} items still needed" as a link that scrolls to the checklist | Always reachable. A disabled button with a reason | P1 |
| P-PROFILE-06 | Photos | Two upload cards, a "0 ready" counter in 7px caps, a retention note [V-legacy] | One "Photos" section: a profile-photos grid (up to 6 thumbnails + an add tile) and a separate "Selfie" tile. Each thumbnail shows a status badge (Uploading / Ready / Couldn't upload). Keep the retention note as a 13px hint | Visual, familiar upload pattern | P2 |
| P-PROFILE-07 | Footer disclaimer | "Profile review does not include government ID verification or a background check." duplicates the Photos privacy sentence [V-legacy] | Remove the footer line. Keep the single sentence in Photos: "We compare your photos and selfie by hand. We don't check ID or run background checks." | Say it once | P2 |

**Remove or combine.** R-01, R-04 (section numbering and icons), R-05 (duplicate ID-check disclaimer). Combine the two top banners into the checklist.

**Language.** C-05 through C-09.

**Responsive.** Single column under 720px. The sticky bar respects the safe-area inset. The days-of-week choices wrap 2 per row at 390px.

**Dependencies.** DS-07 (Field, ChoiceGroup), DS-04. The correction state must keep `correction-reason` prominent, directly under the header.

**Expected outcome.** Shorter perceived length, visible progress, and submission always within reach.

---

#### Page: Tables — `/tables` (P-TABLES)

**Purpose.** Find an upcoming table that suits you and open it.

**Current assessment.** [V-render, V-legacy] A 55px two-line italic hero, a decorative fork-and-knife tile, and an intro take about 240px before the filters. The filter bar is a heavy bordered card with an icon tile and the caption "Find a night that fits / All times are Atlanta time." Results are a 2-column grid of large cards. Each card shows a calendar icon tile, "$25 total", the date, the title, neighborhood/time, and a full-width "View Table" button, so 2 cards fill the viewport. On error, the filters stay visible above the error panel.

**Intended attention flow.** 1) Title. 2) Filters (compact). 3) Results, scannable by date. 4) Each result's title.

| ID | Element | Current issue | Proposed change | Rationale | Priority |
|---|---|---|---|---|---|
| P-TABLES-01 | Header | Hero + eyebrow "FIND YOUR PEOPLE" + decorative tile [V-render] | `PageHeader` H1 "Tables", description "Upcoming evenings in Atlanta. Request a seat at any that suit you." Remove the tile | Utility page (principle 3) | P1 |
| P-TABLES-02 | Filters | Card with icon tile, caption and explicit "Apply filters" button [V-render] | An unboxed inline row: From, To, Neighborhood (select of known neighborhoods if the API exposes them, else text), with "Clear" as a text link when any filter is set. Apply on change (debounced). State "Times are Atlanta time" once, under the results heading | Fewer clicks, less chrome | P2 |
| P-TABLES-03 | Results | 2 large cards per row, with an icon tile and a full-width button per card [V-legacy] | Group by week ("This week", "Next week", then "Week of Dec 14"). Each result is one clickable row/card: date block (DAY / date), title, neighborhood · time, and on the right the seat price ($25) and a request status badge if the guest already requested it. The whole card is the link. Remove the "View Table" button. 3 columns at ≥1280px, 2 at ≥720px, list on phone | More tables per screen. The existing request state shows without opening the table | P1 |
| P-TABLES-04 | Error/empty | Filters remain above an error [V-render] | On load error, show `PageState error` without filters. When filters return nothing: "No tables match those dates." plus a "Clear filters" button | G-08 | P2 |
| P-TABLES-05 | Section label | "UPCOMING IN ATLANTA / Tables to consider" + "Every evening follows a three-stop itinerary." [V-legacy] | Remove the eyebrow and heading; the page title covers them. Move "Every evening has three stops: drinks, dinner and dessert." into the first-use empty state or the How-it-works explainer (`LP §E` unapplied item) | Say it once | P3 |

**Remove or combine.** R-01, R-06 (decorative header tiles), the per-card icon tile and button.

**Language.** C-10, C-11.

**Responsive.** Filters collapse into a "Filter" button that opens a sheet under 640px. Date fields don't sit side by side at 390px.

**Dependencies.** DS-10 (EventCard). G-09. Request status per table, if not already in `/api/tables` (Q-10).

**Expected outcome.** Scanning a month of tables takes one scroll instead of five.

---

#### Page: Table detail — `/tables/$tableId` (P-TABLE)

**Purpose.** Decide whether to request a seat.

**Current assessment.** [V-legacy, V-code] The layout is the strongest guest pattern in the app: itinerary on the left, a sticky decision card on the right. Issues: a stack of eyebrows ("A FIFTH WHEEL EVENING" and "THREE STOPS, ONE GOOD NIGHT"), the itinerary title "Your itinerary" (it isn't theirs yet), three actions in the decision card (Request a seat, Share this Table link, See your Requests), and "per person if you're invited" next to "$25 / total".

**Intended attention flow.** 1) Title + date/time/neighborhood. 2) Itinerary. 3) Price + "Request a seat". 4) Share (tertiary).

| ID | Element | Current issue | Proposed change | Priority |
|---|---|---|---|---|
| P-TABLE-01 | Header | Two eyebrows plus a date line above the title | Back link "Tables", then H1, then the meta line `eventWhen · neighborhood`. Remove both eyebrows | P2 |
| P-TABLE-02 | Itinerary | Card with icon tile, eyebrow and "Your itinerary". Stops show "DINNER · 60 MIN LATER" in 7px caps | H2 "The evening". Each stop: time if known (Q-11) or relative label at 13px, venue name at 20px serif, address and note at 14px. No outer card, just a vertical timeline rule | P2 |
| P-TABLE-03 | Decision card | Price, explanation, primary, share and see-requests links | Price "$25" with "per seat, only if you're invited" (13px). Primary "Request a seat". Then a short line: "Nothing is charged now." Share becomes an icon+label text button at the card bottom. Remove "See your Requests"; after a successful request, the card itself shows "Requested · View in Requests" | P1 |
| P-TABLE-04 | Requested state | Code shows "Request received — awaiting review." [V-code] | Card replaces the primary with a status badge "Requested" plus a "Withdraw request" text button (destructive styling not needed, it's reversible) | P2 |
| P-TABLE-05 | Shared preview (signed out) | Separate layout "SHARED TABLE PREVIEW" [V-code] | Use the same detail layout with the decision card's primary replaced by "Sign in to request a seat" and the link "New here? Join the waitlist." | P2 |

**Responsive.** Under 900px the decision card moves under the header (above the itinerary) and becomes a sticky bottom bar with price + primary when scrolled past.

**Language.** C-12, C-13.

**Dependencies.** DS-11 (Itinerary). Q-11.

---

#### Page: Requests — `/requests` (P-REQUESTS)

**Purpose.** See the status of each seat request, and act on any invitation.

**Current assessment.** [V-legacy, V-code] One request card at 390px holds "SEAT REQUEST · STILL PENDING", the title, a "SEAT REQUEST · PENDING" pill, "Requested Nov 14", a nested invitation card with "TABLE INVITATION / Your invitation is open / Active", a separate-offer disclaimer, a nested "Email provider accepted" card, "Review Table invitation", a withdrawal disclaimer and "View Table details" [V-legacy]. The one action that matters, paying, is a text link fourth from the top of a nested card.

**Intended attention flow.** 1) Invitations awaiting payment (top, brass). 2) Pending requests. 3) Past (withdrawn, not selected, cancelled), collapsed.

| ID | Element | Current issue | Proposed change | Rationale | Priority |
|---|---|---|---|---|---|
| P-REQUESTS-01 | Structure | Each request nests its invitation | Three groups: **"Invited — pay to confirm"** (invitation cards), **"Waiting to hear"** (pending requests), **"Past"** (`<details>` collapsed). A request with an active invitation appears only in the first group | Puts money and time-sensitive items first | P1 |
| P-REQUESTS-02 | Invitation card | Text link, nested cards, Active pill, email status | Card: title, `eventWhen · neighborhood`, the pay deadline if any, and the primary button "Pay $25 to confirm". No email status (D-5). No "separate offer" sentence | One action, stated plainly | P1 |
| P-REQUESTS-03 | Request card | Status repeated twice, eyebrow + pill | Title, `eventWhen`, one badge ("Requested"), "Requested Nov 14" as 13px meta, "Withdraw" text button. Whole card links to the table | One status | P1 |
| P-REQUESTS-04 | Header | Hero "Every request, right here." (legacy) / "Your requests" + clipboard tile (current) | H1 "Requests", no description (the groups explain themselves) | Quiet utility page | P2 |
| P-REQUESTS-05 | Empty | — | "You haven't requested any tables yet." with a "Browse tables" button | Useful empty state | P2 |

**Remove or combine.** R-07 (repeated status labels), R-08 (guest email delivery status), the "This is a separate offer…" and "Request withdrawal is unavailable while this invitation is active. This offer is managed separately." sentences. For the second one, hide the Withdraw control when withdrawal isn't allowed instead of explaining it.

**Language.** C-14 through C-17.

**Dependencies.** D-4 (decline/revoke labels). DS-06, DS-10.

**Expected outcome.** "Do I need to do anything?" is answered by the first card.

---

#### Page: Table invitation and checkout — `/invitations/$invitationId` (P-INVITE)

**Purpose.** Accept the offer by paying for one seat.

**Current assessment.** [V-render] The page title is the table name with the eyebrow "TABLE INVITATION". The decision card says "You're invited / Pay to confirm your seat at Garden Table." It includes a disclosure box with "PAYMENT DISCLOSURE / Version seat-checkout-v1", a checkbox "I acknowledge this disclosure, version seat-checkout-v1.", a disabled "Continue to payment" and "Your seat is confirmed once your payment goes through." Below sit a full itinerary card and two bottom buttons, "Back to Requests" (outline) and "View Table details" (brass). That makes two brass buttons, and the itinerary duplicates the table page.

**Intended attention flow.** 1) "You're invited to {Table}". 2) When and where (summary). 3) Price + disclosure + acknowledge. 4) "Continue to payment". 5) Itinerary (secondary).

| ID | Element | Current issue | Proposed change | Priority |
|---|---|---|---|---|
| P-INVITE-01 | Competing primary | "View Table details" is brass [V-render] | Make it a text link inside the itinerary heading ("Full details"). Remove "Back to Requests" (the back link in the header covers it) | P1 |
| P-INVITE-02 | Header | Eyebrow "TABLE INVITATION" + H1 table title; the card repeats "You're invited" | H1 "You're invited to {Table}". Meta `eventWhen · neighborhood`. Card heading becomes "Your seat" | P2 |
| P-INVITE-03 | Disclosure | Version string shown twice to guests | **Needs legal sign-off (D-14 / Q-05).** Proposed: keep the approved sentence verbatim. Move the version to a 12px line under the box ("Terms version seat-checkout-v1"). Checkbox label "I understand and agree." The record still stores the version | P1 (blocked) |
| P-INVITE-04 | Itinerary | Full itinerary card duplicates P-TABLE | A compact itinerary (3 rows: label, venue, neighborhood) using DS-11 `compact` | P3 |
| P-INVITE-05 | Disabled button | No adjacent reason | Helper under the button while it's disabled: "Check the box above to continue." | P2 |
| P-INVITE-06 | Blocked/unknown states | Copy handled in `LP §D4` | Use `PageState`-style inline notices, not a second card | P2 |

**Language.** C-18, C-19. Keep `CHECKOUT_DISCLOSURE.text` unchanged.

**Responsive.** At 390px the decision card is first, and the pay button sticks to the bottom once the box is checked.

**Dependencies.** Q-05, DS-11.

---

#### Page: My Seats — `/my-seats` (P-SEATS)

**Purpose.** See upcoming and past seats, and any payment that's still settling.

**Current assessment.** [V-render] The breadcrumb reads "MEMBER WORKSPACE · My Seats", followed by the eyebrow "YOUR EVENINGS", a 55px H1 and an icon refresh button. Sections carry eyebrows that repeat the headings ("CURRENT / Upcoming Seats", "HISTORY / Past Seats") and count bubbles. Payment cards hold 5 lines of status, including the 2-line "Payment received; refund pending. A $25 charge was received. The refund is being handled; do not start another payment." The error state shows "The Seat list returned an unexpected response." twice.

**Intended attention flow.** 1) Upcoming seats (next first). 2) Payments that need attention. 3) Past seats.

| ID | Element | Current issue | Proposed change | Priority |
|---|---|---|---|---|
| P-SEATS-01 | Header | Breadcrumb + eyebrow + H1 + description + refresh icon | H1 "My Seats". No description, no refresh (G-14) | P2 |
| P-SEATS-02 | Order | Payments in progress comes first | Upcoming first. Payments in progress second, as compact notice rows (title, one-line status, one-line next step). Past collapsed under "Past evenings ({n})" | P1 |
| P-SEATS-03 | Section labels | Eyebrows duplicate headings, count bubbles | H2 only, count in the heading text when useful ("Past evenings (3)") | P2 |
| P-SEATS-04 | Seat card | Icon tile + state eyebrow + title + meta + "Paid $25.00" + "View details" button | Whole card is a link. Title, `eventWhen · neighborhood`, one status badge (Confirmed / Cancelled / Refunded). No price on list cards (it's on the detail page) | P2 |
| P-SEATS-05 | Payment rows | 4–5 lines, bold heading + body + amount line + second warning | Two lines: status (badge + sentence) and what to do ("Contact us" link if action is needed, otherwise "Nothing to do. This updates by itself.") | P1 |
| P-SEATS-06 | Error | Parser message, shown twice | Standard `PageState error` (C-20) | P1 |

**Language.** C-20, C-21, plus D-10 refund states (decided, `LP §C4`).

**Dependencies.** DS-06, DS-10, G-14.

---

#### Page: Seat detail — `/my-seats/$seatId` (P-SEAT)

**Purpose.** Everything about one evening: when, where, payment and refund, and what you can do.

**Current assessment.** [V-render] There's a cancellation banner, a Payment card and a Refund card side by side, an itinerary card, a cancellation history card, and five bottom buttons (Back to My Seats, View cancellation request, Tonight, Add to calendar [brass], Check again). Cancellation shows up three times: banner, history and button. The Refund card says "No refund is due for this seat" while a cancellation request is pending, which reads as a verdict on the request. Every card has an icon tile + eyebrow + heading.

**Intended attention flow.** 1) Title + when/where. 2) Current status (one line). 3) The most relevant action (Tonight on the night, otherwise Add to calendar). 4) Itinerary. 5) Payment and refund details. 6) "Ask to cancel" (tertiary, at the bottom).

| ID | Element | Current issue | Proposed change | Rationale | Priority |
|---|---|---|---|---|---|
| P-SEAT-01 | Actions | 5 equal-weight buttons at the bottom [V-render] | Header actions: one primary chosen by state. Within 3 hours of start → "Open tonight's page". Upcoming → "Add to calendar". Past → none. "Ask to cancel" (or "View cancellation request") becomes a text link at the bottom of the page. Remove "Back to My Seats" (header back link) and "Check again" (G-14) | One obvious action | P1 |
| P-SEAT-02 | Status | Banner + history card + button for one cancellation | One status line under the title: badge "Cancellation requested" + "Your seat is yours until we decide." Remove the history card when there's only one entry. With several, show a collapsed "History" | Say it once | P1 |
| P-SEAT-03 | Payment and refund | Two cards. "No refund is due" shown during a pending cancellation | One "Payment" section as a definition list: Paid $25.00 · Nov 1, Receipt (link or "Not available yet"), Refund (shown only when a refund exists or a decision is pending: "Decided after your cancellation is reviewed"). Never show "No refund is due" while a request is pending (Q-12) | Accuracy. Less chrome | P1 |
| P-SEAT-04 | Itinerary | Full card with icon + eyebrow | DS-11 standard, no outer card | P2 |

**Language.** C-22, C-23.

**Responsive.** The header primary goes full width under 640px.

**Dependencies.** DS-11. Q-12 (refund copy truth check with Ledger).

---

#### Page: Ask to cancel — `/my-seats/$seatId/cancellation` (P-CANCEL)

**Purpose.** Request cancellation, then follow the decision.

**Current assessment.** [V-render] After the request is sent, the H1 still says "Ask to cancel". Two notices say similar things: a green "Your seat is still yours until we decide. You can still come and vote." and a brass "Request sent. We'll let you know." There's a "REQUEST HISTORY / Request history" eyebrow+heading pair, plus "Back to Seat details" and "Check again".

| ID | Element | Current issue | Proposed change | Priority |
|---|---|---|---|---|
| P-CANCEL-01 | Title by state | Always "Ask to cancel" | Form state: "Ask to cancel". After sending: "Cancellation requested". After a decision: "Cancellation approved" or "Cancellation declined" (D-4 wording) | P1 |
| P-CANCEL-02 | Duplicate notices | Two notices | One success notice: "Request sent. Your seat is yours until we decide, and you can still come and vote." | P2 |
| P-CANCEL-03 | History | Eyebrow repeats heading | H2 "Your request" with the timeline. Remove the eyebrow | P3 |
| P-CANCEL-04 | Actions | Back + Check again | Header back link only | P3 |
| P-CANCEL-05 | Form | Not re-rendered (form state) | Field (DS-07) for the optional note. Submit "Send request" (primary). Show the refund policy summary from `LP §D5` directly above the button | P2 |

---

#### Page: Tonight — `/tonight/$tableId` (P-TONIGHT)

**Purpose.** On the night: where to be when, check-in status, then the vote.

**Current assessment.** [V-render] This is the cleanest guest screen. Its hierarchy is close to right. Issues: "19:00 Atlanta time" in the header while the body uses "7:00 PM", the "Your evening" stops lack the stop number pattern used elsewhere, and the error and refusal pages are generic ("Unavailable right now / This is temporarily unavailable.").

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-TONIGHT-01 | Time format | `eventTime` everywhere (G-09) | P2 |
| P-TONIGHT-02 | Itinerary | DS-11 `compact`, with the current stop highlighted by time | P3 |
| P-TONIGHT-03 | Vote | Keep the ballot → confirm → receipt flow. Make the receipt a success notice, not a bordered card inside a card | P3 |
| P-TONIGHT-04 | Error | `PageState` with "Back to My Seats" as the primary action | P2 |

---

### Admin

#### Page: Overview — `/admin` (P-OVERVIEW)

**Purpose.** What needs attention now, most urgent first.

**Current assessment.** [V-render] The concept is good (an ordered queue list plus worker health). The H1 is "Today", smaller than every other admin title, with no description gap. Count prefixes ("1 · Tables on hold") are serif text, so numbers don't align. Urgency is shown by the button color (brass "Open" vs. outline). The two health banners (green and brass) are separate, full-width boxes.

| ID | Element | Current issue | Proposed change | Priority |
|---|---|---|---|---|
| P-OVERVIEW-01 | Queue rows | "N · Title" in serif, "Open" buttons colored by urgency | DS-12 `QueueRow`: right-aligned tabular count (24px, sans), title (16px), one-line description (14px muted), urgency `StatusBadge` ("Urgent") on urgent rows, row is a link with a chevron. All "Open" buttons removed | P1 |
| P-OVERVIEW-02 | Health | Two banners | One compact status line under the title: "Emails and refunds sending normally · checked 2 min ago". Warnings (stale worker, oldest email waiting) become an urgent row at the top of the list | P2 |
| P-OVERVIEW-03 | Clear queues | "12 queues are clear" | Keep it, at 13px muted under the list | — |
| P-OVERVIEW-04 | Footer | "Need help? Email … Terms and privacy" inside the admin page | Move it to the shell footer (staff only) or remove it. Staff don't need guest terms links on their dashboard (Q-13) | P3 |

---

#### Page: Waitlist — `/admin/waitlist` (P-WAITLIST)

**Purpose.** Find signups and approve app access.

**Current assessment.** [V-legacy, V-render] The table works. Search + neighborhood select + "Search" + icon refresh + a "Live list" pill is more control than needed. The signed-out/error state still shows the toolbar. Status labels mix "Not approved", "Active" and "Access removed". The row action "Review app invite" uses old vocabulary (D-2).

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-WAITLIST-01 | Toolbar | Search field (submits on Enter, with a clear button) + Neighborhood select. Remove the "Search" button, the icon refresh and the "Live list" pill. Page-level "Refresh" text action (G-14) | P2 |
| P-WAITLIST-02 | Row action | "Approve…" (opens the existing dialog). Non-actionable rows show their status only, with no text in the action column | P2 |
| P-WAITLIST-03 | Status filter | Optional (Q-14): a segmented filter "Waiting · Approved · All" to replace manual scanning | P3 |
| P-WAITLIST-04 | Dialog | Keep the recipient summary + email preview. Apply DS-09 so the title reads "Approve {name}?" and the primary reads "Approve and send link" | P2 |
| P-WAITLIST-05 | Phone | Rows become cards (name, email, neighborhood, joined, status, action), not label/value grids | P2 |

**Language.** C-24, C-25.

---

#### Page: Profile review — `/admin/identity-review`, `/admin/identity-review/$guestId` (P-IDREVIEW)

**Purpose.** Check that photos and the selfie match the details, then approve or request a correction.

**Current assessment.** [V-legacy, V-render] The page is titled "Profile review", but the nav item, URL and sidebar footnote say "Identity review", and the detail shows "IDENTITY REVIEW / ATTEMPT 1" and "Profile version 12 · Identity version 3". The decision panel heading "What should happen next?" plus "Decisions apply only to the submitted identity version shown above." frames a simple approve/correct choice as a puzzle. The photos panel is well designed.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-IDREVIEW-01 | Naming | "Profile review" everywhere: nav, H1, breadcrumb/back. URL can stay (Q-15) | P1 |
| P-IDREVIEW-02 | Detail header | H1 = guest name. Meta "Submitted Nov 14 · Review 1". Remove the profile/identity version numbers from the header (keep them in a collapsed "Technical details" if ops needs them, Q-15) | P2 |
| P-IDREVIEW-03 | Layout | Photos panel first (left, wider), details right, decision bar sticky at the bottom of the viewport: "Request changes" (secondary) and "Approve" (primary) | P1 |
| P-IDREVIEW-04 | Decision copy | Remove "What should happen next?" and the version sentence. Add one 13px line: "Approving confirms the photos match these details." | P2 |
| P-IDREVIEW-05 | Queue | Table rows: name, submitted, review #, waiting time. Oldest first | P2 |

---

#### Page: Seat requests and roster — `/admin/seat-requests`, `/admin/seat-requests/$tableId`, `/host/tables/$tableId/roster` (P-ROSTER)

**Purpose.** Pick 3–5 eligible guests for a table, then approve and send invitations. Hosts propose, admins approve.

**Current assessment.** [V-render] The roster detail is long. The applicant list ("People who asked to join") shows a checkbox, an avatar placeholder icon, the name, "Requested Nov 1, 2026 · #1" and an "Eligible" pill. Below it, a "ROSTER DRAFT / Current roster" card repeats the selected names with "Works" pills, an "Approve roster" button and an icon refresh, plus the footnote "This proposal is read-only for your current workspace permissions." The approve dialog is clear and names the recipients.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-ROSTER-01 | Two-pane layout | Desktop: applicants (left, scrollable) and a sticky "Selected (3 of 3–5)" panel (right) with composition checks and the primary "Approve and send invitations" (admin) or "Send to admin" (host). Phone: applicants list with a sticky bottom summary bar ("3 selected · Review"). Removes the duplicated name list | P1 |
| P-ROSTER-02 | Applicant row | Remove the avatar placeholder icon. Name (15px), request date + order as 13px meta, eligibility badge only when *not* eligible (exceptions stand out) | P2 |
| P-ROSTER-03 | Composition checks | Show each failed rule next to the summary as a sentence ("Needs at least one more guest"). Show "Group works" once when all pass. Remove per-name "Works" pills | P2 |
| P-ROSTER-04 | Read-only notice | Replace the footnote with a disabled-state reason beside the primary button ("Only admins can approve") | P2 |
| P-ROSTER-05 | Removal dialog | Already DS-09-like. Align the title "Remove {name} from {Table}?" and the danger primary | P2 |
| P-ROSTER-06 | List page | Table rows: table, `eventWhen`, requests count, roster state badge, link | P2 |

**Dependencies.** D-17 (meaning of "#n"). DS-09, DS-12.

---

#### Page: Tables (supply) — `/admin/tables` (P-SUPPLY)

**Purpose.** See all tables by lifecycle and open one to edit or publish.

**Current assessment.** [V-render, V-legacy, V-code] On load failure the shell switches to host navigation ("Assigned tables" only) and the label "SUPPLY WORKSPACE", which strands the admin. The footnote "Table updates do not change invitations, seats, or payments." is engineering reassurance. The list works.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-SUPPLY-01 | Shell | Covered by G-02 (role from workspace, not page data) | P1 |
| P-SUPPLY-02 | Header actions | "New table" (primary), "Copy a week" (secondary), and "Check Airtable" (secondary, once P-SYNC is routed) in the header actions slot | P2 |
| P-SUPPLY-03 | List | Group or filter by lifecycle (Draft · Approved · Live · Cancelled). Columns: title, `eventWhen`, neighborhood, status badge. Remove raw IDs from titles (fixture data shows "Synthetic Thursday Table 39207abb08fa", which is a fixture, not product, but confirm titles don't carry IDs in production) | P2 |

---

#### Page: Table detail (supply) — `/admin/tables/$tableId` (P-SUPPLYDETAIL)

**Purpose.** Edit a table's draft, preview it, publish it, or cancel it.

**Current assessment.** [V-legacy, V-code] The vocabulary is engineering-heavy: "Edit the working supply", "DRAFT REVISION 2", "Draft changes are separate from accepted and guest-visible revisions.", "SERVER-VALIDATED PREVIEW · DRAFT V2", a raw key `new_table` in "Revision changes", "Source current". There are two final buttons (Accept revision, Publish revision), D-9. The Cancel Table panel renders outside the shell, after the page, with a gold "Cancel table" confirm [V-code `table-cancel-panel.tsx:47`].

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-SUPPLYDETAIL-01 | Page structure | Header: H1 table title, status badge (Draft / Approved / Live), actions "Preview" + primary "Publish" (or "Approve", per D-9). Body: an "Details" form section, then an "Itinerary" section (3 stops), then "Changes since last publish" (diff), then a "Danger zone" section with "Cancel table…" (danger outline) | P1 |
| P-SUPPLYDETAIL-02 | Cancel panel | Move inside the page container (G-02). Its confirm button uses `danger` (DS-05) | P1 |
| P-SUPPLYDETAIL-03 | Diff | Field labels, not keys ("New table" instead of `new_table`). Old → new on one line | P2 |
| P-SUPPLYDETAIL-04 | Stop editor | Each stop: venue select, minutes from start, guest note. Remove the repeated "Drinks venue / Dinner venue" field labels by using the stop heading as the group label (`fieldset legend`) | P2 |
| P-SUPPLYDETAIL-05 | Sticky save | Unsaved-changes bar: "Unsaved changes · Save draft" | P2 |
| P-SUPPLYDETAIL-06 | Dev banners | "Local test data / Local fixture actions enabled" development-only (G-20) | P2 |

**Language.** `LP §D9` covers most strings. Add C-26.

**Dependencies.** D-9, D-16, D-18 (cancel email statement).

---

#### Page: Copy a week — `/admin/tables/weekly-clone` (P-WEEKLY)

**Purpose.** Copy one week's draft tables to another week.

**Current assessment.** [V-render] **This page renders without the app shell**: no top bar, no nav, content flush against the left edge of the window. It also has a "Drafts only / Only drafts are copied." notice that repeats the page description ("Only drafts are copied."), a timezone chip "America/New_York", "1 · Pick weeks" step numbering with only one visible step, and a "Recent copies" error with both "Refresh list" and "Try again".

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-WEEKLY-01 | Shell | Render inside `AppShell` under Tables (G-02) | P1 |
| P-WEEKLY-02 | Redundancy | Remove the "Drafts only" notice and the "Atlanta calendar weeks" chip. Keep the description "Copy draft tables from one week to another. Only drafts are copied." | P2 |
| P-WEEKLY-03 | Form | Two week pickers inline ("From week of" → "To week of") + "Preview copy" primary. Remove the "1 ·" step numbering unless the preview is presented as step 2 on the same page | P2 |
| P-WEEKLY-04 | History | One "Try again" in the error. Remove "Refresh list" | P3 |
| P-WEEKLY-05 | Time zone | "America/New_York" → "Atlanta time" | P2 |

---

#### Page: Table decisions — `/admin/table-decisions` (P-DECISIONS)

**Purpose.** For tables starting within 24 hours, confirm or cancel.

**Current assessment.** [V-render] Clear and compact. Issues: 24-hour time "19:00 Atlanta time", a disabled "Confirm table" without an adjacent reason (the reason "Needs 3–5 paid guests" sits on a separate line), and the "Needs a decision" pill in wine reads like an error.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-DECISIONS-01 | Row | Title, `eventWhen · neighborhood`, "{n} paid guests" (prominent). On the right: "Confirm" (primary) + "Manage" (secondary). When blocked, replace "Confirm" with the reason as text ("Needs 3 paid guests") and keep "Manage" | P2 |
| P-DECISIONS-02 | Badge tone | "Needs a decision" → `pending` tone (brass), not warning/wine | P3 |

---

#### Page: Staff assignments — `/admin/staff-assignments` (P-ASSIGN)

**Purpose.** Set each host's contact details and assigned tables, and each restaurant's venues.

**Current assessment.** [V-render] One card per staff member with an inline contact form and a checkbox list "Assigned Tables · Autumn Table · 2026-12-12". ISO dates. The "Host" pill is the only role signal. The save button is inline with the inputs.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-ASSIGN-01 | Layout | Tabs or sections "Hosts" / "Restaurants". Each person is a row that expands to edit. The contact form gets a "Save" in its own row | P2 |
| P-ASSIGN-02 | Table list | `eventWhen` labels, upcoming only by default, with a "Show past" toggle | P2 |

---

#### Page: Cancellation requests — `/admin/cancellations`, `/$requestId` (P-CANCELS)

**Purpose.** Decide each request and the refund amount.

**Current assessment.** [V-render] The detail shows "REQUEST / {name}", meta "Garden Table · 2026-11-21 · 19:00" (ISO date), a card with "SEAT / Cancellation Requested" (title-case raw state), "THEIR NOTE", a decision card "DECISION / Cancel this seat?", the line "Declining keeps their seat as it is (confirmed). Approving adds the refund to Refunds. Send it from there.", a message field, refund radios, "Amount still available to refund: $25.00. Amount already owed for other refunds: $0.00.", then "Decline" and "Approve cancellation", and below that "Back to queue" and "Check again". The list page has an empty eyebrow element [V-code `seat-cancellation-workspaces.tsx:209`].

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-CANCELS-01 | Header | H1 = guest name, meta = `eventWhen` + table, status badge | P2 |
| P-CANCELS-02 | Decision order | Refund choice first (radios: Full $25.00 / Partial [amount field] / None), then the optional message to the guest, then "Decline request" (secondary) and "Approve and record refund" (primary). The policy line under the radios: "Up to $25.00 can be refunded." Show the other-refunds amount only when it's greater than $0 | P1 |
| P-CANCELS-03 | Remove | "Back to queue", "Check again", the empty eyebrow | P3 |
| P-CANCELS-04 | Queue | Table: guest, table, `eventWhen`, requested, flagged-by-host badge, link | P2 |

**Language.** C-27.

---

#### Page: Refunds — `/admin/refunds`, `/$obligationId` (P-REFUNDS)

**Purpose.** See what's owed, send it, and resolve failures.

**Current assessment.** [V-render] The breadcrumb is "Refunds › Obligation" (data-model word). On the detail page, "Failed" / "Still owed. Needs an admin to look at it first." is repeated in the status card, in a sentence under the stats ("The refund failed. It's still owed."), in the attempt card, and in a footer notice ("Needs an admin to look at it."). There are both "Check again" and "Check status". The four stat boxes have equal weight, though only "Total owed" and "Left to send" drive action.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-REFUNDS-01 | Status | One status block under the header: badge "Failed" + one sentence + the next action button ("Check with Stripe" or "Send again", per state). Remove the 3 repeats | P1 |
| P-REFUNDS-02 | Amounts | A definition list: Paid $25.00 · Owed $12.50 · Sent $0.00 · Left to send $12.50 (emphasized). Not 4 cards | P2 |
| P-REFUNDS-03 | Attempts | A plain table: date, amount, result badge. "Check status" per row only for unknown outcomes | P2 |
| P-REFUNDS-04 | Breadcrumb | "Refunds" back link. No "Obligation" | P2 |

**Language.** `LP §D11` covers states. Add C-28.

---

#### Page: Guest emails — `/admin/notices` (P-EMAILS)

**Purpose.** Fix emails that failed or have an unknown outcome.

**Current assessment.** [V-render] The row shows a raw engineering token "lease expired", the description names the provider ("check Resend first"), and an "Unconfirmed" pill uses wine (error) tone.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-EMAILS-01 | Raw reason | Map internal reasons to labels ("lease expired" → "Sending timed out") | P1 |
| P-EMAILS-02 | Grouping | Two groups: "Didn't send" (Send again primary) and "Not sure it sent" (Check, then Send again or Dismiss) | P2 |
| P-EMAILS-03 | Nav | Merge with Table invitation delivery under one "Emails" nav item with two tabs (R-10, Q-16) | P2 |

**Language.** C-29.

---

#### Page: Table invitation delivery — `/admin/table-invitations` (P-INVDELIVERY)

**Purpose.** Track and retry Table invitation emails.

**Current assessment.** [V-render, V-legacy] The sidebar footnote reads "Retry queues delivery work; it never changes offer approval or payment state." The intro explains Resend semantics. This page overlaps in purpose with Guest emails.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-INVDELIVERY-01 | IA | Becomes the "Table invitations" tab under "Emails" (R-10) | P2 |
| P-INVDELIVERY-02 | Copy | Description: "Invitation emails and whether they were delivered. 'Sent' means our email service accepted it." | P2 |

---

#### Page: Conduct reports and ratings — `/admin/conduct-reports` (P-REPORTS)

**Purpose.** Triage private reports. See rating averages.

**Current assessment.** [V-render] An unstyled native `<select>` for status, a checkbox "Keep (don't delete)", a raw lowercase status badge "new", an ISO date in ratings ("2026-12-12 · 2 responses"), and two H1s on one page ("Conduct reports", "Ratings"). Delete uses `window.confirm`.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-REPORTS-01 | Headings | One H1 "Reports and ratings". H2 for each section, or tabs | P2 |
| P-REPORTS-02 | Report row | Status `StatusBadge` (sentence case), styled select (DS-07), "Hold (don't auto-delete)" toggle with hint, "Delete" in `danger` via DS-09 | P2 |
| P-REPORTS-03 | Ratings | `eventDate` format | P3 |

---

### Host

#### Page: Assigned tables — `/host/assigned-tables` (P-HOSTTABLES)

**Purpose.** See my tables and open roster or attendance.

**Current assessment.** [V-render] The error state is fine. Breadcrumb "Host tools › Assigned Tables" uses different casing from the nav ("Assigned tables"). The footnote "Host access is limited to assigned tables." adds nothing.

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-HOSTTABLES-01 | Header | H1 "Your tables". No breadcrumb (top level). No footnote | P2 |
| P-HOSTTABLES-02 | Rows | Table, `eventWhen`, roster state badge, two actions: "Roster" and "Attendance" (shown when check-in is relevant) | P2 |

#### Page: Attendance — `/host/attendance/$tableId` (P-ATTEND)

**Purpose.** Check guests in on the night, and flag cancellation requests.

**Current assessment.** [V-render] About 120px of empty space above the title at 390px. The explanatory footnote sits at the bottom. The "Check in" button is large and brass on each row, which works for a one-thumb task. "19:00 Atlanta time".

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-ATTEND-01 | Spacing bug | Remove the dead space (G-10) | P1 |
| P-ATTEND-02 | Summary | Add "{checked} of {total} checked in" under the title | P2 |
| P-ATTEND-03 | Row | Name, status badge, right-aligned "Check in". After check-in, the row shows "Checked in 7:05 PM" and an "Undo" text button if the API allows (Q-17). "Flag for admin" appears only on rows with a pending cancellation | P2 |
| P-ATTEND-04 | Closed state | The "Check-in opens once staff record that this Table is proceeding…" notice goes at the top, not the bottom | P2 |

### Restaurant

#### Page: Service times — `/restaurant` (P-RESTAURANT)

**Purpose.** Party size and timing for my venue.

**Current assessment.** [V-render] The nav label is "Service times" but the H1 is "Upcoming service times". The content is simple and fine. A venue selector appears only with multiple venues (correct).

| ID | Element | Proposed change | Priority |
|---|---|---|---|
| P-RESTAURANT-01 | Title | H1 "Service times" (match the nav) | P3 |
| P-RESTAURANT-02 | Rows | Date, arrival time, party size (large, tabular), host contact. Group by date | P3 |

### System

#### Page: Not found and route error (P-404, P-ERROR)

[V-render] These are clear and focused. Remove the "FIFTH WHEEL · ATLANTA" footnote stamp (R-09). In P-ERROR, "Try again" is outline and "Go to home" is primary. Make "Try again" primary.

#### Page: Preview — `/preview` (P-PREVIEW)

[V-render] An internal design gallery with its own copies of shell CSS (about 250 lines of `.preview-*` and phone-frame rules in `styles.css`). Gate it to development builds (G-20) and move its CSS into a dev-only stylesheet so production CSS shrinks.

#### Removed: Check Airtable standalone workspace (P-SYNC)

**Decided 2026-11-15 (Q-18): deleted.** `AdminSupplySyncWorkspace` had no route, so staff could not reach it. The Tables page's inline "Check Airtable" action does the same job. The component and its stylesheet are removed.

---

## 6. Content and language changes

These changes are additive to `app/docs/implementation/language-refactor-plan.md`. "Before" strings are verified in current code. Rows marked **(LP, unapplied)** restate a decided language-plan change that the render still doesn't follow.

| ID | Where | Before (exact) | After | Type | Source |
|---|---|---|---|---|---|
| C-01 | `/` error | "We couldn't load your account." / "Try again." | "We couldn't load your account." / "Check your connection and try again." | Simplify | new |
| C-02 | Home, guest shell | "MEMBER WORKSPACE" (top bar), "Member / Home" (breadcrumb), sidebar caption "YOUR EVENINGS" | Remove all three | Remove | D-1 (LP, unapplied) |
| C-03 | Home | "A lovely evening / takes shape here." + "Signed in as {email}." | "Good evening, {firstName}." | Simplify | new |
| C-04 | Home empty | "Your Tables will appear here" / "Table invitations and Seats are separate from app access. Nothing is shown until it exists on your account." | "No evenings yet" / "Browse tables and request a seat at any that suit you." + button "Browse tables" | Clarify | D-2 (LP, unapplied) |
| C-05 | Home next step | "Complete your profile" / "Add your details and private review evidence. Profile review is separate from app access and Table invitations." | "Complete your profile" / "Add a few details and two photos so we can seat you well." | Simplify | LP §D2 |
| C-06 | Profile header | Eyebrow "ACCOUNT / PROFILE", H1 "A good introduction / starts with you.", intro "Tell us who you are and who you would like to meet. These details stay private." | H1 "Your profile", description "Only you and the Fifth Wheel team can see this." | Simplify | new |
| C-07 | Profile sections | "01 / ABOUT YOU" "The essentials" "Required for a complete member profile." / "02 / YOUR PREFERENCES" "Who you would like to meet" / "03 / MORE ABOUT YOU" "A little more, if you like" "These details are optional and are not automated eligibility filters." / "04 / PHOTOS FOR REVIEW" | "About you" / "Who you'd like to meet" / "More about you (optional)" / "Photos" | Simplify | new |
| C-08 | Profile, top banner | "Finish the required details and add a separate photo and selfie before submitting for review." | Replaced by checklist heading "Still needed" with items | Combine | new |
| C-09 | Profile | Footer "Profile review does not include government ID verification or a background check." | Remove (said in Photos) | Remove | new |
| C-10 | Tables header | Eyebrow "FIND YOUR PEOPLE", H1 "An evening worth / looking forward to.", intro "Upcoming tables in Atlanta. Request a seat at any that suit you, and we'll build each table from the requests." | H1 "Tables", description "Upcoming evenings in Atlanta. Request a seat at any that suit you." | Simplify | new |
| C-11 | Tables filters | "Find a night that fits" / "All times are Atlanta time." / "Apply filters" | Remove caption; "Times are Atlanta time" under results heading; no apply button | Simplify | new |
| C-12 | Table detail | Eyebrows "A FIFTH WHEEL EVENING", "THREE STOPS, ONE GOOD NIGHT"; "Your itinerary" | Remove eyebrows; "The evening" | Simplify | new |
| C-13 | Table detail card | "per person if you're invited" / "We'll look at all the requests and let you know if you're invited. Nothing is charged now." / "See your Requests" | "per seat, only if you're invited" / "Nothing is charged now. We'll let you know if you're invited." / remove link | Simplify | LP §D3 |
| C-14 | Requests | "SEAT REQUEST · STILL PENDING" + pill "SEAT REQUEST · PENDING" (`copy/states.ts`) | One badge "Requested" | Standardize | LP §C4 (unapplied in `states.ts`) |
| C-15 | Requests | "This is a separate offer. Your Seat request remains in history, and this invitation does not confirm a paid Seat." | Remove | Remove | D-2 |
| C-16 | Requests | "Email provider accepted" / "The provider accepted the email. Inbox delivery is not confirmed." | Remove from guest UI | Remove | D-5 (LP, unapplied) |
| C-17 | Requests | "Review Table invitation" (text link) / "Request withdrawal is unavailable while this invitation is active. This offer is managed separately." | Button "Pay $25 to confirm" / remove the sentence and hide Withdraw | Clarify | new |
| C-18 | Invitation | Eyebrow "TABLE INVITATION" + H1 "{Table}" + card "You're invited" / "Pay to confirm your seat at {Table}." | H1 "You're invited to {Table}" / card heading "Your seat" | Simplify | new |
| C-19 | Invitation | "PAYMENT DISCLOSURE" / "Version seat-checkout-v1" / "I acknowledge this disclosure, version seat-checkout-v1." | Heading "Before you pay"; version in 12px footnote "Terms version seat-checkout-v1"; checkbox "I understand and agree." | Clarify | D-14 (**blocked: legal**) |
| C-20 | My Seats error | "The Seat list returned an unexpected response." (×2) | "We couldn't load your seats." / "Try again in a moment. Nothing about your seats or payments has changed." | Clarify | new |
| C-21 | My Seats | Eyebrow "YOUR EVENINGS" + "Your upcoming and past tables."; "CURRENT / Upcoming Seats"; "HISTORY / Past Seats"; "Payments in progress" | Remove eyebrow and description; "Upcoming"; "Past evenings ({n})"; "Payments" | Simplify | D-6 casing |
| C-22 | Seat detail | Refund card "No refund is due for this seat" / "If that changes, the refund status will appear here." (while cancellation pending) | During a pending cancellation: "Refund: decided after your cancellation is reviewed." Otherwise omit the refund row when none exists | Clarify (truth) | new, Q-12 |
| C-23 | Seat detail | "Check again" | Remove | Remove | G-14 |
| C-24 | Waitlist | Row action "Review app invite" | "Approve…" | Standardize | D-2 |
| C-25 | Waitlist | Pill "Live list" | Remove | Remove | new |
| C-26 | Supply detail | "Edit the working supply" / "Draft changes are separate from accepted and guest-visible revisions." / "SERVER-VALIDATED PREVIEW · DRAFT V2" / `new_table` | "Details" / remove / "Preview" / "New table" | Simplify | LP §D9 + new |
| C-27 | Cancellation detail | "Cancellation Requested" (raw title case); "Declining keeps their seat as it is (confirmed). Approving adds the refund to Refunds. Send it from there." | Badge "Cancellation requested"; "Approving records the refund. You send it from Refunds." (decline consequence moves into the Decline confirm) | Clarify | new |
| C-28 | Refund detail | Breadcrumb "Obligation"; "Still owed. Needs an admin to look at it first." ×3 | Back link "Refunds"; one sentence: "This refund failed and is still owed." | Simplify | LP §D11 |
| C-29 | Guest emails | "lease expired"; "For unconfirmed ones, check Resend first. If it didn't go out, send again. If it did, dismiss." | "Sending timed out"; group intro "We're not sure these sent. Check the email log, then send again or dismiss." | Clarify | new |
| C-30 | Sidebar footnotes (all 12) | e.g. "Your admission is separate from Table invitations and payment." / "Retry queues delivery work; it never changes offer approval or payment state." / "Supply changes never alter invitations, seats or payment state." | Remove all (R-01) | Remove | new |
| C-31 | Signed-out panels | "Use the email address connected to your app invitation." | "Sign in with the email you used to join." | Standardize | D-2 (LP, unapplied) |
| C-32 | Staff top bar | "ADMIN WORKSPACE" / "HOST WORKSPACE" / "RESTAURANT WORKSPACE" / "SUPPLY WORKSPACE" | Role shown only when a person has more than one workspace, as a switcher button "Admin ▾" | Simplify | new |
| C-33 | Weekly copy | "America/New_York"; "Drafts only / Only drafts are copied." | "Atlanta time"; remove notice | Simplify | G-09 |
| C-34 | Tonight / Decisions / Attendance | "19:00 Atlanta time" | "7:00 PM" (zone stated once per page) | Standardize | G-09 |
| C-35 | Identity review | Nav "Identity review", eyebrow "IDENTITY REVIEW / ATTEMPT 1", "What should happen next?", "Decisions apply only to the submitted identity version shown above." | Nav "Profile review"; meta "Review 1"; remove heading and sentence; add "Approving confirms the photos match these details." | Standardize | LP §A1-2 |

---

## 7. Elements to remove or consolidate

| ID | Element | Where | What happens to its content or function |
|---|---|---|---|
| R-01 | Sidebar footnotes (12 strings) | Every authenticated page | Deleted. The two that carry user value move: privacy → Profile description; "Seat appears after verified payment" → My Seats empty state ("Seats appear here once you've paid.") |
| R-02 | "Signed in as {email}" | Home | Email visible on Account/Profile only |
| R-03 | "APP ACCESS ACTIVE" pill | Home | Deleted (being on Home proves access) |
| R-04 | Section numbering + section icon tiles | Profile, Weekly copy, roster | Deleted. H2s carry the structure |
| R-05 | Duplicate "no ID check" disclaimer | Profile footer | Kept once in Photos |
| R-06 | Decorative header tiles (fork/knife, clipboard) | Tables, Requests | Deleted |
| R-07 | Repeated status labels (eyebrow + pill + heading) | Requests, My Seats, Seat detail, Refunds | One `StatusBadge` per object |
| R-08 | Guest-facing email delivery status | Requests, invitation | Deleted from guest UI (D-5); remains on staff delivery page |
| R-09 | "FIFTH WHEEL · ATLANTA" stamps | Sign-in, 404, error | Deleted. Brand is in the logo |
| R-10 | Two email nav items ("Guest emails", "Table invitation delivery") | Staff nav | One "Emails" item with two tabs; MESSAGES group removed (one item doesn't need a group label) |
| R-11 | Per-page icon refresh buttons (8) and "Check again" (5) | Guest pages, staff pages | Guest: removed (auto-refresh). Staff: one "Refresh" header action |
| R-12 | Breadcrumbs on top-level pages | Home, Tables, Requests, My Seats, Waitlist, Refunds, Supply | Removed. Detail pages keep a single back link |
| R-13 | "Back to …" buttons at page bottom | Seat detail, invitation, cancellation, refunds | Removed (header back link) |
| R-14 | Workspace label in top bar | All | Replaced by workspace switcher only for multi-role users (C-32) |
| R-15 | Duplicate selected-roster list | Roster detail | Merged into the sticky Selected panel |
| R-16 | Health banners ×2 | Overview | One status line plus an urgent row when unhealthy |
| R-17 | Gradient backgrounds on working cards | `notice-card`, `state-panel`, `member-next-step` | Flat `--surface-2` with `--line-accent` border for the single emphasized card |
| R-18 | Dead `.preview-*` / phone-frame CSS in production stylesheet | `styles.css` ~lines 1–260 | Move to dev-only stylesheet with `/preview` |
| R-19 | Equal-weight stat boxes | Refund detail | Definition list with one emphasized value |
| R-20 | Empty `<p className="eyebrow"></p>` | Refunds list, Cancellations list | Deleted |

---

## 8. Component and design-system changes

Keep these deliberately few. All live in `app/src/components/ui/` (new) and `app/src/styles/` (new: `tokens.css`, `base.css`, `components.css`). Feature CSS files then hold only layout specific to their feature.

### DS-01 Type and spacing scale

| Token | Size / line-height | Use |
|---|---|---|
| `--text-xs` | 12 / 16 | Meta, footnotes, uppercase labels (11px only for uppercase with +0.08em) |
| `--text-sm` | 13 / 20 | Hints, secondary rows, badges |
| `--text-base-staff` | 14 / 22 | Staff body, table cells |
| `--text-base` | 15 / 24 | Guest body, inputs, buttons |
| `--text-lg` | 17 / 26 | Lead paragraph, card titles (sans) |
| `--display-sm` | 20 / 26 Fraunces | Card / list item titles |
| `--display-md` | 26 / 32 Fraunces | H2 |
| `--display-lg` | 34 / 40 Fraunces | H1 (all working pages) |
| `--display-xl` | clamp(40, 6vw, 56) / 1.05 Fraunces | Sign-in and callback only |

Weights: Inter 400/500/600. Fraunces 400 (and italic 400 for brand accents on auth pages only). Max line length is 68ch for prose.

Spacing: `--space-1…8` = 4, 8, 12, 16, 24, 32, 48, 64. Section gap is 32 (guest) or 24 (staff). Field gap is 24. Card padding is 24 desktop, 16 phone.

### DS-02 Color and shape tokens

Reuse the marketing kit's names and values (`src/styles/tokens.css`) and add semantic aliases:

| Semantic token | Value (from kit / current) | Notes |
|---|---|---|
| `--bg` | `--ground` #161009 | |
| `--surface-1` | `--ground-lift` #1f1710 | Cards |
| `--surface-2` | #2b2216 | Raised, selected nav, emphasized card |
| `--line` | `--rule-hair` | Card borders |
| `--line-strong` | ≥3:1 vs. surface (e.g. #7a6648, verify) | **Input and control borders**. Today's #51422e is 1.85:1 (fails WCAG 1.4.11) |
| `--text` | `--linen` #f3e9d8 | |
| `--text-muted` | `--linen-80` #c4b49a | Secondary text |
| `--text-subtle` | #a6947c (6.4:1 on bg) | Meta. Replaces #786c58 (3.6:1, fails) and #84765d (4.2:1, fails) used for nav captions and group labels |
| `--accent` / `--on-accent` | `--brass` #c79a4b / #21190d | Primary button (6.7:1) |
| `--accent-soft` | `--brass-12` | Selected and hover fills |
| `--success`, `--warning`, `--danger` | sage, amber, wine families, each with `-fg`, `-bg`, `-line` | Each `-fg` ≥4.5:1 on its `-bg` |
| `--focus` | `--brass-soft` #dcb670, 2px outline + 2px offset | |
| `--radius-sm/md/lg/pill` | 8 / 12 / 16 / 999 | Inputs and badges (sm), buttons (md), cards and dialogs (lg). Replaces 17 values |
| `--shadow-dialog` | single value | Only dialogs and sheets have elevation |

Disabled primary today is 2.9:1. Use `--surface-2` fill with `--text-subtle` text and a not-allowed cursor, and pair it with a visible reason (principle 6).

### DS-03 AppShell

Props: `role`, `active`, `workspaces` (for the switcher). Top bar: logo (links to the role home), workspace switcher (only if 2+ workspaces), Account (guests) and Sign out. Sidebar on desktop at 240px (staff: grouped; guest: 4 items). Phone: guest bottom tab bar, staff "Menu" drawer. Includes the skip link and the `<main id="content">` landmark. Every authenticated route renders through a TanStack layout route that mounts the shell once, so the shell is never repeated per page.

Staff nav after R-10:

- Overview
- **Guests:** Waitlist · Profile review · Seat requests
- **Tables:** Tables · Table decisions · Staff assignments
- **Money:** Cancellations · Refunds
- **Messages and safety:** Emails · Reports and ratings

### DS-04 PageHeader

`<PageHeader back={{href,label}}? title description? status? actions? />`. H1 uses `--display-lg`. Description uses `--text-lg` muted, max 60ch. Actions are right-aligned on desktop and go full width below the title on phones (primary first). Back link is a 14px text link with an arrow, above the title.

### DS-05 Button

Variants: `primary` (brass), `secondary` (outline using `--line-strong`), `tertiary` (text), `danger` (wine fill for the final confirm, wine outline for entry points). Sizes: `md` 44px (default), `sm` 36px (staff tables only, with a 44px hit area through padding). Icon + label, gap 8px. An icon-only button requires `aria-label` and a tooltip. Loading state keeps the width and shows a spinner + "Saving…".

### DS-06 StatusBadge

Props: `tone` (neutral | pending | success | warning | danger), `label` from `copy/states.ts`, optional icon (each tone has a default icon so state isn't color-only). Sentence case. 13px. One per object per view.

### DS-07 Field, ChoiceGroup, Select

Label (14/600), control (15px, 48px tall guest / 40px staff, `--line-strong` border, `--radius-sm`), hint (13 muted), error (13 `--danger-fg` with icon), all wired with `aria-describedby` and `aria-invalid`. ChoiceGroup covers checkbox and radio cards with explicit checked, focus and disabled styles (closes the 2026-11-12 review note). Select gets a custom chevron and the same box as an input. `ErrorSummary` at the top of any form with more than 3 fields, linking to each field.

### DS-08 PageState

Variants: `loading` (skeleton blocks matching the page's real layout), `empty` (title, one sentence, optional action), `error` (title, "Try again", reassurance when money or saved data could worry the person), `signed-out` (or a route-level redirect, Q-02), `no-access`. Calm surface, solid `--line` border, no dashed wine border. Error tone comes from the icon and title only.

### DS-09 ConfirmDialog

Title "{Verb} {object}?" Body: consequence plus recipients if any. Buttons: "Cancel" and "{Verb} {object}" (danger when destructive). Native `<dialog>` with `showModal()` for focus trap and Escape handling. Becomes a bottom sheet under 640px.

### DS-10 EventCard

For a table, seat or invitation: date block (weekday + day number), title (`--display-sm`), meta line (`eventWhen · neighborhood`), optional right slot (price or badge). The whole card is a link. Used on Tables, Requests, My Seats and Home.

### DS-11 Itinerary

`standard` (Table detail, Seat detail) and `compact` (invitation, Tonight). A vertical rule with three stop markers. Each stop shows its label (Drinks / Dinner / Dessert), time (clock time if available, Q-11), venue, address and note.

### DS-12 QueueRow / DataTable

For staff lists. A row link with a chevron, tabular numerals, optional urgency badge. Phone: rows become stacked cards. Replaces `table-row`, `waitlist-table`, `ops-*` list variants.

### DS-13 Format module

`app/src/format/datetime.ts` and `money.ts` (G-09). They replace the 17 local helpers. Also remove the hard-coded "$25" / "$0–$25" strings by sourcing amounts from price data (`LP §E2`).

---

## 9. Implementation roadmap

Complexity: S = under 1 day, M = 1–3 days, L = more than 3 days (one implementer, with tests).

### Phase 1 — Global foundations

| Task | Priority | Scope (pages / components) | Depends on | Impact | Complexity | Acceptance |
|---|---|---|---|---|---|---|
| **T-01** Tokens + base styles | P1 | New `styles/tokens.css`, `base.css`. Port marketing kit. Delete superseded and preview rule blocks from `styles.css` | — | All | M | AC-T01 |
| **T-02** Self-host fonts | P2 | `__root.tsx`, `public/fonts` | T-01 | All | S | AC-T02 |
| **T-03** Type and spacing scale applied to existing classes | P1 | All CSS files | T-01 | All | L | AC-T03 |
| **T-04** AppShell + layout routes | P1 | `__root`, new `_guest`, `_staff` layout routes. Removes 14 top-bar copies. Fixes weekly-clone, cancel panel, supply nav fallback | T-01 | All authenticated | L | AC-T04 |
| **T-05** PageHeader, Button, StatusBadge, PageState | P1 | `components/ui/*`. Adopt on every page header and state (mechanical) | T-03 | All | L | AC-T05 |
| **T-06** Field, ChoiceGroup, Select, ErrorSummary, ConfirmDialog | P1 | Profile, roster, cancellations, waitlist dialog, cancel panel, conduct | T-03 | Forms | M | AC-T06 |
| **T-07** Format module | P2 | Replace 17 helpers | — | All | M | AC-T07 |
| **T-08** Copy sweep: shell and decided vocabulary | P1 | C-02, C-14–16, C-24, C-30–32, C-35. R-01, R-09, R-12, R-14, R-20. `copy/states.ts` authored labels | T-04, T-05 | All | M | AC-T08 |
| **T-09** Responsive nav (tab bar + drawer) | P1 | AppShell | T-04 | Phone | M | AC-T09 |
| **T-10** A11y foundations | P1 | Skip link, focus tokens, contrast fixes in DS-02, `aria-describedby` on fields | T-01, T-06 | All | S | AC-T10 |
| **T-11** Dev-only gating (reduced: see G-20 correction) | P3 | Preview CSS only | — | Production hygiene | S | AC-T11 |

T-04 and T-05 should land in one branch with the copy-dependent Playwright updates. About 400 text assertions exist (`LP §E2`), so prefer role-based selectors as you touch them.

### Phase 2 — High-impact screens (primary journeys)

| Task | Priority | Scope | Depends on | Impact | Complexity | Acceptance |
|---|---|---|---|---|---|---|
| **T-12** Home | P1 | P-HOME-01–03, C-03–05 | T-05, DS-10 | Guest first impression | M | AC-HOME |
| **T-13** Requests regrouping | P1 | P-REQUESTS-01–05, C-15–17 | T-05, DS-10, D-4 | Payment conversion clarity | M | AC-REQUESTS |
| **T-14** Invitation and checkout | P1 | P-INVITE-01–02, 04–06 (03 after legal) | T-05, DS-11, Q-05 | Payment | M | AC-INVITE |
| **T-15** Tables list + Table detail | P1 | P-TABLES-01–05, P-TABLE-01–05 | DS-10, DS-11, Q-10, Q-11 | Discovery | M | AC-TABLES |
| **T-16** My Seats + Seat detail | P1 | P-SEATS-*, P-SEAT-*, C-20–23 | DS-06, DS-11, Q-12 | Post-purchase trust | M | AC-SEATS |
| **T-17** Profile | P1 | P-PROFILE-01–07 | T-06 | Onboarding completion | L | AC-PROFILE |
| **T-18** Overview | P1 | P-OVERVIEW-01–04 | DS-12 | Staff triage | S | AC-OVERVIEW |
| **T-19** Roster two-pane | P1 | P-ROSTER-01–06 | DS-09, DS-12 | Core ops flow | L | AC-ROSTER |
| **T-20** Supply detail restructure | P1 | P-SUPPLYDETAIL-01–06, P-SUPPLY-*, C-26 | D-9, D-16, T-06 | Publishing safety | L | AC-SUPPLY |

### Phase 3 — Remaining screens and states

| Task | Priority | Scope | Depends on | Complexity |
|---|---|---|---|---|
| **T-21** Cancellations (admin) + Ask to cancel (guest) | P2 | P-CANCELS-*, P-CANCEL-*, C-27 | T-06, D-4 | M |
| **T-22** Refunds | P2 | P-REFUNDS-*, C-28 | T-05 | M |
| **T-23** Emails merge | P2 | P-EMAILS-*, P-INVDELIVERY-*, R-10, C-29 | T-04, Q-16 | M |
| **T-24** Profile review | P2 | P-IDREVIEW-*, C-35 | T-05 | M |
| **T-25** Waitlist | P2 | P-WAITLIST-* | DS-12, DS-09 | S |
| **T-26** Weekly copy, Decisions, Assignments, Reports | P2 | P-WEEKLY-*, P-DECISIONS-*, P-ASSIGN-*, P-REPORTS-* | T-04–T-06 | M |
| **T-27** Host and restaurant | P2 | P-HOSTTABLES-*, P-ATTEND-*, P-RESTAURANT-* | T-09 | S |
| **T-28** Auth pages + entry + system pages | P2 | P-SIGNIN-*, P-CALLBACK-*, P-ENTRY-*, P-404/ERROR | T-03 | S |
| **T-29** Tonight | P3 | P-TONIGHT-* | DS-11 | S |
| **T-30** Check Airtable route-or-delete | P2 | P-SYNC | Q-18 | S |

### Phase 4 — Quality assurance and polish

| Task | Scope | Acceptance |
|---|---|---|
| **T-31** Responsive verification | Every route at 320, 390, 768, 1024, 1440. Fix overflow, sticky bars, dead space | AC-RESP |
| **T-32** Accessibility review | Keyboard pass of every journey, VoiceOver pass of guest journey, axe on every route, 200% zoom, reduced motion | AC-A11Y |
| **T-33** Consistency audit | Lint scripts (raw hex, font-size px outside tokens, banned terms from `LP §E3`). Screenshot diff of all mock specs | AC-CONSIST |
| **T-34** Visual polish pass | Side-by-side review of all screens with the Visual Design Director checklist (§11) | AC-POLISH |

**Sequencing notes.** T-01 → T-03 → T-04/T-05 is the critical path. Don't restyle any page before T-05 lands, because each page would be reworked twice. Guest pages (T-12–T-17) and staff pages (T-18–T-20) can run in parallel once Phase 1 merges, since they share no feature files.

---

## 10. Acceptance criteria

### Global

- **AC-T01** `app/src/styles/tokens.css` defines every color, radius, shadow, font and spacing value. `grep -E '#[0-9a-fA-F]{3,8}'` outside `tokens.css` returns 0 matches in `app/src/**/*.css`. `!important` count ≤ 3, each with a comment.
- **AC-T02** No request to `fonts.googleapis.com` / `fonts.gstatic.com` on any route. Fraunces renders in mock specs with external origins blocked.
- **AC-T03** No computed font size below 12px on any route (check with a Playwright script that walks visible text nodes, at 1440 and 390). Guest body text computes to 15px and staff body to 14px. At most 9 distinct font sizes across the app.
- **AC-T04** Every authenticated route renders exactly one `<header>` top bar and one nav landmark. `/admin/tables/weekly-clone` and `/admin/tables/$id` (including the cancel panel) render inside the shell. `/admin/tables` with a failed API keeps admin nav. No file outside `AppShell` renders `product-topbar`.
- **AC-T05** Every page H1 uses `PageHeader`. Every loading, empty and error state uses `PageState`. No raw enum value is visible (test: the status text of every mock state matches a `copy/states.ts` value).
- **AC-T06** Every form field has a programmatic label. Errors are announced and linked from an `ErrorSummary` on forms with more than 3 fields. No `window.confirm` in the codebase. Every destructive confirm uses `danger`.
- **AC-T07** No ISO date (`\d{4}-\d{2}-\d{2}`) or 24-hour time (`\b[12]\d:\d{2}\b` without AM/PM) in rendered text of any mock spec. "America/New_York" is never rendered.
- **AC-T08** None of these render in guest UI: "member", "app invitation", "admission", "provider", "Email provider accepted". No sidebar footnote element exists. No empty eyebrow elements.
- **AC-T09** At 390px: guest bottom tab bar shows 4 labeled items fully visible. Staff "Menu" opens a drawer listing every nav item. `document.documentElement.scrollWidth <= innerWidth` on every route at 320px.
- **AC-T10** axe-core reports 0 serious or critical violations on every route in mock specs. Input borders and focus indicators are ≥3:1. All text is ≥4.5:1 (≥3:1 for 18px+ display text). A skip link is the first focusable element.
- **AC-T11** The production stylesheet contains no `.preview-*` rules. (`/preview` already 404s in production.)

### Page-level

- **AC-HOME** For each of the six guest states in P-HOME-01, a mock spec shows the matching next-step card, and an approved guest never sees "Complete your profile". If one of the three endpoints fails, a mock spec shows Home still rendering the other sections with no false next step.
- **AC-REQUESTS** With one active invitation and one pending request, the first card on the page is the invitation with a primary "Pay $25 to confirm". Each request shows exactly one status badge.
- **AC-INVITE** Exactly one primary button on the page. The disabled button shows an adjacent reason. Disclosure text is byte-identical to `CHECKOUT_DISCLOSURE.text`.
- **AC-TABLES** At 1440×900, at least 6 tables are visible above the fold with fixture data. Each card is a single link. Filters apply without an Apply button. Load error hides filters.
- **AC-SEATS** Seat detail has at most one primary and two secondary actions. Cancellation state appears once. "No refund is due" never renders while a cancellation is pending. Upcoming seats render above payments in progress.
- **AC-PROFILE** The "Still needed" checklist renders above the first section when anything is missing. Submit is visible in the viewport at all scroll positions (sticky bar). A disabled submit shows a count of missing items.
- **AC-OVERVIEW** Queue counts are right-aligned with tabular numerals. Urgent rows carry an "Urgent" badge. No row has an "Open" button.
- **AC-ROSTER** Selected guests appear in exactly one place. The primary action is visible without scrolling at 1440×900 and in the sticky bar at 390.
- **AC-SUPPLY** Cancel table lives inside the page under "Danger zone" with a `danger` confirm. No raw keys in the diff. One final publish action (or two, per D-9, with plain labels).

### Phase 4

- **AC-RESP** Every route was captured at 320/390/768/1024/1440 with no horizontal overflow, no clipped nav, no sticky element covering content, and no blank region taller than 64px above the H1.
- **AC-A11Y** Keyboard-only completion of: sign in → profile → request → pay (mock) → ask to cancel, and admin: approve waitlist → approve roster → decide cancellation. Focus is always visible and returns to the trigger after dialogs. The VoiceOver pass announces page titles, status changes (`role=status`) and errors (`role=alert`).
- **AC-CONSIST** The lint scripts pass in CI. Screenshot diffs reviewed for all mock specs.
- **AC-POLISH** Every screen passes the review checklist in §11.

---

## 11. Open questions and tradeoffs

### Open questions

| ID | Question | Recommendation | Owner | Blocks |
|---|---|---|---|---|
| Q-01 | **D-12:** make Home state-aware (Option A) or simplify it (Option B)? | **Decided 2026-11-15: Option A.** No new backend is needed, because the data already exists in three guest endpoints | Product (decided) | — |
| Q-02 | Signed-out handling: per-page "Sign in to continue" panels, or a route-level redirect to `/sign-in?next=`? | Redirect. It's a familiar pattern and removes the per-page signed-out panels. Note this is a behavior change and needs a safe `next` allowlist | Engineering + security | T-04 |
| Q-03 | Should guest seat titles keep "Table" in the name ("Garden Table")? D-6 lowercases the common noun but titles are proper names | Keep titles as authored. Lowercase only the common noun in prose | Content | T-08 |
| Q-04 | Drop the italic brass flourish from all working pages? | Yes. Keep it on sign-in and callback only. The Visual Director's dissent is recorded below | Brand | T-05 |
| Q-05 | **D-14:** checkbox wording and version display on the approved disclosure | Proposed in C-19. Needs legal sign-off | Legal / owner | P-INVITE-03 |
| Q-06 | Staff density: 14px body and 40px controls on staff screens vs. guest 15px/48px? | Yes. Staff use the app daily on desktop. Touch targets stay ≥44px through padding on phones | Design | T-03 |
| Q-07 | Is a tablet layout (768–1024) a real use case for hosts at the venue? | Assume yes for host Attendance. Verify with ops | Ops | T-31 |
| Q-08 | Does the callback redirect with `?error=expired` to `/sign-in`? It renders nothing today | If yes, implement P-SIGNIN-02. If not, drop it | Engineering | T-28 |
| Q-09 | Time-of-day greeting on Home ("Good evening") or neutral ("Welcome back")? | Neutral "Welcome back, {firstName}." Avoids time-zone edge cases | Content | T-12 |
| Q-10 | Does `/api/tables` include the guest's request state per table? | If not, show request state only on the detail page. Don't add an API just for badges | Engineering | P-TABLES-03 |
| Q-11 | Clock times for stops ("7:45 PM") instead of "+45 MIN"? (LP unapplied item) | Yes. Compute from start time + offset in the format module | Product | DS-11 |
| Q-12 | Truth check: what should a guest see about refunds while a cancellation is pending? | C-22 wording. Ledger to confirm | Ledger | T-16 |
| Q-13 | Do staff need the help/terms footer on Overview? | Remove | Ops | T-18 |
| Q-14 | Add a status filter to Waitlist? | Optional, P3. Only if ops confirms they scan for unapproved signups | Ops | P-WAITLIST-03 |
| Q-15 | Do reviewers need profile/identity version numbers on screen? | Hide by default in a collapsed "Technical details" | Ops | T-24 |
| Q-16 | Merge Guest emails and Table invitation delivery into one "Emails" page? | Yes, as two tabs. The routes can remain | Ops | T-23 |
| Q-17 | Can a host undo a check-in? | Show "Undo" only if the API supports it. Don't add it otherwise | Product | P-ATTEND-03 |
| Q-18 | Route or delete the unrouted "Check Airtable" workspace? | Route at `/admin/tables/sync` if Airtable is still the supply source. Otherwise delete it and its CSS | **Decided 2026-11-15: deleted.** | T-30 |

### Tradeoffs and critical review log

I reviewed the draft from four perspectives. Challenges and resolutions:

| # | Reviewer | Challenge | Resolution |
|---|---|---|---|
| 1 | Visual Design Director | Removing the two-line italic hero from Tables and Profile strips out the brand's warmth, and the app risks looking like a generic dashboard | **Partly accepted.** Keep Fraunces for every H1/H2 and the brass accent. Keep the flourish on auth pages, and use the Home greeting as the brand moment. Working pages gain warmth from type quality and spacing, not taglines. Revisit after T-05 screenshots (Q-04) |
| 2 | Accessibility Specialist | A 12px floor is still small for the guest audience. Why not 14px? | 12px is allowed only for meta and footnotes. All reading text is 15px. Uppercase labels at 11px are permitted only with tracking and only as non-essential labels. Accepted with AC-T03 enforcing the floor |
| 3 | Accessibility Specialist | Auto-refresh and removing refresh buttons (G-14) could hide state changes from screen-reader users | Status changes on guest pages announce through `role=status`. Payment-pending rows poll and announce. Staff keep a visible "Refresh". Accepted |
| 4 | UX Designer | Making whole cards links (DS-10) breaks when a card also has a button (Withdraw) | Use the "stretched link" pattern only on cards without other controls. Cards with a secondary action make the title the link. Documented in DS-10 |
| 5 | Content Designer | "Pay $25 to confirm" hard-codes the price | Price comes from data (DS-13). The string template is "Pay {price} to confirm" |
| 6 | UX Designer | Collapsing "Past" requests and seats hides history some guests want | `<details>` with a count in the summary is one click away, keyboard-accessible, and keeps the current screen focused. Accepted |
| 7 | Accessibility Specialist | A bottom tab bar plus a sticky action bar (Profile, Table detail) stack two fixed bars on phones | On pages with a sticky action bar, the tab bar hides while the bar is visible (scroll down) and returns on scroll up, or the action bar sits above the tab bar with combined height ≤ 128px. Verify in T-31 |
| 8 | Visual Design Director | Removing every icon tile flattens the lists | Icons stay where they identify a type in a mixed list (payment vs. seat in My Seats) and on status badges. They're removed only from section headings. Accepted |
| 9 | Content Designer | Removing all "this is not X" sentences risks guests believing a request is a booking | The card states the true fact once at the decision point ("Nothing is charged now.") and the request badge says "Requested", not "Booked". The language plan's comprehension test (`LP §E3`) validates this after Phase 2 |
| 10 | UX Designer | Route-level redirect for signed-out users (Q-02) changes behavior, which is out of scope for a design refactor | Kept as an open question, not a task. `PageState signed-out` is the fallback if it's declined |
| 11 | Accessibility Specialist | Staff `sm` 36px buttons fall short of the 44px target | Hit area is padded to 44px. Visual size 36px only on desktop staff tables. Accepted |

**Tradeoff accepted with Q-01:** Option A for Home costs three API calls on load, which is a performance cost for a better first screen. If load time becomes a concern, add a combined endpoint later. Don't add one now.

---

## Appendix A. Evidence and method

- **Branch:** `codex/app-rewrite` @ `6292735`, 2026-11-15.
- **Renders:** a private Vite dev server (port 8095). The repo's 8 mock-only specs (W06 roster, W07 cancellation/checkout/My Seats/refunds, W08 ops, W09 Tonight, W10 overview) were copied to a scratch directory with only their port and screenshot path changed. They passed 43/43 and produced 42 screenshots. To reproduce them in place, run the mock-only specs with `pnpm test:browser` (they write to `app/docs/implementation/screenshots/`). Error and empty states of all 24 page routes were captured at 1440×900 and 390×844 with no backend configured, so they show "temporarily unavailable" error states, not true signed-out states, except `/member` and `/admin/waitlist`, which returned 401.
- **Static analysis:** font-size, radius, hex and breakpoint counts are from a regex scan of `app/src/styles.css` and `app/src/components/*.css`. Contrast ratios were computed with the WCAG relative-luminance formula against the stated background tokens.
- **Prior work honored:** `interface-direction.md` (tokens, IA, 44px targets, reflow at 320px, the 2026-11-12 review notes) and `language-refactor-plan.md` (decisions D-1…D-21, §C vocabulary, §E plan). This plan doesn't re-audit copy covered there. It flags only decided items that are still unapplied in the render, plus new layout-driven copy.
- **No files in the app were modified.** The only artifact is this document.
