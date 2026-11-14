-- W07.4 owner cancellation requests and admin review. Draft only: do not apply
-- before coordinator review and isolated DB acceptance.

alter table public.app_seat_cancellation_requests
  add column member_reason text check (member_reason is null or length(member_reason) between 1 and 2000),
  add column version integer not null default 1 check (version > 0),
  add column refund_cents integer check (refund_cents is null or refund_cents between 0 and 2500),
  add column decided_by uuid references auth.users(id) on delete restrict,
  add constraint app_seat_cancellation_requests_decision_consistency check (
    (state='pending' and version=1 and decided_at is null and decided_by is null and guest_safe_reason is null and refund_cents is null)
    or (state in ('approved','denied') and version=2 and decided_at is not null and decided_by is not null
      and guest_safe_reason is not null and refund_cents is not null)
  );

alter table public.app_refund_obligations drop constraint app_refund_obligations_source_check;
alter table public.app_refund_obligations add constraint app_refund_obligations_source_check
  check (source in ('late_checkout_ineligible','cancellation'));
alter table public.app_refund_obligations drop constraint app_refund_obligations_amount_cents_check;
alter table public.app_refund_obligations add constraint app_refund_obligations_amount_cents_check
  check (amount_cents between 1 and 2500);

create table public.app_seat_cancellation_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('member_request','admin_decision')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{32}$'),
  cancellation_request_id uuid not null references public.app_seat_cancellation_requests(cancellation_request_id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

create table public.app_seat_cancellation_notice_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  cancellation_request_id uuid not null references public.app_seat_cancellation_requests(cancellation_request_id) on delete restrict,
  notice_kind text not null check (notice_kind='decision'),
  state text not null default 'queued' check (state in ('queued','sending','accepted','delivered','failed','unknown')),
  created_at timestamptz not null default now(),
  unique(cancellation_request_id,notice_kind)
);

alter table public.app_seat_cancellation_operations enable row level security;
alter table public.app_seat_cancellation_notice_outbox enable row level security;
revoke all on public.app_seat_cancellation_requests,public.app_seat_cancellation_operations,
  public.app_seat_cancellation_notice_outbox from public,anon,authenticated,service_role;
grant select,insert,update on public.app_seat_cancellation_requests to service_role;
grant select,insert on public.app_seat_cancellation_operations,public.app_seat_cancellation_notice_outbox to service_role;

create or replace function app_private.is_safe_audit_metadata(p_metadata jsonb)
returns boolean language sql immutable strict set search_path = ''
as $function$
  select jsonb_typeof(p_metadata)='object'
    and (select count(*) from jsonb_object_keys(p_metadata))<=7
    and not exists(select 1 from jsonb_each(p_metadata) as entry(key,value) where case
      when entry.key in ('state','from_state','to_state') then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' in ('invited','activated','deleted','queued','sending','accepted','delivered','failed','unknown',
          'confirmed','cancellation_requested','cancelled','completed','pending','approved','denied')
      when entry.key='reason_code' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' in ('validation_failed','unauthenticated','forbidden','not_found','rate_limited','conflict',
          'invalid_link','provider_rejected','provider_outcome_unknown','temporarily_unavailable','duplicate_request','honeypot_ignored')
      when entry.key='attempt_number' then jsonb_typeof(entry.value)='number' and entry.value #>> '{}' ~ '^[0-9]{1,3}$'
      when entry.key='retryable' then jsonb_typeof(entry.value)='boolean'
      when entry.key='guest_id' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      when entry.key='critical_identity_version' then jsonb_typeof(entry.value)='number' and entry.value #>> '{}' ~ '^[0-9]{1,9}$'
      when entry.key='decision' then jsonb_typeof(entry.value)='string' and entry.value #>> '{}' in ('approved','resubmission_required','denied')
      when entry.key='refund_cents' then jsonb_typeof(entry.value)='number' and entry.value #>> '{}' ~ '^(0|[1-9][0-9]{0,3})$'
        and (entry.value #>> '{}')::integer between 0 and 2500
      when entry.key='tableId' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      when entry.key='holdUntil' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      when entry.key='mode' then jsonb_typeof(entry.value)='string' and entry.value #>> '{}' in ('test','live')
      when entry.key='code' then jsonb_typeof(entry.value)='string' and entry.value #>> '{}' in ('session_expiry_too_soon','provider_rejected')
      else false end is not true);
$function$;
revoke all on function app_private.is_safe_audit_metadata(jsonb) from public,anon,authenticated;
grant execute on function app_private.is_safe_audit_metadata(jsonb) to service_role;

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check (action in (
  'waitlist.signup.created','app.admission.invited','app.admission.activated','app.admission.deleted',
  'app.invitation.queued','app.invitation.accepted','app.invitation.delivered','app.invitation.failed',
  'app.invitation.unknown','app.invitation.retry_requested','member_link.requested','auth.callback.rejected',
  'authorization.denied','identity.evidence.read','identity.review.decided',
  'supply.sync.started','supply.sync.finished','supply.sync.missing_detected','supply.sync.missing_resolved',
  'supply.draft.created','supply.draft.updated','supply.draft.accepted','supply.draft.published',
  'supply.weekly_clone.started','supply.weekly_clone.item_created','supply.weekly_clone.item_unknown','supply.weekly_clone.item_conflict',
  'supply.weekly_clone.reconciled','supply.weekly_clone.undo_started','supply.weekly_clone.item_undone',
  'supply.weekly_clone.undo_unknown','supply.weekly_clone.undo_refused',
  'table.request.created','table.request.withdrawn','table.roster.proposed','table.roster.submitted',
  'table.roster.approved','table.invitation.queued','checkout.hold.created','checkout.session.created','checkout.session.unknown',
  'checkout.hold.released','checkout.hold.expired','checkout.payment.fulfilled','checkout.refund.obligation.created',
  'seat.cancellation.requested','seat.cancellation.approved','seat.cancellation.denied'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup','app_admission','invitation_delivery','delivery_attempt','auth_identity','member_link_request',
  'profile_file','identity_review','supply_sync_run','supply_table','supply_table_revision','supply_weekly_clone_operation',
  'supply_weekly_clone_item','table_request','table_roster_proposal','table_invitation','checkout_attempt','payment','seat',
  'stripe_event','refund_obligation','seat_cancellation_request'
));

create function app_private.cancellation_request_dto(p_request public.app_seat_cancellation_requests)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select jsonb_build_object('requestId',p_request.cancellation_request_id,'seatId',p_request.seat_id,
    'state',p_request.state,'version',p_request.version,'requestedAt',p_request.requested_at,
    'decidedAt',p_request.decided_at,'memberReason',p_request.member_reason,
    'memberSafeReason',p_request.guest_safe_reason,'refundCents',p_request.refund_cents)
$function$;

create function app_private.require_cancellation_member(p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  perform app_private.require_service_role();
  if p_actor is null or not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null)
    or not exists(select 1 from public.app_admissions a where a.auth_user_id=p_actor and a.state='activated' and a.deleted_at is null)
    or not exists(select 1 from public.app_member_profiles m where m.auth_user_id=p_actor) then
    raise exception using errcode='42501',message='member_not_admitted';
  end if;
end
$function$;

create function app_private.require_cancellation_admin(p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  perform app_private.require_service_role();
  if p_actor is null or not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null)
    or not exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role='admin') then
    raise exception using errcode='42501',message='admin_required';
  end if;
end
$function$;

create function public.read_my_seat_cancellation_requests(p_actor uuid,p_seat_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_seat public.app_seats%rowtype; v_invitation public.app_table_invitations%rowtype; v_runtime public.app_table_runtime%rowtype;
  v_payment public.app_payments%rowtype; v_reason text; v_items jsonb;
begin
  perform app_private.require_cancellation_member(p_actor);
  select s.* into v_seat from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id
    where s.seat_id=p_seat_id and i.auth_user_id=p_actor;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_invitation from public.app_table_invitations where invitation_id=v_seat.invitation_id;
  select * into v_runtime from public.app_table_runtime where table_id=v_seat.table_id;
  select * into v_payment from public.app_payments where payment_id=v_seat.payment_id;
  if exists(select 1 from public.app_seat_cancellation_requests cr where cr.seat_id=p_seat_id and cr.state='pending') then v_reason:='request_pending';
  elsif v_runtime.state in ('completed','cancelled') then v_reason:='table_closed';
  elsif v_seat.state<>'confirmed' then v_reason:='seat_not_active';
  elsif v_payment.state<>'verified_paid' then v_reason:='payment_unresolved';
  else v_reason:='available'; end if;
  select coalesce(jsonb_agg(app_private.cancellation_request_dto(cr) order by cr.requested_at desc,cr.cancellation_request_id desc),'[]'::jsonb)
    into v_items from public.app_seat_cancellation_requests cr where cr.seat_id=p_seat_id;
  return jsonb_build_object('seatState',case when v_runtime.state='completed' then 'completed'
      when v_runtime.state='cancelled' then 'cancelled' else v_seat.state end,
    'items',v_items,'nextCursor',null,
    'requestAvailability',jsonb_build_object('canRequest',v_reason='available','reason',v_reason));
end
$function$;

create function public.request_seat_cancellation(p_actor uuid,p_seat_id uuid,p_operation_id uuid,p_member_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_seat public.app_seats%rowtype; v_invitation public.app_table_invitations%rowtype; v_request public.app_seat_cancellation_requests%rowtype;
  v_runtime public.app_table_runtime%rowtype; v_payment public.app_payments%rowtype; v_head public.app_supply_table_heads%rowtype;
  v_profile public.app_member_profiles%rowtype; v_admission public.app_admissions%rowtype;
  v_prior public.app_seat_cancellation_operations%rowtype; v_result jsonb; v_hash text;
begin
  perform app_private.require_cancellation_member(p_actor);
  if p_seat_id is null or p_operation_id is null or (p_member_reason is not null and length(btrim(p_member_reason)) not between 1 and 2000) then
    raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('seatId',p_seat_id,'memberReason',nullif(btrim(p_member_reason),''))::text);
  perform pg_advisory_xact_lock(hashtextextended('seat-cancellation:'||p_operation_id::text,0));
  select * into v_prior from public.app_seat_cancellation_operations where operation_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.action<>'member_request' or v_prior.request_hash<>v_hash then
      raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  select s.* into v_seat from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id
    where s.seat_id=p_seat_id and i.auth_user_id=p_actor;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_head from public.app_supply_table_heads where table_id=v_seat.table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select m.* into v_profile from public.app_member_profiles m where m.auth_user_id=p_actor and m.guest_id=v_seat.guest_id for share;
  if not found then raise exception using errcode='42501',message='member_not_admitted'; end if;
  select a.* into v_admission from public.app_admissions a where a.auth_user_id=p_actor and a.state='activated' and a.deleted_at is null for share;
  if not found then raise exception using errcode='42501',message='member_not_admitted'; end if;
  select * into v_invitation from public.app_table_invitations where invitation_id=v_seat.invitation_id for update;
  select * into v_request from public.app_seat_cancellation_requests where seat_id=p_seat_id and state='pending' for update;
  select * into v_seat from public.app_seats where seat_id=p_seat_id for update;
  select * into v_payment from public.app_payments where payment_id=v_seat.payment_id for update;
  select * into v_runtime from public.app_table_runtime where table_id=v_seat.table_id;
  if v_request.cancellation_request_id is not null then raise exception using errcode='P0001',message='request_pending'; end if;
  if v_runtime.state in ('completed','cancelled') then raise exception using errcode='P0001',message='seat_not_cancellable'; end if;
  if v_seat.state<>'confirmed' then raise exception using errcode='P0001',message='seat_not_cancellable'; end if;
  if v_payment.state<>'verified_paid' then raise exception using errcode='P0001',message='seat_not_cancellable'; end if;
  insert into public.app_seat_cancellation_requests(seat_id,state,member_reason) values(p_seat_id,'pending',nullif(btrim(p_member_reason),'')) returning * into v_request;
  update public.app_seats set state='cancellation_requested' where seat_id=p_seat_id;
  v_result:=app_private.cancellation_request_dto(v_request);
  insert into public.app_seat_cancellation_operations(operation_id,actor_user_id,action,request_hash,cancellation_request_id,result)
    values(p_operation_id,p_actor,'member_request',v_hash,v_request.cancellation_request_id,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,'seat.cancellation.requested','seat_cancellation_request',v_request.cancellation_request_id,p_operation_id,
      jsonb_build_object('from_state','confirmed','to_state','cancellation_requested'));
  return v_result;
end
$function$;

create function app_private.admin_cancellation_dto(p_request_id uuid,p_detail boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb; v_refund_committed integer; v_refund_available integer; v_paid_cents integer;
begin
  select p.amount_cents,coalesce(sum(o.amount_cents),0)::integer into v_paid_cents,v_refund_committed
  from public.app_seat_cancellation_requests cr join public.app_seats s on s.seat_id=cr.seat_id
  join public.app_payments p on p.payment_id=s.payment_id left join public.app_refund_obligations o on o.payment_id=p.payment_id
  where cr.cancellation_request_id=p_request_id group by p.amount_cents;
  if v_paid_cents is null then raise exception using errcode='P0002',message='not_found'; end if;
  v_refund_available:=v_paid_cents-v_refund_committed;
  select jsonb_build_object('request',app_private.cancellation_request_dto(cr),
    'member',jsonb_build_object('guestId',m.guest_id,'displayName',btrim(m.first_name||' '||m.last_name)),
    'table',jsonb_build_object('tableId',h.table_id,'title',r.content->>'title','localDate',r.content->>'localDate','startLocalTime',r.content->>'startLocalTime'),
    'seat',jsonb_build_object('seatId',s.seat_id,'state',case when rt.state='completed' then 'completed'
      when rt.state='cancelled' then 'cancelled' else s.state end,'paidAt',p.verified_at,
      'amountCents',p.amount_cents,'refundAvailableCents',v_refund_available))
    into v_result
  from public.app_seat_cancellation_requests cr join public.app_seats s on s.seat_id=cr.seat_id
    join public.app_table_invitations i on i.invitation_id=s.invitation_id join public.app_member_profiles m on m.guest_id=i.guest_id
    join public.app_payments p on p.payment_id=s.payment_id join public.app_table_runtime rt on rt.table_id=s.table_id
    join public.app_table_roster_proposals rp on rp.proposal_id=i.proposal_id
    join public.app_supply_table_revisions r on r.revision_id=rp.supply_revision_id
  where cr.cancellation_request_id=p_request_id;
  if v_result is null then raise exception using errcode='P0002',message='not_found'; end if;
  if p_detail then v_result:=v_result||jsonb_build_object('refundBalance',jsonb_build_object('paidCents',v_paid_cents,
    'refundCommittedCents',v_refund_committed,'refundAvailableCents',v_refund_available)); end if;
  return v_result;
end
$function$;

create function public.list_admin_seat_cancellations(p_actor uuid,p_cursor_requested_at timestamptz,p_cursor_request_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb; v_more boolean;
begin
  perform app_private.require_cancellation_admin(p_actor);
  if p_limit is null or p_limit not between 1 and 50 or ((p_cursor_requested_at is null)<>(p_cursor_request_id is null)) then
    raise exception using errcode='22023',message='invalid_input'; end if;
  with page as (
    select cr.requested_at,cr.cancellation_request_id request_id,
      app_private.admin_cancellation_dto(cr.cancellation_request_id,false) item,
      row_number() over(order by cr.requested_at desc,cr.cancellation_request_id desc) as n
    from public.app_seat_cancellation_requests cr where cr.state='pending'
      and (p_cursor_requested_at is null or (cr.requested_at,cr.cancellation_request_id)<(p_cursor_requested_at,p_cursor_request_id))
    order by cr.requested_at desc,cr.cancellation_request_id desc limit p_limit+1
  ) select coalesce(jsonb_agg(item order by requested_at desc,request_id desc) filter(where n<=p_limit),'[]'::jsonb),
      coalesce(bool_or(n>p_limit),false) into v_items,v_more from page;
  return jsonb_build_object('items',v_items,'nextCursor',case when v_more then 'more' else null end);
end
$function$;

create function public.read_admin_seat_cancellation(p_actor uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_cancellation_admin(p_actor);
  if p_request_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  return app_private.admin_cancellation_dto(p_request_id,true);
end
$function$;

create function public.decide_seat_cancellation(p_actor uuid,p_request_id uuid,p_operation_id uuid,p_expected_version integer,
  p_decision text,p_refund_cents integer,p_member_safe_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_request public.app_seat_cancellation_requests%rowtype; v_seat public.app_seats%rowtype; v_payment public.app_payments%rowtype;
  v_invitation public.app_table_invitations%rowtype; v_head public.app_supply_table_heads%rowtype; v_runtime public.app_table_runtime%rowtype;
  v_profile public.app_member_profiles%rowtype; v_admin_role public.app_user_roles%rowtype; v_prior public.app_seat_cancellation_operations%rowtype;
  v_hash text; v_result jsonb; v_available integer; v_committed integer; v_paid_cents integer;
begin
  perform app_private.require_cancellation_admin(p_actor);
  if p_request_id is null or p_operation_id is null or p_expected_version is null or p_decision not in ('approve','deny')
    or p_refund_cents is null or p_refund_cents not between 0 and 2500 or (p_decision='deny' and p_refund_cents<>0)
    or p_member_safe_reason is null or length(btrim(p_member_safe_reason)) not between 1 and 500 then
    raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('requestId',p_request_id,'expectedVersion',p_expected_version,'decision',p_decision,
    'refundCents',p_refund_cents,'memberSafeReason',btrim(p_member_safe_reason))::text);
  perform pg_advisory_xact_lock(hashtextextended('seat-cancellation:'||p_operation_id::text,0));
  select * into v_prior from public.app_seat_cancellation_operations where operation_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.action<>'admin_decision' or v_prior.request_hash<>v_hash then
      raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  select cr.* into v_request from public.app_seat_cancellation_requests cr where cr.cancellation_request_id=p_request_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select s.* into v_seat from public.app_seats s where s.seat_id=v_request.seat_id;
  select * into v_head from public.app_supply_table_heads where table_id=v_seat.table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select r.* into v_admin_role from public.app_user_roles r where r.user_id=p_actor and r.role='admin' for share;
  if not found then raise exception using errcode='42501',message='admin_required'; end if;
  select m.* into v_profile from public.app_member_profiles m where m.guest_id=v_seat.guest_id for share;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_invitation from public.app_table_invitations where invitation_id=v_seat.invitation_id for update;
  select * into v_request from public.app_seat_cancellation_requests where cancellation_request_id=p_request_id for update;
  select * into v_seat from public.app_seats where seat_id=v_request.seat_id for update;
  select * into v_payment from public.app_payments where payment_id=v_seat.payment_id for update;
  perform 1 from public.app_refund_obligations where payment_id=v_payment.payment_id order by obligation_id for update;
  if v_request.state<>'pending' then raise exception using errcode='P0001',message='decision_finalized'; end if;
  if v_request.version<>p_expected_version then raise exception using errcode='P0001',message='stale_version'; end if;
  if v_seat.state<>'cancellation_requested' then raise exception using errcode='P0001',message='seat_not_cancellable'; end if;
  if v_payment.state not in ('verified_paid','refund_pending') then raise exception using errcode='P0001',message='seat_not_cancellable'; end if;
  v_paid_cents:=v_payment.amount_cents;
  select coalesce(sum(amount_cents),0)::integer into v_committed
    from public.app_refund_obligations where payment_id=v_payment.payment_id;
  v_available:=v_paid_cents-v_committed;
  if p_refund_cents>v_available then raise exception using errcode='P0001',message='refund_amount_exceeds_balance'; end if;
  select * into v_runtime from public.app_table_runtime where table_id=v_seat.table_id;
  update public.app_seat_cancellation_requests set state=case p_decision when 'approve' then 'approved' else 'denied' end,
    version=2,decided_at=clock_timestamp(),decided_by=p_actor,guest_safe_reason=btrim(p_member_safe_reason),refund_cents=p_refund_cents
    where cancellation_request_id=p_request_id returning * into v_request;
  if p_decision='approve' then
    update public.app_seats set state='cancelled',cancelled_at=clock_timestamp() where seat_id=v_seat.seat_id;
    update public.app_table_invitations set state='revoked',revoked_at=clock_timestamp() where invitation_id=v_invitation.invitation_id and state='active';
    if p_refund_cents>0 then
      insert into public.app_refund_obligations(payment_id,source,amount_cents,currency,state)
      values(v_payment.payment_id,'cancellation',p_refund_cents,'USD','open');
      update public.app_payments set state='refund_pending' where payment_id=v_payment.payment_id;
    end if;
  else
    update public.app_seats set state=case when v_runtime.state='completed' then 'completed' when v_runtime.state='cancelled' then 'cancelled' else 'confirmed' end,
      cancelled_at=case when v_runtime.state='cancelled' then coalesce(cancelled_at,clock_timestamp()) else null end
      where seat_id=v_seat.seat_id;
  end if;
  insert into public.app_seat_cancellation_notice_outbox(cancellation_request_id,notice_kind,state) values(p_request_id,'decision','queued')
    on conflict(cancellation_request_id,notice_kind) do nothing;
  v_result:=app_private.admin_cancellation_dto(p_request_id,true);
  insert into public.app_seat_cancellation_operations(operation_id,actor_user_id,action,request_hash,cancellation_request_id,result)
    values(p_operation_id,p_actor,'admin_decision',v_hash,p_request_id,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,case p_decision when 'approve' then 'seat.cancellation.approved' else 'seat.cancellation.denied' end,
      'seat_cancellation_request',p_request_id,p_operation_id,jsonb_build_object('decision',case p_decision when 'approve' then 'approved' else 'denied' end,
      'refund_cents',p_refund_cents,'from_state','cancellation_requested','to_state',case p_decision when 'approve' then 'cancelled' else 'confirmed' end));
  return v_result;
end
$function$;

revoke all on function app_private.cancellation_request_dto(public.app_seat_cancellation_requests) from public,anon,authenticated,service_role;
revoke all on function app_private.require_cancellation_member(uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.require_cancellation_admin(uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.admin_cancellation_dto(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.read_my_seat_cancellation_requests(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.request_seat_cancellation(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.list_admin_seat_cancellations(uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.read_admin_seat_cancellation(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.decide_seat_cancellation(uuid,uuid,uuid,integer,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.read_my_seat_cancellation_requests(uuid,uuid) to service_role;
grant execute on function public.request_seat_cancellation(uuid,uuid,uuid,text) to service_role;
grant execute on function public.list_admin_seat_cancellations(uuid,timestamptz,uuid,integer) to service_role;
grant execute on function public.read_admin_seat_cancellation(uuid,uuid) to service_role;
grant execute on function public.decide_seat_cancellation(uuid,uuid,uuid,integer,text,integer,text) to service_role;

comment on table public.app_seat_cancellation_operations is 'Idempotency results for W07.4 cancellation request and admin decision mutations.';
comment on table public.app_seat_cancellation_notice_outbox is 'Durable decision notification intents; W07.4 queues but does not send these notices.';
