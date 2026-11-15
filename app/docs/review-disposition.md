# Fifth Wheel — Rewrite Requirements Review

2026-11-11 · Specification review only. Application implementation remains paused. Historical reviews apply to the old refactor packet, not to this rewrite.

The earlier task list was not complete for a fresh rewrite. It assumed existing route/runtime work, omitted admission from the marketing waitlist and retained a preference model inconsistent with the marketing form. The current [requirements](PRD.md), [flows/style](flow-ui-brief.md), [architecture](architecture.md) and [task list](tasks-checklist.md) replace those instructions for the new app.

## Confirmed decisions and corrections

| Issue | Current contract | Task / acceptance |
| --- | --- | --- |
| App access confused with Table offer | Admin issues app invitation from marketing waitlist; recipient signs in by magic link. A separate later Table invitation enables that Table’s payment. | W03 then W06; R00/R03; A26–A31/A06–A08 |
| Returning access undefined | Admitted members request fresh magic links themselves; admission persists, tokens expire independently; suspension deferred. | W03.4–W03.5; D15/D17; A28–A30 |
| Marketing intake omitted | Preserve existing full-payload `/api/waitlist`, exact fields and private admin queue linkage; no competing email-only intake. | W03.1–W03.2; A26/A32 |
| Preference mismatch | App uses the marketing form’s exact non-empty combination of Women, Men and Non-binary people. D16 supersedes D13’s single-choice preference restriction. | W04.1/W06.3/W11.1; A32 |
| Refactor assumptions | Fresh runtime/routes/screens/schema/fixtures; previous code archived as reference. Reconcile live data; do not reset hosted records or inherit old test claims. | W00/W02/W11/W12 |
| Style versus usability unclear | Match archived visual styling, including typography/components/spacing. UI layouts, IA and navigation may improve. Palette-only similarity is insufficient. | D18/R11; W01/W02.2/W12.3; A34–A35 |
| Backend progress mistaken for working product | Each slice requires complete screens, authorized persistent actions, error/recovery states and current acceptance evidence. First functional checkpoint is the complete admission journey. | Every feature gate; W03.7/W12 |
| New gate depended on future profile/matching work | W03 closes A26–A31 and only intake preservation for A32; profile/edit/matching completes in W04/W06/W12. | W03 gate corrected; no circular dependency |
| Pending cancellation versus loss of rights | Pending requests preserve active-paid rights; confirmed removal/cancellation changes authority. | PRD R05; Architecture §§3/8; W07.4/W08/W09 |

## Coverage and verification

The current packet specifies visitor/admitted member/admin/assigned host/assigned venue journeys, R00–R11, A01–A35 and W00–W12. The backlog includes experience design, actual prior-style references, shared UI, fresh runtime/auth/roles/database, full marketing intake, app/email admission, all inherited Table/payment/night-of features, complete operational interfaces, privacy/data lifecycle, provider recovery, legacy reconciliation and release verification.

Checks required for documentation readiness: local Markdown links resolve; every R and A ID has task coverage; W task IDs are unique; dependencies/gates do not require downstream features; no current instruction reinstates D13, imports the archived runtime, claims previous tests as rewrite evidence or permits unapproved external actions. Direct file inspection verifies the referenced marketing fields and archived tokens/component recipes. An independent product critic reviewed the previous packet and rechecked the revised scope and task dependencies; findings and their corrections are recorded above. This is not an independent engineering/security certification.

No application tests, browser renders or new migration applications are claimed for this requirements task. No new application code was written after the requirements-only pause. An unused local scaffold and empty migration predate the pause; no schema was applied.

## Remaining evidence and launch dependencies

- Actual live waitlist store and legacy account/admission mapping, provider field dictionaries and data quality, current schema/permissions and payment/refund linkage: W02.5/W11.1–W11.2.
- Email sender/redirect/delivery capabilities, trusted staff provisioning, Stripe modes/webhooks, hosting/scheduler/independent monitor and backup/restore: W02.4–W02.6/W11.4.
- Accountable release/operator ownership, final cancellation/consent/privacy/legal alignment and retention/financial/backup policy: W10.3/W11.4–W11.5.
- Actual UI design, functionality, accessibility, concurrency/recovery, private access and visual fidelity: W01–W12 implementation evidence. No screen design approval or working behavior is implied by this review.

These are named discovery/implementation/release tasks, not missing definitions of the confirmed core product. Requirements readiness does not authorize resuming implementation, sending real emails, accessing production data destructively, charging or deploying. The human’s requirements-review hold remains in effect.

## Final documentation disposition

**Ready as a requirements and fresh-rewrite plan; implementation remains paused.** Direct inspection and the independent product recheck found no further material functionality omission after the recorded gate correction. All six current packet files have resolving local links; R00–R11 and A01–A35 map to the backlog; all 63 task IDs are unique and current task references resolve. The 266-file archive manifest was reverified with no changed source/config/document hash. W00’s archive/documentation tasks are complete; every implementation task remains unchecked. This verdict is for specification completeness against the documented MVP and current clarifications, not a promise that unknown provider/data facts are resolved or that the app is built.
