# Relationship specs

Status: current working model. Each relationship the first night depends on, specified as mechanics, cardinality, sorts, filters, and dependency.

Sorts are not in the object files. Where a sort is named below, it is a display default, not an accepted product rule. Filters and dependencies that are accepted are marked as rules.

## Table has Seats

| Lens | Spec |
| --- | --- |
| Mechanics | A seat attaches when payment succeeds. A checkout hold is not this link. |
| Cardinality | A table has 0..capacity seats. Target 5 confirmed. Each seat belongs to one table. |
| Sorts | Display default: confirmation time. Not a recorded rule. |
| Filters | Confirmed (paid) versus not. Holds are excluded from the confirmed count. |
| Dependency | A seat requires a table. A draft table may have zero seats. Viability uses the confirmed count: minimum 3, target 5, 3 or 4 allowed when mutual-preference rules pass. Revalidate on add, remove, and replace. |

## Table has Invitations

| Lens | Spec |
| --- | --- |
| Mechanics | Sent automatically after staff approve. Must not send before approval. |
| Cardinality | A table has 0..n invitations. Each invitation belongs to one table. |
| Sorts | Display default: sent time. The two-day notice is a staff alert, not a sort. |
| Filters | Unanswered means no confirmed seat. If that definition changes, this filter changes. |
| Dependency | Send depends on approval. An invitation requires a table. A table does not require invitations. Nothing cascades into an Expired state. |

## Table has Guests

| Lens | Spec |
| --- | --- |
| Mechanics | A guest is on a table through an invitation and, once paid, a seat. Past tables are a matching input. |
| Cardinality | A viable night has 3..5 confirmed guests. A guest attends 0..n tables over time. A draft may sit below 3. |
| Sorts | No guest-facing sort by age. Staff may see age in years. |
| Filters | Confirmed guests count toward viability. Invited guests do not. |
| Dependency | A guest may exist with zero tables. A viable night depends on the confirmed count and on revalidation. |

## Invitation may become a Seat

| Lens | Spec |
| --- | --- |
| Mechanics | The seat appears when that guest pays. |
| Cardinality | 0..1 in each direction. |
| Sorts | Not applicable. |
| Filters | None. |
| Dependency | Payment creates the seat. The invitation does not require a seat. Whether a seat can exist with no invitation is open. Do not require browse-and-pay. |

## Table has one Vote

| Lens | Spec |
| --- | --- |
| Mechanics | The app opens the window. The guest casts inside it. Reveal is automatic and mutual-only. |
| Cardinality | One voting period per table. One ballot per guest per table. A ballot involves 2..n guests (voter and subjects). |
| Sorts | No ballot order is specified. |
| Filters | Eligible attendees only. Non-attendees are excluded. Disclosure is mutual pairs only. |
| Dependency | The period belongs to one table. It opens 90 minutes after the recorded start and lasts 30 minutes. It is closed at check-in. One-sided interest is never shown. Which clock is the start, and the exact meaning of eligible, are open. Reveal timing (at close, or when both have voted) is open. Do not show one-sided interest in either case. |

## Waitlist signup may become a Guest

| Lens | Spec |
| --- | --- |
| Mechanics | Not automatic. A signup may later be the same person as a guest. |
| Cardinality | 0..1 either way. |
| Sorts | Not applicable. |
| Filters | None. |
| Dependency | Optional both ways. A signup is not a seated guest. The same store is not proven. |

## Waitlist signup may source an Invitation

| Lens | Spec |
| --- | --- |
| Mechanics | Staff say Yes to one composition-safe suggestion. The app proposes the person. |
| Cardinality | A signup may source 0..n invitations. An invitation has 0..1 signup. |
| Sorts | One named suggestion. Not a ranked list. |
| Filters | The suggestion must keep a valid composition, including mutual age fit and the 12-year span. |
| Dependency | The replacement invitation depends on Yes. An invitation can exist with no signup. If no one is eligible, Yes is unavailable and removal can still proceed. |

## Age rule used by Table, Guest, and Waitlist signup

This is a dependency across objects, not a separate relationship.

- Store date of birth. Derive years when the rule runs.
- Waitlist 21+ check uses today. A table uses the table date.
- Mutual inclusion: each person’s age falls inside the other’s youngest–oldest range.
- Table span is at most 12 years.
- Staff see years and may open the birthday. Guests see neither birthday nor match range.
- Do not derive a birthday from an integer age or from an old age band.
