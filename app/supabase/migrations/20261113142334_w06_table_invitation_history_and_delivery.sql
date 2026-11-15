-- W06.5: owner-visible Table offer history and durable email delivery recovery.
-- This migration adds no provider traffic and does not alter admission deliveries.

alter table public.app_audit_events drop constraint app_audit_events_system_actor_check;
alter table public.app_audit_events add constraint app_audit_events_system_actor_check check (system_actor is null or system_actor in (
  'auth_callback', 'email_delivery_worker', 'retention_worker', 'supply_sync_worker', 'table_invitation_worker'
));

alter table public.app_table_invitation_outbox
  drop constraint app_table_invitation_outbox_invitation_id_key;
alter table public.app_table_invitation_outbox
  add column message_kind text not null default 'invitation'
    check (message_kind in ('invitation','reminder_t48')),
  add column manual_retry_requested boolean not null default false;
create unique index app_table_invitation_outbox_invitation_kind_uidx
  on public.app_table_invitation_outbox(invitation_id,message_kind);

create table public.app_table_invitation_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.app_table_invitation_outbox(outbox_id) on delete restrict,
  operation_id uuid not null unique,
  attempt_number integer not null check (attempt_number > 0),
  state text not null check (state in ('sending','accepted','delivered','failed','unknown')),
  provider_message_id text check (provider_message_id is null or (length(provider_message_id)<=200 and provider_message_id !~ '[[:cntrl:]]')),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_.-]{1,100}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(outbox_id,attempt_number),
  check ((state='sending')=(finished_at is null)),
  check (state<>'delivered' or provider_message_id is not null)
);
create index app_table_invitation_attempts_outbox_idx
  on public.app_table_invitation_attempts(outbox_id,attempt_number desc);
alter table public.app_table_invitation_attempts enable row level security;
revoke all on public.app_table_invitation_attempts from public,anon,authenticated,service_role;

create table public.app_table_invitation_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action='delivery.retry_failed'),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{32}$'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);
alter table public.app_table_invitation_operations enable row level security;
revoke all on public.app_table_invitation_operations from public,anon,authenticated,service_role;

create function app_private.require_table_invitation_admin(p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  if p_actor_user_id is null or not exists(select 1 from auth.users u where u.id=p_actor_user_id and u.email_confirmed_at is not null for share)
    or not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin' for share) then
    raise exception using errcode='42501',message='forbidden';
  end if;
end $function$;
revoke all on function app_private.require_table_invitation_admin(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.require_table_invitation_admin(uuid) to service_role;

create or replace function public.list_member_table_requests(p_auth_user_id uuid,p_cursor text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_cursor_at timestamptz; v_cursor_id uuid; v_items jsonb; v_next text;
begin
  perform app_private.require_service_role();
  perform app_private.require_admitted_table_member(p_auth_user_id);
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_cursor is not null then
    if length(p_cursor)>150 or p_cursor !~ '^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='invalid_input'; end if;
    begin v_cursor_at:=split_part(p_cursor,'|',1)::timestamptz; v_cursor_id:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception using errcode='22023',message='invalid_input'; end;
  end if;
  with enriched as (
    select q.request_id,q.created_at,
      jsonb_build_object('requestId',q.request_id,'tableId',q.table_id,'state',q.state,'declineReason',q.decline_reason,
        'createdAt',q.created_at,'updatedAt',q.updated_at,
        'table',jsonb_build_object('tableId',q.table_id,'title',q.table_title,'localDate',q.table_local_date::text,
          'startLocalTime',to_char(q.table_start_local_time,'HH24:MI'),'neighborhood',q.table_neighborhood,
          'isCurrentlyPublished',coalesce(h.lifecycle='published' and h.published_revision_id is not null,false)),
        'tableInvitation',(select jsonb_build_object('invitationId',i.invitation_id,'state',i.state,
          'deliveryState',o.state,'createdAt',i.created_at)
          from public.app_table_invitations i
          join public.app_table_invitation_outbox o on o.invitation_id=i.invitation_id and o.message_kind='invitation'
          where i.source_request_id=q.request_id and i.auth_user_id=q.auth_user_id
            and i.guest_id=q.guest_id and i.table_id=q.table_id
          order by i.created_at desc,i.invitation_id desc limit 1)) as item
    from public.app_table_requests q left join public.app_supply_table_heads h on h.table_id=q.table_id
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
revoke all on function public.list_member_table_requests(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_member_table_requests(uuid,text,integer) to service_role;

create function public.read_member_table_invitation(p_auth_user_id uuid,p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_invitation public.app_table_invitations%rowtype; v_outbox public.app_table_invitation_outbox%rowtype;
  v_request public.app_table_requests%rowtype; v_content jsonb; v_head record; v_stops jsonb:='[]'::jsonb; v_available boolean:=false;
begin
  perform app_private.require_service_role();
  perform app_private.require_admitted_table_member(p_auth_user_id);
  select i.* into v_invitation from public.app_table_invitations i
    join public.app_member_profiles p on p.guest_id=i.guest_id and p.auth_user_id=i.auth_user_id
    where i.invitation_id=p_invitation_id and i.auth_user_id=p_auth_user_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select q.* into v_request from public.app_table_requests q where q.request_id=v_invitation.source_request_id
    and q.auth_user_id=p_auth_user_id and q.guest_id=v_invitation.guest_id and q.table_id=v_invitation.table_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select o.* into v_outbox from public.app_table_invitation_outbox o
    where o.invitation_id=v_invitation.invitation_id and o.message_kind='invitation';
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select h.lifecycle,h.published_revision_id into v_head from public.app_supply_table_heads h where h.table_id=v_invitation.table_id;
  if found and v_head.lifecycle='published' and v_head.published_revision_id is not null then
    select r.content into v_content from public.app_supply_table_revisions r
      where r.revision_id=v_head.published_revision_id and r.table_id=v_invitation.table_id and r.state='published';
    if found and jsonb_typeof(v_content->'stops')='array' and jsonb_array_length(v_content->'stops')=3 then
      select coalesce(jsonb_agg(jsonb_build_object('role',s.value->>'role','venueName',s.value->>'venueName',
        'venueAddress',s.value->>'venueAddress','minutesFromStart',s.value->'minutesFromStart','publicNotes',coalesce(s.value->>'publicNotes','')) order by s.ordinality),'[]'::jsonb)
        into v_stops from jsonb_array_elements(v_content->'stops') with ordinality s(value,ordinality);
      v_available:=true;
    end if;
  end if;
  return jsonb_build_object('invitationId',v_invitation.invitation_id,'state',v_invitation.state,'createdAt',v_invitation.created_at,
    'delivery',jsonb_build_object('state',v_outbox.state,'attemptCount',v_outbox.attempt_count,'lastAttemptAt',v_outbox.attempted_at),
    'table',jsonb_build_object('tableId',v_invitation.table_id,
      'title',case when v_available then v_content->>'title' else v_request.table_title end,
      'localDate',case when v_available then v_content->>'localDate' else v_request.table_local_date::text end,
      'startLocalTime',case when v_available then v_content->>'startLocalTime' else to_char(v_request.table_start_local_time,'HH24:MI') end,
      'neighborhood',case when v_available then v_content->>'neighborhood' else v_request.table_neighborhood end,
      'seatPriceCents',2500,'currency','USD','stops',v_stops,'itineraryAvailable',v_available));
end $function$;
revoke all on function public.read_member_table_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_member_table_invitation(uuid,uuid) to service_role;

create function public.list_admin_table_invitations(p_actor_user_id uuid,p_cursor text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_cursor_at timestamptz; v_cursor_id uuid; v_items jsonb; v_next text;
begin
  perform app_private.require_table_invitation_admin(p_actor_user_id);
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_cursor is not null then
    if length(p_cursor)>150 or p_cursor !~ '^\d{4}-\d{2}-\d{2}T[^|]{1,40}\|[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='invalid_input'; end if;
    begin v_cursor_at:=split_part(p_cursor,'|',1)::timestamptz; v_cursor_id:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception using errcode='22023',message='invalid_input'; end;
  end if;
  with enriched as (
    select i.invitation_id,i.created_at,
      jsonb_build_object('invitationId',i.invitation_id,'invitationState',i.state,'createdAt',i.created_at,
        'guest',jsonb_build_object('guestId',i.guest_id,'displayName',btrim(p.first_name||' '||p.last_name)),
        'table',jsonb_build_object('tableId',i.table_id,'title',q.table_title,'localDate',q.table_local_date::text,
          'startLocalTime',to_char(q.table_start_local_time,'HH24:MI'),'neighborhood',q.table_neighborhood),
        'delivery',jsonb_build_object('outboxId',o.outbox_id,'state',o.state,'attemptCount',o.attempt_count,
          'queuedAt',o.queued_at,'nextAttemptAt',o.next_attempt_at,'lastAttemptAt',o.attempted_at,'safeErrorCode',o.error_code),
        'attempts',coalesce((select jsonb_agg(jsonb_build_object('attemptNumber',a.attempt_number,'state',a.state,
          'startedAt',a.started_at,'finishedAt',a.finished_at,'safeErrorCode',a.error_code) order by a.attempt_number desc)
          from (select at.* from public.app_table_invitation_attempts at where at.outbox_id=o.outbox_id
            order by at.attempt_number desc limit 3) a),'[]'::jsonb)) as item
    from public.app_table_invitations i
    join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id
      and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
    join public.app_member_profiles p on p.guest_id=i.guest_id and p.auth_user_id=i.auth_user_id
    join public.app_table_invitation_outbox o on o.invitation_id=i.invitation_id and o.message_kind='invitation'
    where (v_cursor_at is null or i.created_at<v_cursor_at or (i.created_at=v_cursor_at and i.invitation_id<v_cursor_id))
  ), page as (
    select *,row_number() over(order by created_at desc,invitation_id desc) rn from enriched
    order by created_at desc,invitation_id desc limit p_limit+1
  )
  select coalesce(jsonb_agg(item order by created_at desc,invitation_id desc) filter(where rn<=p_limit),'[]'::jsonb),
    case when count(*)>p_limit then (select created_at::text||'|'||invitation_id::text from page where rn=p_limit) else null end
    into v_items,v_next from page;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $function$;
revoke all on function public.list_admin_table_invitations(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_admin_table_invitations(uuid,text,integer) to service_role;

create function public.retry_failed_table_invitation_delivery(p_actor_user_id uuid,p_invitation_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_operation_id uuid; v_expected_count integer; v_hash text; v_prior public.app_table_invitation_operations%rowtype;
  v_invitation public.app_table_invitations%rowtype; v_outbox public.app_table_invitation_outbox%rowtype; v_result jsonb;
begin
  perform app_private.require_service_role();
  if jsonb_typeof(p_request)<>'object' or (select count(*) from jsonb_object_keys(p_request))<>2
    or not (p_request ? 'operationId') or not (p_request ? 'expectedAttemptCount') then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  begin v_operation_id:=(p_request->>'operationId')::uuid; v_expected_count:=(p_request->>'expectedAttemptCount')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
  if v_operation_id is null or v_expected_count is null or v_expected_count<1 then raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('invitationId',p_invitation_id,'expectedAttemptCount',v_expected_count)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_operation_id::text,0));
  perform app_private.require_table_invitation_admin(p_actor_user_id);
  select * into v_prior from public.app_table_invitation_operations x where x.operation_id=v_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'delivery.retry_failed' or v_prior.request_hash<>v_hash then
      raise exception using errcode='P0001',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  select * into v_invitation from public.app_table_invitations i where i.invitation_id=p_invitation_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_invitation.state<>'active' then raise exception using errcode='P0001',message='attempt_not_retryable'; end if;
  select * into v_outbox from public.app_table_invitation_outbox o
    where o.invitation_id=p_invitation_id and o.message_kind='invitation' for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_outbox.state='unknown' then raise exception using errcode='P0001',message='attempt_reconciliation_required'; end if;
  if v_outbox.state<>'failed' or v_outbox.attempt_count<>v_expected_count then raise exception using errcode='P0001',message='attempt_not_retryable'; end if;
  update public.app_table_invitation_outbox set state='queued',next_attempt_at=clock_timestamp(),lease_until=null,
    error_code=null,manual_retry_requested=true where outbox_id=v_outbox.outbox_id returning * into v_outbox;
  v_result:=jsonb_build_object('invitationId',p_invitation_id,'deliveryState','queued','attemptCount',v_outbox.attempt_count,
    'queuedAt',v_outbox.queued_at,'nextAttemptAt',v_outbox.next_attempt_at);
  insert into public.app_table_invitation_operations(operation_id,actor_user_id,action,request_hash,result)
    values(v_operation_id,p_actor_user_id,'delivery.retry_failed',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'app.invitation.retry_requested','table_invitation',p_invitation_id,v_operation_id,'{}'::jsonb);
  return v_result;
end $function$;
revoke all on function public.retry_failed_table_invitation_delivery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.retry_failed_table_invitation_delivery(uuid,uuid,jsonb) to service_role;

create function public.begin_table_invitation_delivery_attempt(p_outbox_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_outbox public.app_table_invitation_outbox%rowtype; v_attempt public.app_table_invitation_attempts%rowtype;
begin
  perform app_private.require_service_role();
  if p_outbox_id is null or p_operation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_attempt from public.app_table_invitation_attempts a where a.operation_id=p_operation_id;
  if found then
    if v_attempt.outbox_id<>p_outbox_id then raise exception using errcode='P0001',message='operation_conflict'; end if;
    select * into v_outbox from public.app_table_invitation_outbox o where o.outbox_id=p_outbox_id;
    return jsonb_build_object('created',false,'outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt));
  end if;
  select * into v_outbox from public.app_table_invitation_outbox o where o.outbox_id=p_outbox_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_outbox.state='unknown' then raise exception using errcode='P0001',message='attempt_reconciliation_required'; end if;
  if v_outbox.state='sending' then raise exception using errcode='P0001',message='attempt_busy'; end if;
  if v_outbox.state='failed' and v_outbox.next_attempt_at>clock_timestamp() and not v_outbox.manual_retry_requested then
    raise exception using errcode='P0001',message='attempt_busy'; end if;
  if v_outbox.state not in ('queued','failed') then raise exception using errcode='P0001',message='attempt_not_retryable'; end if;
  if v_outbox.attempt_count>=8 and not v_outbox.manual_retry_requested then raise exception using errcode='P0001',message='attempt_not_retryable'; end if;
  insert into public.app_table_invitation_attempts(outbox_id,operation_id,attempt_number,state)
    values(p_outbox_id,p_operation_id,v_outbox.attempt_count+1,'sending') returning * into v_attempt;
  update public.app_table_invitation_outbox set state='sending',attempt_count=attempt_count+1,attempted_at=clock_timestamp(),
    lease_until=clock_timestamp()+interval '5 minutes',manual_retry_requested=false,error_code=null
    where outbox_id=p_outbox_id returning * into v_outbox;
  return jsonb_build_object('created',true,'outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt));
end $function$;
revoke all on function public.begin_table_invitation_delivery_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_table_invitation_delivery_attempt(uuid,uuid) to service_role;

create function public.begin_next_table_invitation_delivery_attempt(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_outbox public.app_table_invitation_outbox%rowtype; v_attempt public.app_table_invitation_attempts%rowtype;
begin
  perform app_private.require_service_role();
  if p_operation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_attempt from public.app_table_invitation_attempts a where a.operation_id=p_operation_id;
  if found then
    select * into v_outbox from public.app_table_invitation_outbox o where o.outbox_id=v_attempt.outbox_id;
    return jsonb_build_object('created',false,'outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt));
  end if;
  select o.* into v_outbox from public.app_table_invitation_outbox o
    join public.app_table_invitations i on i.invitation_id=o.invitation_id and i.state='active'
    where o.message_kind='invitation' and o.state in ('queued','failed')
      and o.next_attempt_at<=clock_timestamp()
      and (o.attempt_count<8 or o.manual_retry_requested)
    order by o.next_attempt_at,o.queued_at,o.outbox_id
    limit 1 for update of o skip locked;
  if not found then return null; end if;
  if v_outbox.state='failed' and v_outbox.next_attempt_at>clock_timestamp() and not v_outbox.manual_retry_requested then
    raise exception using errcode='P0001',message='attempt_busy'; end if;
  insert into public.app_table_invitation_attempts(outbox_id,operation_id,attempt_number,state)
    values(v_outbox.outbox_id,p_operation_id,v_outbox.attempt_count+1,'sending') returning * into v_attempt;
  update public.app_table_invitation_outbox set state='sending',attempt_count=attempt_count+1,attempted_at=clock_timestamp(),
    lease_until=clock_timestamp()+interval '5 minutes',manual_retry_requested=false,error_code=null
    where outbox_id=v_outbox.outbox_id returning * into v_outbox;
  return jsonb_build_object('created',true,'outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt));
end $function$;
revoke all on function public.begin_next_table_invitation_delivery_attempt(uuid) from public,anon,authenticated;
grant execute on function public.begin_next_table_invitation_delivery_attempt(uuid) to service_role;

create function public.read_table_invitation_delivery_context(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb;
begin
  perform app_private.require_service_role();
  if p_invitation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select jsonb_build_object('invitationId',i.invitation_id,'state',i.state,'recipientEmail',a.email_normalized,
      'table',jsonb_build_object('tableId',q.table_id,'title',q.table_title,'localDate',q.table_local_date::text,
        'startLocalTime',to_char(q.table_start_local_time,'HH24:MI'),'neighborhood',q.table_neighborhood))
    into v_context
    from public.app_table_invitations i
    join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id
      and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
    join public.app_member_profiles p on p.guest_id=i.guest_id and p.auth_user_id=i.auth_user_id
    join public.app_admissions a on a.auth_user_id=i.auth_user_id and a.state='activated'
    join auth.users u on u.id=i.auth_user_id and u.email_confirmed_at is not null and lower(u.email)=a.email_normalized
    where i.invitation_id=p_invitation_id;
  if v_context is null then raise exception using errcode='P0002',message='not_found'; end if;
  if v_context->>'state'<>'active' then raise exception using errcode='P0001',message='attempt_not_retryable'; end if;
  return v_context;
end $function$;
revoke all on function public.read_table_invitation_delivery_context(uuid) from public,anon,authenticated;
grant execute on function public.read_table_invitation_delivery_context(uuid) to service_role;

create function public.read_unknown_table_invitation_delivery_context(p_invitation_id uuid,p_expected_attempt_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb;
begin
  perform app_private.require_service_role();
  if p_invitation_id is null or p_expected_attempt_count is null or p_expected_attempt_count<1 then
    raise exception using errcode='22023',message='invalid_input'; end if;
  select jsonb_build_object('invitationId',i.invitation_id,'state',i.state,'recipientEmail',a.email_normalized,
      'table',jsonb_build_object('title',q.table_title,'localDate',q.table_local_date::text,
        'startLocalTime',to_char(q.table_start_local_time,'HH24:MI'),'neighborhood',q.table_neighborhood),
      'attemptId',at.attempt_id,'attemptNumber',at.attempt_number,'providerMessageId',at.provider_message_id)
    into v_context
    from public.app_table_invitations i
    join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id
      and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
    join public.app_member_profiles p on p.guest_id=i.guest_id and p.auth_user_id=i.auth_user_id
    join public.app_admissions a on a.auth_user_id=i.auth_user_id and a.state='activated'
    join auth.users u on u.id=i.auth_user_id and u.email_confirmed_at is not null and lower(u.email)=a.email_normalized
    join public.app_table_invitation_outbox o on o.invitation_id=i.invitation_id and o.message_kind='invitation' and o.state='unknown'
    join public.app_table_invitation_attempts at on at.outbox_id=o.outbox_id and at.attempt_number=o.attempt_count and at.state='unknown'
    where i.invitation_id=p_invitation_id and at.attempt_number=p_expected_attempt_count;
  if v_context is null then raise exception using errcode='P0001',message='attempt_not_unknown'; end if;
  return v_context;
end $function$;
revoke all on function public.read_unknown_table_invitation_delivery_context(uuid,integer) from public,anon,authenticated;
grant execute on function public.read_unknown_table_invitation_delivery_context(uuid,integer) to service_role;

create function public.finish_table_invitation_delivery_attempt(p_attempt_id uuid,p_state text,p_provider_message_id text default null,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_outbox_id uuid; v_outbox public.app_table_invitation_outbox%rowtype; v_attempt public.app_table_invitation_attempts%rowtype;
  v_delay interval; v_action text;
begin
  perform app_private.require_service_role();
  if p_attempt_id is null or p_state not in ('accepted','delivered','failed','unknown')
    or (p_provider_message_id is not null and (length(p_provider_message_id)>200 or p_provider_message_id ~ '[[:cntrl:]]'))
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_.-]{1,100}$') then raise exception using errcode='22023',message='invalid_input'; end if;
  select a.outbox_id into v_outbox_id from public.app_table_invitation_attempts a where a.attempt_id=p_attempt_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_outbox from public.app_table_invitation_outbox o where o.outbox_id=v_outbox_id for update;
  select * into v_attempt from public.app_table_invitation_attempts a where a.attempt_id=p_attempt_id for update;
  if v_attempt.state<>'sending' then
    if v_attempt.state=p_state and v_attempt.provider_message_id is not distinct from p_provider_message_id
      and v_attempt.error_code is not distinct from p_error_code then
      return jsonb_build_object('outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt),'changed',false); end if;
    raise exception using errcode='P0001',message='attempt_already_finished';
  end if;
  update public.app_table_invitation_attempts set state=p_state,provider_message_id=p_provider_message_id,error_code=p_error_code,finished_at=clock_timestamp()
    where attempt_id=p_attempt_id returning * into v_attempt;
  v_delay:=case when v_attempt.attempt_number=1 then interval '1 minute' when v_attempt.attempt_number=2 then interval '5 minutes'
    when v_attempt.attempt_number=3 then interval '15 minutes' else interval '60 minutes' end;
  update public.app_table_invitation_outbox set state=p_state,lease_until=null,provider_message_id=p_provider_message_id,error_code=p_error_code,
    accepted_at=case when p_state in ('accepted','delivered') then clock_timestamp() else null end,
    delivered_at=case when p_state='delivered' then clock_timestamp() else null end,
    next_attempt_at=case when p_state='failed' then clock_timestamp()+v_delay else next_attempt_at end
    where outbox_id=v_outbox_id returning * into v_outbox;
  v_action:=case when p_state='accepted' then 'app.invitation.accepted' when p_state='delivered' then 'app.invitation.delivered'
    when p_state='unknown' then 'app.invitation.unknown' else 'app.invitation.failed' end;
  insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,operation_id,metadata)
    values('system','table_invitation_worker',v_action,'delivery_attempt',v_attempt.attempt_id,v_attempt.operation_id,
      jsonb_build_object('attempt_number',v_attempt.attempt_number,'to_state',p_state));
  return jsonb_build_object('outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt),'changed',true);
end $function$;
revoke all on function public.finish_table_invitation_delivery_attempt(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_table_invitation_delivery_attempt(uuid,text,text,text) to service_role;

create function public.mark_table_invitation_delivery_delivered(p_attempt_id uuid,p_provider_message_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_outbox_id uuid; v_outbox public.app_table_invitation_outbox%rowtype; v_attempt public.app_table_invitation_attempts%rowtype;
begin
  perform app_private.require_service_role();
  if p_attempt_id is null or p_provider_message_id is null or length(p_provider_message_id)>200
    or p_provider_message_id ~ '[[:cntrl:]]' then raise exception using errcode='22023',message='invalid_input'; end if;
  select a.outbox_id into v_outbox_id from public.app_table_invitation_attempts a where a.attempt_id=p_attempt_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_outbox from public.app_table_invitation_outbox o where o.outbox_id=v_outbox_id for update;
  select * into v_attempt from public.app_table_invitation_attempts a where a.attempt_id=p_attempt_id for update;
  if v_attempt.state='delivered' and v_outbox.state='delivered'
    and v_attempt.provider_message_id=p_provider_message_id and v_outbox.provider_message_id=p_provider_message_id then
    return jsonb_build_object('outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt),'changed',false);
  end if;
  if v_attempt.state<>'accepted' or v_outbox.state<>'accepted' or v_attempt.attempt_number<>v_outbox.attempt_count
    or (v_attempt.provider_message_id is not null and v_attempt.provider_message_id<>p_provider_message_id)
    or (v_outbox.provider_message_id is not null and v_outbox.provider_message_id<>p_provider_message_id) then
    raise exception using errcode='P0001',message='attempt_not_accepted';
  end if;
  update public.app_table_invitation_attempts set state='delivered',provider_message_id=p_provider_message_id
    where attempt_id=p_attempt_id returning * into v_attempt;
  update public.app_table_invitation_outbox set state='delivered',provider_message_id=p_provider_message_id,delivered_at=clock_timestamp()
    where outbox_id=v_outbox_id returning * into v_outbox;
  insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,operation_id,metadata)
    values('system','table_invitation_worker','app.invitation.delivered','delivery_attempt',v_attempt.attempt_id,v_attempt.operation_id,
      jsonb_build_object('attempt_number',v_attempt.attempt_number,'to_state','delivered'));
  return jsonb_build_object('outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt),'changed',true);
end $function$;
revoke all on function public.mark_table_invitation_delivery_delivered(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_table_invitation_delivery_delivered(uuid,text) to service_role;

create function public.expire_table_invitation_delivery_leases()
returns integer language plpgsql security definer set search_path = '' as $function$
declare v_outbox public.app_table_invitation_outbox%rowtype; v_attempt public.app_table_invitation_attempts%rowtype; v_count integer:=0;
begin
  perform app_private.require_service_role();
  for v_outbox in select * from public.app_table_invitation_outbox o where o.state='sending' and o.lease_until<=clock_timestamp()
    order by o.lease_until,o.outbox_id for update skip locked loop
    select * into v_attempt from public.app_table_invitation_attempts a where a.outbox_id=v_outbox.outbox_id and a.state='sending'
      order by a.attempt_number desc limit 1 for update;
    if found then
      update public.app_table_invitation_attempts set state='unknown',error_code='worker_lease_expired',finished_at=clock_timestamp()
        where attempt_id=v_attempt.attempt_id returning * into v_attempt;
      update public.app_table_invitation_outbox set state='unknown',lease_until=null,error_code='worker_lease_expired'
        where outbox_id=v_outbox.outbox_id;
      insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,operation_id,metadata)
        values('system','table_invitation_worker','app.invitation.unknown','delivery_attempt',v_attempt.attempt_id,v_attempt.operation_id,
          jsonb_build_object('attempt_number',v_attempt.attempt_number,'to_state','unknown'));
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end $function$;
revoke all on function public.expire_table_invitation_delivery_leases() from public,anon,authenticated;
grant execute on function public.expire_table_invitation_delivery_leases() to service_role;

create function public.reconcile_unknown_table_invitation_attempt(p_attempt_id uuid,p_state text,p_provider_message_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_outbox_id uuid; v_outbox public.app_table_invitation_outbox%rowtype; v_attempt public.app_table_invitation_attempts%rowtype; v_delay interval;
begin
  perform app_private.require_service_role();
  if p_attempt_id is null or p_state not in ('accepted','delivered','failed')
    or (p_provider_message_id is not null and (length(p_provider_message_id)>200 or p_provider_message_id ~ '[[:cntrl:]]')) then raise exception using errcode='22023',message='invalid_input'; end if;
  select a.outbox_id into v_outbox_id from public.app_table_invitation_attempts a where a.attempt_id=p_attempt_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_outbox from public.app_table_invitation_outbox o where o.outbox_id=v_outbox_id for update;
  select * into v_attempt from public.app_table_invitation_attempts a where a.attempt_id=p_attempt_id for update;
  if v_attempt.state=p_state and v_outbox.state=p_state and v_attempt.provider_message_id is not distinct from p_provider_message_id then
    return jsonb_build_object('outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt),'changed',false); end if;
  if v_attempt.state<>'unknown' or v_outbox.state<>'unknown' or v_attempt.attempt_number<>v_outbox.attempt_count then
    raise exception using errcode='P0001',message='attempt_not_unknown'; end if;
  update public.app_table_invitation_attempts set state=p_state,provider_message_id=p_provider_message_id,error_code=null,finished_at=clock_timestamp()
    where attempt_id=p_attempt_id returning * into v_attempt;
  v_delay:=case when v_attempt.attempt_number=1 then interval '1 minute' when v_attempt.attempt_number=2 then interval '5 minutes'
    when v_attempt.attempt_number=3 then interval '15 minutes' else interval '60 minutes' end;
  update public.app_table_invitation_outbox set state=p_state,provider_message_id=p_provider_message_id,error_code=null,
    lease_until=null,accepted_at=case when p_state in ('accepted','delivered') then clock_timestamp() else null end,
    delivered_at=case when p_state='delivered' then clock_timestamp() else null end,
    next_attempt_at=case when p_state='failed' then clock_timestamp()+v_delay else next_attempt_at end
    where outbox_id=v_outbox_id returning * into v_outbox;
  insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,operation_id,metadata)
    values('system','table_invitation_worker',case when p_state='accepted' then 'app.invitation.accepted'
      when p_state='delivered' then 'app.invitation.delivered' else 'app.invitation.failed' end,
      'delivery_attempt',v_attempt.attempt_id,v_attempt.operation_id,jsonb_build_object('attempt_number',v_attempt.attempt_number,'to_state',p_state));
  return jsonb_build_object('outbox',to_jsonb(v_outbox),'attempt',to_jsonb(v_attempt),'changed',true);
end $function$;
revoke all on function public.reconcile_unknown_table_invitation_attempt(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_unknown_table_invitation_attempt(uuid,text,text) to service_role;

comment on table public.app_table_invitation_attempts is 'Private attempt history for Table-invitation and reminder outbox messages; an uncertain attempt may be resolved once through reconciliation.';
comment on table public.app_table_invitation_operations is 'Admin delivery-retry operation replay ledger; never creates an invitation or sends email inline.';
