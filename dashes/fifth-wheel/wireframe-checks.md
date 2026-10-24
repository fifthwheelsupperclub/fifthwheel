# Wireframe checks — fifth-wheel

**Date:** 2026-10-23  
**File:** `dashes/fifth-wheel/wireframe.html`  
A full a11y audit skill pass was not run as a Sentry sign-off. The rows below are the P6 checklist with pointers. Iris did not sign `ui-mapping.md`.

| Check | Result | Evidence |
| --- | --- | --- |
| Success criteria map to a visible element | Pass | Pay, Approve, no deadline, replacement modal, vote window, “Your table” title. Goal-page map in `flow.md`. |
| P/S/T/Q ranks | Pass with one note | Your table: Pay primary, Account tertiary. Approve modal: Send primary, Keep as draft secondary. Replacement: Replace primary, Remove secondary, Dismiss tertiary (`A-11`). Staff table has no primary of its own; Approve lives on the draft. |
| Attribute priority | Pass | Status and when/neighborhood before metadata. Birthday is not a column (`rev-scale`). |
| Visual roles | Pass | Matches `ui-mapping.md` identity/status/primary. |
| Layers annotated | Pass | HTML comments on Your table, Take your seat, Table review, Replacement, Vote, Reveal, Waitlist. |
| Color is not the only status signal | Pass | `.status` text chips. CSS does not use color to distinguish states. |
| Heading hierarchy | Pass | One `h1`. Each surface is an `h2`. States are `h3`. |
| Sort and filter listed | Pass | Comment above the staff table: sort by age in years, filter none. |
| Accessible names | Pass | Buttons and links have text. Checkbox fieldset has a legend. |
| Component hints | Pass | Comments include `component-hint`. |
| ui-rule ids exist in the decision tree | Pass except permission | Cited ids are in `skills/shape-interface-system/references/design-dash/ui-interaction/decision-tree.json`: `ORG_SHOW_ESSENTIAL`, `FEEDBACK_PERSISTENT_PAGE_STATUS`, `DISPLAY_SIMPLE_SEQUENCE`, `ACTION_PRIMARY_COMMIT`, `HELP_ESSENTIAL_VISIBLE`, `DISPLAY_COMPARABLE_RECORDS`, `COLLECTION_SORT`, `META_HIGH_IMPACT_AI_REVIEW`, `AI_UNCERTAIN_CONSEQUENTIAL`, `SELECT_BOOLEAN_NAMED_ALTERNATIVES`, `ACTION_DESTRUCTIVE_IRREVERSIBLE`, `SELECT_MULTI_FEW_VISIBLE`, `INPUT_MEMORABLE_DATE`, `INPUT_EXACT_NUMBER`, `FEEDBACK_FIELD_ERROR`. Permission-denied blocks are marked `ui-rule: TBD` in the Your table comment. The tree has no permission id. Logged, not silent. |
| Constraints honored | Pass | No event label, no countdown, no refund button, no cutoff, November not promised in the wireframe. |
| Representation matches intent | Pass | Staff people are a table. Guest home is one instance. Ballot is a short multi-select. |
| Icons | Pass | `icon-lib: none` in the top comment. No icon-only controls. |
| Charts | Pass | None, so the dataviz gate is not triggered. |
| Novel interactions | Pass | Dismiss on replacement is labeled in the page as not decided. |
| Five states per page | Pass | Ids in `edge-state-matrix.md` match ids in the HTML: `yt-*`, `pay-*`, `rev-*`, `rep-*`, `vote-*`, `revl-*`, `wl-*`. |
| Full component CSS inlined | Debt | Used rules were copied. The 3,000-line catalog page was not pasted. Owner: unassigned — needs Aaron if a later critique requires the full catalog inline. |

## Consistency

| Check | Result | Evidence |
| --- | --- | --- |
| Action map vs rendered CTAs | Pass | `ui-mapping.md` action map lists Pay, Account, Approve, Send invitations, Keep as draft, Replace, Remove without a replacement, Dismiss, Cast vote, Back, Join the waitlist. Those strings are in `wireframe.html`. No extra CTA. |
| Edge matrix vs rendered states | Pass | Every matrix id appears once in the HTML. |
| ui-rule ids exist | Pass with TBD | See the checklist row. |
| IA matches selected concept | Debt, owned | The HTML matches Table door. Selection Gate is not cleared, so this is an illustration, not a locked IA. Owner: unassigned — needs Aaron (`concepts.md`). |

## Accessibility floor (not a sign-off)

Text labels, a legend on the ballot, status as text, and a logical heading order are in the file. Not checked with an assistive-technology pass: focus trap on the modals, zoom at 200%, or the 30-minute in-room vote for someone who cannot use the phone quickly. Allie flagged that last point in `ethics-review.md` (E3). It stays open.
