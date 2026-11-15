-- Profile preference DTOs use the stable identity codes, while the marketing
-- intake stores its original display labels. Keep the two validation contracts
-- explicit so exact intake selections map without widening or label mismatch.
create function app_private.is_valid_profile_open_to(p_values text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select cardinality(p_values) between 1 and 3
    and p_values <@ array['woman', 'man', 'non_binary']::text[]
    and cardinality(p_values) = (
      select count(distinct value)::integer
      from unnest(p_values) as selected(value)
    );
$function$;

revoke all on function app_private.is_valid_profile_open_to(text[]) from public, anon, authenticated;
grant execute on function app_private.is_valid_profile_open_to(text[]) to service_role;

alter table public.app_member_profiles
  drop constraint app_member_profiles_open_to_check;
alter table public.app_member_profiles
  add constraint app_member_profiles_open_to_check
  check (app_private.is_valid_profile_open_to(open_to));
