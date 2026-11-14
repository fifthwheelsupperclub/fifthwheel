-- W08: T-24 decision queue, proceed, attendance/check-in, host flag, staff assignments, restaurant service read.
-- All functions are service-role only; the server resolves the actor first and the database re-checks role and assignment.

do $$
declare v_def text; v_add text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.app_audit_events'::regclass and conname='app_audit_events_action_check';
  foreach v_add in array array['table.proceed.recorded','table.attendance.checked_in','table.cancellation.flagged','staff.assignment.changed','table.suspended'] loop
    if position(quote_literal(v_add) in v_def)=0 then
      v_def:=regexp_replace(v_def, '\]\)\)\)\s*$', ', '||quote_literal(v_add)||'::text]))) ');
    end if;
  end loop;
  alter table public.app_audit_events drop constraint app_audit_events_action_check;
  execute 'alter table public.app_audit_events add constraint app_audit_events_action_check '||v_def;
end $$;

alter table public.app_audit_events drop constraint app_audit_events_system_actor_check;
alter table public.app_audit_events add constraint app_audit_events_system_actor_check check (system_actor is null or system_actor in (
  'auth_callback','email_delivery_worker','retention_worker','supply_sync_worker','table_invitation_worker','stripe_webhook_worker',
  'checkout_fulfillment_worker','refund_worker','table_runtime_trigger'));

create table public.app_table_attendance (
  attendance_id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  seat_id uuid not null unique references public.app_seats(seat_id) on delete restrict,
  guest_id uuid not null,
  checked_in_at timestamptz not null default clock_timestamp(),
  checked_in_by uuid not null references auth.users(id) on delete restrict
);
create index app_table_attendance_table_idx on public.app_table_attendance(table_id);

create table public.app_venue_memberships (
  venue_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key(venue_id,user_id)
);

create table public.app_staff_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  business_contact text not null check (length(btrim(business_contact)) between 1 and 200),
  updated_at timestamptz not null default now()
);

create table public.app_ops_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('proceed')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{32}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.app_seat_cancellation_requests
  add column host_flagged_at timestamptz, add column host_flagged_by uuid references auth.users(id) on delete restrict,
  add constraint app_seat_cancellation_requests_flag_pair check ((host_flagged_at is null) = (host_flagged_by is null));

alter table public.app_table_attendance enable row level security;
alter table public.app_venue_memberships enable row level security;
alter table public.app_staff_contacts enable row level security;
alter table public.app_ops_operations enable row level security;
revoke all on public.app_table_attendance,public.app_venue_memberships,public.app_staff_contacts,public.app_ops_operations from public,anon,authenticated,service_role;
grant select,insert on public.app_table_attendance,public.app_ops_operations to service_role;
grant select,insert,update,delete on public.app_venue_memberships,public.app_staff_contacts to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Shared predicates
-- ---------------------------------------------------------------------------------------------------------------------
create function app_private.paid_group_issues(p_table_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_date date; v_count integer; v_codes text[]:='{}';
begin
  select (r.content->>'localDate')::date into v_date from public.app_supply_table_heads h
    join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=p_table_id;
  with g as (
    select p.guest_id,p.identity,p.open_to,p.match_age_min,p.match_age_max,
      extract(year from age(v_date,p.date_of_birth))::integer as age,
      (p.identity_status='approved' and p.reviewed_identity_version=p.critical_identity_version) as approved
    from public.app_seats s join public.app_member_profiles p on p.guest_id=s.guest_id
    where s.table_id=p_table_id and s.state in ('confirmed','cancellation_requested','completed')),
  pairs as (
    select a.guest_id as a_id,b.guest_id as b_id,
      (a.age between b.match_age_min and b.match_age_max and b.age between a.match_age_min and a.match_age_max) as age_ok,
      (a.identity=any(b.open_to) and b.identity=any(a.open_to)) as open_ok
    from g a join g b on a.guest_id<b.guest_id)
  select (select count(*)::integer from g),
    array_remove(array[
      case when (select count(*) from g) not between 3 and 5 then 'select_three_to_five' end,
      case when exists(select 1 from g where age is null or age<21) then 'age_under_21' end,
      case when exists(select 1 from g where not approved) then 'profile_not_approved' end,
      case when exists(select 1 from pairs where not age_ok) then 'pair_age_mismatch' end,
      case when exists(select 1 from g where not exists(select 1 from pairs x where x.open_ok and g.guest_id in (x.a_id,x.b_id))) then 'missing_mutual_open_connection' end,
      case when (select max(age)-min(age) from g)>12 then 'age_span_exceeded' end],null)
  into v_count,v_codes;
  return jsonb_build_object('valid',coalesce(cardinality(v_codes),0)=0,'count',v_count,'issues',to_jsonb(coalesce(v_codes,'{}'::text[])));
end $function$;

create function app_private.require_staff(p_actor uuid,p_role text)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  if p_actor is null or not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null)
    or not exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role=p_role) then
    raise exception using errcode='42501',message=p_role||'_required';
  end if;
end $function$;

-- Admin, or a host assigned to this exact Table. Returns true for admin.
create function app_private.require_admin_or_assigned_host(p_actor uuid,p_table_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean;
begin
  perform app_private.require_service_role();
  if p_actor is null or not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null) then
    raise exception using errcode='42501',message='forbidden'; end if;
  v_admin:=exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role='admin');
  if not v_admin and not (exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role='host')
    and exists(select 1 from public.app_supply_table_assignments a where a.table_id=p_table_id and a.user_id=p_actor)) then
    raise exception using errcode='42501',message='forbidden'; end if;
  return v_admin;
end $function$;

-- A removal that leaves a proceeding Table invalid suspends it; voting and check-in require 'proceeding'.
create function app_private.suspend_invalid_proceeding()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.state='cancelled' and old.state in ('confirmed','cancellation_requested')
    and exists(select 1 from public.app_table_runtime rt where rt.table_id=new.table_id and rt.state='proceeding')
    and not (app_private.paid_group_issues(new.table_id)->>'valid')::boolean then
    update public.app_table_runtime set state='review_required',version=version+1,updated_at=clock_timestamp() where table_id=new.table_id;
    insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,metadata)
      values('system','table_runtime_trigger','table.suspended','supply_table',new.table_id,jsonb_build_object('tableId',new.table_id));
  end if;
  return null;
end $function$;
create trigger app_seats_suspend_invalid_proceeding after update of state on public.app_seats
  for each row execute function app_private.suspend_invalid_proceeding();

-- ---------------------------------------------------------------------------------------------------------------------
-- W08.1 decision queue and proceed
-- ---------------------------------------------------------------------------------------------------------------------
create function public.read_table_decision_queue(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb;
begin
  perform app_private.require_staff(p_actor,'admin');
  select coalesce(jsonb_agg(item order by (item->>'startsAt')),'[]'::jsonb) into v_items from (
    select jsonb_build_object('tableId',h.table_id,'title',r.content->>'title','localDate',r.content->>'localDate',
      'startLocalTime',r.content->>'startLocalTime','neighborhood',r.content->>'neighborhood',
      'startsAt',((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York',
      'status',case rt.state when 'proceeding' then 'proceeding' when 'review_required' then 'suspended' else 'needs_decision' end,
      'paidCount',(g->>'count')::integer,'canProceed',rt.state in ('open','review_required') and (g->>'valid')::boolean,
      'blockers',g->'issues') as item
    from public.app_supply_table_heads h
    join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id
    join public.app_table_runtime rt on rt.table_id=h.table_id
    cross join lateral (select app_private.paid_group_issues(h.table_id) as g) x
    where rt.state in ('open','review_required','proceeding')
      and ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York' > now()-interval '3 hours'
      and (rt.state='review_required'
        or ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York' <= now()+interval '24 hours')
  ) q;
  return jsonb_build_object('items',v_items);
end $function$;

create function public.record_table_proceed(p_actor uuid,p_table_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_hash text; v_prior public.app_ops_operations%rowtype; v_runtime public.app_table_runtime%rowtype; v_start timestamptz; v_g jsonb; v_result jsonb;
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_table_id is null or p_operation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('tableId',p_table_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('ops:'||p_operation_id::text,0));
  select * into v_prior from public.app_ops_operations where operation_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.action<>'proceed' or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  perform 1 from public.app_supply_table_heads where table_id=p_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_runtime from public.app_table_runtime where table_id=p_table_id for update;
  select ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York' into v_start
    from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=p_table_id;
  if v_runtime.state not in ('open','review_required') or v_start is null or v_start<=now() then raise exception using errcode='P0001',message='table_not_proceedable'; end if;
  if v_start-interval '24 hours'>now() then raise exception using errcode='P0001',message='decision_not_open'; end if;
  v_g:=app_private.paid_group_issues(p_table_id);
  if not (v_g->>'valid')::boolean then raise exception using errcode='P0001',message='group_invalid'; end if;
  update public.app_table_runtime set state='proceeding',version=version+1,updated_at=clock_timestamp() where table_id=p_table_id;
  update public.app_supply_table_heads set protected_by_activity=true,updated_at=clock_timestamp() where table_id=p_table_id;
  v_result:=jsonb_build_object('tableId',p_table_id,'state','proceeding','paidCount',(v_g->>'count')::integer);
  insert into public.app_ops_operations(operation_id,actor_user_id,action,request_hash,result) values(p_operation_id,p_actor,'proceed',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,'table.proceed.recorded','supply_table',p_table_id,p_operation_id,jsonb_build_object('tableId',p_table_id));
  return v_result;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- W08.3 attendance, host flag
-- ---------------------------------------------------------------------------------------------------------------------
create function public.read_table_attendance(p_actor uuid,p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_table jsonb; v_guests jsonb; v_state text;
begin
  perform app_private.require_admin_or_assigned_host(p_actor,p_table_id);
  select rt.state,jsonb_build_object('tableId',h.table_id,'title',r.content->>'title','localDate',r.content->>'localDate',
    'startLocalTime',r.content->>'startLocalTime','neighborhood',r.content->>'neighborhood','runtimeState',rt.state)
    into v_state,v_table
    from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id
    join public.app_table_runtime rt on rt.table_id=h.table_id where h.table_id=p_table_id;
  if v_table is null then raise exception using errcode='P0002',message='not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('seatId',s.seat_id,'firstName',m.first_name,'seatState',s.state,
      'checkedInAt',a.checked_in_at,'cancellationRequestId',cr.cancellation_request_id,'cancellationFlagged',cr.host_flagged_at is not null)
      order by m.first_name,s.seat_id),'[]'::jsonb) into v_guests
    from public.app_seats s join public.app_member_profiles m on m.guest_id=s.guest_id
    left join public.app_table_attendance a on a.seat_id=s.seat_id
    left join public.app_seat_cancellation_requests cr on cr.seat_id=s.seat_id and cr.state='pending'
    where s.table_id=p_table_id and s.state in ('confirmed','cancellation_requested','completed');
  return jsonb_build_object('table',v_table,'guests',v_guests,'canCheckIn',v_state='proceeding');
end $function$;

create function public.check_in_guest(p_actor uuid,p_table_id uuid,p_seat_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_seat public.app_seats%rowtype; v_state text; v_row public.app_table_attendance%rowtype;
begin
  v_admin:=app_private.require_admin_or_assigned_host(p_actor,p_table_id);
  if p_seat_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  perform 1 from public.app_supply_table_heads where table_id=p_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select state into v_state from public.app_table_runtime where table_id=p_table_id for update;
  select * into v_seat from public.app_seats where seat_id=p_seat_id and table_id=p_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_state<>'proceeding' then raise exception using errcode='P0001',message='table_not_proceeding'; end if;
  if v_seat.state not in ('confirmed','cancellation_requested','completed')
    or not exists(select 1 from public.app_payments p where p.payment_id=v_seat.payment_id and p.state in ('verified_paid','refund_pending')) then
    raise exception using errcode='P0001',message='seat_not_checkin_eligible'; end if;
  insert into public.app_table_attendance(table_id,seat_id,guest_id,checked_in_by) values(p_table_id,p_seat_id,v_seat.guest_id,p_actor)
    on conflict (seat_id) do nothing returning * into v_row;
  if v_row.attendance_id is null then
    select * into v_row from public.app_table_attendance where seat_id=p_seat_id;
  else
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
      values('user',p_actor,'table.attendance.checked_in','seat',p_seat_id,jsonb_build_object('tableId',p_table_id,'guest_id',v_seat.guest_id));
  end if;
  return jsonb_build_object('seatId',p_seat_id,'checkedInAt',v_row.checked_in_at,'byAdmin',v_admin);
end $function$;

create function public.flag_cancellation_request(p_actor uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_cr public.app_seat_cancellation_requests%rowtype; v_table uuid;
begin
  select s.table_id into v_table from public.app_seat_cancellation_requests cr join public.app_seats s on s.seat_id=cr.seat_id
    where cr.cancellation_request_id=p_request_id;
  if not found then perform app_private.require_service_role(); raise exception using errcode='P0002',message='not_found'; end if;
  perform app_private.require_admin_or_assigned_host(p_actor,v_table);
  select * into v_cr from public.app_seat_cancellation_requests where cancellation_request_id=p_request_id for update;
  if v_cr.state<>'pending' then raise exception using errcode='P0001',message='decision_finalized'; end if;
  if v_cr.host_flagged_at is null then
    update public.app_seat_cancellation_requests set host_flagged_at=clock_timestamp(),host_flagged_by=p_actor where cancellation_request_id=p_request_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
      values('user',p_actor,'table.cancellation.flagged','seat_cancellation_request',p_request_id,jsonb_build_object('tableId',v_table));
  end if;
  return jsonb_build_object('requestId',p_request_id,'flagged',true);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Assignments (admin) and restaurant service read
-- ---------------------------------------------------------------------------------------------------------------------
create function public.set_host_assignment(p_actor uuid,p_table_id uuid,p_user_id uuid,p_assigned boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_table_id is null or p_user_id is null or p_assigned is null then raise exception using errcode='22023',message='invalid_input'; end if;
  perform 1 from public.app_supply_table_heads where table_id=p_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if p_assigned then
    if not exists(select 1 from public.app_user_roles r where r.user_id=p_user_id and r.role='host') then raise exception using errcode='P0001',message='not_a_host'; end if;
    insert into public.app_supply_table_assignments(table_id,user_id,assigned_by) values(p_table_id,p_user_id,p_actor) on conflict do nothing;
  else
    delete from public.app_supply_table_assignments where table_id=p_table_id and user_id=p_user_id;
  end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'staff.assignment.changed','supply_table',p_table_id,jsonb_build_object('tableId',p_table_id));
  return jsonb_build_object('tableId',p_table_id,'userId',p_user_id,'assigned',p_assigned);
end $function$;

create function public.set_venue_membership(p_actor uuid,p_venue_id uuid,p_user_id uuid,p_assigned boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_venue_id is null or p_user_id is null or p_assigned is null then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_assigned then
    if not exists(select 1 from public.app_user_roles r where r.user_id=p_user_id and r.role='restaurant') then raise exception using errcode='P0001',message='not_a_restaurant_user'; end if;
    if not exists(select 1 from public.app_supply_external_mappings m where m.entity_kind='venue' and m.core_id=p_venue_id) then raise exception using errcode='P0002',message='not_found'; end if;
    insert into public.app_venue_memberships(venue_id,user_id,assigned_by) values(p_venue_id,p_user_id,p_actor) on conflict do nothing;
  else
    delete from public.app_venue_memberships where venue_id=p_venue_id and user_id=p_user_id;
  end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'staff.assignment.changed','auth_identity',p_user_id,'{}'::jsonb);
  return jsonb_build_object('venueId',p_venue_id,'userId',p_user_id,'assigned',p_assigned);
end $function$;

create function public.set_staff_contact(p_actor uuid,p_user_id uuid,p_display_name text,p_business_contact text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_user_id is null or length(btrim(coalesce(p_display_name,''))) not between 1 and 120 or length(btrim(coalesce(p_business_contact,''))) not between 1 and 200 then
    raise exception using errcode='22023',message='invalid_input'; end if;
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_user_id and r.role in ('host','restaurant')) then raise exception using errcode='P0002',message='not_found'; end if;
  insert into public.app_staff_contacts(user_id,display_name,business_contact) values(p_user_id,btrim(p_display_name),btrim(p_business_contact))
    on conflict (user_id) do update set display_name=excluded.display_name,business_contact=excluded.business_contact,updated_at=clock_timestamp();
  return jsonb_build_object('userId',p_user_id);
end $function$;

create function public.read_staff_assignments(p_actor uuid)
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
  select coalesce(jsonb_agg(jsonb_build_object('venueId',x.venue_id,'name',x.name) order by x.name),'[]'::jsonb) into v_venues from (
    select distinct on (s.value->>'venueId') (s.value->>'venueId')::uuid as venue_id,s.value->>'venueName' as name
    from public.app_supply_table_heads h join public.app_supply_table_revisions rev on rev.revision_id=h.published_revision_id
    cross join lateral jsonb_array_elements(rev.content->'stops') s(value) order by s.value->>'venueId') x;
  return jsonb_build_object('staff',v_staff,'tables',v_tables,'venues',v_venues);
end $function$;

create function public.read_restaurant_workspace(p_actor uuid,p_venue_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_venues jsonb; v_selected uuid; v_services jsonb;
begin
  perform app_private.require_staff(p_actor,'restaurant');
  select coalesce(jsonb_agg(jsonb_build_object('venueId',x.venue_id,'name',x.name) order by x.name),'[]'::jsonb) into v_venues from (
    select m.venue_id,coalesce((select s.value->>'venueName' from public.app_supply_table_revisions rev
        cross join lateral jsonb_array_elements(rev.content->'stops') s(value) where s.value->>'venueId'=m.venue_id::text order by rev.created_at desc limit 1),'Venue') as name
    from public.app_venue_memberships m where m.user_id=p_actor) x;
  select m.venue_id into v_selected from public.app_venue_memberships m where m.user_id=p_actor and (p_venue_id is null or m.venue_id=p_venue_id)
    order by (m.venue_id=p_venue_id) desc nulls last,m.venue_id limit 1;
  if p_venue_id is not null and v_selected is distinct from p_venue_id then raise exception using errcode='42501',message='forbidden'; end if;
  if v_selected is null then return jsonb_build_object('venues',v_venues,'selected',null,'services','[]'::jsonb); end if;
  select coalesce(jsonb_agg(svc order by svc->>'serviceLocalDate',svc->>'serviceLocalTime'),'[]'::jsonb) into v_services from (
    select jsonb_build_object('tableId',h.table_id,'title',rev.content->>'title','role',s.value->>'role','serviceLocalDate',rev.content->>'localDate',
      'serviceLocalTime',to_char(((rev.content->>'localDate')::date+(rev.content->>'startLocalTime')::time)+((s.value->>'minutesFromStart')::integer*interval '1 minute'),'HH24:MI'),
      'paidCount',(select count(*) from public.app_seats x where x.table_id=h.table_id and x.state in ('confirmed','cancellation_requested','completed')),
      'status',rt.state,'notes',s.value->>'publicNotes',
      'hostContacts',coalesce((select jsonb_agg(jsonb_build_object('displayName',c.display_name,'businessContact',c.business_contact))
        from public.app_supply_table_assignments a join public.app_staff_contacts c on c.user_id=a.user_id where a.table_id=h.table_id),'[]'::jsonb)) as svc
    from public.app_supply_table_heads h join public.app_supply_table_revisions rev on rev.revision_id=h.published_revision_id
    join public.app_table_runtime rt on rt.table_id=h.table_id
    cross join lateral jsonb_array_elements(rev.content->'stops') s(value)
    where s.value->>'venueId'=v_selected::text and rt.state in ('open','review_required','proceeding')
      and ((rev.content->>'localDate')::date+(rev.content->>'startLocalTime')::time) at time zone 'America/New_York' > now()-interval '6 hours') q;
  return jsonb_build_object('venues',v_venues,'selected',v_selected,'services',v_services);
end $function$;

do $$
declare v text;
begin
  foreach v in array array[
    'public.read_table_decision_queue(uuid)','public.record_table_proceed(uuid,uuid,uuid)','public.read_table_attendance(uuid,uuid)',
    'public.check_in_guest(uuid,uuid,uuid)','public.flag_cancellation_request(uuid,uuid)','public.set_host_assignment(uuid,uuid,uuid,boolean)',
    'public.set_venue_membership(uuid,uuid,uuid,boolean)','public.set_staff_contact(uuid,uuid,text,text)','public.read_staff_assignments(uuid)',
    'public.read_restaurant_workspace(uuid,uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
    execute format('grant execute on function %s to service_role',v);
  end loop;
  foreach v in array array['app_private.paid_group_issues(uuid)','app_private.require_staff(uuid,text)','app_private.require_admin_or_assigned_host(uuid,uuid)','app_private.suspend_invalid_proceeding()'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
  end loop;
end $$;
grant execute on function app_private.paid_group_issues(uuid),app_private.require_staff(uuid,text),app_private.require_admin_or_assigned_host(uuid,uuid) to service_role;
