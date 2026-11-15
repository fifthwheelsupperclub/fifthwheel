# Fresh rewrite — interface direction and first visual review

Status: refined six-screen visual direction is ready for the first human review; this is not a claim that the routes or services work. Product behavior remains governed by [PRD](../PRD.md); required journeys by [Flow/UI](../flow-ui-brief.md); implementation and acceptance by [rewrite tasks](../tasks-checklist.md).

## Goal and visual source

Give members and staff a clear next action while keeping the app recognizably Fifth Wheel. Preserve the previous app’s branded visual language; improve the navigation, information hierarchy, spacing on small screens and page grouping where those changes make tasks clearer. Do not recreate the old prototype’s screen selector, pretend guest identities, placeholder outcomes, old refund promises or interactions.

Use the branded token/component recipes in `archives/app-2026-11-11-before-restart/src/prototype/FifthWheelPrototype.tsx` as the primary reference. The archived global CSS contains generic light/slate defaults, so use it only as implementation context. Verify any imagery in the archive against the new photo-privacy rules before reuse.

### Core visual tokens

| Role | Reference |
| --- | --- |
| Deep background | `#161009` |
| Surface | `#211A11` |
| Raised surface | `#2B2216` |
| Warm border / hairline | `#3A2F20` |
| Main text / ivory | `#F3E9D8` |
| Muted text | `#A6947C` |
| Strong muted text | `#C4B49A` |
| Primary / restrained gold | `#C79A4B` |
| Wine state accent | `#7C3547` |
| Sage state accent | `#7C9070` |
| Display / body type | Fraunces / Inter |

Preserve the warm, low-gloss surface treatment, hairline borders, restrained pill/badge styling, gold primary action, rounded primary controls and warm card rhythm. The archived reference uses approximately 14px primary-button corners and 18px card corners. Treat these as starting recipes, then calibrate for the new component scale. Keep colors semantic so pending, error, success and destructive states stay legible and consistent.

## Navigation and page hierarchy

### Member

- Primary navigation: **Home, Tables, Requests, My Seats**.
- **Account** stays in the header and remains easy to reach on mobile.
- Requests contains seat applications and unpaid Table invitations. My Seats contains payment attempts and actual Seats; an app-access invitation is never shown as a paid Seat.
- Home leads with the current next step, while still surfacing all other actionable invitations or Seats. Use a short status summary and a clear destination instead of a stack of competing panels.
- Profile/review state can gate browsing or payment, but existing owned records remain reachable where the product rules allow them.

### Admin

- **Overview**: actionable cross-functional queues and urgent delivery/supply/payment/worker exceptions.
- **People** group: Waitlist, Identity Review, Seat Requests.
- **Tables**: supply, curation, invitations, staffing and attendance.
- **Money** group: Cancellations, Refunds.
- **Operations** group: Communications, Conduct Reports, Audit.
- Groups are navigation labels, not invented workflow pages. Table detail keeps draft supply, roster proposal, approval, delivery, payment and attendance as clearly labeled states/actions.

### Assigned host and restaurant

- Host navigation shows assigned Tables and permitted Table-specific operational actions only.
- Restaurant navigation shows assigned venue service information; a venue selector appears only when the server confirms multiple authorized assignments.
- A member of multiple roles can use a workspace switcher, populated from actual server authorization. Never implement a client-side role/demo selector.

On desktop, staff may use a persistent list/detail layout with visible Table context. On mobile, present list → detail → return while preserving filters, page position and selected object. Member detail screens use a readable single content column; do not wrap the app in a decorative phone frame.

## Shared interaction and visual rules

Use semantic, accessible shared components for the app shell, page title/actions, section headings, cards, buttons, form fields, checkbox/radio groups, validation summary, status badges, Table itinerary rows, list/detail panes, confirmation dialogs, async feedback, pagination, empty/error/permission panels and loading skeletons.

- Keep state visually explicit with text and shape as well as color. Show actor-safe descriptions and the next useful action.
- Form errors remain next to their fields and in an announced summary. Preserve valid inputs after failure.
- Confirmation dialogs state the consequence and recipient/action, trap and restore focus, and support keyboard operation.
- Use real disabled styling only where an action is genuinely unavailable. A visible primary action must have a real destination or work; no dead links or fake success buttons.
- Show loading, empty, error, permission-denied and pending states using the same page hierarchy as the success state. Never substitute sample records when a query fails.
- At 320 CSS px and 200% text zoom, content reflows without horizontal clipping. Primary touch controls target 44px. Respect reduced motion and visible focus. Adjust token shades only as needed for documented contrast and readability.

## Six screens for the first review

Review these as complete member/admin screen designs at both a narrow phone width and a desktop width. Include default and one meaningful loading, error, empty or pending state for each. They establish the visual direction and information architecture before feature pages multiply. Preview fixtures must be synthetic and visibly identified. This review is visual evidence only; do not imply authentication, persistence, email delivery or live data.

The preview implements a Desktop/Phone view switch and a Default/Alternate state switch for each screen. Alternate states are sign-in validation, member-home loading, profile upload failure, unavailable Table, uncertain invitation delivery, and roster validation. These controls change only the local design presentation; they do not simulate a successful product action or use live records.

1. **Sign-in and link recovery** — branded app entry with concise invitation-only explanation; returning-member email form; check-email confirmation; expired/used-link recovery and safe retry; visible link to the existing marketing waitlist. Explain that signup alone does not grant app access.
2. **Newly admitted member home** — a clear welcome and profile-completion next step, no fictional upcoming Table, and compact navigation to Home/Tables/Requests/My Seats/Account. At the visual-review milestone, unimplemented actions are plainly preview-only and cannot claim completion.
3. **Profile and preferences** — first name/DOB/own identity, the three independent Women/Men/Non-binary people preferences, matching age bounds, and distinct private-photo/selfie sections with a short privacy explanation. Show incomplete and validation-error states without preselecting preferences.
4. **Table detail** — realistic synthetic itinerary hierarchy, date/neighborhood, $25 price placement and explicit request-versus-offer state. Include empty/missing-itinerary behavior. Do not show purchasable sample supply or imply a confirmed Seat.
5. **Admin waitlist and app invitation** — searchable list/detail, signup context, admission/delivery/activation as separate statuses, recipient-specific invitation preview and clear confirm/retry dialog. Show an empty list and a failed/unknown delivery state.
6. **Admin roster review** — named proposed guests, capacity and concrete composition-rule errors adjacent to the roster; show stale-revision/invalid approval behavior and an explicit recipient summary before Table-invitation send. No send is claimed during this visual review.

## Visual-review acceptance

The first review passes when all six screens form one coherent, navigable visual system; the previous app’s typography, palette, surfaces, controls, borders and spacing remain recognizable; the proposed navigation distinguishes app admission, requests, Table invitations, payment and paid Seats; empty/error/pending states make sense; and the layouts remain usable on phone and desktop. Compare representative components and hierarchy side by side with the archived app. Do not require whole-page pixel equivalence because the information architecture may improve.

Record the user’s feedback and changes to the interface direction before implementation expands beyond the initial screens. Keep this visual review distinct from the first working gate: W03 proves local marketing intake → authorized admin admission/invitation → intercepted email → member sign-in/home → returning sign-in with persistent state.

## Human review notes

First review feedback (2026-11-12): use Lucide icons; polish spacing, type scales and alignment; radio buttons and checkboxes need clearly styled checked, unchecked, focus and disabled states. Finn owns this bounded W01 refinement. Recheck both phone and desktop previews before expanding feature UI.
