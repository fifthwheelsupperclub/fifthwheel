-- W06.1-W06.2: guest-safe reads of accepted published supply and durable
-- member Seat requests. No Data API role accesses these records directly.

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check (action in (
  'waitlist.signup.created', 'app.admission.invited', 'app.admission.activated', 'app.admission.deleted',
  'app.invitation.queued', 'app.invitation.accepted', 'app.invitation.delivered', 'app.invitation.failed',
  'app.invitation.unknown', 'app.invitation.retry_requested', 'member_link.requested', 'auth.callback.rejected',
  'authorization.denied', 'identity.evidence.read', 'identity.review.decided',
  'supply.sync.started', 'supply.sync.finished', 'supply.sync.missing_detected', 'supply.sync.missing_resolved',
  'supply.draft.created', 'supply.draft.updated', 'supply.draft.accepted', 'supply.draft.published',
  'supply.weekly_clone.started', 'supply.weekly_clone.item_created', 'supply.weekly_clone.item_unknown', 'supply.weekly_clone.item_conflict',
  'supply.weekly_clone.reconciled', 'supply.weekly_clone.undo_started', 'supply.weekly_clone.item_undone',
  'supply.weekly_clone.undo_unknown', 'supply.weekly_clone.undo_refused',
  'table.request.created', 'table.request.withdrawn'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup','app_admission','invitation_delivery','delivery_attempt','auth_identity','member_link_request',
  'profile_file','identity_review','supply_sync_run','supply_table','supply_table_revision',
  'supply_weekly_clone_operation','supply_weekly_clone_item','table_request'
));

create table public.app_table_requests (
  request_id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  guest_id uuid not null references public.app_member_profiles(guest_id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  table_title text not null check (length(btrim(table_title)) between 3 and 180),
  table_local_date date not null,
  table_start_local_time time not null,
  table_neighborhood text not null check (length(btrim(table_neighborhood)) between 1 and 120),
  state text not null default 'pending' check (state in ('pending','withdrawn','declined')),
  decline_reason text check (decline_reason is null or (length(btrim(decline_reason)) between 1 and 2000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'declined') = (decline_reason is not null))
);
create unique index app_table_requests_one_pending_per_guest_table
  on public.app_table_requests (auth_user_id, table_id) where state = 'pending';
create index app_table_requests_guest_history_idx
  on public.app_table_requests (auth_user_id, created_at desc, request_id desc);
create index app_table_requests_table_queue_idx
  on public.app_table_requests (table_id, created_at, request_id) where state = 'pending';

create table public.app_table_request_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('request.create','request.withdraw')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{32}$'),
  request_id uuid not null references public.app_table_requests(request_id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.app_table_requests enable row level security;
alter table public.app_table_request_operations enable row level security;
revoke all on public.app_table_requests, public.app_table_request_operations from public, anon, authenticated, service_role;

create function app_private.require_admitted_table_member(p_auth_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  if p_auth_user_id is null or not exists (
    select 1 from auth.users u
    join public.app_admissions a on a.auth_user_id = u.id and a.state = 'activated'
    where u.id = p_auth_user_id and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'member_not_admitted';
  end if;
end $function$;
revoke all on function app_private.require_admitted_table_member(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.require_admitted_table_member(uuid) to service_role;

create function app_private.require_approved_table_member(p_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_guest_id uuid;
begin
  perform app_private.require_admitted_table_member(p_auth_user_id);
  select p.guest_id into v_guest_id
  from public.app_member_profiles p
  where p.auth_user_id = p_auth_user_id
    and p.identity_status = 'approved'
    and p.reviewed_identity_version = p.critical_identity_version
  for share;
  if not found then raise exception using errcode = 'P0001', message = 'profile_incomplete'; end if;
  return v_guest_id;
end $function$;
revoke all on function app_private.require_approved_table_member(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.require_approved_table_member(uuid) to service_role;

create function app_private.table_request_dto(p_request_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'requestId', r.request_id,
    'tableId', r.table_id,
    'state', r.state,
    'declineReason', r.decline_reason,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  ) from public.app_table_requests r where r.request_id = p_request_id
$function$;
revoke all on function app_private.table_request_dto(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.table_request_dto(uuid) to service_role;

create function public.list_published_tables(
  p_auth_user_id uuid,
  p_date_from text default null,
  p_date_to text default null,
  p_neighborhood text default null,
  p_cursor text default null,
  p_limit integer default 25
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_guest_id uuid; v_from date; v_to date; v_cursor_date date; v_cursor_time time; v_cursor_table uuid;
  v_limit integer; v_items jsonb; v_next text;
begin
  perform app_private.require_service_role();
  v_guest_id := app_private.require_approved_table_member(p_auth_user_id);
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode = '22023', message = 'invalid_input'; end if;
  if p_date_from is not null then
    if p_date_from !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'invalid_input'; end if;
    begin v_from := p_date_from::date; exception when others then raise exception using errcode = '22023', message = 'invalid_input'; end;
  end if;
  if p_date_to is not null then
    if p_date_to !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode = '22023', message = 'invalid_input'; end if;
    begin v_to := p_date_to::date; exception when others then raise exception using errcode = '22023', message = 'invalid_input'; end;
  end if;
  if v_from is not null and v_to is not null and v_from > v_to then raise exception using errcode = '22023', message = 'invalid_input'; end if;
  if p_neighborhood is not null and (length(btrim(p_neighborhood)) not between 1 and 120 or p_neighborhood ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  if p_cursor is not null then
    if length(p_cursor) > 150 or p_cursor !~ '^\d{4}-\d{2}-\d{2}\|\d{2}:\d{2}:\d{2}\|[0-9a-fA-F-]{36}$' then
      raise exception using errcode = '22023', message = 'invalid_input';
    end if;
    begin
      v_cursor_date := split_part(p_cursor, '|', 1)::date;
      v_cursor_time := split_part(p_cursor, '|', 2)::time;
      v_cursor_table := split_part(p_cursor, '|', 3)::uuid;
    exception when others then raise exception using errcode = '22023', message = 'invalid_input'; end;
  end if;
  v_limit := p_limit;
  with matching as (
    select h.table_id, r.content,
      (r.content->>'localDate')::date as local_date,
      (r.content->>'startLocalTime')::time as start_local_time
    from public.app_supply_table_heads h
    join public.app_supply_table_revisions r on r.revision_id = h.published_revision_id and r.state = 'published'
    where h.lifecycle = 'published' and h.published_revision_id is not null
      and ((r.content->>'localDate')::date + (r.content->>'startLocalTime')::time) at time zone 'America/New_York' > now()
      and (v_from is null or (r.content->>'localDate')::date >= v_from)
      and (v_to is null or (r.content->>'localDate')::date <= v_to)
      and (p_neighborhood is null or lower(r.content->>'neighborhood') = lower(btrim(p_neighborhood)))
      and (v_cursor_date is null or (r.content->>'localDate')::date > v_cursor_date
        or ((r.content->>'localDate')::date = v_cursor_date and (r.content->>'startLocalTime')::time > v_cursor_time)
        or ((r.content->>'localDate')::date = v_cursor_date and (r.content->>'startLocalTime')::time = v_cursor_time and h.table_id > v_cursor_table))
  ), enriched as (
    select m.*, own.own_request,
      jsonb_build_object('tableId',m.table_id,'title',m.content->>'title','localDate',m.content->>'localDate',
        'startLocalTime',m.content->>'startLocalTime','neighborhood',m.content->>'neighborhood','seatPriceCents',2500,'currency','USD',
        'ownRequest',own.own_request) as item
    from matching m
    left join lateral (
      select app_private.table_request_dto(q.request_id) as own_request
      from public.app_table_requests q where q.auth_user_id = p_auth_user_id and q.table_id = m.table_id
      order by q.created_at desc, q.request_id desc limit 1
    ) own on true
  ), page as (
    select enriched.*, row_number() over(order by local_date, start_local_time, table_id) as rn
    from enriched order by local_date, start_local_time, table_id limit v_limit + 1
  )
  select coalesce(jsonb_agg(item order by local_date, start_local_time, table_id) filter(where rn <= v_limit),'[]'::jsonb),
    case when count(*) > v_limit then (
      select local_date::text || '|' || to_char(start_local_time,'HH24:MI:SS') || '|' || table_id::text
      from page where rn = v_limit
    ) else null end
  into v_items, v_next from page;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $function$;

create function public.read_published_table_preview(p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_content jsonb;
begin
  perform app_private.require_service_role();
  select r.content into v_content
  from public.app_supply_table_heads h join public.app_supply_table_revisions r
    on r.revision_id = h.published_revision_id and r.state = 'published'
  where h.table_id = p_table_id and h.lifecycle = 'published'
    and ((r.content->>'localDate')::date + (r.content->>'startLocalTime')::time) at time zone 'America/New_York' > now();
  if not found then return null; end if;
  return jsonb_build_object('view','preview','table',jsonb_build_object(
    'tableId',p_table_id,'title',v_content->>'title','localDate',v_content->>'localDate','neighborhood',v_content->>'neighborhood'));
end $function$;

create function public.read_published_table_detail(p_auth_user_id uuid, p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest_id uuid; v_content jsonb; v_request jsonb; v_table jsonb; v_start timestamptz;
begin
  perform app_private.require_service_role();
  v_guest_id := app_private.require_approved_table_member(p_auth_user_id);
  select r.content, ((r.content->>'localDate')::date + (r.content->>'startLocalTime')::time) at time zone 'America/New_York'
    into v_content, v_start
  from public.app_supply_table_heads h join public.app_supply_table_revisions r
    on r.revision_id = h.published_revision_id and r.state = 'published'
  where h.table_id = p_table_id and h.lifecycle = 'published';
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  if v_start <= now() then raise exception using errcode = 'P0001', message = 'not_future'; end if;
  select app_private.table_request_dto(q.request_id) into v_request
  from public.app_table_requests q where q.auth_user_id = p_auth_user_id and q.table_id = p_table_id
  order by q.created_at desc, q.request_id desc limit 1;
  select jsonb_agg(jsonb_build_object('role',stop.value->>'role','venueName',stop.value->>'venueName',
      'venueAddress',stop.value->>'venueAddress','minutesFromStart',(stop.value->>'minutesFromStart')::integer,
      'publicNotes',stop.value->>'publicNotes') order by stop.ordinality)
    into v_table from jsonb_array_elements(v_content->'stops') with ordinality as stop(value,ordinality);
  v_table := jsonb_build_object('tableId',p_table_id,'title',v_content->>'title','localDate',v_content->>'localDate',
    'startLocalTime',v_content->>'startLocalTime','neighborhood',v_content->>'neighborhood','stops',coalesce(v_table,'[]'::jsonb),
    'seatPriceCents',2500,'currency','USD','ownRequest',v_request);
  return jsonb_build_object('view','member','table',v_table);
end $function$;

create function public.create_table_request(p_auth_user_id uuid, p_table_id uuid, p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest_id uuid; v_prior public.app_table_request_operations%rowtype; v_request public.app_table_requests%rowtype; v_hash text; v_start timestamptz; v_content jsonb; v_result jsonb;
begin
  perform app_private.require_service_role();
  if p_operation_id is null or p_table_id is null then raise exception using errcode = '22023', message = 'invalid_input'; end if;
  v_hash := md5(jsonb_build_object('tableId',p_table_id)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_prior from public.app_table_request_operations where operation_id = p_operation_id;
  if found then
    if v_prior.actor_user_id <> p_auth_user_id or v_prior.action <> 'request.create' or v_prior.request_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'operation_conflict';
    end if;
    return v_prior.result;
  end if;
  v_guest_id := app_private.require_approved_table_member(p_auth_user_id);
  perform pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text || ':' || p_table_id::text,1));
  select r.content, ((r.content->>'localDate')::date + (r.content->>'startLocalTime')::time) at time zone 'America/New_York'
    into v_content, v_start
  from public.app_supply_table_heads h join public.app_supply_table_revisions r
    on r.revision_id = h.published_revision_id and r.state = 'published'
  where h.table_id = p_table_id and h.lifecycle = 'published' for share of h;
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  if v_start <= now() then raise exception using errcode = 'P0001', message = 'not_future'; end if;
  select * into v_request from public.app_table_requests q
    where q.auth_user_id = p_auth_user_id and q.table_id = p_table_id and q.state = 'pending'
    order by q.created_at desc limit 1 for update;
  if not found then
    insert into public.app_table_requests(table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state)
      values(p_table_id,v_guest_id,p_auth_user_id,v_content->>'title',(v_content->>'localDate')::date,
        (v_content->>'startLocalTime')::time,v_content->>'neighborhood','pending') returning * into v_request;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_auth_user_id,'table.request.created','table_request',v_request.request_id,p_operation_id,'{}'::jsonb);
  end if;
  v_result := app_private.table_request_dto(v_request.request_id);
  insert into public.app_table_request_operations(operation_id,actor_user_id,action,request_hash,request_id,result)
    values(p_operation_id,p_auth_user_id,'request.create',v_hash,v_request.request_id,v_result);
  return v_result;
end $function$;

create function public.list_member_table_requests(p_auth_user_id uuid,p_cursor text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest_id uuid; v_cursor_at timestamptz; v_cursor_id uuid; v_items jsonb; v_next text;
begin
  perform app_private.require_service_role();
  perform app_private.require_admitted_table_member(p_auth_user_id);
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode = '22023', message = 'invalid_input'; end if;
  if p_cursor is not null then
    if length(p_cursor)>150 or p_cursor !~ '^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-fA-F-]{36}$' then raise exception using errcode = '22023', message = 'invalid_input'; end if;
    begin v_cursor_at := split_part(p_cursor,'|',1)::timestamptz; v_cursor_id := split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception using errcode = '22023', message = 'invalid_input'; end;
  end if;
  with enriched as (
    select q.request_id,q.created_at,
      jsonb_build_object('requestId',q.request_id,'tableId',q.table_id,'state',q.state,'declineReason',q.decline_reason,
        'createdAt',q.created_at,'updatedAt',q.updated_at,
        'table',jsonb_build_object('tableId',q.table_id,'title',q.table_title,'localDate',q.table_local_date::text,
          'startLocalTime',to_char(q.table_start_local_time,'HH24:MI'),'neighborhood',q.table_neighborhood,
          'isCurrentlyPublished',coalesce(h.lifecycle='published' and h.published_revision_id is not null,false))) as item
    from public.app_table_requests q
    left join public.app_supply_table_heads h on h.table_id=q.table_id
    where q.auth_user_id=p_auth_user_id and (v_cursor_at is null or q.created_at<v_cursor_at or (q.created_at=v_cursor_at and q.request_id<v_cursor_id))
  ), page as (
    select *,row_number() over(order by created_at desc,request_id desc) rn from enriched
    order by created_at desc,request_id desc limit p_limit+1
  )
  select coalesce(jsonb_agg(item order by created_at desc,request_id desc) filter(where rn<=p_limit),'[]'::jsonb),
    case when count(*)>p_limit then (select created_at::text||'|'||request_id::text from page where rn=p_limit) else null end
  into v_items,v_next from page;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $function$;

create function public.withdraw_table_request(p_auth_user_id uuid,p_request_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_request public.app_table_requests%rowtype; v_prior public.app_table_request_operations%rowtype; v_hash text; v_result jsonb; v_table_id uuid;
begin
  perform app_private.require_service_role();
  if p_request_id is null or p_operation_id is null then raise exception using errcode = '22023', message = 'invalid_input'; end if;
  v_hash := md5(jsonb_build_object('requestId',p_request_id)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_prior from public.app_table_request_operations where operation_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_auth_user_id or v_prior.action<>'request.withdraw' or v_prior.request_hash<>v_hash then
      raise exception using errcode = 'P0001', message = 'operation_conflict';
    end if;
    return v_prior.result;
  end if;
  perform app_private.require_admitted_table_member(p_auth_user_id);
  select q.table_id into v_table_id from public.app_table_requests q where q.request_id=p_request_id and q.auth_user_id=p_auth_user_id;
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text || ':' || v_table_id::text,1));
  select * into v_request from public.app_table_requests q where q.request_id=p_request_id and q.auth_user_id=p_auth_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  if v_request.state<>'pending' then raise exception using errcode = 'P0001', message = 'invalid_transition'; end if;
  update public.app_table_requests set state='withdrawn',updated_at=now() where request_id=p_request_id returning * into v_request;
  v_result := app_private.table_request_dto(v_request.request_id);
  insert into public.app_table_request_operations(operation_id,actor_user_id,action,request_hash,request_id,result)
    values(p_operation_id,p_auth_user_id,'request.withdraw',v_hash,p_request_id,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_auth_user_id,'table.request.withdrawn','table_request',p_request_id,p_operation_id,'{}'::jsonb);
  return v_result;
end $function$;

do $grants$
declare fn text;
begin
  foreach fn in array array[
    'public.list_published_tables(uuid,text,text,text,text,integer)',
    'public.read_published_table_preview(uuid)',
    'public.read_published_table_detail(uuid,uuid)',
    'public.create_table_request(uuid,uuid,uuid)',
    'public.list_member_table_requests(uuid,text,integer)',
    'public.withdraw_table_request(uuid,uuid,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end $grants$;

comment on table public.app_table_requests is
  'Private Seat applications; distinct from Table Invitations, checkout holds, payments and paid Seats.';
comment on table public.app_table_request_operations is
  'Private idempotency ledger for member Seat request creation and withdrawal; server RPC only.';
