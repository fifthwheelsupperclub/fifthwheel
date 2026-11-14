-- Fresh-app admission foundation. This migration owns only fresh local/app objects;
-- it deliberately does not import or alter archived legacy application tables.

create schema app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

create function app_private.is_valid_open_to(p_values text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select cardinality(p_values) between 1 and 3
    and p_values <@ array['Women', 'Men', 'Non-binary people']::text[]
    and cardinality(p_values) = (
      select count(distinct value)::integer
      from unnest(p_values) as selected(value)
    );
$function$;

revoke all on function app_private.is_valid_open_to(text[]) from public, anon, authenticated;
grant execute on function app_private.is_valid_open_to(text[]) to service_role;

create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique
    check (email_normalized = lower(btrim(email_normalized)) and length(email_normalized) between 3 and 320),
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  birthdate date not null check (
    birthdate <= (timezone('America/New_York', now())::date - interval '21 years')::date
  ),
  identity text not null check (identity in ('Woman', 'Man', 'Non-binary')),
  open_to text[] not null check (app_private.is_valid_open_to(open_to)),
  match_age_min smallint not null check (match_age_min >= 21),
  match_age_max smallint not null check (match_age_max >= match_age_min),
  neighborhood text not null check (length(btrim(neighborhood)) between 1 and 120),
  nights text[] not null default '{}',
  referral text not null default '' check (length(referral) <= 1000),
  looking_for text not null check (looking_for in ('Casual', 'Open', 'Relationship')),
  surprise_game text not null check (
    surprise_game in ('Yes, surprise me', 'I''d rather keep it conversational')
  ),
  source text not null default 'landing-page' check (source = 'landing-page'),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (cardinality(nights) <= 7),
  check (nights <@ array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[])
);

create table public.app_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'host', 'restaurant')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (user_id, role)
);

create table public.app_admissions (
  id uuid primary key default gen_random_uuid(),
  waitlist_signup_id uuid not null unique
    references public.waitlist_signups(id) on delete restrict,
  email_normalized text not null unique
    references public.waitlist_signups(email_normalized) on update cascade on delete restrict,
  state text not null default 'invited'
    check (state in ('invited', 'activated', 'deleted')),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  activated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'activated') = (activated_at is not null)),
  check ((state = 'deleted') = (deleted_at is not null)),
  check ((auth_user_id is null) or (activated_at is not null))
);

create table public.app_invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null references public.app_admissions(id) on delete restrict,
  operation_id uuid not null unique,
  state text not null default 'queued'
    check (state in ('queued', 'sending', 'accepted', 'delivered', 'failed', 'unknown')),
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text check (error_code is null or length(error_code) <= 100),
  queued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  attempted_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((state in ('accepted', 'delivered')) = (accepted_at is not null)),
  check ((state = 'delivered') = (delivered_at is not null)),
  check (delivered_at is null or accepted_at <= delivered_at)
);

create table public.app_invitation_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.app_invitation_deliveries(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  state text not null check (state in ('sending', 'accepted', 'failed', 'unknown')),
  provider_message_id text,
  error_code text check (error_code is null or length(error_code) <= 100),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (delivery_id, attempt_number),
  check ((state = 'sending') = (finished_at is null))
);

create index app_waitlist_received_idx on public.waitlist_signups (received_at desc, id);
create index app_waitlist_neighborhood_idx on public.waitlist_signups (neighborhood, received_at desc, id);
create index app_admissions_state_idx on public.app_admissions (state, created_at desc, id);
create index app_deliveries_state_idx on public.app_invitation_deliveries (state, next_attempt_at, id);
create index app_deliveries_lease_idx on public.app_invitation_deliveries (lease_until, id) where state = 'sending';
create index app_delivery_attempts_delivery_idx on public.app_invitation_delivery_attempts (delivery_id, attempt_number desc);

alter table public.waitlist_signups enable row level security;
alter table public.app_user_roles enable row level security;
alter table public.app_admissions enable row level security;
alter table public.app_invitation_deliveries enable row level security;
alter table public.app_invitation_delivery_attempts enable row level security;

-- All access is through server-side handlers that validate origin/input and use
-- the service role only after explicit authorization. Signup receives no Data API grant.
revoke all on public.waitlist_signups from anon, authenticated;
revoke all on public.app_user_roles from anon, authenticated;
revoke all on public.app_admissions from anon, authenticated;
revoke all on public.app_invitation_deliveries from anon, authenticated;
revoke all on public.app_invitation_delivery_attempts from anon, authenticated;
grant select, insert, update, delete on public.waitlist_signups to service_role;
grant select, insert, update, delete on public.app_user_roles to service_role;
grant select, insert, update, delete on public.app_admissions to service_role;
grant select, insert, update, delete on public.app_invitation_deliveries to service_role;
grant select, insert, update, delete on public.app_invitation_delivery_attempts to service_role;
