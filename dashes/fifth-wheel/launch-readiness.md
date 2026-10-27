# Launch readiness — 26 October 2026 (waitlist ads)

**Recommendation: go for waitlist ads.** A complete landing POST now stores a last name and returns `{ ok: true, email: "sent" }`. Stripe and invitations are still out of this bar (`decision-waitlist-ads-before-stripe`).

This is a recommendation. Aaron owns the decision. Do not invite a stranger to pay.

## What changed in this pass

Hosted Supabase was behind the live app. Applied:

1. `waitlist_last_name` — `waitlist.last_name` and 14-argument `join_waitlist` (also recorded as `20261026194000` so CLI will not replay the file).
2. `profile_star_sign` — `profiles.star_sign` only. The file’s backfill needs `profiles.birthdate`, which is not on hosted (`20261026183000_waitlist_claim` was never applied). That backfill was skipped.
3. `waitlist_profile_id` — `waitlist.profile_id`. Without it, `syncClaimedIntake` selected a missing column, the row still inserted, and the guest saw **500** Could not save.

Re-probe: POST from origin `https://fifthwheel.community` with last name and `waitlist-migration-probe-20261027@example.invalid` returned **200** `{"ok":true,"email":"sent"}` in 1.99s. The row had `last_name` Lovelace and a confirmation stamp. That row was deleted. Not a real person. Inbox delivery was not opened.

`join_waitlist` execute remains `postgres` and `service_role` only.

## Decision this audit supports

Whether to start public waitlist collection, including Meta ads. Not in this bar: invitation, payment, Identity, or a confirmed seat.

## Residual risk (not ads blockers)

- **Claim path.** `20261026183000_waitlist_claim` is still not applied (it would replace `join_waitlist` without last name if run as-is). Hosted `profiles` still has no `birthdate`. Age/sign on a claimed profile can fail until that is applied in a last-name-safe form.
- **Welcome mail.** Provider accepted the probe (`email: "sent"`). [FIF-44](https://linear.app/fifthwheel/issue/FIF-44) is still Backlog; a human inbox was not opened.
- **Staff host TLS.** `https://admin.fifthwheel.community/admin/login` failed handshake from this machine. Guests use `app.fifthwheel.community`.
- **Copy leftover.** Form intro still says a real person thoughtfully curates every table ([FIF-24](https://linear.app/fifthwheel/issue/FIF-24)). FAQ/terms no longer promise November, founder perks, or expiring invitations.
- **Events Manager** was not reopened on this pass. Lead is in the live waitlist bundle after a stored ok.
- **`anon`/`authenticated` still have table privileges on `waitlist`.** RLS is on with no policies (deny for those roles). Staff/app use `service_role`.

## Next safe action

Aaron can turn ads on. Do not send an invitation to pay. Apply a last-name-safe claim migration before a guest claims an account. Confirm one staff-owned inbox when convenient and close [FIF-44](https://linear.app/fifthwheel/issue/FIF-44).
