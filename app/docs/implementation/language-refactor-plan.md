---
id: language-refactor-plan
type: language-inventory
status: proposal — audit and planning only; no copy changed
date: 2026-11-14
owner: echo
related_objects: [guest, table, invitation, seat, waitlist-signup, vote]
supersedes: none (extends language-inventory-finished-screens.md)
---

# Fifth Wheel product language refactor: audit and plan

**What this is:** a screen-by-screen audit of the interface language in `app/src`, plus a vocabulary, a voice guide, a before-and-after map, and an ordered plan for the change. Nothing in the app has been edited.

**The short version:** most of the copy is accurate, careful, and kindly meant. The trouble is that it talks about the *system* (admission, obligations, operations, revisions, providers, delivery states) when it should talk about what the person is trying to do. The prior copy pass removed the worst infrastructure terms. What's left is mostly structural:

1. **One word, several meanings.** "Invitation" means two unrelated things. "Identity" means both gender and photo verification. "Waitlist" means both website signups and the replacement pool. "Request" covers three kinds of request. "Review" is used for five different processes.
2. **Several words, one meaning.** One person is called *member, guest, applicant, person, you, admitted account*. Permission to use the app is called *app access, admission, member access, app invitation, admin invitation, invite*.
3. **Disclaimer stacking.** Because these terms overlap, nearly every screen adds a sentence saying what something *isn't* ("A request is not an invitation or a confirmed Seat"). This happens 30+ times in the guest flows. It's a symptom of the vocabulary problem, and fixing the words is what removes the need for it.
4. **Admin screens explain engineering guarantees.** Phrases like *idempotency key, operation ID, reconcile exact operation, provider marker, durable ledger, guest read model, synthetic fixture* show up. Staff need to know what's safe to click, not how that safety is built.
5. **Nine copies of the admin navigation, with different section names, items and placeholders.** Copy can't be consistent until there's one nav.

## How to read this document

| § | Deliverable |
|---|---|
| A | Content audit summary |
| B | Voice and tone guide |
| C | Vocabulary and terminology dictionary |
| D | Before-and-after messaging map (by journey) |
| E | Prioritized refactor plan and validation |
| F | Adversarial review findings and open decisions |
| — | Coverage and evidence debt |

Each change in §D has a **type**:

- **S (simplify):** same meaning, fewer or plainer words.
- **C (clarify):** the current wording is ambiguous or misleading.
- **T (standardize):** apply a canonical term from §C.
- **D (decision):** needs a product or behavior call first. These are listed in §F and must not be implemented as copy alone.

---

## Coverage and evidence debt

**Audited.** I extracted every JSX text node and prose string literal from 58 TSX files (`app/src/routes/**`, `app/src/components/**`), about 2,600 strings. I read them in the context of their component state logic. I also covered server-sent `safeMessage` and `message` strings that reach the UI (`app/src/server/*.server.ts`), guest email templates (`notice-templates.server.ts`, `email.resend.server.ts`, `admission.email.mailpit.server.ts`), and the checkout disclosure (`checkout-runtime.server.ts:20`). I checked layout against the existing screenshots in `app/docs/implementation/screenshots/` (for example, the 390px request card and the admin overview).

**Not audited, or only partly:**

- **Marketing site** (`/src`, Astro). It's out of scope per `policy-copy-inventory.md`. The sign-in page links to it, and its Terms are referenced in emails.
- **`/preview`** (`routes/preview.tsx`). This is an internal design gallery with sample copy. I list only the error-page leak it causes (§D0).
- **Live rendering.** I didn't run the app. Space and fit judgments come from the screenshots and CSS class context, not a live check at every breakpoint. Screens marked `mock-only` in the screenshots were rendered with mocked data.
- **Stripe-hosted checkout and Supabase auth emails** (the magic-link template is configured in Supabase, not in this repo).
- **Any real user research.** Every "users would…" claim below is reviewer judgment (§F), not observed behavior.

---

## A. Content audit summary

### A1. The most important problems

| # | Problem | Where | Impact | Maxim |
|---|---|---|---|---|
| 1 | **"Invitation" is overloaded.** The *app invitation* (waitlist → can sign in) and the *Table invitation* (offer to buy a Seat) share a noun. Sign-in says "the email address connected to your app invitation". The sign-in story says "Your invitation is the start". The footnote says "An admin invitation is required". The approve-roster dialog says "Table invitation". Overview says "App invitation emails failed". Guests can't tell which invitation a screen means. That's why every invitation screen adds a "this is separate" sentence. | sign-in, callback, member home, waitlist, overview, emails | High: first-run confusion on the most important journey | Manner, Quantity |
| 2 | **"Identity" means two things.** "How do you identify?" / "Choose one identity" / "Your identity" mean gender. "Identity review" / "identity details" / "Identity evidence" mean photo-and-selfie verification. "Changes to your identity details need another review" can't be read without knowing both meanings. | profile, admin review | High: affects a sensitive, personal question | Manner |
| 3 | **Too many names for one person.** Guest-facing: *member, member account, admitted member, admitted account, app member*. Staff-facing: *member, guest, applicant, person, people*. The glossary says **Guest**. The UI says "member" 101 times. | everywhere | High: blocks consistent copy | Manner |
| 4 | **Too many names for permission to use the app.** *App access, admission, member access, member admission, app invitation, app invite, admin invitation, admitted*. | sign-in, home, entry, waitlist | High | Manner |
| 5 | **Disclaimer stacking.** One 390px request card shows five status statements ("SEAT REQUEST · STILL PENDING", "SEAT REQUEST · PENDING", "Active", "Your invitation is open", "Email provider accepted") plus two "this is separate" sentences (screenshot `w065-member-request-offer-overlay-390px.png`). | requests, Table detail, home, callback, invitation | High: hides the one thing to do next ("pay for your Seat") | Quantity, Relation |
| 6 | **Email delivery status is shown to guests.** Guests reading their invitation *in the app* are told "Email provider accepted. Inbox delivery is not confirmed." That's operational data with no guest action attached. | requests, invitation detail | Medium–High | Relation |
| 7 | **Three vocabularies for email status.** *Provider accepted / Email service accepted / Accepted by email service*. *Outcome unknown / Status unclear / Unconfirmed*. *Delivery pending / Email queued*. | member requests, admin invitations, waitlist, email problems | Medium | Manner |
| 8 | **Engineering terms on admin screens.** For example: "Retry will reuse the same operation ID", "provider idempotency key", "Reconcile this exact operation", "provider marker reconciliation", "guest read model", "durable refund ledger", "Synthetic local provider fixture", "Ask engineering to run the finalizer", "check the scheduler". | supply, weekly copy, refunds, overview | High for supply and refunds (daily staff work) | Relation, Manner |
| 9 | **Money states named after the data model.** *Refund obligation, operation, dispatch, settled, Recorded obligation, Review obligation*. Guests see six refund states, and most of them differ only in back-office queueing. | refunds, My Seats | High: money and trust | Manner, Quantity |
| 10 | **Admin navigation is inconsistent and duplicated.** It's implemented 9 times. Section names vary (*TABLES / TABLE OPERATIONS / ASSIGNED TABLES*). One page has two names (*Communications* / *Email problems*), and so do reports (*Conduct reports* / *Reports & ratings*). The Overview nav has no Waitlist or Profile review. The Waitlist nav has no Table decisions. | all admin screens | High: staff can't predict where things are | Manner |
| 11 | **Same action, different verbs.** Cancellation decision: admin "Deny", guest sees "Declined". Seat ends: *removed / cancelled / released*. Invitation ends: *revoked / closed*. Roster: *proposal / roster / group / draft / revision*. | money, rosters | Medium | Manner |
| 12 | **Leftover preview and placeholder copy.** The error page offers "Return to preview home". (Disabled "My Seats" and admin placeholder links were being fixed in an uncommitted change during this audit.) Member home always says "Complete your profile", even when the profile is approved. | root, member home | Medium (Quality: these statements are false) | Quality |
| 13 | **Inconsistent time and date display.** *Atlanta time / Atlanta local time / ET / America/New_York*. Table invitation emails print raw `2026-12-11 at 19:00`. Conduct report receipts print raw status ("status new"). | supply, emails, Tonight | Medium | Manner |

### A2. Recurring patterns (fix these as rules, not string by string)

- **"X is temporarily unavailable. Try again shortly."** This sentence is the fallback across about 60 load-error states. It's acceptable, but it never says what's still safe. The prior pass added "No Seat or payment status has changed" in some places. Make that the rule wherever the user might worry about money or saved work, and drop it where they wouldn't (§B4).
- **"Sign in to continue" + "This workspace requires a verified staff account" + "is available to authorized administrators only"** in 25+ variants. Replace them with three shared states: *signed out*, *no access*, *not found* (§E, shared component).
- **Generated labels.** `titleCase(state)` produces "Declined", "Withdrawn", "Active", "Revoked" (`member-tables-workspace.tsx:567,569`). Raw `r.status` is printed directly (`tonight-workspace.tsx`, report receipts). Every state shown to a person needs an authored label from §C4.
- **ALL-CAPS eyebrows duplicate the heading.** For example, "SEAT REQUEST · PENDING" sits above "Friday Dinner…" and is repeated in the pill. Keep one status signal per card.
- **Capitalized "Table" and "Seat"** as proper nouns (glossary convention). This affects nearly every string. Decide once (§F, D-6) before any other pass, so files aren't edited twice.

### A3. What's working (keep it)

- Error messages usually say what didn't change ("Your entries are still here; try again"). That's good Quality practice.
- The prior pass already separated *recorded* from *sent* money correctly ("This screen does not send money"). Keep that distinction even when the words get simpler.
- Tonight, voting and conduct-report copy is the strongest in the app: direct, human, honest about limits ("we don't monitor evenings in real time. If you or someone else is in danger, call 911."). Use it as the reference voice.
- Destructive dialogs name their consequences. The Table cancel and remove-guest dialogs are good models. Most of their changes are terminology only.

---

## B. Fifth Wheel voice and tone guide

### B1. Voice in one line

**A good host:** warm, direct, unhurried, and honest about what's settled and what isn't.

| We are | So we | Not |
|---|---|---|
| Clear | Use everyday words. Name the thing the person sees. | "admission", "obligation", "revision", "provider" |
| Conversational | Write how a thoughtful host would say it out loud. Use contractions. | "This workspace is available to authorized administrators only." |
| Confident | State facts plainly. Hedge only where the system is truly uncertain, and then say exactly what's uncertain. | "may", "should", "temporarily" stacked in one sentence |
| Helpful | Lead with what to do next. | Leading with what something *isn't* |
| Concise | One idea per sentence. One status per card. | Repeating the status in the eyebrow, pill, heading and body |
| Human | Be warm in headings and empty states. Be plain in money, safety and errors. | Exclamation marks, "Oops", congratulations, "successfully", "please proceed" |

### B2. Writing rules

1. **Lead with the user's goal or next step.** Add the consequence if there is one. Add a caveat only if it changes what they'll do.
2. **Say what something *is*, not what it isn't.** A "this is not X" sentence is allowed once per journey, at the first point of confusion, and only if research or support shows the confusion is real.
3. **One concept, one name.** Use §C. Don't vary synonyms for style.
4. **Name the actor only when it matters.** Use "We" for Fifth Wheel staff (guest-facing). Use "Stripe" or "the email service" by name in admin screens, never "the provider". Guests don't need to know a provider exists unless it affects them (for example, refund timing).
5. **Truth over comfort.** Use "Sent" only after something was sent. Use "Refunded" only after Stripe confirmed it. If we don't know, say "We're not sure yet" plus what happens next.
6. **Buttons are verb + object** and predict the outcome: "Send sign-in link", "Approve roster", "Cancel Table". The confirm button repeats the dialog's verb ("Cancel Table", not "Confirm"). Use an ellipsis (…) on a button only when it opens a dialog.
7. **Sentence case** everywhere except the logo. Eyebrows may use CSS uppercase, but the source text is sentence case so screen readers and translations get real words.
8. **Numbers and time:** "Fri, Dec 11 · 7:00 PM". Write "Atlanta time" only where a person might be elsewhere (emails, the first date on a screen). Never write "ET", "America/New_York" or "local". Show currency as $25.00 in money contexts and $25 in prose.
9. **No implementation words in guest copy:** session, server, provider, record, ledger, operation, version, revision, queue, state, workspace, evidence, admission, eligibility (except in Tonight, see §C).
10. **Write for translation:** whole sentences, no concatenated fragments (for example, `Seat{s} cancelled, {n} request{s}` at `table-cancel-panel.tsx:39`). Use `Intl.PluralRules` and full-sentence templates.

### B3. Words to stop using

| Avoid | Use instead |
|---|---|
| successfully, please, proceed, utilize, ensure | (delete) / "go ahead" / "use" / "make sure" |
| temporarily unavailable (as a whole message) | "We couldn't load X. Try again." plus what's safe |
| authorized / restricted / verified staff account | "You don't have access to this page." |
| record (noun) / for the record | "save" / "note" / "reason (only staff see this)" |
| revision, version (user-facing) | "changes", "the latest", "draft" |
| operation, run, attempt (guest-facing) | name the thing: "payment", "refund", "email" |
| eligible / eligibility (guest-facing outside Tonight) | "can", "available to you" |
| workspace | (drop it) or the page name |

### B4. Tone by context

| Context | Tone | Pattern | Example (proposed) |
|---|---|---|---|
| Navigation, actions | Short, predictable | Noun for places, verb + object for actions | "Tables" · "Request a seat" · "Approve roster" |
| Onboarding / first sign-in | Welcoming, what's next | One sentence of value, one action | "You're in. Finish your profile so we can match you to a table." |
| Empty states | Helpful, not obvious | What will appear + how to make it appear | "No requests yet. Find a table you like and ask to join." [Browse tables] |
| Success | Brief, factual | Past tense fact + next step if any | "Request sent. We'll let you know if you're invited." |
| Pending / uncertain | Calm, precise | What we know, what we don't, what to do (or not do) | "We're confirming your payment. Don't pay again. This page updates on its own." |
| Errors | Calm, specific, recovery | What happened + what's safe + what to do | "We couldn't save your profile. Your changes are still here. Try again." |
| Warnings | Proportionate | Consequence first | "This can't be undone." first only when it's true and serious |
| Consequential (money, removal, cancellation) | Precise, respectful | Exact consequences as a list, specific button | See remove-guest and cancel-Table dialogs in §D |
| Safety and conduct | Plain, serious, no warmth flourishes | Keep the current Tonight copy | "If you or someone else is in danger, call 911." |

---

## C. Product vocabulary and terminology dictionary

Rules: one row = one concept. **Guest UI** = what guests read. **Staff UI** = admin, host and restaurant screens. Lowercase forms are shown on the assumption that D-6 (casing) is accepted. If it isn't, capitalize *Table* and *Seat* only.

### C1. Objects

| Internal / code | Guest UI | Staff UI | Plain definition | Avoid | Notes and usage |
|---|---|---|---|---|---|
| product | **Fifth Wheel** | Fifth Wheel | The service | Fifthwheel, the fifth wheel (as a person) | Logo styling "fifth wheel." is visual only (D-7) |
| `profile` / user / member / guest | **you** · "your account" | **guest** / guests | A person who can sign in and join tables | member, applicant, admitted account, app member, user, person (as a label) | D-1. "Waitlist signup" before they're let in |
| waitlist signup | **waitlist** (verb: join the waitlist) | **waitlist signup** / "on the waitlist" | Someone who signed up on the website and hasn't been let in yet | lead, applicant, marketing signup | |
| admission / app access | **access** ("You're in", "your access") | **access** · action "Let in" / "Approve" | Permission to sign in to the app | admission, app invitation, admin invitation, app invite, member access | D-2. Never "invitation" |
| `profile` + identity review | **profile** | **profile** | Your details, preferences and review photos | identity (for the profile as a whole) | |
| identity review | **profile review** | **profile review** | Staff checking your photos and selfie match your details | identity review, identity evidence, verification (implies ID check) | Keep "This doesn't check government ID or background records." **once**, on the photos step and the approve dialog |
| gender identity field | **"How do you identify?"** · short label "Gender" | **gender** | Woman / Man / Non-binary | identity, "Choose one identity" | Frees "identity" from double use |
| review photos | **photos** · **selfie** | **review photos** | Images for profile review | evidence, private evidence, review evidence | |
| `event` / table | **table** | **table** | One planned evening for 3–5 guests, three stops | event, supply, record, candidate, snapshot, evening (as an object name) | "evening/night" is fine in warm prose ("A night that fits"). Not for status or nav |
| itinerary / stops | **plan for the night** / **stops** (drinks, dinner, dessert) | **itinerary** · **stops** | Where and when you'll be | — | "Your evening" (Tonight) is fine |
| seat request | **request** (nav, list) · "Request a seat" (action) | **seat request** | Asking to be considered for a table | application, applicant, "request for staff consideration", conversation | D-3 |
| table invitation | **invitation** | **invitation** (or "table invitation" where access still appears nearby) | Staff offer to buy one seat at one table | offer, Table offer, open invitation | Once D-2 lands, guests have only one kind of invitation |
| checkout hold | **hold** ("Your seat is held until 7:42 PM") | **hold** | Seat kept for you while you pay | checkout window, capacity, payment attempt | |
| seat / booking | **seat** | **seat** | Your paid place at a table | booking, reservation | A seat exists only after payment is confirmed |
| roster / proposal | — | **roster** | The group of 3–5 guests for a table | proposal, group (as object), draft, revision | "Draft roster" / "Roster waiting for approval" are states, not new nouns |
| cancellation request | **cancellation request** · "Ask to cancel" | **cancellation request** | Guest asks to give up a paid seat | "request a review", removal | |
| refund obligation | **refund** | **refund** (amount owed) | Money we owe back | obligation, settlement, ledger | |
| refund operation | — | **refund attempt** | One try at sending a refund through Stripe | operation, dispatch | |
| ballot / vote | **vote** · "your choice" | **vote** | Private choice of who you'd like to meet again | ballot (fine internally) | |
| match / reveal | **mutual match** ("You and Sam chose each other") | **mutual matches** (counts only) | Two people chose each other | connection, result | |
| rating / feedback | **feedback** | **ratings** | 1–5 scores and an optional note | recap | |
| conduct report | **report** ("Report a concern") | **conduct report** | Private report to staff | — | |
| notice | **email** | **guest email** | Automated emails to guests | notice, communication | Admin nav "Communications" → "Guest emails" |
| draft / revision / snapshot | — | **draft** → **approved** → **live** | A table's details being prepared, approved, then shown to guests | revision, snapshot, read model, supply | D-9 |
| Airtable source | — | **Airtable** | Where staff plan tables | source, source record, staged candidate, provider | |
| weekly clone | — | **copy week** | Copy drafts from one week to another | clone, manifest, run, operation | |
| staff assignment | — | **assignment** | Which host or restaurant sees which tables | provisioning | |
| worker / heartbeat | — | **background jobs** | The process that sends emails and refunds | worker, scheduler, finalizer | D-11 |

### C2. Roles

| Code | Guest UI | Staff UI | Avoid |
|---|---|---|---|
| guest | you | guest | member, applicant |
| admin | **the Fifth Wheel team** / "we" | **admin** | administrator, authorized administrator, staff account, review team, operations owner |
| host | **your host** | **host** | — |
| restaurant user | — | **restaurant** (partner) | restaurant user |
| staff (all of the above) | "the team" | **staff** | — |

### C3. Actions (verbs)

| Concept | Verb (guest) | Verb (staff) | Don't use |
|---|---|---|---|
| Waitlist → app | — | **Approve** + **Send sign-in link** | admit, invite (app), provision |
| Get a sign-in link | **Send sign-in link** | — | request a link |
| Ask for a seat | **Request a seat** | — | apply, send a request for consideration |
| Take back a seat request | **Withdraw request** | — | cancel request |
| Say no to a seat request | (sees "Not selected") | **Decline** | reject |
| Build and approve a roster | — | **Save draft** · **Send for approval** (host) · **Approve roster** (admin) | submit proposal, save proposal, queue invitations |
| End an invitation | (sees "No longer available") | **Withdraw invitation** | revoke |
| Pay | **Pay $25** / **Continue to payment** | — | checkout attempt, secure checkout (repeated) |
| Ask to cancel a paid seat | **Ask to cancel** | — | request a review, submit cancellation request |
| Decide a cancellation | (sees "Approved" / "Declined") | **Approve cancellation** · **Decline** | deny, approve · remove Seat |
| Remove a guest | — | **Remove from table** | — |
| Cancel a table | (sees "Cancelled") | **Cancel table** | — |
| Confirm a table is happening (T−24) | — | **Confirm table** | record proceed |
| Send a refund | (sees status) | **Send refund** · **Try again** · **Check status** | dispatch, queue for processing, reconcile |
| Check an uncertain email | — | **Check status** | reconcile |
| Resend an email | — | **Send again** | retry delivery, queue delivery retry |
| Approve or publish table details | — | **Approve changes** · **Publish** | accept revision |
| Check Airtable | — | **Check Airtable** | sync, synchronize |
| Copy a week | — | **Copy drafts** · **Undo copy** | clone, safe undo |

### C4. States (authored labels for every visible state)

**Profile review** (`profile-workspace.tsx:156–167, 620`)
| Code | Label | Detail |
|---|---|---|
| draft / incomplete | Not submitted | "Add the required details and photos, then submit for review." |
| pending | In review | "We're checking your profile. You can keep editing." |
| approved | Approved | "You can browse and request tables." |
| resubmission_required | Changes needed | Staff's note + "Make the change, then submit again." |

**Seat request** (`member-tables-workspace.tsx:566–567`)
| Code | Label |
|---|---|
| pending | Waiting for review |
| pending + active invitation | Invited (the invitation replaces the request status; the request isn't shown separately) |
| withdrawn | Withdrawn |
| declined | Not selected (D-4) |
| closed_by_table | Table cancelled |

**Invitation** (guest / staff)
| Code | Guest | Staff |
|---|---|---|
| active | Invited, pay to confirm | Open |
| revoked | No longer available | Withdrawn |
| closed | No longer available | Closed |

**Email delivery** (staff only, with D-5: hidden from guests)
| Code | Label | Detail |
|---|---|---|
| queued | Waiting to send | — |
| sending | Sending | — |
| accepted | Sent | "Not confirmed delivered." |
| delivered | Delivered | — |
| failed | Not sent | "Safe to send again." |
| unknown | Unconfirmed | "We don't know whether it was sent. Check status before sending again." |

**Checkout / payment** (guest; `member-checkout-workspace.tsx:415–421`, `member-seats-workspace.tsx:219–224`)
| Code | Label | Detail |
|---|---|---|
| open (hold active) | Seat held | "Pay by {time} to confirm your seat." |
| processing | Confirming payment | "Don't pay again. This updates on its own." |
| unknown | Confirming payment | Same message: from the guest's view the action is identical (D-8) |
| failed | Payment didn't go through | "You haven't been charged. {Try again / Back to invitation}." |
| expired | Hold ended | "Your seat is no longer held. {Back to invitation}." Only if nothing was charged (see note) |
| paid, seat pending | Confirming your seat | "Payment received. We're confirming your seat. Don't pay again." |
| paid, no seat (late) | Payment received; refund pending | **Keep exactly** (approved A11 text) |
| confirmed | Seat confirmed | — |

Note: "expired" currently says "first confirm this attempt's final payment status". The server may not know yet whether a late payment landed. Keep the "check before paying again" instruction until engineering confirms an expired hold can't have a pending charge (D-8).

**Seat** (`member-seats-workspace.tsx:182–185`, `seat-cancellation-workspaces.tsx:101–104`)
| Code | Guest | Staff |
|---|---|---|
| confirmed | Confirmed | Confirmed |
| cancellation_requested | Cancellation requested | Cancellation requested |
| cancelled | Cancelled | Cancelled |
| completed | Completed | Completed |

**Refund**
| Code | Guest (D-10) | Staff |
|---|---|---|
| open | Refund pending | Owed, not sent |
| pending | Refund pending | Queued |
| submitted | Refund on its way | Sent to Stripe |
| unknown | Refund delayed | Unconfirmed |
| failed | Refund delayed | Failed |
| succeeded | Refunded | Refunded |

**Table (staff)**
| Code | Label |
|---|---|
| draft | Draft |
| accepted | Approved (not live) |
| published | Live |
| review needed | Needs review |
| source missing | Removed from Airtable |
| T−24 needs decision | Needs go/cancel decision |
| proceeding | Confirmed |
| suspended | On hold, needs review |

**Conduct report**: new → New · reviewing → In review · resolved → Resolved. Guest receipts: "Received {date} · {label}".

---

## D. Before-and-after messaging map

Paths are relative to `app/src/`. Line numbers are where the string starts in the current file. Within each screen, rows are ordered by priority.
**Pri:** H / M / L. **Type:** S / C / T / D (see top). **Maxim:** Qt (quantity), Ql (quality), R (relation), M (manner).
Lowercase *table* and *seat* are written as if D-6 were accepted.

### D0. Global shell, errors, entry

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Error page button | Return to preview home | Go to home | Leftover from preview. "Preview" is false in production. | Ql | H | C | `routes/__root.tsx:91` |
| Error page body | Something unexpected interrupted this page. Try again, or return to the preview home. | Something went wrong on our end. Try again, or go to the home page. | Same leak. "Interrupted" is vague. | Ql, M | H | C | `routes/__root.tsx:53` |
| Error / 404 eyebrows | PAGE ERROR · PAGE NOT FOUND | (remove; the heading already says it) | Repeats the heading | Qt | L | S | `routes/__root.tsx:41,51` |
| 404 body | The address may have changed. Return to Fifth Wheel home to continue. | This link may be old or mistyped. | Simpler; the button already says where to go | Qt | L | S | `routes/__root.tsx:43` |
| Entry loading | Checking your Fifth Wheel access… | Loading… | Users don't need the mechanism | R | L | S | `routes/index.tsx:47` |
| Workspace chooser heading | Choose your workspace. / Only workspaces authorized for your account are shown. | Where to? (no subline) | "Workspace" and "authorized" are system words. Only usable items are shown anyway. | M, Qt | M | S | `routes/index.tsx:53–54` |
| Chooser items | Member · Your profile, requests and Seats. / Admin · Waitlist admission and staff operations. / Host · Your assigned Table operations. / Restaurant · Your assigned venue service view. | Your tables · Profile, requests and seats / Admin · Waitlist, tables, payments and guests / Host · Tables you're hosting / Restaurant · Upcoming service times | Describe what's inside, not the role taxonomy | R, M | M | T | `routes/index.tsx:10–13` |
| Chooser disabled | This workspace is not available yet. | Coming soon | Shorter. True: it's a rollout state. | Qt | L | S | `routes/index.tsx:59` |
| No access | No workspace is available. / This account does not currently have app admission or a staff role. | You don't have access yet. / If you joined the waitlist, we'll email you when you're in. Signed up with a different email? Sign in with that one. | Jargon (admission, staff role). Adds the likely recovery. | M, R | H | T | `routes/index.tsx:68–69` |
| Entry error | We couldn't check your account. / Try again, or go to member sign in. | We couldn't load your account. Try again. | "member sign in" goes away under D-1 | M | L | T | `routes/index.tsx:78–79` |
| Top bar label | MEMBER WORKSPACE / ADMIN WORKSPACE / HOST WORKSPACE / RESTAURANT WORKSPACE / SUPPLY WORKSPACE | (guest: remove) / ADMIN / HOST / RESTAURANT | "Supply workspace" on the admin Tables page is a fourth, unexplained role. Guests don't need a role badge. | M, Qt | M | T | `member.tsx:54`, `member-tables-workspace.tsx:220`, `admin-supply-management-workspace.tsx:155`, `ops-workspaces.tsx:34` … |
| Guest nav caption | YOUR EVENINGS | (remove) or "Fifth Wheel" | Decorative and repeated | Qt | L | S | `member.tsx:58`, `member-tables-workspace.tsx:224`, `profile-workspace.tsx:603` |
| Guest nav footnotes | Your admission is separate from Table invitations and payment. / A request is a step toward a Table, not an invitation or a confirmed Seat. / A Seat appears here only after verified payment. / Your profile stays private… | (remove all; one "How it works" explainer covers it, see D2) | Disclaimer stacking in persistent chrome | Qt | H | D | `member.tsx:63`, `member-tables-workspace.tsx:229`, `profile-workspace.tsx:608` |
| Guest nav "My Seats" | Disabled on member home and profile | Enabled, same as other screens | Inconsistent. **Already being fixed:** an uncommitted working-tree change seen during this audit enables it. Verify it lands. | Ql | H | C | `member.tsx:62`, `profile-workspace.tsx:607` |
| Admin nav (9 copies) | WORKSPACE / PEOPLE / TABLES vs TABLE OPERATIONS vs ASSIGNED TABLES / MONEY / OPERATIONS. The same page `/admin/notices` is called "Communications" in four navs and "Email problems" in the ops nav. "Conduct reports" vs "Reports & ratings". (An uncommitted change seen mid-audit turns the disabled Overview, Communications and Conduct reports placeholders into links and drops "Audit", which makes the naming split live rather than dormant.) | One nav: **Today** (Overview) · **Guests**: Waitlist, Profile review, Seat requests · **Tables**: Tables, Go/cancel decisions, Assignments · **Money**: Cancellations, Refunds · **Messages**: Guest emails, Invitation emails · **Safety**: Reports & ratings. Hide unbuilt items (no "Audit" placeholder). | Staff can't predict where items are, and placeholders look broken | M | H | D | `identity-review-workspace.tsx:325–337`, `admin-supply-management-workspace.tsx:155–167`, `admin-supply-sync-workspace.tsx:202–214`, `routes/admin/waitlist.tsx:289–310`, `seat-cancellation-workspaces.tsx:285`, `refund-workspaces.tsx:238`, `table-invitation-workspaces.tsx:272–277`, `roster-curation-workspace.tsx:184–203`, `ops-workspaces.tsx:33–42` |
| Admin nav footnotes | App access and Table invitations are separate. / Supply changes never alter invitations, Seats or payment state. / Retry queues delivery work; it never changes offer approval or payment state. / Amounts remain owed until the payment provider confirms settlement. / Identity evidence is restricted… / Sensitive review actions are recorded. | (remove; put a consequence line inside the relevant action only) | Different notes on every page, in the nav, none relevant to the current task | R, Qt | M | S | same files as above |
| Generic API fallback | This is temporarily unavailable. Try again shortly. / The connection failed. Try again. | Something went wrong. Try again. / You seem to be offline. Check your connection and try again. | Make the network case explicit. Drop "temporarily". | M | M | S | `tonight-workspace.tsx` (`call`), `ops-workspaces.tsx:15–16` |
| Signed-out state (25+ variants) | Sign in to continue / This workspace requires a verified staff account / …available to authorized administrators only | **Signed out:** "Sign in to see this page." [Sign in] · **No access (staff):** "You don't have access to this page. Ask an admin if you think you should." · **No access (guest):** see per-screen | One shared component, one voice | M | M | T | all `*-workspace.tsx` state blocks |
| Sign-out error | Could not sign out. Try again. | Couldn't sign out. Try again. | Contraction, consistent with voice | M | L | S | `sign-out-button.tsx:36` |

### D1. Sign in and the link callback

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Story copy | Your invitation is the start. Sign in to see what's next. | Sign in to see your tables. | "Invitation" here means app access, which collides with table invitations (A1-1) | M | H | T | `routes/sign-in.tsx:61` |
| Card eyebrow / heading | MEMBER SIGN IN / Welcome back. | SIGN IN / Welcome back. | "Member" (D-1). Also fails for first-time sign-in. "Welcome back" is fine only if most visits are returns: **keep**, low risk. | M | L | T | `routes/sign-in.tsx:69–70` |
| Intro | Enter the email address connected to your app invitation. We'll send a secure sign-in link if this account can access the app. | Enter the email you used to join the waitlist. If you have access, we'll send you a sign-in link. | Names the email they actually remember. Removes "app invitation". Keeps the deliberately neutral (non-enumerating) promise. | M, R | H | T | `routes/sign-in.tsx:71` |
| Return note | After sign in, we'll return you to the page you selected. | We'll bring you back to this page after you sign in. | Plainer | M | L | S | `routes/sign-in.tsx:72` |
| Sign-out uncertain | Your saved sign-in was cleared. / We couldn't confirm that sign-out finished on our server. You can still request a new link. | You're signed out on this device. / (remove second line) | "Server" detail has no user action (R). Sign-out on this device is what the user cares about and is true. Security owner to confirm that hiding server-side uncertainty is acceptable. | R, Ql | M | D | `routes/sign-in.tsx:73`, `routes/auth/callback.tsx:183` |
| Submit button | Send sign-in link / Sending link… | (keep) | Good | — | — | — | `routes/sign-in.tsx:88` |
| Success | Check your inbox. / If this email can access Fifth Wheel, a sign-in link is on its way. | Check your email. / If you have access, a sign-in link is on its way. It can take a minute. | Simpler. Keeps the neutral wording. Sets the wait expectation. | M | M | S | `routes/sign-in.tsx:93` |
| Request error | We couldn't request a link. / Check your connection and try again. | We couldn't send a link. Check your connection and try again. | User's frame is "send" | M | L | S | `routes/sign-in.tsx:96` |
| Waitlist footnote | Waitlist signup does not grant app access. An admin invitation is required. | Joining the waitlist doesn't give you access right away. We'll email you when you're in. | Says what happens next instead of the rule. Drops "admin invitation". | R, M | H | T | `routes/sign-in.tsx:100` |
| Callback story | Your next chapter starts here. / Confirm your secure sign-in link to enter Fifth Wheel. | (keep heading) / One more step to sign in. | "Confirm your secure sign-in link" is mechanism | R | L | S | `routes/auth/callback.tsx:141–142` |
| Callback ready | SECURE SIGN IN / Ready when you are. / Continue to use this one-time link and open your member account. Your sign-in won't finish until you continue. | SIGN IN / Ready when you are. / Tap Continue to finish signing in. | One instruction. "One-time link", "member account" are noise. | Qt | M | S | `routes/auth/callback.tsx:177–181` |
| Callback button | Continue to Fifth Wheel / Verifying link… | Continue / Signing in… | User frame | M | L | S | `routes/auth/callback.tsx:192` |
| Callback footnote | App access does not include a Table invitation or payment. | (remove) | Irrelevant at sign-in | R, Qt | H | S | `routes/auth/callback.tsx:198` |
| Invalid link | LINK NOT AVAILABLE / This link can't be used. / It may have expired, already been used, or be incomplete. Request a fresh sign-in link to continue. / Request a new link | This link has expired. / Sign-in links work once and expire after a short time. / Send a new link | One likely cause, stated plainly. The button matches the sign-in page verb. Ql check: the "incomplete" case is real but rare. Keep the generic heading "This link doesn't work" if the security owner prefers no single cause. | M | M | C | `routes/auth/callback.tsx:151–154` |
| Already signed in | SESSION ALREADY ACTIVE / Sign out to use this link. / You are already signed in. / Sign out before using this link. Your current sign-in is still active, and you can continue with this same link. | You're already signed in. / To use this link with a different account, sign out first. / [Sign out and continue] [Go to my account] | "Session". Repeated three times. Adds the more likely intent (they're the same person). | Qt, M | M | C | `routes/auth/callback.tsx:157–160` |
| Verify error | This sign-in link could not be verified. / It may have expired or already been used. Request a fresh link. | This link has expired or was already used. / Send a new link | Plain | M | L | S | `routes/auth/callback.tsx:195` |

### D2. Guest home and profile

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Home status | App access is active for **email**. / APP ACCESS ACTIVE | Signed in as **email** | "App access active" is system state. Being on this page already proves it. | Qt, R | H | T | `routes/member.tsx:73` |
| Home next step | Complete your profile / Add your details and private review evidence. Profile review is separate from app access and Table invitations. | (shown only when profile isn't approved) Finish your profile / Add a few details and two photos so we can match you to a table. | "Evidence", plus a disclaimer. **Also always shown even when approved: a false statement** (needs profile state on home, D-12). | Ql, M | H | D | `routes/member.tsx:76` |
| Home empty | Your Tables will appear here / Table invitations and Seats are separate from app access. Nothing is shown until it exists on your account. | No tables yet / When you're invited to a table or have a seat, it'll show here. [Browse tables] | Disclaimer. Also: the home never lists tables (D-12). | Qt, R | H | D | `routes/member.tsx:79` |
| Home forbidden | Member access isn't active / This account does not have an active member admission… | You don't have access yet / If you're on the waitlist, we'll email you when you're in. | Jargon | M | H | T | `routes/member.tsx:70` |
| Home load | Checking your access / Your private member workspace is loading. | Loading… | Mechanism | Qt | L | S | `routes/member.tsx:68` |
| **New: "How it works"** (single explainer replacing ~30 disclaimers) | — | 1 **Request** a seat at a table you like · 2 We build each table and **invite** you · 3 **Pay** to confirm your seat · 4 **Show up** and meet your table | The guest's mental model, shown once (Tables empty state, Requests page header, first-run home). Shown again only as a compact step indicator on request and invitation cards. | Qt, M | H | D | new shared component |
| Profile intro | Tell us who you are and who you would like to meet. These details stay private. | (keep) | Good | — | — | — | `profile-workspace.tsx:617` |
| Review panel label | IDENTITY REVIEW | PROFILE REVIEW | Frees "identity" (A1-2) | M | H | T | `profile-workspace.tsx:620` |
| Review states | Profile approved / Review in progress / A correction is needed / Complete your profile · IN REVIEW / CHANGES REQUESTED | Approved / In review / Changes needed / Not submitted | One label set (§C4) | M | M | T | `profile-workspace.tsx:156–158, 620` |
| Approved detail | The review team approved the profile details and photos you submitted. This is a manual review; it does not verify a government ID or check background records. | You're approved. You can browse and request tables. | The ID disclaimer belongs on the photos step, before submission, not after approval. | R, Qt | M | S | `profile-workspace.tsx:166` |
| Correction prompt | Please make the correction requested by the review team, then submit your profile again. | Make the change below, then submit again. | "Please", "review team" | Qt | L | S | `profile-workspace.tsx:167` |
| Re-review rule | Changes to your date of birth, identity, profile photos or selfie need another review. Preference changes keep your current review, but may affect future Table invitations. | Changing your date of birth, gender, photos or selfie means we'll review your profile again. Other changes don't. | "Identity" is ambiguous. Second clause is speculative. | M | H | C | `profile-workspace.tsx:623` |
| Image retention | We remove review images on a set schedule. Your approved profile stays approved after they are removed. Changes to your identity details need another review. | We delete your review photos after we've checked them. You stay approved. | Plainer. **Ql:** confirm "after we've checked them" matches the retention schedule (7/30 days, storage job not built, `policy-copy-inventory.md`). If not, use "after {n} days". | Ql, M | M | D | `profile-workspace.tsx:624, 670` |
| Gender question errors | Choose one identity. / "Your identity" (checklist) | Choose how you identify. / How you identify | A1-2 | M | H | T | `profile-workspace.tsx:188, 750` |
| Age range help | You must be at least 21. Matching ages can be set from 21 to 120. | You must be 21 or older. | Second sentence is a validation rule, not guidance. It's covered by the field below. | Qt | L | S | `profile-workspace.tsx:631` |
| Age range labels | Youngest age / Oldest age · Whole years, 21–120. | Youngest / Oldest (under "Ages you'd like to meet") · help: 21–120 | Group label gives context. "Whole years" is implied. | Qt | L | S | `profile-workspace.tsx:645–646` |
| Preferences help | Choose one or more. Your choices are saved exactly as selected. / Keep your own identity separate. | Choose all that apply. | "Saved exactly as selected" and "keep your identity separate" read as defensive noise | Qt, M | M | S | `profile-workspace.tsx:640–641` |
| "Surprise game" | What are you looking for? / Surprise game / Yes, surprise me / I'd rather keep it conversational | Keep the label but add help: "A short icebreaker game at dinner. Totally optional." | **Unexplained term.** Content owner to confirm what the game is. | M | M | D | `profile-workspace.tsx:653, 73` |
| Section 03 help | These details are optional and are not automated eligibility filters. | Optional. Helps your host break the ice. | "Automated eligibility filters" is system talk. Confirm who sees the intro (D-13). | R, M | M | D | `profile-workspace.tsx:658` |
| Phone help | Optional. We won't ask you to verify it. | Optional. | Second sentence answers a question nobody asked | Qt | L | S | `profile-workspace.tsx:660` |
| Photos step | Photos and a separate selfie / Only the review team can see these private images. They review them by hand; they do not verify a government ID or check background records. | Photos for review / Only Fifth Wheel staff see these. We compare your photos and selfie by hand. We don't check ID or run background checks. | Keep the honesty, simpler. This becomes the one place the disclaimer lives. | M | M | S | `profile-workspace.tsx:666` |
| Photo metadata | We remove hidden image details before review… | We strip location and camera details from your photos. | Says concretely what "hidden details" means. **Ql:** confirm the normalizer strips all EXIF, not just location (`image-normalizer.server.ts`). | Ql, M | L | C | `profile-workspace.tsx:670` |
| Upload progress | Preparing secure upload… / Uploading private evidence… / Checking and protecting the image… | Uploading… / Uploading… / Processing photo… | "Evidence" | M | M | T | `profile-workspace.tsx:454, 497, 510` |
| Photo states | Upload pending / Ready for review / Needs replacement / Replaced / Removed | Uploading / Ready / Replace this photo / (hide replaced and removed) | Users only care whether it's done or needs action | Qt | L | S | `profile-workspace.tsx:766–770` |
| Preview link | Private preview. Link expires shortly and is not saved. | Only you can see this preview. | Mechanism | R | L | S | `profile-workspace.tsx:738` |
| Submit button | Submit for identity review | Submit for review | A1-2 | M | H | T | `profile-workspace.tsx:680` |
| Footer | Profile review does not include government ID verification or a background check. | (remove; it's on the photos step) | Third repetition on the same page | Qt | M | S | `profile-workspace.tsx:683` |
| Stale conflict | This profile changed in another session. Reload the latest version before saving again. | Your profile was changed in another tab or device. Reload to see the latest, then save again. | "Session" | M | M | S | `profile-workspace.tsx:357` |
| Save success | Your profile changes are saved. | Saved. | Qt | Qt | L | S | `profile-workspace.tsx:371` |
| Submit success | Your profile has been sent for review. | Submitted. We'll email you when it's reviewed. | **D:** is there an approval email? None found in `notice-templates.server.ts`. If not, "Check back here for updates." | Ql | M | D | `profile-workspace.tsx:421` |
| Not a member | Member profile unavailable / This account does not have an active member profile. If you expected access, contact the team. | You don't have access yet / If you're on the waitlist, we'll email you when you're in. | D-1, D-2 | M | M | T | `profile-workspace.tsx:614` |

### D3. Browse tables, table detail, requests

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Tables intro | Browse upcoming published Tables in Atlanta. A request starts a conversation; it is not an invitation or a confirmed Seat. | Upcoming tables in Atlanta. Request a seat at any that suit you, and we'll build each table from the requests. | "Published" is staff vocabulary. "Starts a conversation" is **untrue** (there's no chat; Ql). Says what a request does. | Ql, M | H | C | `member-tables-workspace.tsx:316` |
| Filter help | Dates are shown in Atlanta local time. | All times are Atlanta time. | Standard time phrase | M | L | T | `member-tables-workspace.tsx:318` |
| Filter button | Apply filters | (keep) / or filter on change | — | — | — | — | `:322` |
| Load state | Finding upcoming Tables / Checking the current published schedule. | Loading tables… | Mechanism | Qt | L | S | `:324` |
| No admission | An app invitation is required / Joining the waitlist does not grant app access. Sign in with the email address that received your app invitation. / Use an admitted account | You don't have access yet / If you joined the waitlist, we'll email you when you're in. Already in? Sign in with that email. / Sign in with a different email | A1-1, A1-4. "Use an admitted account" is jargon. | M | H | T | `:326, :467` |
| Profile gate | Finish your profile to browse / Published Tables are available to members with an approved profile. | Finish your profile to see tables / We review every profile before you can browse. | Plain | M | M | T | `:327` |
| Error | Tables are temporarily unavailable / We could not verify the published schedule. No sample Tables are shown. | We couldn't load tables / Try again in a moment. | "No sample Tables are shown" is a developer guarantee | R | M | S | `:328` |
| Empty filtered | No upcoming Tables match yet / Try a wider date range or remove the neighborhood filter. We'll show a Table here only after staff publish it. | No tables match / Try different dates or another neighborhood. | Second clause is internal | Qt | L | S | `:329` |
| List heading | UPCOMING IN ATLANTA / Tables to consider / Every evening follows a three-stop itinerary. | Upcoming in Atlanta / Each night has three stops: drinks, dinner and dessert. | Name the stops (useful). "To consider" is filler. | R | L | S | `:331` |
| Load more | Load more Tables / Loading more… | Show more | Short | Qt | L | S | `:338` |
| Detail eyebrows | A FIFTH WHEEL EVENING / THREE STOPS, ONE GOOD NIGHT / Your itinerary / " · 45 min later" | (keep warmth) / Your night: · Drinks · 7:00 PM / Dinner · 7:45 PM / Dessert · 9:00 PM | Use clock times, not offsets ("45 min later"). The data is available (`stopTime` in Tonight). | M | M | C | `:472–475` |
| Detail CTA panel | YOUR NEXT STEP / A seat at this Table / $25 total for one Seat / Send a request for the team to consider. This is not a Table invitation, guaranteed place, or payment. | Request a seat / $25 per person if you're invited / We'll look at all the requests and let you know if you're invited. Nothing is charged now. | Leads with what happens. Keeps the "no charge now" fact, which is the user-relevant part of the disclaimer. | Qt, R | H | C | `:477` |
| Request pending | Request received — awaiting review. / The team will review your request. You can withdraw while it is pending. | Request sent. / We'll let you know if you're invited. You can withdraw any time before then. | Plain. Active voice. **Ql:** "let you know": invitation email exists (`email.resend.server.ts:122`), but decline has no email. Say "check Requests" if no decline notice exists (D-4). | Ql | H | D | `:402, :478` |
| Declined | This request was declined. / See Requests for your history. | You weren't selected for this table. / (show staff reason if present) [Browse other tables] | Softer and accurate. "History" is system. | M | M | D | `:479` |
| Withdrawn | Your earlier request was withdrawn. You can send a new request if you are still interested. / Your request was withdrawn. It will remain in Requests history. | You withdrew your request. [Request again] | Plain | Qt | L | S | `:480, :436` |
| Table cancelled | This Table was cancelled. / Any payment you made will be refunded. See Requests and My Seats for status. | This table was cancelled. / If you paid, you'll get a full refund. Track it in My Seats. | Ql: the full refund is policy (PRD D04, `policy-copy-inventory.md`). One place to look. | Ql, Qt | M | C | `:481` |
| Request buttons | Request a Seat / Request again / Sending request… / Withdraw request / Withdrawing… | Request a seat / Request again / Sending… / Withdraw request / Withdrawing… | Casing only | M | L | T | `:483–484` |
| Uncertain request | We could not confirm your request. Check Requests before trying again. | We're not sure your request went through. Check Requests before trying again. | Clearer about what's uncertain | M | M | S | `:411, :415` |
| Uncertain withdrawal | We could not confirm withdrawal. Refresh the Table before retrying. | We're not sure your request was withdrawn. Refresh the page to check. | Same | M | M | S | `:440, :552` |
| Share result | Table link copied. Anyone who opens it follows the same sign-in and profile gates. | Link copied. Friends will need their own access to request a seat. | "Gates" is system talk | M | L | S | `:453` |
| Share error | This link could not be shared from your browser. Copy the address to share it. | Couldn't share from this browser. Copy the address bar instead. | Plain | M | L | S | `:456` |
| Shared preview | Sign in with an admitted member account and complete an approved profile to see the itinerary and request a Seat. Sharing this link does not invite anyone or reserve a place. | Sign in to see the full plan and request a seat. / New to Fifth Wheel? Join the waitlist. | Jargon, plus a disclaimer aimed at the sharer while the reader is the recipient (R) | R, M | M | C | `:502` |
| Table unavailable | This Table isn't available / It may have passed or is no longer published. We don't have enough current information to show its details. | This table isn't available / It may have already happened or been removed. | "Published", plus the second sentence | M | L | S | `:469` |
| Profile gate (detail) | A profile approved by the team is needed to view the itinerary and request a Seat. | Finish your profile to see the plan and request a seat. | Plain | M | L | T | `:468` |
| Requests header | YOUR TABLE JOURNEY / Every request, right here. / Follow your requests for staff consideration. A pending request is not an invitation or a promise of a Seat. | Your requests / Tables you've asked to join, and any invitations. | Disclaimer. "Staff consideration". | Qt, M | H | C | `:559` |
| Requests empty | No requests yet / When you ask the team to consider you for a Table, it will appear here. Requests do not reserve or charge for a Seat. | No requests yet / Find a table you like and request a seat. [Browse tables] | Disclaimer. Actionable. | Qt | M | S | `:564` |
| Requests profile gate | Requests aren't available yet / Complete your profile to use member requests. | Finish your profile first / You can request seats once we've reviewed your profile. | "Member requests" | M | L | T | `:562` |
| Requests error | Requests are temporarily unavailable / Your saved requests were not changed. | We couldn't load your requests / Nothing has changed. Try again. | Simpler | M | L | S | `:563` |
| Request card status (eyebrow + pill + heading) | SEAT REQUEST · STILL PENDING / AWAITING REVIEW / WITHDRAWN / TABLE CANCELLED / REQUEST UPDATE + pill SEAT REQUEST · PENDING / Table cancelled / titleCase(state) | **One status chip:** Waiting for review / Invited / Withdrawn / Not selected / Table cancelled. No eyebrow. | Five overlapping signals on one card (screenshot). Generated labels. | Qt, M | H | T | `:566–567` |
| Invitation block on request card | TABLE INVITATION / Your invitation is open / (pill) Active / This is a separate offer. Your Seat request remains in history, and this invitation does not confirm a paid Seat. / [email status] / Review Table invitation / Request withdrawal is unavailable while this invitation is active. This offer is managed separately. | **You're invited.** Pay by {date} to confirm your seat. [View invitation] | Collapse to the single next step. Drop email status (D-5) and both disclaimers. **D:** invitations don't expire (`decisions/invitations-do-not-expire.md`). If there's no deadline, use "Pay to confirm your seat; seats go to whoever pays first" **only if true**, otherwise just "Pay to confirm your seat." | Qt, R, Ql | H | D | `:568–573` |
| Invitation closed or revoked | Invitation revoked / Invitation closed | This invitation is no longer available. | "Revoked" is harsh and legalistic. Guests don't need the distinction (D-4). | M | M | D | `:569` |
| Member email delivery labels | Email queued / Email sending / Email provider accepted / Delivery confirmed / Email delivery failed / Email outcome unknown (+ details) | (remove from guest UI) | Guest already has the invitation in the app (R). D-5. | R | H | D | `member-tables-workspace.tsx:172–177` |
| Unpublished table note | This Table is no longer published. Your request history remains here. | This table is no longer available. | "Published" | M | L | T | `:577` |

### D4. Invitation and payment

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Invitation heading | YOUR OFFER / You're invited to this Table / This Table invitation is named for your member account. It is separate from your pending Seat request and does not confirm a paid Seat. | You're invited / Pay to confirm your seat at {title}. | Leads with the action. Drops "offer", "named for your member account" and the disclaimer. | Qt, R | H | C | `table-invitation-workspaces.tsx:168` |
| Email status panel | EMAIL STATUS / Invitation created / Attempts recorded / Last attempt | (remove from guest view) | D-5 | R | H | D | `table-invitation-workspaces.tsx:169` |
| Itinerary missing | The published itinerary is not currently available. Your invitation record and Table summary remain here. | The full plan isn't available right now. Your invitation is still here. | "Record", "published" | M | L | S | `:173` |
| Wrong account | This invitation is not available to this account / Table invitations are limited to the named member. Check that you signed in with the account that received the offer. | This invitation is for a different account / Sign in with the email the invitation was sent to. | Plain | M | M | T | `:158` |
| Load | Opening your invitation / Checking this offer for your member account. | Loading… | Mechanism | Qt | L | S | `:156` |
| Checkout eligibility load | Checking checkout eligibility… | Loading… | "Eligibility" | M | L | S | `member-checkout-workspace.tsx:361` |
| Disclosure block | PAYMENT DISCLOSURE / Version **seat-checkout-v1** / I acknowledge this disclosure, version seat-checkout-v1. | Before you pay / (disclosure text unchanged) / ☐ I understand and agree. | Version ID is meaningless to guests. Checkbox label is legalistic. **The disclosure text itself is approved and must not change.** The checkbox label and the visible version may need legal sign-off (D-14). | M | H | D | `member-checkout-workspace.tsx:369–373` |
| Hold | Checkout hold until {time} | Your seat is held until {time}. | Plain, and says what's held | M | H | T | `:380` |
| Pay button | Continue to secure checkout / Continue secure checkout / Starting checkout… | Continue to payment / Resume payment / Opening payment… | "Secure" repeated three times on one screen. Stripe's page carries the trust signal. | Qt | M | S | `:405` |
| Pay caveat | Starting checkout does not confirm a paid Seat. Your Seat is confirmed only after the payment service verifies payment. | Your seat is confirmed once your payment goes through. | Same fact, positive framing, shorter | Qt | M | S | `:407` |
| Card checkout panel | Secure card checkout / Payment is handled securely. This screen will update from your saved payment status. | Pay by card / Payment is handled by Stripe. This page updates when your payment goes through. | Name Stripe (trust signal). Remove repeated "secure". | Qt, Ql | L | S | `:397` |
| Blocked, not configured | Secure checkout is unavailable until the payment service and app configuration are ready. No payment has been started. / Checkout is unavailable until an approved payment disclosure is configured. | Payment isn't available yet. We'll let you know when you can pay. You haven't been charged. | Config details are irrelevant to guests (R). **D:** "we'll let you know": is there a notice? If not, "Check back soon." | R, Ql | M | D | `:390, :121` |
| Blocker reasons | Your profile needs current approval before checkout can continue. / This Table invitation needs staff review before checkout can continue. / Checkout capacity is not available right now. / A prior payment is still being resolved… / There is an earlier checkout to resolve before starting another. | Your profile needs to be reviewed again before you can pay. / We're checking this invitation. Check back soon. / This table is full right now. / We're still confirming an earlier payment. Don't pay again. / (merge with previous) | "Capacity", "resolve". **Ql:** confirm "capacity" means the table is full and not a system limit. | Ql, M | H | C | `:122–129` |
| Already a seat | A Seat already exists for this invitation. Check the status below. | You already have a seat at this table. | Plain | M | L | S | `:126` |
| Status block | Seat confirmed / Payment received; refund pending / Payment confirmed; Seat status is updating / Payment status is being confirmed / Checkout is processing / This checkout window ended / Checkout is ready to continue (+ details) | Per §C4 checkout table: Seat confirmed / Payment received; refund pending (**exact**) / Confirming your seat / Confirming payment / Confirming payment / Hold ended / Seat held | Seven labels for what the guest experiences as four situations | Qt, M | H | T | `:415–421` |
| Refresh | Refresh payment status / Refresh status | Check again | Short | Qt | L | S | `:383, :393` |
| Seat-service footnote | Seat status confirmed by the payment service. | (remove) | Mechanism | R | L | S | `:381` |
| Server messages | Check payment status before retrying. / This checkout attempt has ended. Reload the invitation before trying again. / The checkout window ended. Confirm payment status before trying again. | We're still confirming your last payment. Check again before paying. / Your hold ended. Go back to your invitation. / (same) | Consistent with §C4 | M | M | T | `server/checkout.service.server.ts` (`safeMessage`s) |

### D5. My Seats and cancellation (guest)

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Page intro | Your payment, Seat and refund status from your member account. | Your upcoming and past tables. | Mechanism-led | R | M | S | `member-seats-workspace.tsx:274` |
| Empty | No Seats yet / A Seat appears here only after the payment service verifies payment and saves your place. | No seats yet / When you pay for an invitation, your seat shows up here. [Browse tables] | Plain | M | M | S | `:284` |
| Needs attention | NEEDS ATTENTION / Checkout status | Payments in progress | Says what's in the section | M | L | S | `:281` |
| Pending payment cards | Checkout open · A temporary checkout hold is active until {t}. This is not a confirmed Seat. / Payment processing · No Seat is confirmed yet… / Payment status unknown · Do not start another payment… / Checkout failed · No confirmed Seat is shown. The server will tell you whether this invitation can be retried. / Checkout window ended · Confirm the saved payment status… | Seat held · Pay by {t} to confirm. [Continue to payment] / Confirming payment · Don't pay again. This updates on its own. / (same) / Payment didn't go through · You haven't been charged. [Back to invitation] / Hold ended · [Back to invitation] | §C4. "The server will tell you" is system narration. **Ql:** "You haven't been charged" is accurate for `failed` only if Stripe reported no charge. Confirm with the checkout contract (D-8). | Ql, M | H | T | `:219–224` |
| Late charge | Payment received; refund pending. / A $25 charge was received. The refund is being handled; do not start another payment. | (heading **exact**) / We received your $25 payment but couldn't confirm a seat, so we're refunding it. Don't pay again. | Explains why. Hard-coded "$25" should come from data (§E). | Ql, M | M | C | `:219` |
| Seat state labels | Seat confirmed / Cancellation under review / Seat cancelled / Evening complete (+ "Your Seat is saved to your account." / "Your Seat remains active while…" / "This Seat was removed from the Table." / "Your Table has concluded.") | Confirmed / Cancellation requested / Cancelled / Completed (detail only where useful: "Your seat stays yours until we decide.") | §C4. "Removed" vs "cancelled". "Concluded". | M | M | T | `:182–185` |
| Payment labels | Payment confirmed / Payment received; refund pending / Refunded / Payment status unknown | Paid / Payment received; refund pending (**exact**) / Refunded / Confirming payment | §C4 | M | M | T | `:190–193` |
| Refund labels and details | Refund owed / queued / processing / status unclear / not completed / complete + six details ("…The payment provider has not confirmed it yet." etc.) | Refund pending / Refund pending / Refund on its way / Refund delayed / Refund delayed / Refunded + details: "We'll send your {amount} refund soon." / "Your refund is on its way to your original payment method. Banks can take 5–10 business days." / "Your refund is taking longer than usual. You're still owed {amount}, and we'll sort it out. Questions? hello@fifthwheel.community" / — | Guests can't act on queue states. Collapsing keeps the Quality line: never "Refunded" before `succeeded`; "delayed" still says the amount is owed. D-10. | Qt, Ql | H | D | `:198–213` |
| No refund | No refund is due for this Seat / If that changes, the refund status will appear here. | (hide the refund panel when there's no refund) | Empty panels are noise | Qt | L | S | `:325` |
| Detail section labels | PAYMENT / Amount / Paid / Status unknown / Receipt / View receipt / Receipt status unknown / Receipt unavailable | Payment / $25.00 paid {date} / View receipt (hide if unavailable) | Fewer labels | Qt | L | S | `:324` |
| Itinerary offsets | +45 MIN | 7:45 PM | Clock time | M | M | C | `:327` |
| Cancellation history empty | There are no cancellation requests for this Seat. | (hide section) | Noise | Qt | L | S | `:328` |
| Actions | Request cancellation / View cancellation request / Tonight & recap / Add to calendar / Refresh status | Ask to cancel / View cancellation request / Tonight / Add to calendar / Check again | Verb consistency (§C3). "Recap" isn't used elsewhere. | M | M | T | `:329` |
| Cancellation states | No request / Request under review / Cancellation approved / Seat remains confirmed · Request submitted / Request approved / Request declined | — / Waiting for review / Approved / Declined | One set. "Seat remains confirmed" moves into the declined detail. | M | M | T | `:360–370`, `seat-cancellation-workspaces.tsx:97` |
| Cancellation page heading | YOUR SEAT / Cancellation request / Ask the team to review your Seat. You will see their decision here. | Ask to cancel / We'll review your request and let you know here and by email. | "Review your Seat" is odd. Email exists (`cancellation_decision` notice). | M | M | C | `seat-cancellation-workspaces.tsx:174` |
| Pending note | Your Seat stays active while your request is reviewed. / You remain eligible for check-in and voting until the team approves its removal. | Your seat is still yours until we decide. You can still come and vote. | Same meaning, plain. Keep the state-dependent variants from the prior pass. | M | M | S | `:175` |
| Form | REQUEST A REVIEW / Ask to cancel this Seat / Request another review / The team will decide whether to keep your Seat or remove it, and whether any refund is owed. / Optional note to the team / Share any context that may help with the review. / Submit cancellation request | Ask to cancel this seat / Ask again / We'll decide whether to cancel your seat and whether you'll get a refund. / Anything we should know? (optional) / Send request | "Request a review" vs "Ask to cancel". Verbose. Keep the refund-discretion fact (it matches the approved disclosure). | M, Qt | M | T | `:178` |
| Unavailable reasons | You can request cancellation for this active Seat. / This Seat is no longer active, so a new request cannot be made. / We're still confirming your payment… / This Table is complete or cancelled, so new cancellation requests are closed. | (hide when available) / This seat is already cancelled. / (keep, simplified) / This table has already happened or was cancelled. | Plain | M | L | S | `:89–93` |
| Availability label | REQUEST AVAILABILITY / No new request available | (remove; use the reason line) | Noise | Qt | L | S | `:178` |
| Approved with refund | The team approved removing your Seat and recorded a {amount} refund to be sent. This does not confirm that the money has reached your account. Check My Seats for the refund status. | We approved your cancellation. You'll get a {amount} refund. Track it in My Seats. | Ql preserved: "You'll get" is a commitment that the obligation guarantees. Status in My Seats shows progress honestly. | Qt | M | C | `:187` |
| Approved, refund pending | The team approved removing your Seat. Your refund amount is still being confirmed. | We approved your cancellation. We'll confirm your refund amount soon. | Plain | M | L | S | `:185` |
| Submit success | Your request was saved. | Request sent. We'll let you know. | Consistent | M | L | S | `:161` |

### D6. Tonight, voting, feedback, reports

The reference voice; few changes.

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| 403 / 404 | Not available / Tonight is only available to guests with a paid Seat at this Table. | This page is for guests at this table. | Simpler | Qt | L | S | `tonight-workspace.tsx:53–54` |
| Check-in | Not checked in yet. Your host checks guests in when you arrive. | (keep) | Good | — | — | — | |
| Vote wait | Voting opens at {t} for guests who were checked in by then, and closes at {t}. Nothing you do here changes who can vote. | Voting opens at {t} and closes at {t}. You'll need to be checked in by {open} to vote. | Second sentence is defensive and unclear | M | M | C | `:70` |
| Vote ineligible | Voting is limited to guests who were checked in before it opened at {t}. | Only guests checked in by {t} can vote. | Plain | M | L | S | `:72` |
| Server reason | Your ballot is already submitted and cannot be changed. / Feedback opens after voting closes for guests who attended. | You've already voted. / Feedback opens after voting closes. | "Ballot" | M | L | T | `stateMessage` |
| Ballot legend | Who would you like to meet again? Only a mutual choice is ever shown, and only to the two of you. Closes at {t}. | (keep) | Good: precise and human | — | — | — | |
| Reveal denied | Voting has closed. Results are shown only to guests who were eligible to vote. | Voting has closed. Results are only for guests who voted. | Ql check: "eligible" (checked in) ≠ "voted". Eligible non-voters do see "You didn't submit a choice", so keep "who could vote". Proposed: "Results are only for guests who could vote." | Ql | L | S | `:Reveal` |
| No match | No mutual connection this time. | No mutual match this time. | Term (§C1) | M | L | T | |
| Feedback gate | Feedback and reports are open to guests who were checked in to this evening. | Feedback is for guests who were checked in. | Shorter | Qt | L | S | |
| Rating saved | Saved. You can change it any time. | (keep) | Good | — | — | — | |
| Report receipt | Your report was received. Keep this page for your records. / Report received {date} · status {raw} | Report sent. We'll review it. / Sent {date} · New / In review / Resolved | Raw status. "Keep this page" is odd when the receipt persists. | M, Ql | M | C | `ReportForm` |
| Report button | Send private report | (keep) | — | — | — | — | |

### D7. Guest emails

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Access email subject + body | Your Fifth Wheel app invitation / You have been invited to join Fifth Wheel. This invitation grants app access. Table invitations are separate. / Sign in to Fifth Wheel | You're in: welcome to Fifth Wheel / You're off the waitlist. Sign in, finish your profile, and start requesting seats at tables. / Sign in | A1-1. Explains what to do next. | M, R | H | T | `server/email.resend.server.ts:88–90`, `server/admission.email.mailpit.server.ts:182–191` |
| Table invitation email | Your Fifth Wheel Table invitation: {title} / You have a Table invitation for {title}. / **2026-12-11 at 19:00** · {neighborhood}. / This is a separate Table offer; your app admission and sign-in link are unchanged. | You're invited: {title} / You're invited to {title} on Friday, December 11 at 7:00 PM (Atlanta time) in {neighborhood}. / Pay to confirm your seat. [View invitation] | **Raw ISO date and 24-hour time** (bug-level). "Admission", disclaimer. Reuse the `when()` helper from `notice-templates.server.ts`. | M, Qt | H | C | `server/email.resend.server.ts:122–124`, `server/table-invitation.email.mailpit.server.ts:64–69` |
| T−48 reminder | Your Seat isn't confirmed until you complete payment. Spots are limited. | Your seat isn't confirmed until you pay. | **Ql:** "Spots are limited" is a pressure claim. True only if capacity < invitations. Remove unless staff confirm (D-15). | Ql | M | D | `server/notice-templates.server.ts` (`t48_reminder`) |
| Cancellation decision | Your Seat is released. / We couldn't approve your cancellation / Your Seat remains confirmed. | Your seat is cancelled. / We declined your cancellation request / Your seat is still yours. | "Released" vs app "cancelled"; "couldn't" implies inability, not decision (Ql) | Ql, M | M | T | `notice-templates.server.ts` |
| Removed | Your place at this Table was removed / our team removed you from {title}. | (keep: direct and respectful) | — | — | — | — | |
| Footer | Fifth Wheel · Questions? Reply to hello@fifthwheel.community | (keep) | Confirm the mailbox is monitored (policy inventory) | — | — | — | |

### D8. Admin: waitlist and profile review

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Header | APP ACCESS / Waitlist / Review signups from the website and approve app access. Table invitations come later. | Waitlist / People who signed up on the website. Approve them to send a sign-in link. | One sentence, the action | Qt | M | T | `routes/admin/waitlist.tsx:316` |
| Column | App access | Access | D-2 | M | M | T | `:335, :340` |
| Row action | Review app invite | Review | The dialog title gives the context | Qt | M | T | `:342` |
| Row states | Active / Access approved / Access removed / Not approved · Member active / Delivery pending / Email processing / Accepted by email service / Delivery confirmed / Email failed / Email status unclear / App invitation | Signed in / Approved / Access removed / Not approved · email: per §C4 (Waiting to send / Sending / Sent / Delivered / Not sent / Unconfirmed) | Merge vocabularies. "Member active" → "Signed in". **Ql:** confirm "activated" means first sign-in. | M | H | T | `:381–425` |
| Dialog | APP ACCESS INVITE / Review this app invite / APP ACCESS · Sign-in link / Approves app access and sends this member a sign-in link. / TABLE INVITATION · Separate, later decision · This action does not offer a Table or create a Seat. | Approve {name}? / They'll get an email with a sign-in link. They can then complete their profile and request seats. | Remove the "Table invitation" panel: it explains a non-action | Qt, R | H | S | `:358–364` |
| Primary buttons | Approve app access and send / Send app invite email / Retry same request / Retry email / Check email status / Email accepted | Approve and send link / Send link / Try again / Send again / Check status / Sent | Verb consistency (§C3) | M | H | T | `:374` |
| Uncertain approve | We may have approved app access already. Retry this same request before sending the email. / We couldn't confirm app access. Retry this same request; access won't be approved twice. | We're not sure this went through. Try again. It's safe and won't approve twice. | Same safety promise, plain | M | M | S | `:159, :198, :212` |
| Email outcomes | The email service accepted the message. This does not confirm it reached the member's inbox. / The email service did not accept the message. You can safely try again without approving app access again. / We can't confirm whether the email was accepted. Check its status before trying again. / We still can't confirm… Don't send it again yet. | Sent. (Delivery isn't confirmed.) / Not sent. Safe to send again. / We don't know if this was sent. Check status before sending again. / Still unconfirmed. Don't send again yet. | Consistent §C4 email set | Qt, M | M | T | `:240–283` |
| Profile review header | PEOPLE / IDENTITY REVIEW / Thoughtful review, one person at a time. / Review only the current submitted profile version. This manual photo review does not verify government ID or background history. | Profile review / Check each guest's photos and selfie match their details. | A1-2. Version jargon. Disclaimer repeated on the same screen 3×. | M, Qt | H | T | `identity-review-workspace.tsx:145–146` |
| Queue empty | No profiles are waiting for review / When a member submits a complete profile, it will appear here. | Nothing to review / New profiles appear here when guests submit them. | D-1 | M | L | T | `:152` |
| Detail labels | IDENTITY REVIEW / ATTEMPT / Profile version / Identity version / CURRENT SUBMISSION / STALE REVIEW / Review attempt | Submitted {date} · Review #{n} / Out of date | Version jargon. Staff need "is this current?" | M | M | S | `:280–286` |
| Stale | The member changed their profile after this review was submitted. Refresh before approving it or requesting changes. | {First name} changed their profile since submitting. Refresh to see the latest. | Plain | M | M | S | `:282` |
| Evidence | PRIVATE EVIDENCE / Review the submitted images / Each image link is temporary and access is logged. / Refresh private evidence links / Image unavailable. Refresh the review to request a new audited link. | Photos / Viewing is logged. / Refresh photos / Photo link expired. Refresh photos. | "Evidence", "audited link" | M | M | T | `:290–294` |
| Decision | REVIEW DECISION / What should happen next? / Decisions apply only to the submitted identity version shown above. / Request a correction / Approve this version | Decision / Ask for changes / Approve | Plain | Qt | M | T | `:301–302` |
| Approve confirm | Approve the profile details and photos shown here? This is a manual review. It does not verify a government ID or check background records. | Approve {first name}'s profile? / This confirms the photos match. It isn't an ID or background check. | Keep the disclaimer once, here, where the decision is made | M | M | S | `:303` |
| Correction | Explain what the member needs to correct / Required, 1–2,000 characters. This explanation is shown to the member. / Send correction request | What should they change? / They'll see this message. / Send | Plain | M | M | T | `:304` |
| Results | The submitted identity version is approved. / The member can now see the correction request and resubmit. | Approved. / Sent. They'll see your note when they next open their profile. | Plain. **Ql:** no email is sent for corrections (no template found), so "next open". | Ql | M | C | `:256` |

### D9. Admin: tables (Airtable, drafts, weekly copy)

This area has the most jargon. Most terms are listed once and then applied mechanically (§E step 4).

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Breadcrumb and headers | Table supply / TABLE SUPPLY / / SUPPLY PROVIDER / Supply status / Supply sync / TABLES / WEEKLY SUPPLY | Tables / Airtable / Check Airtable / Copy a week | "Supply" is an internal metaphor | M | H | T | `admin-supply-management-workspace.tsx:319–324, 559–562`, `admin-supply-sync-workspace.tsx:218–232`, `admin-supply-weekly-clone.tsx:345–347` |
| Lifecycle labels | Draft / Accepted / Published / Review needed / Source missing | Draft / Approved / Live / Needs review / Removed from Airtable | §C4. D-9 on the Accepted vs Published split. | M | H | D | `admin-supply-management-workspace.tsx:21, 339` |
| Provider mode | Local test data / Local fixture actions enabled / Write actions disabled / Write actions disabled outside the local synthetic fixture / Synthetic local provider fixture / Provider is configured; production writes are disabled in this workspace | Test mode: changes don't reach Airtable / Editing is turned off here | Developer environment terms on a staff screen. **D-16:** in production, are writes really disabled? If so, staff can't create drafts there, which is a product gap, not a copy issue. | Ql, R | H | D | `admin-supply-management-workspace.tsx:123–126, 324, 563, 601`, `admin-supply-weekly-clone.tsx:369, 379, 401` |
| Mapping not set | Airtable fields need setup / We have not confirmed how Airtable fields match Table details… | Airtable isn't set up yet / Ask {owner} to connect the Airtable fields. Editing is paused until then. | Actionable. Name the owner (D-11). | R | M | D | `:126`, sync `:75` |
| Ready for review list | FROM AIRTABLE / Tables ready for review / These details are not visible to members yet. Starting a draft does not approve or publish a Table. / Try draft again / Review Table details | New from Airtable / Guests can't see these yet. / Start draft / Try again | Shorter. Disclaimer → one clause. | Qt | M | S | `:327–334` |
| Draft editor | NEW TABLE DRAFT / Set the first version. / This creates a private working draft only. It does not publish a Table, invite anyone or affect payment. | New table draft / Guests won't see this until you approve and publish it. | Positive framing of the one relevant fact | Qt | M | S | `:386` |
| Field help | Times are evaluated in America/New_York, including daylight-saving transitions. / America/New_York time; daylight-saving gaps and repeated times require correction. | Atlanta time. | Implementation detail. The validator message handles the DST edge case. | Qt | M | T | `:396, :579` |
| Stops help | Stops stay in the required drinks → dinner → dessert order. Start offsets default to 0, 45 and 120 minutes. / minutes after Table start | Drinks, dinner, dessert, in that order. / Starts (minutes after the table begins) | Plain | M | L | S | `:399–400, :582–583` |
| Notes | Private host notes / Visible to assigned staff only. These notes are not guest itinerary copy. / Guest-facing itinerary note | Notes for staff (guests don't see these) / Note for guests | Paired, clear audience | M | M | S | `:398, :408, :581, :586` |
| Save results | Draft saved. It is still private and not accepted or published. / We could not confirm the save. Retry will reuse the same operation ID. / We could not confirm draft creation. Retry with the same candidate action. | Draft saved. / We're not sure that saved. Try again; it won't save twice. | **Operation ID** → the guarantee in plain words | R, M | H | S | `:504–505, :277, :293` |
| Preview | SERVER-VALIDATED PREVIEW · DRAFT V{n} / Review before moving forward. / Preview revision / Atlanta local schedule resolves to {t}. / Preview is current. Review the changes before accepting or publishing. / Resolve the listed issues before this draft can be accepted. | Preview / Check the details before approving. / Preview / Starts {Fri, Dec 11 · 7:00 PM}. / Up to date. / Fix these before approving: | Jargon | M | M | S | `:594, :518, :590` |
| Accept / publish | Accept revision / Publish revision / Accept this revision? / This confirms the reviewed supply revision for staff. Members will continue to see the current published snapshot. / Publish this revision? / This makes the accepted supply revision the current guest-visible Table. It does not create invitations, seats or payment records. / Confirm acceptance / Confirm publication | Approve changes / Publish / Approve these changes? Guests will still see the current version until you publish. / Publish these changes? Guests will see them right away. / Approve / Publish | **Snapshot, read model, revision** removed. Confirm buttons repeat the verb (§B2-6). | M | H | T | `:598, :624` |
| Result | Revision accepted. Member-visible supply has not changed. / Revision published. The accepted supply is now the current guest read model. / We could not confirm {kind}. Retry will reuse the same operation ID. | Approved. Not live yet. / Published. Guests can see it now. / We're not sure that worked. Try again; it's safe. | "Guest read model" | M | H | T | `:549–550` |
| Source conflicts | Source record missing / The latest complete sync no longer includes this source record. The current published snapshot remains visible to members and is not changed by this conflict. / Source has changed since this revision / Review the new sync candidate and conflicts. This detail does not reschedule or unpublish an existing Table. / Source record missing in latest sync | Removed from Airtable / This table isn't in Airtable anymore. Guests still see the live version. / Changed in Airtable / Airtable has newer details. Review them below. / Removed from Airtable | Plain | M | H | T | `:564, :342` |
| No draft | No editable draft is attached / Create a draft from a staged source candidate on the Table list. Accepted and published snapshots remain read-only here. / Return to staged candidates | No draft yet / Start one from "New from Airtable" on the Tables page. / Back to Tables | "Staged source candidate" | M | M | T | `:571` |
| Draft section | DRAFT REVISION / Edit the working supply / Working supply / Draft changes are separate from accepted and guest-visible revisions. | Draft / Edit draft / Guests won't see changes until you publish. | Jargon | M | M | T | `:573` |
| Session expired | Your staff session has ended. Sign in again to continue. | You've been signed out. Sign in again. | "Session" | M | L | S | `:264, :492, :514, :534`, sync `:169` |
| Permission error | Your account cannot {kind} this Table revision. / Your account cannot synchronize Table supply. | You don't have permission to do this. | Template injects code verbs ("accept", "publish"). Not translatable. | M | L | S | `:535`, sync `:170` |
| Check Airtable panel | CHECK FOR UPDATES / Find new Table details / Checking Airtable prepares details for staff review. It does not approve or publish a Table. / Check Airtable / Check again | Check Airtable / Pulls in new or changed tables for you to review. Nothing goes live. | Shorter, same fact | Qt | M | S | `:345` |
| Sync page | TABLES / AIRTABLE UPDATES / Check for Table updates. / Check Airtable and review new Table details before adding them. This check does not publish changes or affect Tables with invitations or paid Seats. | Check Airtable / See what's new in Airtable before adding it. Nothing goes live from here. | Same | Qt | M | S | `admin-supply-sync-workspace.tsx:220` |
| Sync run states | In progress / Ready for review / No changes found / Check incomplete / Needs review / Sync failed | Checking / Changes to review / No changes / Didn't finish / Needs review / Check failed | Consistent verb ("check", not "sync") | M | M | T | `admin-supply-sync-workspace.tsx:81–86` |
| Sync summary | WHAT MEMBERS SEE / Published Tables / Version / LATEST AIRTABLE CHECK / Pages checked / Suggested version / New details are ready for staff review… / ACTION REQUIRED / Review sync conflicts / … Published supply remains unchanged. / Contact the operations owner for the remaining items. | What guests see / Live tables / Last check / Changes to review / Problems to fix / Showing {n} of {m}. Ask {owner} about the rest. | "Members", "supply", "version", unnamed owner | M | M | T | `:241–245` |
| Sync guarantee | Checking Airtable does not change Tables / This check will not cancel or reschedule a Table, send invitations, change a roster, or affect paid Seats or refunds. To edit or publish Table details, use the Tables workspace. | (shorten to one line) Checking Airtable never changes live tables, guests or payments. | Qt: the list is exhaustive anxiety. Keep the one-line guarantee. | Qt | L | S | `:247` |
| Weekly page | Weekly preview & clone / Preview and copy a week of drafts. / Drafts only / This copies eligible drafts only. It does not copy invitations, Seats, payments, attendance, or published Tables. Airtable changes are disabled outside the local test preview. | Copy a week / Copy draft tables from one week to another. Only drafts are copied. | "Clone". Over-qualified. | M, Qt | M | T | `admin-supply-weekly-clone.tsx:345–351` |
| Weekly steps | 01 / READ-ONLY PREVIEW / Choose source and destination weeks / Weeks run Monday through Sunday in Atlanta time. Each source date shifts by the exact whole-week difference. / Source week starts Monday / Target week starts Monday / Preview this week | 1 · Pick weeks / Copy from (week of) / Copy to (week of) / Same day and time, different week. / Preview | Plain | M | M | S | `:354–359` |
| Weekly states | Copying drafts / Some drafts copied / Result needs a check / Drafts copied / Removing copies / Removal needs a check / Copies removed / Copies could not be removed (+ item states) | (keep: already plain from the prior pass) | — | — | — | — | `:124–132` |
| Weekly errors | Only a draft can be cloned. / Not eligible for cloning. / A protected Table change blocks this clone. / Resolve the clone operation before undoing it. | Only drafts can be copied. / Can't be copied. / This table has guests or payments, so it can't be copied. / Finish checking this copy before undoing it. | "Clone", "protected" | M | M | T | `:138–151` |
| Weekly recovery | The server response was interrupted. Reconcile this exact operation before retrying. / The clone may have started, but its result could not be read. Reconcile this exact operation. / Some provider writes need exact marker reconciliation before another attempt. / The response was lost. Reconcile this exact operation before any retry. / The operation could not be reconciled. No new write was started. / No clone write was found. The same operation can now be retried safely. / The provider marker check is complete. Review the item states below. | We're not sure the copy finished. Check what happened before trying again. / (same, one message for all four) / Couldn't check. Nothing new was copied. / Nothing was copied. Safe to try again. / Check complete. See each table below. | **Worst jargon in the app.** Seven messages collapse to three user situations. | R, M | H | S | `:284–308` |
| Weekly buttons | Reconcile exact operation / Create draft clones / Confirm safe undo / Keep clones / Review undo / Open run / Load older runs | Check what happened / Copy drafts / Undo copy / Keep copies / Undo… / Open / Show older | Verbs (§C3) | M | H | T | `:399, :416–417, :407, :389–391` |
| Weekly confirm | Clone eligible drafts to this week? / This will create up to {n} draft records for the week of {d}. It will not publish them or alter invitations, Seats, payments, attendance, or existing published snapshots. | Copy {n} drafts to the week of {d}? / They'll be drafts. Nothing goes live. | Over-qualified | Qt | M | S | `:416` |
| Undo confirm | Remove unchanged weekly clones? / The server will recheck every clone's revision and activity before deleting anything. If any cloned record changed or gained an invitation/Seat, that item will be refused safely. | Undo this copy? / We'll remove copied drafts that haven't been edited or used. Anything edited stays. | Plain, same guarantee | M | M | S | `:417` |
| Locked controls | Clone and undo actions stay locked until the guarded fixture endpoints pass their idempotency and recovery checks. | (remove in production; dev-only banner) | Developer status note in staff UI | R | H | D | `:379, :401` |
| Recent ops | 03 / RECENT ACTIVITY / Recent draft copies / No weekly clone operations yet / Completed, partial, and unresolved runs will appear here after the first operation. | Recent copies / None yet. | Jargon | Qt | L | T | `:383–386` |

### D10. Admin and host: rosters, go/cancel decisions, attendance, assignments

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Queue header | PEOPLE · TABLE ROSTERS / Seat requests / Review Seat requests and build a proposed group for each Table. | Seat requests / Pick a group of 3–5 for each table. | "Proposed group" | M | M | T | `roster-curation-workspace.tsx:234–235` |
| Host header | ASSIGNED SERVICE / Assigned Tables / Review Seat requests and suggest a group for your assigned Tables. An administrator makes the final approval. | Your tables / Suggest a group for each table. An admin approves it. | Plain | M | M | T | `:234–235` |
| Queue items | Needs proposal / {n} waiting · Seat requests · no roster started / Review roster / Open roster | Needs a roster / {n} requests · not started / Open | "Proposal" | M | M | T | `:247–252` |
| Applicants | APPLICANTS / currently eligible / SEAT REQUESTS / People who asked to join / Listed by request time. The selected group must meet the age and openness rules shown below. / queue position {rank} | Requests / {n} can be picked / People who asked to join / Oldest request first. / #{n} | "Applicants". **Ql:** "queue position" displays `recommendationRank`. If it's a recommendation score, not request order, label it "Suggested #{n}" (D-17). | Ql, M | H | D | `:418–432` |
| Roster draft | ROSTER DRAFT / Not started / Choose 3–5 people who meet the Table rules / Your roster draft / Save the group as a draft, then submit it for an administrator to review. / Version {n} | Roster / Not started / Pick 3–5 people / Save, then send for approval. | Jargon | M | M | T | `:419, :443–444` |
| Rules panel | Roster meets the current rules / Roster needs changes / We check each person's age, preferred age range, and who is open to meeting whom. / Meets requirements / Requirements changed | Group works / Group needs changes / (keep explainer) | Simpler | M | L | S | `:446–450` |
| Rule violations | (list at `:164–171`, `ops-workspaces.tsx:28–29`) | (keep: already plain from the prior pass). Unify the two lists into one shared map. | Two parallel lists drift (e.g., "Ages span more than 12 years" vs "The oldest and youngest guest are more than 12 years apart") | M | M | T | `roster-curation-workspace.tsx:164–171`, `ops-workspaces.tsx:28–29` |
| Published version | PUBLISHED TABLE VERSION / Table details are managed in the Tables workspace / This roster uses older Table details. Reload and start a new roster before continuing. | (remove label) / The table's details changed. Start a new roster. | Version jargon | M | M | S | `:416–420` |
| Buttons | Save proposal / Submit for review / Approve roster / Reload current proposal / Approve and queue invitations / Go back | Save draft / Send for approval / Approve roster / Reload / Approve and send invitations / Back | "Proposal"; "queue" (§C3). **Ql** handled by the result message. | M | H | T | `:461–478` |
| Approve dialog | ADMIN APPROVAL / Approve this roster? / This creates a separate Table invitation for each selected person and queues an email. It will not charge anyone or confirm that an email reached their inbox. | Approve this roster? / Each person gets an invitation by email. They pay to confirm their seat. | Positive and complete. "Not charge" is implied by "they pay". | Qt | H | S | `:474–475` |
| Results | Roster approved. Table invitations are queued for separate delivery; no email delivery is claimed here. / Proposal submitted for administrator review. / Proposal saved as a new revision. / The operation outcome is unknown. Retry to reuse the same operation ID, or reload to inspect the saved state. | Roster approved. Invitations are on their way. Track them in Invitation emails. / Sent for approval. / Saved. / We're not sure that worked. Try again (it's safe) or reload. | Ql: "on their way" = queued to send. The email page shows real status. | R, M | H | T | `:381–387` |
| Conflicts | This request was already used for a different change. Reload before continuing. / Only a submitted proposal can be approved. / A member changed their profile. Reload the applicant list and check the roster again. | Something changed. Reload and try again. / Send this roster for approval first. / A guest changed their profile. Reload to recheck the group. | Plain | M | M | S | `:138–146` |
| T−24 page | NEXT 24 HOURS / Table decisions / Within 24 hours of the start, new checkout pauses until you record a decision. Fewer than three paid guests must be cancelled; three to five valid guests can proceed. | Go / cancel decisions / Tables starting in the next 24 hours. Guests can't pay for these until you decide. Confirm tables with 3–5 paid guests. Cancel any with fewer than 3. | Same rule, plain, active | M | H | T | `ops-workspaces.tsx:70` |
| T−24 states and actions | Proceeding / Suspended — needs review / Needs decision / Record proceed / Confirm proceed / Manage or cancel | Confirmed / On hold, needs review / Needs a decision / Confirm table / Confirm / Manage | "Proceed", "record" | M | H | T | `:75–81` |
| T−24 empty | No Tables need a decision / Tables appear here 24 hours before they start, or when a proceeding Table is suspended. | No decisions needed / Tables show up here 24 hours before they start. | Shorter | Qt | L | S | `:72` |
| Attendance gate | Check-in opens once staff record that this Table is proceeding. A suspended or cancelled Table cannot check guests in. | Check-in opens once an admin confirms this table. | Plain | M | M | T | `:96, :100` |
| Attendance flag | Flag for admin / · flagged for admin / Hosts can flag a cancellation request for admin attention. Only admins approve removals or decide refunds. | Flag for admin / · flagged / Flag a cancellation request to bring it to an admin's attention. | Shorter | Qt | L | S | `:105–109` |
| Assignments | ACCESS / Staff assignments / Hosts see only the Tables assigned here. Restaurant users see only their venues' service times, counts and the host contact below. Roles themselves are provisioned separately. / No host or restaurant users yet / Provision a host or restaurant role first; they will appear here. | Assignments / Choose which tables each host sees, and which venues each restaurant sees. / No hosts or restaurants yet / Add the role in {where} first. | "Provisioned" (D-11: where are roles added? The UI doesn't say) | R, M | M | D | `:125–127` |
| Restaurant | SERVICE / Upcoming service times / Counts and timing only. Guest names, payments and private notes are never shown here. / No venue assigned / Ask Fifth Wheel staff to assign your venue. | Upcoming service / Party size and timing for your venue. / No venue yet / Ask Fifth Wheel to add your venue. | Shorter; the privacy note is for staff, not restaurants | R | L | S | `:149–152` |
| Remove dialog | REMOVE FROM TABLE / Their invitation is revoked and any unfinished checkout is released. If they already paid, their Seat is cancelled and the refund below becomes owed. / Refund if they have paid ($0–$25) / Replace with {name} from the waitlist? / They have asked for this Table, are approved and keep the group valid… / Keep guest / Yes, remove and invite / No, remove only | Remove {name} from this table? / Their invitation ends. If they paid, their seat is cancelled and you'll owe the refund below. / Refund ($0–$25) / Invite {name} instead? / They asked to join this table and still fit the group. / Keep {name} / Remove and invite {name} / Remove only | **"Waitlist" means two things.** Here it's the replacement pool, which is pending seat requests for this table (`replacement_candidates`, `supabase/migrations/20261114180000_w08_removal_replacement.sql:62–75`). Everywhere else it means website signups who don't have access yet. `decisions/waitlist-replacement-prompt.md` uses the pool sense, so the collision is in the domain language itself. Also: "Revoked", "released". Price should come from data. | Ql, M | H | C | `ops-workspaces.tsx:197–217` |
| Remove result | Their Seat was cancelled and a {$} refund is owed; send it from Refunds. / Their invitation was revoked. / One replacement invitation was queued. | Seat cancelled. {$} refund owed. [Go to Refunds] / Invitation withdrawn. / {name} has been invited. | Plain | M | M | T | `:200–201` |
| Cancel Table panel | Cancel this Table. Closes requests and invitations, cancels every Seat and records refunds for all payments. / Cancel Table… / This cannot be undone. Applications and invitations close, holds are released, every paid Seat is cancelled, and the remaining balance on every payment becomes a refund you then send. Guests are not emailed automatically. / Reason for the record (1–500 characters) / Keep Table / Confirm cancellation | Cancel this table / Cancel table… / This can't be undone. • Seat requests and invitations end. • Every paid seat is cancelled. • Each guest is owed a full refund. You send refunds from Refunds. / Reason (only staff see this) / Keep table / Cancel table | "Applications". List format. **Ql flag:** "Guests are not emailed automatically" now looks false. The W10 trigger `notice_table_cancelled` queues a `table_cancelled` email for every paid guest when the table is cancelled (`supabase/migrations/20261115150000_w10_notices.sql:58–73`). If that's live, say "Paid guests get an email." (D-18) | Ql, M | H | D | `table-cancel-panel.tsx:30–49` |
| Cancel result | {n} Seat(s) cancelled, {n} request(s) and {n} invitation(s) closed. {n} refunds totalling {$} are now owed; send them from Refunds. | Table cancelled. {n} seats cancelled, {$} in refunds to send. [Go to Refunds] | Fragment concatenation (§B2-10) | M | M | S | `table-cancel-panel.tsx:39–40` |
| Cancel unknown | The result is unknown. Try the same confirmation again; it cannot cancel twice. | We're not sure that worked. Try again. It's safe and won't cancel twice. | Consistent uncertain pattern | M | L | S | `:25` |

### D11. Admin: money (cancellations and refunds)

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Cancellation queue | MONEY · REVIEW / Cancellation requests / Review the request, confirm whether to keep or remove the Seat, then record the refund decision. / New member requests will appear here. | Cancellation requests / Decide whether to cancel each seat and how much to refund. / New requests appear here. | Plain | M | M | T | `seat-cancellation-workspaces.tsx:208–213` |
| Queue states | Seat active / Cancellation requested / Table completed / Table cancelled · Max refund | Confirmed / Cancellation requested / Table completed / Table cancelled · Refundable | §C4 | M | L | T | `:101–104, :218` |
| Detail labels | MEMBER REQUEST · VERSION / SEAT STATUS / MEMBER NOTE / SAVED TEAM RESPONSE / REVIEW DECISION / Keep or remove this Seat / Approve to remove the Seat. | Request / Seat / Their note / Your reply / Decision | D-1, version | M | M | T | `:265–269` |
| Explanation field | Member-visible explanation / Write a clear explanation the member can see. | Message to {first name} / They'll see this. | Plain | M | M | T | `:270` |
| Refund options | Full refund · {$} / Partial refund / Refund amount in dollars / No refund / Amount still available to refund: … Amount already owed for other refunds: … | (keep options) / Up to {$} can be refunded. | Second clause only when nonzero | Qt | L | S | `:271` |
| Buttons | Approve · remove Seat / Deny · keep Seat active / completed / cancelled / Confirm decision / Go back | Approve cancellation / Decline / Approve / Decline (repeat verb) / Back | "Deny" vs guest "Declined". State-suffixed button labels → put the state in the detail line. | M | H | T | `:125–128, :272–273` |
| Denial outcome | Denying leaves the Seat active / marked as completed / marked as cancelled. / Request denied · Seat remains … | Declining keeps their seat as it is ({state}). / Declined. Seat unchanged. | Consistent verb, same meaning | M | M | T | `:109–120` |
| Money truth line | If you approve a refund, the amount is recorded for processing. This screen does not send money. / A {$} refund will be recorded for processing. This decision does not send money. / {$} refund recorded for processing. This does not confirm that money has reached the member. | Approving adds a {$} refund to Refunds. Send it from there. / Approved. {$} refund added to Refunds. [Go to Refunds] | Says what to do next instead of what didn't happen. Keeps the Ql distinction. | Qt, R | H | C | `:269, :273–274, :253` |
| Refunds header | MONEY · OPERATIONS / Refund obligations / Track amounts owed and queue or recover provider operations. A queued action is not a confirmed refund. | Refunds / Money we owe guests, and its status with Stripe. | "Obligation", "provider operations" | M | H | T | `refund-workspaces.tsx:150` |
| Refund states (staff) | Refund owed / queued / processing / status unclear / attempt failed / complete | Owed, not sent / Queued / Sent to Stripe / Unconfirmed / Failed / Refunded | §C4 staff | M | H | T | `:84–89` |
| Attempt states | Queued for processing / Submitted to payment provider / Outcome is being checked / Refund attempt failed / Confirmed complete | Queued / Sent to Stripe / Checking / Failed / Refunded | Name Stripe | M | M | T | `:94–98` |
| Reasons | Late payment without a Seat / Approved cancellation | Paid after table filled / Cancellation | **Ql:** confirm "late" always means "no seat could be created" (`checkout-fulfillment.server.ts`) | Ql | L | D | `:102` |
| Blockers | This amount remains reserved while the refund is under review. / A refund operation is already being processed. / This obligation has been settled. / The refund provider is not available. The obligation remains recorded. / Dispatch is currently unavailable. / The provider outcome needs reconciliation. / The last attempt needs an administrator review. | (same meanings) Being reviewed. / Already in progress. / Already refunded. / Can't reach Stripe. Still owed. / Sending is unavailable right now. / Check status with Stripe first. / Needs an admin to look at it. | Jargon | M | H | T | `:106–121` |
| Labels | Loading refund obligations / Reading the durable refund ledger. / Review obligation / Obligation / OBLIGATION STATUS / Recorded obligation / Verified payment / Confirmed refunded / Total owed on this payment / Available to refund / REFUND HISTORY / Refund attempts | Loading refunds… / Open / Refund / Status / Owed / Paid / Refunded so far / Total owed / Left to send / Attempts | "Durable ledger" | M | H | T | `:151–223` |
| Actions | Queue refund for processing / Try refund again / Check refund status / Confirm and queue | Send refund / Try again / Check status / Send {$} / Try again / Check status | §C3, repeat verb in confirm | M | H | T | `:224–228` |
| Confirm dialogs | Queue this refund? / This amount is owed and has not been queued yet. Queue up to {$} for processing. / Queue a retry? / This queues another attempt using the same saved refund operation and provider idempotency key. / Check provider status? / This queues a provider status check only. It will not send a new refund. / The saved status changes only after server/provider evidence. This action does not itself confirm that money has been returned. | Send {$} refund? / This sends the refund through Stripe. The status updates when Stripe confirms. / Try again? / This retries the same refund. It can't pay out twice. / Check with Stripe? / This only checks. It won't send another refund. | **"Idempotency key"** → its meaning. Ql: "updates when Stripe confirms" keeps the sent ≠ refunded line. | R, M | H | S | `:228` |
| Results | Refund action queued. This does not confirm that money was returned. / Status check queued. The saved refund state will update when provider evidence is available. | Refund sent to Stripe. We'll update this when it's confirmed. / Checking with Stripe. This updates when we hear back. | **Ql caution:** "sent to Stripe" happens when the worker runs, not at click time. Use "Refund queued. It'll be sent to Stripe shortly." until engineering confirms latency (D-19). | Ql | H | D | `:206` |
| Empty | No refund obligations / Amounts recorded for refund processing will appear here. | No refunds owed. | Shorter | Qt | L | S | `:155` |

### D12. Admin: overview, emails, reports

| Where | Current | Proposed | Problem → why better | Maxim | Pri | Type | Ref |
|---|---|---|---|---|---|---|---|
| Overview intro | TODAY / Overview / Everything that needs a person, in order of urgency. Counts and ages only; nothing private is shown here. | Today / What needs attention, most urgent first. | "Counts and ages only" is meta | Qt | L | S | `ops-workspaces.tsx:285` |
| Heartbeat | Background worker last ran {n} minutes ago. / …has never reported in. Emails and refunds will not send until it runs. / …or has been failing. Emails and refunds may be stuck; check the scheduler. | Emails and refunds are sending normally. (last checked {n} min ago) / Emails and refunds aren't sending. Tell {owner} now. | Outcome over mechanism. "Check the scheduler" isn't an admin action (D-11). | R | H | D | `:287` |
| Queue rows | Suspended Tables · A removal left a proceeding Table invalid. Review before voting. / Tables needing a T−24 decision · Checkout is paused until you record proceed or cancel. / Payments with no Seat or refund · Investigate before anything else; money is unaccounted for. / Refunds failed or unconfirmed · Retry or reconcile; never resend without provider evidence. / Vote results not finalized · … Ask engineering to run the finalizer. / Guest emails failed or unconfirmed · Check the provider's logs, then send again or dismiss. / Refunds owed · Open refund obligations. / … App invitation emails failed or unconfirmed · Open the waitlist to retry or reconcile. / Profiles awaiting identity review / Seat requests waiting · Applicants not yet on a roster. / Rosters awaiting approval / Waitlist people not yet invited · No app invitation has been sent. / New conduct reports · Private. Triage them. / Reports due for 12-month review · Delete unless on hold. / Tables whose source changed or went missing · Review supply before accepting or publishing. / Tables in the next 7 days with no host | Tables on hold · A guest was removed and the group no longer works. / Go/cancel decisions due · Guests can't pay until you decide. / Payments with no seat or refund · Money is unaccounted for. Look at these first. / Refunds that failed or are unconfirmed · Try again or check status with Stripe. / Vote results not ready · Tell {owner}. / Guest emails not sent · Check and send again, or dismiss. / Refunds to send / Waitlist access emails not sent / Profiles to review / Seat requests waiting · Not on a roster yet. / Rosters to approve / Waitlist signups not yet approved / New reports / Reports due for deletion review · Delete unless on hold. / Tables changed or removed in Airtable / Tables next week with no host · Assign one. | Applies §C. Removes engineering steps an admin can't take. | M, R | H | T | `:257–275` |
| Email problems | EMAIL / Guest emails that need a person / The system never sends an uncertain email twice on its own. For "unconfirmed", check the email provider's logs for this guest first. If it was not sent, send again; if it was, dismiss it. / Send again / Dismiss | Guest emails / Emails that didn't send, or that we couldn't confirm. For unconfirmed ones, check {Resend dashboard} first. If it didn't go out, send again. If it did, dismiss. | Name the tool (Resend) instead of "the provider" | M, R | M | T | `:310–316` |
| Email kinds | Seat confirmed / Cancellation decision / Table cancelled / Removed from Table / Invitation reminder | (keep) | — | — | — | — | `:300` |
| Conduct reports | PRIVATE / Conduct reports / Visible to admins only. Hosts, restaurants and other guests never see these, and report text is kept out of audit logs. Fifth Wheel does not monitor evenings in real time. | Reports / Only admins can see reports. | Audience note is good (keep the first sentence). The rest is policy for the team, not UI. | Qt | L | S | `:237` |
| Report controls | Hold (do not delete) / Delete (review due) / This report is not yet due for deletion review. | Keep (don't delete) / Delete / Not due for deletion yet. | Plain | M | L | S | `:244–245` |
| Ratings | AGGREGATE ONLY / Ratings / Averages appear once at least three guests have responded. Free-text notes are never shown here. / Fewer than 3 responses | Ratings / Averages show once 3 or more guests respond. / Not enough responses yet | Shorter | Qt | L | S | `:246–249` |
| Invitation emails page | OPERATIONS · EMAIL STATUS / Table invitations / Check email attempts for approved Table invitations. An email service accepting a message does not confirm it reached the inbox. This page queues retries; it does not send email itself. | Invitation emails / Status of each invitation email. "Sent" means Resend accepted it, not that it reached the inbox. | One definition, at the page level | Qt | M | T | `table-invitation-workspaces.tsx:280` |
| Its rows and actions | ACTIVE TABLE INVITATION / REVOKED INVITATION / CLOSED INVITATION / no attempt yet / Latest safe delivery code: / Attempt history / Queue delivery retry / Queueing retry… / Check email status / Retry queues a new delivery attempt. It does not send email inline or change the invitation. | Open / Withdrawn / Closed / Not sent yet / Error code: / History / Send again / Sending… / Check status / (remove) | "Safe delivery code", "inline" | M | M | T | `:290–297` |
| Its results | A new email attempt is queued. This page did not send the email or confirm delivery. / The email service accepted this existing attempt. No email was sent again, and delivery to the inbox is not confirmed. / The email status is still unclear. No email was sent again… | Queued to send again. / Sent (checked; nothing was resent). / Still unconfirmed. Nothing was resent. | Shorter; same guarantees | Qt | M | S | `:238–267` |

### D13. Server messages (shared)

Apply as a rule in each `*.http.server.ts` / `*.service.server.ts` `safeMessage` table.

| Pattern now | Rule | Example |
|---|---|---|
| "App member access is required to {verb}." (×5) / "Admitted app member access is required." | → "You don't have access yet." | `server/tables.service.server.ts` |
| "Finish identity review before browsing Tables or requesting a Seat." | → "Finish your profile review first." | |
| "Only an admin may {retry/reconcile/review} invitation delivery." | → "Only admins can do this." | |
| "This operation ID was already used for different details." / "This operation identifier was used for a different request." / "This send operation was already claimed…" | → "Something changed. Reload and try again." | |
| "Delivery reconciliation is not configured." / "Delivery status must be reconciled before retrying." | → "Check status before sending again." | |
| "Check the {Seat link / checkout return details / invitation request / request history page} and try again." | → "Something went wrong. Reload and try again." (the specific noun adds nothing) | |
| "Invalid." / "Missing." / "not_found" (raw) | → never shown; map to the shared fallback | |
| "Calendar export is available for future active Seats only." | → "You can add upcoming seats to your calendar." | |

---

## E. Prioritized refactor plan

### E1. Order of work (and why)

| Step | Work | Depends on | Why this order |
|---|---|---|---|
| **0** | **Decide the open items in §F** that block terminology: D-1 (guest/member), D-2 (access ≠ invitation), D-6 (casing), D-5 (guest email status), D-10 (guest refund states). Update `knowledge/glossary/terms.md` from §C. | — | Every later step touches the same strings. Deciding first avoids editing files twice. The glossary is the gate (`skills/design-product-language`: "Do not rename a domain object locally without reconciling the glossary"). |
| **1** | **Centralize shared chrome.** One `AdminNav` (9 copies → 1, §D0). One `GuestNav` (3 copies). One `PageState` component for signed-out / no access / not found / load error. One status-label module, `app/src/copy/states.ts`, holding every §C4 table, keyed by the contract state types (`RequestState`, `TableInvitationDeliveryState`, refund and seat states). Replace `titleCase(state)` and raw `r.status`. | 0 | Gets the largest consistency win for the fewest edits, and makes later steps one-line changes. This is a refactor, not new behavior. |
| **2** | **Critical guest journey** (priority 1–3 in the brief): sign-in → home → profile → tables → request → invitation → payment → My Seats. All H rows in §D1–D5, the "How it works" explainer, and removal of guest-facing disclaimers. | 1 | Highest-traffic path. Where the vocabulary collisions hurt most. |
| **3** | **Emails.** §D7. Fix the raw date format in invitation emails (reuse `when()` from `notice-templates.server.ts`). | 0 | Small, high-visibility. The date bug is independent of the terminology decisions and can ship first. |
| **4** | **Admin jargon sweep.** Tables/Airtable (§D9), refunds and cancellations (§D11), rosters and go/cancel (§D10), overview and emails (§D12), waitlist and profile review (§D8). | 1 | Staff tolerate jargon better than guests, but these screens carry money and destructive actions. |
| **5** | **Errors and server messages.** §D13 rules plus the "uncertain outcome" pattern: "We're not sure that worked. Try again. It's safe." | 1 | Mostly mechanical once the shared fallback exists |
| **6** | **Tonight, empty states, low-priority polish.** §D6, all L rows, eyebrow cleanup. | 2–5 | Lowest impact |

Behavior-dependent rows (type **D**) ship only after their decision is made, and in the same PR as any behavior change (for example, D-12 needs profile state on the home page before the copy can be conditional).

### E2. Implementation notes

- **Lowercase table and seat (if D-6 is accepted):** do it in step 1 as a single mechanical pass so it doesn't get mixed into meaning changes. Exclude the approved disclosure text and the A11 heading, which keep their exact wording until legal re-approves.
- **Approved and fixed text:** `CHECKOUT_DISCLOSURE.text` (`server/checkout-runtime.server.ts:21`) and "Payment received; refund pending." Don't touch these without the owner's sign-off.
- **Hard-coded amounts:** "$25" in `member-seats-workspace.tsx:219` and "$0–$25" in `ops-workspaces.tsx:184, 210`. Source these from the price data while you're in these files. It's a correctness risk if the price changes.
- **Translation readiness:** introduce a copy module, not full i18n. Fix the sentence fragments in `table-cancel-panel.tsx:39–40`, `refund-workspaces.tsx:228`, and the `${kind}` interpolations in `admin-supply-management-workspace.tsx:535–550`.
- **Tests:** all 19 Playwright specs in `app/tests/browser/` assert on copy (~400 `getByText` / accessible-name assertions). Update them in the same PR as each step. Prefer role and test-id selectors for structure, and keep text assertions only for the strings that are actually being validated.
- **Don't add new duplicate copy:** any new string goes into the copy module if it's a state label, or the component if it's one-off.

### E3. Validation strategy

| Check | How | When |
|---|---|---|
| Terminology lint | A grep script (`app/scripts/check-copy.mjs`) that fails on banned guest-facing terms in `app/src/components/member-*`, `profile-*`, `tonight-*`, `table-invitation-*`, `routes/sign-in.tsx`, `routes/member.tsx`, emails: `admission, admitted, obligation, provider, operation, revision, snapshot, workspace, evidence, eligib(?!le to vote), app invitation, session`. Run a staff-UI subset list on admin files: `operation ID, idempotency, reconcile, fixture, read model, ledger, supply`. | Every PR (CI) |
| State coverage | Unit test: every value of each contract state union has an authored label in `copy/states.ts` (type-level exhaustive `Record`) | Step 1 |
| Context read-through | For each journey, read the screens in order as a first-time guest (per `design-product-language` verification). Check unique labels, predictable outcome, recovery present. | End of steps 2 and 4 |
| Truth check | Domain owner (Luke / Ledger) signs off every row marked Ql in §D, especially refunds, payment, email and replacement wording. | Before merge of steps 2, 4 |
| Layout | Re-run the existing screenshot specs at 390px and desktop. Watch the nav labels, request card, refund chips, and buttons ("Approve and send invitations", "Remove and invite {name}"). | Each step |
| Accessibility | Eyebrows authored in sentence case. Every icon-only control keeps its aria-label. Live regions keep `role=status` / `alert`. Button names stay unique per page (e.g., two "Check status" on one page get context: "Check email status for {name}"). | Each step |
| Comprehension (evidence, not opinion) | 5-person unmoderated test of the guest journey (request → invitation → pay) and a staff walk-through of refunds. Questions: "What happens if you click this?" and "Have you been charged?" | After step 2, before launch |

---

## F. Adversarial review findings

A simulated review by four perspectives. **CD** = content designer, **UXR** = UX researcher, **PD** = product designer, **DX** = domain/product expert. No usability data backs any position. Where the panel split, the resolution is a recommendation, not a finding.

### F1. Key debates

**1. Guest vs member (D-1)**
- CD: "Member" plus "admitted" plus "app member" is three names. Pick one. In guest UI, use "you" and the problem disappears.
- DX: The glossary already says *Guest*. "Member" crept in from the marketing idea of a "dining community".
- PD: Brand may *want* membership. It signals exclusivity and belonging.
- UXR: Nobody calls themselves "a member" while booking dinner. But nobody's confused by "guest" either. Low risk either way. The only real harm is mixing them.
- **Resolution:** guest UI uses "you" (no noun needed in almost every string). Staff UI uses "guest". If marketing wants "member", use it *only* in marketing and brand moments (e.g., the email "welcome" line), never as a UI label. **Decision owner: product lead.**

**2. Stop calling app access an "invitation" (D-2)**
- DX: Admission really is an invitation. Staff invite people off the waitlist. The PRD says "app invitation".
- CD: Two things named "invitation" force a disclaimer on every screen. The guest's word is "I got in". The staff action is "approve".
- UXR: The confusion is predictable. A guest gets an "invitation" email, signs in, and finds no table.
- **Resolution:** Adopt "access" / "You're in". Reserve "invitation" for tables. PRD terms can stay internal. **Owner: product lead + Luke (glossary).**

**3. Lowercase table and seat (D-6)**
- DX: Capitalized *Table* marks the product object (a five-person night) apart from furniture. The glossary chose it deliberately.
- CD: Capitalized common nouns read as legal or system terms, hurt scanning, and are inconsistent already (the page title says "A seat at the table"). Translation tools treat them as proper nouns.
- PD: The double meaning is the brand ("a seat at the table"). Context always disambiguates. Nobody thinks they're requesting furniture.
- UXR: No evidence either way. Casing is unlikely to affect task success.
- **Resolution:** recommend lowercase, decided once, applied mechanically in step 1. If declined, nothing else in this plan changes. **Owner: product lead / brand.**

**4. Showing email delivery status to guests (D-5)**
- DX: It was added so guests aren't confused if the email didn't arrive.
- PD: A guest reading this card is *already in the app looking at the invitation*. The email's fate doesn't change what they do.
- CD: It also exposes vocabulary ("provider accepted") we're removing everywhere else.
- UXR: A guest who never got the email isn't on this screen, so the message can't reach the person it's for.
- **Resolution:** remove from guest UI. Staff keep it. This is a behavior (information) change, so it needs a product call. **Owner: product lead.**

**5. Collapsing guest refund states (D-10)**
- DX: Six states exist because each means something different about the money. Collapsing them risks implying progress that hasn't happened.
- CD: Guests can't act on any difference between *owed* and *queued*, or between *unknown* and *failed*. Six labels are a quantity violation.
- UXR: What guests ask is "Am I getting my money, and when?"
- DX (counter): "Refund delayed" for `unknown` is fine, but never say "on its way" for `pending`, because nothing has gone to Stripe yet.
- **Resolution:** four guest labels (§C4). `submitted` is the only "on its way". "Refunded" only at `succeeded`. Both owed and unknown states keep "you're still owed {amount}". Staff keep all six. **Owner: Ledger / finance + product.**

**6. "Sent" vs "Accepted by the email service"**
- DX: Provider acceptance isn't delivery. The prior pass fought hard for this distinction.
- CD: "Sent" is the everyday word for "left our hands". Delivery is a separate, explicit state ("Delivered").
- **Resolution:** "Sent" plus a page-level definition ("Sent means Resend accepted it, not that it reached the inbox") and a distinct "Delivered". The distinction survives, and the jargon goes. **Agreed.**

**7. "Send refund" when the click only queues**
- DX: The button doesn't send anything. A worker does, later.
- CD: The user's intent is to send the refund. "Queue refund for processing" names the mechanism.
- PD: Verb on the button = intent. The result message carries the truth.
- **Resolution:** button "Send refund". The result says "Refund queued. It'll be sent to Stripe shortly." The status column shows real progress. **Agreed, conditional on D-19** (that the worker runs within minutes).

**8. Removing "this is not X" disclaimers**
- DX: Each disclaimer was added after a specific risk review (e.g., guests thinking a request reserves a place).
- CD: Repeating it 30 times trains people to skip it, including the one time it matters.
- UXR: A single model shown once ("How it works") plus honest status chips is more likely to stick than scattered negatives. That's a hypothesis to test, not a finding.
- **Resolution:** keep exactly one positive statement of each boundary at its decision point ("Nothing is charged now" on the request CTA; "Your seat is confirmed once your payment goes through" at checkout). Remove the rest. Test in the comprehension check (§E3). **Agreed with the test as a condition.**

**9. Hiding server-side sign-out uncertainty**
- DX / security: Telling users the server sign-out wasn't confirmed is honest.
- CD: There's no action the user can take. On a shared device, the local sign-out is what protects them.
- **Resolution:** unresolved. Recommend the shorter copy, but this is the security owner's call (Sentry agent / human).

**10. Admin copy: how much safety explanation?**
- DX: Staff *must* know that retry is safe, or they'll double-refund out of fear.
- CD: Agreed. Say "It's safe; it won't pay out twice", not "idempotency key".
- **Resolution:** every uncertain-outcome message names the guarantee in plain words. **Agreed.**

### F2. Open decisions (do not implement these as copy alone)

Decided 2026-11-14: D-1, D-2, D-5, D-6, D-7, D-10 and D-21, all as recommended. They're recorded in `knowledge/glossary/terms.md` and `knowledge/decisions/waitlist-replacement-prompt.md`. The rest are still open.

| ID | Question | Recommendation | Owner |
|---|---|---|---|
| D-1 | Guest-facing noun for the person | **Decided 2026-11-14 as recommended.** "you"; staff UI "guest"; drop "member" as a label | Product lead |
| D-2 | Stop calling app access an "invitation"? | **Decided 2026-11-14 as recommended.** Yes: "access" / "You're in" | Product + Luke |
| D-3 | Separate the three meanings of "request" | "Request" nav = seat requests only; "Ask to cancel" for cancellation; drop "application" | Echo (confirm) |
| D-4 | Guest-facing labels for declined requests and revoked or closed invitations; is there a decline notice? | "Not selected"; "No longer available". Add notice or say "check Requests" | Product |
| D-5 | Hide email delivery status from guests | **Decided 2026-11-14 as recommended.** Yes | Product |
| D-6 | Lowercase table and seat | **Decided 2026-11-14 as recommended.** Yes, in one pass | Product / brand |
| D-7 | Product name in prose: "Fifth Wheel" (current UI) vs "Fifthwheel" (repo, this brief) | **Decided 2026-11-14 as recommended.** Keep "Fifth Wheel". Confirm. | Product / brand |
| D-8 | Can an expired or failed checkout still have a pending charge? Determines whether "You haven't been charged" is true | Engineering to confirm from the checkout contract | Engineering + Ledger |
| D-9 | Is the two-step *Accept* → *Publish* for tables needed, or can it be one "Publish"? | Keep if it's used. Rename "Approved (not live)" / "Live" | Product + ops |
| D-10 | Guest refund states: 6 → 4 | **Decided 2026-11-14 as recommended.** Yes (§C4) | Ledger + product |
| D-11 | Who's the named owner for Airtable setup, worker outages, the vote finalizer, and role provisioning? Copy currently says "operations owner", "engineering", "the scheduler" | Name a role or contact in the copy | Ops |
| D-12 | Member home shows a static "Complete your profile" and never lists tables. Fix the behavior, or simplify the page? | Make it state-aware (profile state, upcoming seat, open invitation) | Product + engineering |
| D-13 | Who sees the one-line intro and the phone number? | State it in the field help | Product + privacy |
| D-14 | Checkbox label and version display on the approved disclosure | "I understand and agree." Hide the version or move it to small print. Needs legal sign-off. | Legal / owner |
| D-15 | "Spots are limited" in the T−48 reminder: true? | Remove unless verifiable | Product |
| D-16 | Production Tables screen says writes are disabled outside local fixtures. Is that the shipped state? | If so, it's a product gap. Fix before the copy matters. | Engineering |
| D-17 | Is `recommendationRank` request order or a suggestion score? | Label to match: "#n" (order) or "Suggested #n" | Engineering |
| D-18 | Cancel-Table dialog says "Guests are not emailed automatically", but the W10 trigger (`20261115150000_w10_notices.sql:58–73`) queues a cancellation email for paid guests | Likely a stale statement from before W10. Engineering to confirm the trigger is live, then update the dialog. | Engineering |
| D-21 | "Waitlist" means both website signups (no access yet) and the replacement pool (pending seat requests for a table) | **Decided 2026-11-14 as recommended.** Keep "waitlist" for website signups only. Call the replacement pool "people who requested this table". Update `decisions/waitlist-replacement-prompt.md` wording. | Luke + Liza |
| D-19 | Time from "Send refund" click to the Stripe call | If it's minutes, the "sent shortly" wording is fine | Engineering |
| D-20 | What is the "surprise game"? | Content owner to supply one line | Content / product |

### F3. Where the panel didn't reach consensus

- **D-6 casing** and **D-1 "member"**: these are brand calls with no usability evidence either way.
- **Sign-out uncertainty (F1-9)**: a security call.
- Whether the **"How it works" explainer** replaces disclaimers well enough. That's a hypothesis, and the §E3 comprehension test decides it.
