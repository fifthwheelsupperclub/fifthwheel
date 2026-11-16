-- Supply is app-owned: admins curate Venues in Supabase instead of an external provider snapshot.
-- Draft stops keep their venueName/venueAddress snapshot; venue edits never rewrite existing revisions.

do $$
declare v_def text; v_add text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.app_audit_events'::regclass and conname='app_audit_events_action_check';
  foreach v_add in array array['supply.venue.saved'] loop
    if position(quote_literal(v_add) in v_def)=0 then
      v_def:=regexp_replace(v_def, '\]\)\)\)\s*$', ', '||quote_literal(v_add)||'::text]))) ');
    end if;
  end loop;
  alter table public.app_audit_events drop constraint app_audit_events_action_check;
  execute 'alter table public.app_audit_events add constraint app_audit_events_action_check '||v_def;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.app_audit_events'::regclass and conname='app_audit_events_subject_type_check';
  if position(quote_literal('supply_venue') in v_def)=0 then
    v_def:=regexp_replace(v_def, '\]\)\)\)\s*$', ', '||quote_literal('supply_venue')||'::text]))) ');
  end if;
  alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
  execute 'alter table public.app_audit_events add constraint app_audit_events_subject_type_check '||v_def;
end $$;

create table public.app_supply_venues (
  venue_id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 180),
  address text not null check (length(btrim(address)) between 1 and 400),
  neighborhood text not null check (length(btrim(neighborhood)) between 1 and 120),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_supply_venues enable row level security;
revoke all on public.app_supply_venues from public, anon, authenticated, service_role;
grant select on public.app_supply_venues to service_role;

-- Create or update by caller-generated venue_id, so a retried create is a no-op instead of a duplicate.
create function public.save_supply_venue(p_actor_user_id uuid,p_venue_id uuid,p_name text,p_address text,p_neighborhood text,p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.app_supply_venues;
begin
  perform app_private.require_staff(p_actor_user_id,'admin');
  if p_venue_id is null or p_active is null
    or length(btrim(coalesce(p_name,''))) not between 1 and 180
    or length(btrim(coalesce(p_address,''))) not between 1 and 400
    or length(btrim(coalesce(p_neighborhood,''))) not between 1 and 120 then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  insert into public.app_supply_venues(venue_id,name,address,neighborhood,active,created_by)
    values(p_venue_id,btrim(p_name),btrim(p_address),btrim(p_neighborhood),p_active,p_actor_user_id)
  on conflict (venue_id) do update set name=excluded.name,address=excluded.address,neighborhood=excluded.neighborhood,
    active=excluded.active,updated_at=clock_timestamp()
  returning * into v_row;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor_user_id,'supply.venue.saved','supply_venue',p_venue_id,'{}'::jsonb);
  return jsonb_build_object('venueId',v_row.venue_id,'name',v_row.name,'address',v_row.address,
    'neighborhood',v_row.neighborhood,'active',v_row.active,'updatedAt',v_row.updated_at);
end $function$;
revoke all on function public.save_supply_venue(uuid,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_supply_venue(uuid,uuid,text,text,text,boolean) to service_role;

create or replace function app_private.supply_venues_exist(p_content jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
declare v_stop jsonb;
begin
  if not app_private.supply_valid_content(p_content) then return false; end if;
  for v_stop in select value from jsonb_array_elements(p_content->'stops') loop
    if not exists(select 1 from public.app_supply_venues v
      where v.venue_id=(v_stop->>'venueId')::uuid and v.active) then return false; end if;
  end loop;
  return true;
end
$function$;

-- Admins see every venue (archived included, flagged); assigned hosts see only venues on their drafts.
create or replace function public.list_supply_venues(p_actor_user_id uuid,p_query text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_assigned_host boolean; v_items jsonb;
begin
  perform app_private.require_service_role();
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') into v_admin;
  select exists(select 1 from public.app_user_roles r join public.app_supply_table_assignments a on a.user_id=r.user_id
    where r.user_id=p_actor_user_id and r.role='host') into v_assigned_host;
  if not v_admin and not v_assigned_host then raise exception using errcode='42501',message='forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('venueId',v.venue_id,'name',v.name,'address',v.address,
      'neighborhood',v.neighborhood,'active',v.active) order by v.active desc,lower(v.name)),'[]'::jsonb)
    into v_items
  from public.app_supply_venues v
  where (p_query is null or lower(v.name) like '%'||lower(p_query)||'%' or lower(v.neighborhood) like '%'||lower(p_query)||'%')
    and (v_admin or exists(select 1 from public.app_supply_table_assignments a join public.app_supply_table_heads h on h.table_id=a.table_id
      join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id
      cross join lateral jsonb_array_elements(r.content->'stops') as stop(value)
      where a.user_id=p_actor_user_id and stop.value->>'venueId'=v.venue_id::text));
  return jsonb_build_object('items',v_items);
end $function$;

create or replace function public.set_venue_membership(p_actor uuid,p_venue_id uuid,p_user_id uuid,p_assigned boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_venue_id is null or p_user_id is null or p_assigned is null then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_assigned then
    if not exists(select 1 from public.app_user_roles r where r.user_id=p_user_id and r.role='restaurant') then raise exception using errcode='P0001',message='not_a_restaurant_user'; end if;
    if not exists(select 1 from public.app_supply_venues v where v.venue_id=p_venue_id) then raise exception using errcode='P0002',message='not_found'; end if;
    insert into public.app_venue_memberships(venue_id,user_id,assigned_by) values(p_venue_id,p_user_id,p_actor) on conflict do nothing;
  else
    delete from public.app_venue_memberships where venue_id=p_venue_id and user_id=p_user_id;
  end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'staff.assignment.changed','auth_identity',p_user_id,'{}'::jsonb);
  return jsonb_build_object('venueId',p_venue_id,'userId',p_user_id,'assigned',p_assigned);
end $function$;

-- Same as W08 except the venue list now comes from app_supply_venues, so a venue with no Tables yet can be staffed.
create or replace function public.read_staff_assignments(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_staff jsonb; v_tables jsonb; v_venues jsonb;
begin
  perform app_private.require_staff(p_actor,'admin');
  select coalesce(jsonb_agg(jsonb_build_object('userId',r.user_id,'role',r.role,'email',u.email,'displayName',c.display_name,'businessContact',c.business_contact,
      'tableIds',coalesce((select jsonb_agg(a.table_id) from public.app_supply_table_assignments a where a.user_id=r.user_id),'[]'::jsonb),
      'venueIds',coalesce((select jsonb_agg(v.venue_id) from public.app_venue_memberships v where v.user_id=r.user_id),'[]'::jsonb))
      order by u.email),'[]'::jsonb) into v_staff
    from public.app_user_roles r join auth.users u on u.id=r.user_id left join public.app_staff_contacts c on c.user_id=r.user_id
    where r.role in ('host','restaurant');
  select coalesce(jsonb_agg(jsonb_build_object('tableId',h.table_id,'title',rev.content->>'title','localDate',rev.content->>'localDate') order by rev.content->>'localDate'),'[]'::jsonb) into v_tables
    from public.app_supply_table_heads h join public.app_supply_table_revisions rev on rev.revision_id=h.published_revision_id
    join public.app_table_runtime rt on rt.table_id=h.table_id
    where rt.state in ('open','review_required','proceeding')
      and ((rev.content->>'localDate')::date+(rev.content->>'startLocalTime')::time) at time zone 'America/New_York' > now()-interval '12 hours';
  select coalesce(jsonb_agg(jsonb_build_object('venueId',v.venue_id,'name',v.name) order by v.name),'[]'::jsonb) into v_venues
    from public.app_supply_venues v where v.active;
  return jsonb_build_object('staff',v_staff,'tables',v_tables,'venues',v_venues);
end $function$;
