-- W07.2: durable Stripe event ingress and one idempotent paid-Seat fulfillment.
-- Additive draft. Do not apply without coordinator migration review.

create table public.app_stripe_checkout_events (
  event_id text not null check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  provider_mode text not null check (provider_mode in ('test','live')),
  provider_account_id text not null default '' check (length(provider_account_id) <= 255),
  event_type text not null check (event_type in (
    'checkout.session.completed','checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed','checkout.session.expired'
  )),
  session_id text not null check (session_id ~ '^cs_(test_|live_)[A-Za-z0-9]+$'),
  event_created_at timestamptz not null,
  signature_verified boolean not null default true check (signature_verified),
  state text not null default 'received' check (state in ('received','processing','processed','ignored','retryable')),
  result_code text check (result_code is null or result_code in ('paid_fulfilled','late_refund','not_paid','payment_failed','ignored_event','payment_truth_invalid')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider_mode, provider_account_id, event_id)
);
create index app_stripe_checkout_events_recovery_idx
  on public.app_stripe_checkout_events(state,updated_at) where state in ('received','processing','retryable');

create table public.app_refund_obligations (
  obligation_id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.app_payments(payment_id) on delete restrict,
  source text not null check (source in ('late_checkout_ineligible')),
  amount_cents integer not null check (amount_cents = 2500),
  currency text not null default 'USD' check (currency = 'USD'),
  state text not null default 'open' check (state in ('open','pending','submitted','unknown','failed','succeeded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_id,source)
);
create index app_refund_obligations_open_idx on public.app_refund_obligations(state,created_at) where state <> 'succeeded';

alter table public.app_stripe_checkout_events enable row level security;
alter table public.app_refund_obligations enable row level security;
revoke all on public.app_stripe_checkout_events,public.app_refund_obligations from public,anon,authenticated,service_role;
grant select,insert,update on public.app_stripe_checkout_events to service_role;
grant select,insert,update on public.app_refund_obligations to service_role;

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
  'table.roster.approved','table.invitation.queued','checkout.hold.created','checkout.session.created',
  'checkout.session.unknown','checkout.hold.released','checkout.hold.expired','checkout.payment.fulfilled','checkout.refund.obligation.created'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup','app_admission','invitation_delivery','delivery_attempt','auth_identity','member_link_request',
  'profile_file','identity_review','supply_sync_run','supply_table','supply_table_revision',
  'supply_weekly_clone_operation','supply_weekly_clone_item','table_request','table_roster_proposal',
  'table_invitation','checkout_attempt','payment','seat','stripe_event','refund_obligation'
));
alter table public.app_audit_events drop constraint app_audit_events_system_actor_check;
alter table public.app_audit_events add constraint app_audit_events_system_actor_check check (system_actor is null or system_actor in (
  'auth_callback','email_delivery_worker','retention_worker','supply_sync_worker','stripe_webhook_worker','checkout_fulfillment_worker'
));

create function public.persist_stripe_checkout_event(
  p_event_id text,p_event_type text,p_provider_mode text,p_provider_account_id text,p_event_created_at timestamptz,p_session_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_event public.app_stripe_checkout_events%rowtype;
begin
  perform app_private.require_service_role();
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9]+$' or p_event_type not in (
    'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'
  ) or p_provider_mode not in ('test','live') or p_provider_account_id is null or length(p_provider_account_id)>255
    or p_event_created_at is null or p_session_id is null or p_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$' then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  insert into public.app_stripe_checkout_events(event_id,provider_mode,provider_account_id,event_type,event_created_at,session_id)
  values(p_event_id,p_provider_mode,p_provider_account_id,p_event_type,p_event_created_at,p_session_id)
  on conflict(provider_mode,provider_account_id,event_id) do nothing;
  select * into v_event from public.app_stripe_checkout_events
    where provider_mode=p_provider_mode and provider_account_id=p_provider_account_id and event_id=p_event_id;
  if v_event.event_type<>p_event_type or v_event.session_id<>p_session_id then
    raise exception using errcode='P0001',message='event_conflict';
  end if;
  return jsonb_build_object('eventId',v_event.event_id,'state',v_event.state,'resultCode',v_event.result_code);
end $function$;
revoke all on function public.persist_stripe_checkout_event(text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.persist_stripe_checkout_event(text,text,text,text,timestamptz,text) to service_role;

create function public.mark_stripe_checkout_event_result(
  p_event_id text,p_provider_mode text,p_provider_account_id text,p_state text,p_safe_code text
) returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  if p_state not in ('processed','ignored','retryable') or (p_safe_code is not null and p_safe_code not in ('paid_fulfilled','late_refund','not_paid','payment_failed','ignored_event','payment_truth_invalid')) then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  update public.app_stripe_checkout_events set state=p_state,result_code=p_safe_code,
    attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
    where event_id=p_event_id and provider_mode=p_provider_mode and provider_account_id=p_provider_account_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
end $function$;
revoke all on function public.mark_stripe_checkout_event_result(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mark_stripe_checkout_event_result(text,text,text,text,text) to service_role;

create or replace function public.read_checkout_eligibility(p_actor uuid,p_invitation_id uuid,p_disclosure_version text,p_disclosure_text text,p_requires_ack boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb; v_reason text; v_active jsonb; v_table uuid;
begin
  perform app_private.require_service_role();
  if p_actor is null or p_invitation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  if not exists(select 1 from auth.users u join public.app_admissions a on a.auth_user_id=u.id and a.state='activated'
    where u.id=p_actor and u.email_confirmed_at is not null) then raise exception using errcode='42501',message='member_not_admitted'; end if;
  select i.table_id into v_table from public.app_table_invitations i where i.invitation_id=p_invitation_id and i.auth_user_id=p_actor;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  begin v_context:=app_private.checkout_invitation_context(p_actor,p_invitation_id,false);
  exception when sqlstate 'P0001' then
    if sqlerrm='invitation_ineligible' then v_reason:='invitation_closed'; else raise; end if;
  end;
  if v_context is not null then
    if v_context->>'runtimeState' not in ('open','proceeding') or (v_context->>'runtimeState'='open'
      and ((v_context->>'localDate')::date+(v_context->>'startLocalTime')::time)<=timezone('America/New_York',clock_timestamp())+interval '24 hours') then v_reason:='table_closed'; end if;
    if (v_context->>'age')::integer<21 then v_reason:='profile_review_required'; end if;
  end if;
  select jsonb_build_object('attemptId',x.attempt_id,'invitationId',x.invitation_id,'state',x.state,'holdUntil',x.hold_until,
    'providerSessionExpiresAt',x.provider_session_expires_at) into v_active
    from public.app_checkout_attempts x where x.invitation_id=p_invitation_id
      and x.state in ('creating','open','unknown','processing') order by x.created_at desc limit 1;
  if v_reason is null and v_active is not null then v_reason:='attempt_recovery_required'; end if;
  if v_reason is null and exists(select 1 from public.app_seats s where s.invitation_id=p_invitation_id and s.state in ('confirmed','cancellation_requested','completed')) then v_reason:='seat_exists'; end if;
  if v_reason is null and exists(select 1 from public.app_payments p join public.app_checkout_attempts x on x.attempt_id=p.attempt_id
    where x.invitation_id=p_invitation_id and (p.state in ('verified_paid','refund_pending')
      or exists(select 1 from public.app_refund_obligations o where o.payment_id=p.payment_id and o.state<>'succeeded'))) then
    v_reason:='payment_unresolved';
  end if;
  if v_reason is null and ((select count(*) from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id
      where i.table_id=v_table and s.state in ('confirmed','cancellation_requested','completed'))
    +(select count(*) from public.app_checkout_attempts x where x.table_id=v_table and x.state in ('creating','open','unknown','processing') and x.hold_until>clock_timestamp())>=5) then
    v_reason:='capacity_unavailable';
  end if;
  if p_disclosure_version is null or length(btrim(p_disclosure_version))=0 or p_disclosure_text is null or length(btrim(p_disclosure_text))=0 then
    v_reason:='disclosure_not_configured';
  end if;
  return jsonb_build_object('invitationId',p_invitation_id,'expectedProposalRevision',coalesce((v_context->>'proposalRevision')::integer,0),
    'expectedProfileRevision',coalesce((v_context->>'profileRevision')::integer,0),
    'eligibility',jsonb_build_object('status',case when v_reason is null then 'ready' else 'blocked' end,'reasonCode',v_reason),
    'price',jsonb_build_object('amountCents',2500,'currency','USD'),
    'disclosure',case when p_disclosure_version is null or p_disclosure_text is null or btrim(p_disclosure_text)=''
      then jsonb_build_object('status','not_configured') else jsonb_build_object('status','ready','version',p_disclosure_version,
        'text',p_disclosure_text,'requiresAcknowledgement',p_requires_ack) end,'activeAttempt',v_active);
end $function$;

create or replace function public.read_my_checkout_attempt(p_actor uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype; v_seat uuid; v_payment_state text; v_unresolved boolean;
begin
  perform app_private.require_service_role();
  if p_actor is null or p_attempt_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_attempt from public.app_checkout_attempts where attempt_id=p_attempt_id and auth_user_id=p_actor;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select s.seat_id into v_seat from public.app_seats s join public.app_payments p on p.payment_id=s.payment_id
    where s.invitation_id=v_attempt.invitation_id and p.attempt_id=v_attempt.attempt_id;
  select exists(select 1 from public.app_payments p left join public.app_refund_obligations o on o.payment_id=p.payment_id
    where p.attempt_id=v_attempt.attempt_id and (p.state='refund_pending' or p.state='verified_paid' and not exists(
      select 1 from public.app_seats s where s.payment_id=p.payment_id)
      or (o.obligation_id is not null and o.state<>'succeeded'))) into v_unresolved;
  v_payment_state:=case when v_seat is not null then 'confirmed' when v_unresolved then 'refund_pending'
    when v_attempt.state='processing' then 'processing' when v_attempt.state in ('expired','released') then 'not_started' else 'unknown' end;
  return jsonb_build_object('attempt',app_private.checkout_attempt_dto(v_attempt),'paymentState',v_payment_state,'seatId',v_seat);
end $function$;

create function public.read_checkout_return_binding(p_actor uuid,p_invitation_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype;
begin
  perform app_private.require_service_role();
  if p_actor is null or p_invitation_id is null or p_attempt_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_attempt from public.app_checkout_attempts
    where attempt_id=p_attempt_id and invitation_id=p_invitation_id and auth_user_id=p_actor;
  if not found or v_attempt.provider_session_id is null then raise exception using errcode='P0002',message='not_found'; end if;
  return jsonb_build_object('attemptId',v_attempt.attempt_id,'invitationId',v_attempt.invitation_id,
    'providerSessionId',v_attempt.provider_session_id,'mode',v_attempt.provider_mode,
    'holdUntil',v_attempt.hold_until,'providerSessionExpiresAt',v_attempt.provider_session_expires_at);
end $function$;
revoke all on function public.read_checkout_return_binding(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_checkout_return_binding(uuid,uuid,uuid) to service_role;

create function public.read_checkout_webhook_binding(p_provider_mode text,p_session_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype;
begin
  perform app_private.require_service_role();
  if p_provider_mode not in ('test','live') or p_session_id is null or p_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$' then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  select * into v_attempt from public.app_checkout_attempts
    where provider_mode=p_provider_mode and provider_session_id=p_session_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  return jsonb_build_object('attemptId',v_attempt.attempt_id,'invitationId',v_attempt.invitation_id,
    'providerSessionId',v_attempt.provider_session_id,'mode',v_attempt.provider_mode,
    'holdUntil',v_attempt.hold_until,'providerSessionExpiresAt',v_attempt.provider_session_expires_at);
end $function$;
revoke all on function public.read_checkout_webhook_binding(text,text) from public,anon,authenticated;
grant execute on function public.read_checkout_webhook_binding(text,text) to service_role;

create function public.expire_table_checkout_session(p_provider_mode text,p_session_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype; v_table uuid; v_guest uuid; v_invitation uuid; v_now timestamptz;
begin
  perform app_private.require_service_role();
  if p_provider_mode not in ('test','live') or p_session_id is null or p_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$' then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  select table_id,guest_id,invitation_id into v_table,v_guest,v_invitation from public.app_checkout_attempts
    where provider_mode=p_provider_mode and provider_session_id=p_session_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  perform 1 from public.app_supply_table_heads where table_id=v_table for update;
  perform 1 from public.app_member_profiles where guest_id=v_guest for update;
  perform 1 from public.app_table_invitations where invitation_id=v_invitation for update;
  select * into v_attempt from public.app_checkout_attempts where provider_mode=p_provider_mode and provider_session_id=p_session_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if exists(select 1 from public.app_payments where attempt_id=v_attempt.attempt_id) then
    return jsonb_build_object('state',v_attempt.state,'changed',false);
  end if;
  if v_attempt.state in ('creating','open','unknown','processing') then
    v_now:=clock_timestamp();
    update public.app_checkout_attempts set state='expired',provider_create_lease_until=null,updated_at=v_now
      where attempt_id=v_attempt.attempt_id returning * into v_attempt;
    insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,request_id,operation_id,metadata)
      values('system','checkout_fulfillment_worker','checkout.hold.expired','checkout_attempt',v_attempt.attempt_id,v_attempt.attempt_id,v_attempt.attempt_id,'{}'::jsonb);
  end if;
  return jsonb_build_object('state',v_attempt.state,'changed',v_attempt.state='expired');
end $function$;
revoke all on function public.expire_table_checkout_session(text,text) from public,anon,authenticated;
grant execute on function public.expire_table_checkout_session(text,text) to service_role;

create function public.release_failed_checkout_session(
  p_event_id text,p_provider_mode text,p_provider_account_id text,p_session_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_event public.app_stripe_checkout_events%rowtype; v_attempt public.app_checkout_attempts%rowtype;
  v_table uuid; v_guest uuid; v_invitation uuid; v_now timestamptz:=clock_timestamp(); v_changed boolean:=false;
begin
  perform app_private.require_service_role();
  if p_event_id is null or p_provider_mode not in ('test','live') or p_provider_account_id is null
    or p_session_id is null or p_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$' then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  select * into v_event from public.app_stripe_checkout_events where event_id=p_event_id
    and provider_mode=p_provider_mode and provider_account_id=p_provider_account_id for update;
  if not found or v_event.event_type<>'checkout.session.async_payment_failed' or v_event.session_id<>p_session_id then
    raise exception using errcode='P0001',message='event_binding_invalid';
  end if;
  select table_id,guest_id,invitation_id into v_table,v_guest,v_invitation from public.app_checkout_attempts
    where provider_mode=p_provider_mode and provider_session_id=p_session_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  -- Same capacity lock order as reserve, expiry and fulfillment.
  perform 1 from public.app_supply_table_heads where table_id=v_table for update;
  perform 1 from public.app_member_profiles where guest_id=v_guest for update;
  perform 1 from public.app_table_invitations where invitation_id=v_invitation for update;
  select * into v_attempt from public.app_checkout_attempts where provider_mode=p_provider_mode and provider_session_id=p_session_id for update;
  if exists(select 1 from public.app_payments where attempt_id=v_attempt.attempt_id) then
    raise exception using errcode='P0001',message='payment_already_recorded';
  end if;
  v_now:=clock_timestamp();
  if v_attempt.state in ('creating','open','unknown','processing') then
    update public.app_checkout_attempts set state='released',provider_create_lease_until=null,
      last_provider_error_code='provider_rejected',updated_at=v_now where attempt_id=v_attempt.attempt_id returning * into v_attempt;
    v_changed:=true;
    insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,request_id,operation_id,metadata)
      values('system','checkout_fulfillment_worker','checkout.hold.released','checkout_attempt',v_attempt.attempt_id,
        v_attempt.attempt_id,v_attempt.attempt_id,'{}'::jsonb);
  end if;
  update public.app_stripe_checkout_events set state='processed',result_code='payment_failed',
    attempt_count=attempt_count+1,last_attempt_at=v_now,updated_at=v_now
    where event_id=p_event_id and provider_mode=p_provider_mode and provider_account_id=p_provider_account_id;
  return jsonb_build_object('state',v_attempt.state,'changed',v_changed);
end $function$;
revoke all on function public.release_failed_checkout_session(text,text,text,text) from public,anon,authenticated;
grant execute on function public.release_failed_checkout_session(text,text,text,text) to service_role;

create function public.fulfill_paid_checkout_session(
  p_event_id text,p_provider_mode text,p_provider_account_id text,p_attempt_id uuid,p_session_id text,p_payment_intent_id text,
  p_session_status text,p_payment_status text,p_amount_total integer,p_currency text,p_verified_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_attempt public.app_checkout_attempts%rowtype; v_head public.app_supply_table_heads%rowtype;
  v_payment public.app_payments%rowtype; v_seat uuid; v_obligation uuid; v_eligible boolean:=false;
  v_capacity integer; v_table uuid; v_guest uuid; v_invitation uuid; v_now timestamptz:=clock_timestamp(); v_event public.app_stripe_checkout_events%rowtype;
begin
  perform app_private.require_service_role();
  if p_attempt_id is null or p_session_id is null or p_provider_mode not in ('test','live') or p_provider_account_id is null
    or p_session_status is distinct from 'complete' or p_payment_status is distinct from 'paid'
    or p_amount_total is distinct from 2500 or lower(coalesce(p_currency,''))<>'usd'
    or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$' or p_verified_at is null then
    raise exception using errcode='P0001',message='payment_truth_invalid';
  end if;
  if p_event_id is not null then
    select * into v_event from public.app_stripe_checkout_events where event_id=p_event_id and provider_mode=p_provider_mode
      and provider_account_id=p_provider_account_id for update;
    if not found or v_event.session_id<>p_session_id then raise exception using errcode='P0001',message='event_not_persisted'; end if;
  end if;
  -- Lock order: Table head, profile, invitation, attempt. W07 money operations lock payment after these.
  select table_id,guest_id,invitation_id into v_table,v_guest,v_invitation from public.app_checkout_attempts where attempt_id=p_attempt_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_head from public.app_supply_table_heads where table_id=v_table for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  perform 1 from public.app_member_profiles where guest_id=v_guest for update;
  perform 1 from public.app_table_invitations where invitation_id=v_invitation for update;
  select * into v_attempt from public.app_checkout_attempts where attempt_id=p_attempt_id for update;
  v_now:=clock_timestamp();
  if v_attempt.provider_mode<>p_provider_mode or v_attempt.provider_session_id<>p_session_id
    or v_attempt.amount_cents<>2500 or v_attempt.currency<>'USD' then raise exception using errcode='P0001',message='session_binding_invalid'; end if;
  select * into v_payment from public.app_payments where attempt_id=p_attempt_id for update;
  if found then
    select seat_id into v_seat from public.app_seats where payment_id=v_payment.payment_id;
    select obligation_id into v_obligation from public.app_refund_obligations where payment_id=v_payment.payment_id and source='late_checkout_ineligible';
    if p_event_id is not null then update public.app_stripe_checkout_events set state='processed',result_code=case when v_seat is null then 'late_refund' else 'paid_fulfilled' end,
      attempt_count=attempt_count+1,last_attempt_at=v_now,updated_at=v_now where event_id=p_event_id and provider_mode=p_provider_mode
        and provider_account_id=p_provider_account_id; end if;
    return jsonb_build_object('paymentState',case when v_seat is not null then 'confirmed' else 'refund_pending' end,
      'seatId',v_seat,'paymentId',v_payment.payment_id,'refundObligationId',v_obligation);
  end if;
  -- Do not trust the event/return metadata. Re-check the invitation and current domain pointers while the Table is locked.
  select exists(
    select 1 from public.app_table_invitations i
    join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id and q.state='pending'
    join public.app_table_roster_proposals p on p.proposal_id=i.proposal_id and p.table_id=i.table_id and p.state='approved'
      and p.revision=v_attempt.proposal_revision and p.supply_revision_id=v_attempt.supply_revision_id
    join public.app_table_roster_proposal_members pm on pm.proposal_id=p.proposal_id and pm.request_id=q.request_id and pm.guest_id=i.guest_id
    join public.app_member_profiles m on m.guest_id=i.guest_id and m.auth_user_id=i.auth_user_id
      and m.profile_revision=v_attempt.profile_revision and pm.captured_profile_revision=m.profile_revision
      and m.identity_status='approved' and m.reviewed_identity_version=m.critical_identity_version
      and pm.captured_critical_identity_version=m.critical_identity_version
    join public.app_admissions a on a.id=m.admission_id and a.auth_user_id=i.auth_user_id and a.state='activated'
    join public.app_supply_table_revisions r on r.revision_id=v_attempt.supply_revision_id and r.table_id=i.table_id and r.state='published'
    join public.app_table_runtime rt on rt.table_id=i.table_id and rt.state in ('open','proceeding')
    where i.invitation_id=v_attempt.invitation_id and i.table_id=v_attempt.table_id and i.guest_id=v_attempt.guest_id
      and i.auth_user_id=v_attempt.auth_user_id and i.state='active'
      and v_head.lifecycle='published' and v_head.sync_state='current' and v_head.published_revision_id=v_attempt.supply_revision_id
      and (r.content->>'localDate')::date+(r.content->>'startLocalTime')::time > timezone('America/New_York',v_now)
      and (rt.state='proceeding' or ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time
        > timezone('America/New_York',v_now)+interval '24 hours'))
      and extract(year from age((r.content->>'localDate')::date,m.date_of_birth)) >= 21
  ) into v_eligible;
  select count(*) into v_capacity from (
    select s.seat_id from public.app_seats s where s.table_id=v_attempt.table_id and s.state in ('confirmed','cancellation_requested','completed')
    union all
    select x.attempt_id from public.app_checkout_attempts x where x.table_id=v_attempt.table_id and x.attempt_id<>p_attempt_id
      and x.state in ('creating','open','unknown','processing') and x.hold_until>v_now
  ) as occupied;
  v_eligible:=v_eligible and v_capacity<5
    and not exists(select 1 from public.app_seats s where s.table_id=v_attempt.table_id and s.guest_id=v_attempt.guest_id and s.state in ('confirmed','cancellation_requested','completed'));
  insert into public.app_payments(attempt_id,provider_mode,provider_payment_id,amount_cents,currency,state,verified_at)
  values(p_attempt_id,p_provider_mode,p_payment_intent_id,2500,'USD',case when v_eligible then 'verified_paid' else 'refund_pending' end,p_verified_at)
  returning * into v_payment;
  if v_eligible then
    insert into public.app_seats(invitation_id,table_id,guest_id,payment_id,state)
      values(v_attempt.invitation_id,v_attempt.table_id,v_attempt.guest_id,v_payment.payment_id,'confirmed') returning seat_id into v_seat;
    update public.app_checkout_attempts set state='consumed',provider_create_lease_until=null,updated_at=v_now where attempt_id=p_attempt_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,request_id,operation_id,metadata)
      values('user',v_attempt.auth_user_id,'checkout.payment.fulfilled','seat',v_seat,p_attempt_id,p_attempt_id,'{}'::jsonb);
  else
    insert into public.app_refund_obligations(payment_id,source,amount_cents,currency,state)
      values(v_payment.payment_id,'late_checkout_ineligible',2500,'USD','open') returning obligation_id into v_obligation;
    update public.app_checkout_attempts set state='consumed',provider_create_lease_until=null,updated_at=v_now where attempt_id=p_attempt_id;
    insert into public.app_audit_events(actor_type,system_actor,action,subject_type,subject_id,request_id,operation_id,metadata)
      values('system','checkout_fulfillment_worker','checkout.refund.obligation.created','refund_obligation',v_obligation,p_attempt_id,p_attempt_id,'{}'::jsonb);
  end if;
  if p_event_id is not null then update public.app_stripe_checkout_events set state='processed',
    result_code=case when v_seat is null then 'late_refund' else 'paid_fulfilled' end,
    attempt_count=attempt_count+1,last_attempt_at=v_now,updated_at=v_now where event_id=p_event_id and provider_mode=p_provider_mode
      and provider_account_id=p_provider_account_id; end if;
  return jsonb_build_object('paymentState',case when v_seat is not null then 'confirmed' else 'refund_pending' end,
    'seatId',v_seat,'paymentId',v_payment.payment_id,'refundObligationId',v_obligation);
end $function$;
revoke all on function public.fulfill_paid_checkout_session(text,text,text,uuid,text,text,text,text,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.fulfill_paid_checkout_session(text,text,text,uuid,text,text,text,text,integer,text,timestamptz) to service_role;

comment on table public.app_stripe_checkout_events is 'Minimal signature-verified Stripe event inbox. Raw bodies, signatures, secrets and names are never stored.';
comment on table public.app_refund_obligations is 'Durable refund liability for a verified late charge that cannot safely receive a Seat.';
