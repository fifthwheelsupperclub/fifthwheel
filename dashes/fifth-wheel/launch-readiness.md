# Launch readiness — 26 October 2026

**Recommendation: no-go.** Do not start marketing today.

A stranger can open https://fifthwheel.community and submit the waitlist form to a live app. They cannot be shown to complete the path this launch would promise: a delivered welcome email, an invitation to a table, payment that makes the seat real, and an honest confirmation after paying. The public page also asserts November seating, founder perks, expiring invitations, a firm refund ladder, and a Meta signup event. None of those are true in the accepted decisions or in the code that was checked.

This is a recommendation. Marketing has not started. Aaron owns the decision.

## Decision this audit supports

Whether to send a stranger to the site today, meaning they can:

1. Join the landing-page waitlist
2. Receive the welcome email
3. Be invited to a table
4. Register, including payment if payment is required before a seat is real
5. Sign in and see an honest state after paying

Marketing host: https://fifthwheel.community (this repo, GitHub Pages). Product app: https://admin.fifthwheel.community (`src/data/site.ts`). App code inspected at `fifthwheelsupperclub/app` commit `29dafe4` (not in this repo). Render reports that commit as the live deploy. No valid person was submitted. No email was opened. No card was charged.

## Options

| Option | Result |
| --- | --- |
| Start marketing today, full path | Rejected. Steps 2–5 are not a working stranger path. |
| Start Meta ads only | Rejected. The pixel records PageView. The privacy page says Meta hears about a signup. There is no signup event and no campaign attribution. |
| Collect a quiet waitlist under the current page | Rejected. The form is the same page as the November, founder, expiry, refund, and inbox promises, and it collects date of birth, identity, and who someone will sit with. |
| Hold new traffic until the blockers below are fixed or explicitly accepted | **Recommended.** |

Success targets are still undecided (`knowledge/decisions/launch-timing-and-success.md`). This audit does not invent a signup goal or a November date.

**Dissent preserved:** Going does not make November, human-only curation, expiring invitations, the published refund ladder, or a Meta signup event true.

## End-to-end path

| Step | Status | Evidence |
| --- | --- | --- |
| 1. Waitlist signup | Code and a live invalid request look ready. A stored row was not proven. | Form posts to `https://admin.fifthwheel.community/api/waitlist` (`src/scripts/waitlist.ts`). Live HTML and `/_astro/Waitlist.astro_astro_type_script_index_0_lang.BI35M3Zn.js` do the same. A POST of `{"probe":"invalid"}` from origin `https://fifthwheel.community` returned **400** `{"error":"Invalid submission"}` in 0.19s, with that origin allowed. That error string is `src/lib/waitlist/parse.ts` in `29dafe4`. `join_waitlist` is written to insert birthdate and match ages (`supabase/migrations/20261025230000_waitlist_birthdate.sql`). Hosted Supabase was not queried, so this audit did not see a row. |
| 2. Welcome email | Not proven, and the blueprint can record a send that never left. | The waitlist route sends `EMAIL.waitlist_confirmation` (“You're on the Fifth Wheel list”) in the same request, then returns `{ ok: true }` even if that send fails (`src/app/api/waitlist/route.ts`). `render.yaml` sets `NOTIFICATIONS_DRY_RUN` to `"true"`. Dry-run `sendEmail` returns success and the route then sets `confirmation_sent_at` (`src/lib/notify/send.ts`). The live flag was not read. The thanks panel says “Check your inbox in a moment.” There is no guest magic link in that email. Guest sign-in in the app is a phone code. |
| 3. Invitation | Missing. | No invitation template and no approve-then-send action. Staff can mark a waitlist row contacted. `seat_guests` inserts a **confirmed** booking with no charge (`supabase/migrations/20260903192832_punch_list.sql`). Accepted rule: staff approve, then invitations send, and they do not expire. Existing issues: [FIF-8](https://linear.app/fifthwheel/issue/FIF-8), [FIF-28](https://linear.app/fifthwheel/issue/FIF-28). |
| 4. Register and pay | A separate self-serve path exists in code. It does not start from the waitlist, and a live charge was not made. | Phone OTP, onboarding, Stripe Identity, a two-hour hold, then a PaymentIntent. The webhook sets `confirmed` only while the booking is still `held`. Stripe key mode was not read. [FIF-42](https://linear.app/fifthwheel/issue/FIF-42) is still the connect-and-confirm work. |
| 5. After paying | The return page can lie. | `/book/[id]/confirmed` always says “Your seat is set.” It does not read the booking (`src/app/book/[id]/confirmed/page.tsx`). The webhook returns `{ received: true }` even when the booking update matches nothing (`src/app/api/stripe/webhook/route.ts`). |

A waitlist row is not a Guest and not a Seat. That part matches the object model. The landing POST does not create an account.

## Blockers

These must be fixed, or explicitly accepted by Aaron, before sending strangers to the site.

1. **The inbox promise can be false.** Dry-run or a failed Resend call can still show “Check your inbox,” and a dry-run success stamps `confirmation_sent_at`, which stops a retry. [FIF-49](https://linear.app/fifthwheel/issue/FIF-49/do-not-mark-the-waitlist-email-sent-unless-resend-accepted-it). Dashboard keys remain [FIF-44](https://linear.app/fifthwheel/issue/FIF-44).
2. **No invitation, and the site promises one.** FAQ and terms say an invitation arrives with a deadline. The confirmation email promises a date and a claim link. The app does not send one. [FIF-8](https://linear.app/fifthwheel/issue/FIF-8), [FIF-28](https://linear.app/fifthwheel/issue/FIF-28).
3. **A seat can be called confirmed without a confirmed booking.** The post-payment page does not check status ([FIF-52](https://linear.app/fifthwheel/issue/FIF-52/show-a-confirmed-seat-only-after-the-booking-is-confirmed)). Staff match can insert `confirmed` with no payment ([FIF-53](https://linear.app/fifthwheel/issue/FIF-53/stop-confirming-seats-from-staff-match-without-payment)).
4. **Public copy contradicts accepted decisions, and states policies that are not decided.** November seating, founder perks, expiring invitations, “there is no algorithm,” a firm refund ladder, and cancel-under-3. [FIF-24](https://linear.app/fifthwheel/issue/FIF-24/align-landing-copy-with-staff-approved-curation) (moved to Todo, audit notes added). Refunds and cutoffs stay [FIF-36](https://linear.app/fifthwheel/issue/FIF-36) and [FIF-35](https://linear.app/fifthwheel/issue/FIF-35). Do not invent a date or a refund ladder in the fix.
5. **Privacy overclaims Meta.** Live HTML calls `fbq("init", "1554369373159853")` and `fbq("track", "PageView")` after load. The waitlist bundle has no `fbq`. `src/components/PrivacyContent.astro` says Meta is told about a visit or a waitlist signup. [FIF-50](https://linear.app/fifthwheel/issue/FIF-50/make-the-privacy-page-match-the-meta-pixel-before-any-ads). Adding events is the separate, still-open [FIF-34](https://linear.app/fifthwheel/issue/FIF-34). Events Manager was not opened, so a PageView in HTML is not proof Meta received it.
6. **The public waitlist function is not locked down in the migration, and the POST is unlimited.** `join_waitlist` is granted to `service_role` and the new migration does not revoke `public`, `anon`, or `authenticated`. Hosted grants were not queried. [FIF-51](https://linear.app/fifthwheel/issue/FIF-51/revoke-public-execute-on-join-waitlist), [FIF-54](https://linear.app/fifthwheel/issue/FIF-54/rate-limit-the-public-waitlist-post).

## Not blockers for this recommendation

- **Render free spin-down.** Accepted in `knowledge/decisions/app-host-render-free.md`. The marketing site answered in 0.11s (`server: GitHub.com`). The app is on the free plan in `render.yaml`. A specialist measured a cold HTML request at about 26s, then sub-second responses. This audit’s invalid waitlist POST was already warm (0.19s). A cold signup can sit on “Sending…”. That is the accepted degradation, not a reason to buy a warm host today.
- **Notification drain.** GitHub Actions run `40364446042` (26 Oct 2026, 16:59Z) failed in 8 seconds: `APP_URL` and `CRON_SECRET` are empty (`curl: URL rejected: No host part`). The three newest scheduled runs failed the same way. Waitlist mail is sent in the request, not by this cron. Repair is already on [FIF-46](https://linear.app/fifthwheel/issue/FIF-46). It does not make the welcome email true while dry-run stamps a send.
- **Guest word “event” in the database.** Landing hero and the form say table. Guest screens say table. `event` is the code and schema name.
- **Stale comment in `src/data/site.ts`.** It still says posts go to `5thwheel.app` until the admin host is deployed. The script and the live bundle post to `admin.fifthwheel.community`. [FIF-45](https://linear.app/fifthwheel/issue/FIF-45) still describes a Porkbun parking CNAME; DNS now points `admin` at Render. The issue text is behind production.
- **Repeat email returns success and does not update answers.** Misleading for someone correcting the form. It does not stop a first signup.
- **UTC versus local age on the exact 21st birthday.** Real, narrow, and not why marketing waits.
- **`/_vercel/insights/script.js` on the marketing host returns 404.** No first-party analytics there. Not a signup blocker. It is named in [FIF-50](https://linear.app/fifthwheel/issue/FIF-50) because the privacy page still talks about Vercel hosting.

## What was not verified

- That a real waitlist row is stored, including birthdate and match ages.
- That any email arrives. Resend domain, from-address, and the live `NOTIFICATIONS_DRY_RUN` value.
- Stripe live versus test, webhook delivery, and whether a paid hold is later cancelled by `expire_stale_holds`.
- Hosted `join_waitlist` grants and whether migration `20261025230000` is applied. The 400 only proves the parser rejected a bad body.
- Twilio for guest phone login.
- Meta Events Manager, domain verification, and ad blockers.
- Cloudflare WAF in front of the app.
- A cold `POST /api/waitlist` specifically. The slow wake was measured on the HTML app, not on that route.
- Supabase Auth redirect and SMS settings. Local `supabase/config.toml` is not the hosted project.

Automated coverage does not close any of that. The app’s only tests are four age and parse checks in `src/lib/waitlist/parse.test.ts`. CI typechecks, lints, and builds. It does not run that file.

## Existing issues left as they are

Not re-filed: [FIF-8](https://linear.app/fifthwheel/issue/FIF-8) and [FIF-28](https://linear.app/fifthwheel/issue/FIF-28) (invite after approval), [FIF-44](https://linear.app/fifthwheel/issue/FIF-44) (Resend keys), [FIF-42](https://linear.app/fifthwheel/issue/FIF-42) (Stripe), [FIF-43](https://linear.app/fifthwheel/issue/FIF-43) (Twilio), [FIF-46](https://linear.app/fifthwheel/issue/FIF-46) (post-secret verification, including the cron), [FIF-34](https://linear.app/fifthwheel/issue/FIF-34) (Meta events and campaign), [FIF-36](https://linear.app/fifthwheel/issue/FIF-36), [FIF-35](https://linear.app/fifthwheel/issue/FIF-35), [FIF-11](https://linear.app/fifthwheel/issue/FIF-11).

## Next safe action

Aaron decides whether to hold traffic. If he holds, Finn can start with [FIF-49](https://linear.app/fifthwheel/issue/FIF-49) and [FIF-51](https://linear.app/fifthwheel/issue/FIF-51). Copy and refund language stay with Aaron ([FIF-24](https://linear.app/fifthwheel/issue/FIF-24), [FIF-36](https://linear.app/fifthwheel/issue/FIF-36)). Do not turn dry-run off, send a test signup to a real guest, or open a campaign from this report.
