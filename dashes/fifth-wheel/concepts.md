# Concepts — fifth-wheel

**Date:** 2026-10-23  
**Steward:** Charlie  
**Selection Gate:** not cleared. Aaron has not selected a concept.  
**Structural dimensions:** navigation (invite-only vs browse-and-pay), hub (Table vs Guest), staff control (approve-then-send vs staff-sends-each-invite).

An adversarial panel did not score distinctness. Liza’s check: the three concepts differ on the declared dimensions, not on color or copy. That is enough to call them structurally distinct. It is not a human selection.

## Table door (recommendation, pending Aaron)

Invite-only. Hub is the Table. Staff approve once. Invitations send automatically. The guest’s home is the one table on the invitation. Checkout requires that invitation. Staff work a table list.

## Open board (runner-up)

Browse-and-pay. Hub is still the Table. After approval, an account can pay with or without an invitation. Reuses `tables` and `book/[id]` as a catalog. Makes “unanswered invitation” ambiguous because someone else can take the seat. The object files leave this path open.

## Guest desk (runner-up)

Invite-only. Hub is the Guest. Staff send each invitation from a person queue. That replaces the automatic send the approval decision requires.

## Scorecard

Weights come from the heuristic priority report: every row below is a Must-Be in that heuristic, so each weighs the same. This is not a surveyed QFD.

| Criterion | Table door | Open board | Guest desk |
| --- | --- | --- | --- |
| Staff approval before invites | Strong (3) | Partial (2) | Partial (2) |
| Seat confirmed only at payment | Strong (3) | Strong (3) | Strong (3) |
| Invitations do not expire | Strong (3) | Partial (2) | Partial (2) |
| Mutual-only vote | Strong (3) | Strong (3) | Strong (3) |
| Do not rebuild existing routes | Strong (3) | Partial (2) | Weak (1) |
| Total | 15 | 12 | 11 |

North-star business metric: none accepted. The scorecard does not invent one. Ledger’s candidate “invited guests who pay” would favor Table door only after Aaron accepts that measure. Using it now would launder an open decision into the selection.

## Why the wireframe still draws Table door

The plan has to be buildable. The wireframe illustrates Table door and labels it as Charlie’s recommendation. Switching to Open board or Guest desk changes the guest entry and the staff primary action. Do not treat the HTML as a locked information architecture.

## Allie’s note on selection

Allie did not bless Table door. Her challenge is that people would pay to be scored on age, identity, and romantic intent while the public story, the refund, and the deletion path are unsettled. Concept choice does not close that.
