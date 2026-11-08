# Signup attribution

## Meta ad URL parameters
Paste this into each website ad's **Tracking > URL parameters** (no leading `?`). Copy it into future ads as well; website code cannot supply an ad ID that Meta never sends.

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&placement={{placement}}
```

IDs are the stable reporting keys. Names may reflect their original Meta publication names. Unresolved `{{...}}` placeholders are discarded. Untagged traffic remains unattributed; older registrations are not retroactively assigned to a campaign.

## Attribution model
The last tagged visit within 30 days is kept in browser local storage. A direct return preserves that touch, a new tagged visit replaces the entire touch, and a new database insertion fixes its acquisition attribution. Repeat email submissions may correct intake answers but cannot overwrite original campaign attribution or count as a new conversion. Tracking does not cross browsers/devices and differs from Meta attribution windows.

## Test signups
The normalized Gmail mailbox `oradioso@gmail.com`, its dotted/plus variants, and the equivalent googlemail address are marked `is_test=true` by Supabase. The existing founder record is flagged, not deleted.

For tests using another email, open https://fifthwheel.community/?fw_test=1 before submitting. Test mode persists for that browser tab/session. Open https://fifthwheel.community/?fw_test=0 to leave test mode. Tests are stored for inspection but excluded from `public.waitlist_marketing_signups`. Only an explicit server `track_lead: true` response fires Meta Lead and Google generate_lead; tests and repeat submissions do not.

## Reporting
Use `public.waitlist_marketing_signups` for acquisition reports, or explicitly filter the base waitlist with `is_test = false`. The view includes campaign, adset and ad IDs, name tags, identity, timestamp, and confirmation-sent timestamp without exposing emails. It retains underlying RLS and is not granted to public clients. Existing Airtable/external reports must use this view or apply the same filter; raw table totals still include test records.

Example (staff SQL editor):
```sql
select campaign_id, ad_id, identity, count(*) as signups
from public.waitlist_marketing_signups
group by 1,2,3 order by signups desc;
```

## Release order / verification
1. Apply app migration `20261108190000_waitlist_attribution.sql` (applied in Supabase November 8).
2. Deploy app review branch `codex/waitlist-attribution` before marketing site branch of the same name.
3. Add Meta ad URL parameters; preserve budget, schedule and campaign delivery state.
4. Use a founder alias and test mode to verify campaign/ad persistence and no Lead event end to end. Do not create synthetic non-test paid conversions.

Verification performed: client/server parser tests, marketing Astro production build, live database transaction checks (rolled back temporary rows): create vs duplicate, original attribution preservation, founder aliases, explicit tests, report exclusion and restricted access. Live form verification remains pending app/site deployment approval. No historical Meta counts can be corrected retrospectively.
