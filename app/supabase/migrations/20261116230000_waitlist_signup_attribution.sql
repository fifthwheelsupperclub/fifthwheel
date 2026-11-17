-- The marketing form sends ad attribution and a test flag with every signup. Store both (additive, nullable/defaulted; nothing existing changes).
alter table public.waitlist_signups
  add column attribution jsonb
    check (attribution is null or (jsonb_typeof(attribution) = 'object' and length(attribution::text) <= 4000)),
  add column is_test boolean not null default false;
