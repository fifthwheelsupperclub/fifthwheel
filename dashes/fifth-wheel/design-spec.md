# Design spec — Fifth Wheel pre-MVP

**Dash:** fifth-wheel  
**Date:** 2026-10-23  
**Status:** draft plan. Not accepted.  
**Concept drawn:** Table door, recommendation only (`concepts.md`).

## 1. Context

Fifth Wheel is one paid table of about five adults in an Atlanta neighborhood: drinks, dinner, dessert, then a private vote. The marketing site in this repo collects a waitlist. The product app already implements large parts of the night. This spec locks the workflow the knowledge files already decided, and it leaves the open decisions open.

Evidence is code, copy, and a stakeholder brief. There is no guest research. See `evidence-summary.md`.

## 2. Goals and non-goals

**Goals**

- Staff approve a valid table, then invitations send.
- A guest pays to confirm a seat. The invitation shows no deadline.
- One replacement prompt keeps composition valid.
- Voting follows the 90/30 mutual rule.
- Guest language matches the glossary.

**Non-goals**

- A new app or a new design system.
- Refunds, rescheduling, or table cutoffs.
- A launch date, a November milestone, or a numeric success target.
- Treating the landing sentence “a real person thoughtfully curates every table” as true.
- Overwriting `knowledge/objects/`.
- Legal sign-off. That remains unassigned.

## 3. Primary user

The primary guest is an adult who was invited to one table and pays for that seat. Staff are the second role: they approve, follow up at T-2, and answer the replacement prompt. The visitor on the waitlist is upstream and is not seated. The host is out of this spec.

## 4. Scenarios and flow

Three scenarios: pay from an invitation, approve then send, one replacement prompt. Full steps, pages, and the reconciliation table are in `flow.md`.

## 5. Concept selection

Not selected. Charlie recommends Table door (invite-only, table hub, approve-then-send). Open board and Guest desk are runners-up. Scorecard is in `concepts.md`. The wireframe illustrates the recommendation so a builder can see the gates.

## 6. Information architecture and page anatomy

See `dashes/fifth-wheel/wireframe.html`. Staff review is a comparable list of people on one table. The guest home is one table instance, not a catalog. The replacement and approve steps are modals.

## 7. Objects

Cite `knowledge/objects/` and `dashes/fifth-wheel/domain-summary.md`. Hub is Table.

## 8. Measurement

No accepted metric. Candidates in `metrics.md`.

## 9. Gates still open

Evidence, reconciliation, selection, ethics (blocked), privacy (legal escalation), learning. Human owner: unassigned — needs Aaron.
