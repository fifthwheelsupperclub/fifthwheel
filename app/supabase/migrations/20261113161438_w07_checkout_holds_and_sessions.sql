-- W07.1: private checkout holds and embedded Stripe Checkout attempts.
-- Additive only. Do not reset or apply to hosted projects.

create table public.app_table_runtime (
  table_id uuid primary key references public.app_supply_table_heads(table_id) on delete restrict,
  state text not null default 'open' check (state in ('open','review_required','proceeding','cancelled','completed')),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
insert into public.app_table_runtime(table_id)
select table_id from public.app_supply_table_heads
on conflict (table_id) do nothing;

alter table public.app_table_invitations
  add constraint app_table_invitations_identity_tuple_uq unique(invitation_id,table_id,guest_id,auth_user_id),
  add constraint app_table_invitations_guest_table_tuple_uq unique(invitation_id,table_id,guest_id);
create function app_private.create_table_runtime_row()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.app_table_runtime(table_id) values(new.table_id) on conflict do nothing;
  return new;
end $function$;
create trigger app_supply_table_runtime_init after insert on public.app_supply_table_heads
for each row execute function app_private.create_table_runtime_row();

create table public.app_checkout_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.app_table_invitations(invitation_id) on delete restrict,
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  guest_id uuid not null references public.app_member_profiles(guest_id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  proposal_revision integer not null check (proposal_revision > 0),
  profile_revision integer not null check (profile_revision > 0),
  supply_revision_id uuid not null references public.app_supply_table_revisions(revision_id) on delete restrict,
  state text not null default 'creating' check (state in ('creating','open','unknown','processing','expired','released','consumed')),
  hold_until timestamptz not null,
  provider_session_expires_at timestamptz not null,
  amount_cents integer not null default 2500 check (amount_cents = 2500),
  currency text not null default 'USD' check (currency = 'USD'),
  provider_mode text not null check (provider_mode in ('test','live')),
  provider_idempotency_key text not null unique,
  provider_session_id text,
  provider_create_lease_until timestamptz,
  last_provider_error_code text check (last_provider_error_code is null or last_provider_error_code in ('session_expiry_too_soon','provider_rejected','provider_unavailable')),
  disclosure_version text not null check (length(btrim(disclosure_version)) between 1 and 100),
  disclosure_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_checkout_attempts_invitation_identity_fk foreign key(invitation_id,table_id,guest_id,auth_user_id)
    references public.app_table_invitations(invitation_id,table_id,guest_id,auth_user_id) on delete restrict,
  check (provider_session_expires_at >= hold_until and provider_session_expires_at <= hold_until + interval '2 minutes'),
  check (provider_session_id is null or provider_session_id ~ '^cs_(test_|live_)[A-Za-z0-9]+$'),
  check (state not in ('open','processing','consumed') or provider_session_id is not null)
);

create unique index app_checkout_attempts_one_unresolved_per_invitation
  on public.app_checkout_attempts(invitation_id) where state in ('creating','open','unknown','processing');
create unique index app_checkout_attempts_provider_session_mode_uq
  on public.app_checkout_attempts(provider_mode,provider_session_id) where provider_session_id is not null;
create index app_checkout_attempts_capacity_idx on public.app_checkout_attempts(table_id,hold_until)
  where state in ('creating','open','unknown','processing');

create table public.app_checkout_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('checkout.begin')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{32}$'),
  attempt_id uuid not null references public.app_checkout_attempts(attempt_id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.app_payments (
  payment_id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.app_checkout_attempts(attempt_id) on delete restrict,
  provider_mode text not null check (provider_mode in ('test','live')),
  provider_payment_id text not null,
  amount_cents integer not null check (amount_cents = 2500),
  currency text not null check (currency = 'USD'),
  state text not null check (state in ('verified_paid','refund_pending','refunded')),
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(provider_mode,provider_payment_id)
);

create table public.app_seats (
  seat_id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.app_table_invitations(invitation_id) on delete restrict,
  table_id uuid not null,
  guest_id uuid not null,
  payment_id uuid not null unique references public.app_payments(payment_id) on delete restrict,
  state text not null default 'confirmed' check (state in ('confirmed','cancellation_requested','cancelled','completed')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint app_seats_invitation_identity_fk foreign key(invitation_id,table_id,guest_id)
    references public.app_table_invitations(invitation_id,table_id,guest_id) on delete restrict,
  check ((state = 'cancelled') = (cancelled_at is not null))
);
create unique index app_seats_one_active_paid_per_table_guest
  on public.app_seats(table_id,guest_id) where state in ('confirmed','cancellation_requested','completed');
create index app_seats_capacity_table_idx on public.app_seats(table_id,state);

alter table public.app_table_runtime enable row level security;
alter table public.app_checkout_attempts enable row level security;
alter table public.app_checkout_operations enable row level security;
alter table public.app_payments enable row level security;
alter table public.app_seats enable row level security;
revoke all on public.app_table_runtime,public.app_checkout_attempts,public.app_checkout_operations,public.app_payments,public.app_seats
  from public,anon,authenticated,service_role;
grant select,insert,update on public.app_table_runtime to service_role;
grant select,insert,update on public.app_checkout_attempts to service_role;
grant select,insert on public.app_checkout_operations to service_role;
grant select,insert,update on public.app_payments,public.app_seats to service_role;

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
  'checkout.session.unknown','checkout.hold.released'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup','app_admission','invitation_delivery','delivery_attempt','auth_identity','member_link_request',
  'profile_file','identity_review','supply_sync_run','supply_table','supply_table_revision',
  'supply_weekly_clone_operation','supply_weekly_clone_item','table_request','table_roster_proposal',
  'table_invitation','checkout_attempt','payment','seat'
));

create function app_private.checkout_invitation_context(p_actor uuid,p_invitation uuid,p_for_update boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb;
begin
  perform app_private.require_service_role();
  select jsonb_build_object(
    'invitationId',i.invitation_id,'tableId',i.table_id,'guestId',i.guest_id,'authUserId',i.auth_user_id,
    'sourceRequestId',i.source_request_id,'proposalId',p.proposal_id,'proposalRevision',p.revision,
    'profileRevision',m.profile_revision,'supplyRevisionId',h.published_revision_id,
    'runtimeState',rt.state,'localDate',r.content->>'localDate','startLocalTime',r.content->>'startLocalTime',
    'age',extract(year from age((r.content->>'localDate')::date,m.date_of_birth))::integer
  ) into v_context
  from public.app_table_invitations i
  join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
  join public.app_table_roster_proposals p on p.proposal_id=i.proposal_id and p.table_id=i.table_id and p.state='approved'
  join public.app_table_roster_proposal_members pm on pm.proposal_id=p.proposal_id and pm.request_id=q.request_id and pm.guest_id=i.guest_id
  join public.app_member_profiles m on m.guest_id=i.guest_id and m.auth_user_id=i.auth_user_id
    and m.identity_status='approved' and m.reviewed_identity_version=m.critical_identity_version
    and pm.captured_profile_revision=m.profile_revision and pm.captured_critical_identity_version=m.critical_identity_version
  join public.app_admissions a on a.id=m.admission_id and a.auth_user_id=i.auth_user_id and a.state='activated'
  join public.app_supply_table_heads h on h.table_id=i.table_id and h.published_revision_id=p.supply_revision_id and h.lifecycle='published' and h.sync_state='current'
  join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id and r.state='published' and r.table_id=h.table_id
  join public.app_table_runtime rt on rt.table_id=i.table_id
  where i.invitation_id=p_invitation and i.auth_user_id=p_actor and i.state='active'
    and (r.content->>'localDate')::date + (r.content->>'startLocalTime')::time > timezone('America/New_York',clock_timestamp())
  for update of h,m,i,p;
  if v_context is null then raise exception using errcode='P0001',message='invitation_ineligible'; end if;
  return v_context;
end $function$;
revoke all on function app_private.checkout_invitation_context(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.checkout_invitation_context(uuid,uuid,boolean) to service_role;

create function public.read_checkout_eligibility(p_actor uuid,p_invitation_id uuid,p_disclosure_version text,p_disclosure_text text,p_requires_ack boolean)
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
    if v_context->>'runtimeState' not in ('open','proceeding')
      or (v_context->>'runtimeState'='open'
        and ((v_context->>'localDate')::date+(v_context->>'startLocalTime')::time)
          <= timezone('America/New_York',clock_timestamp())+interval '24 hours') then v_reason:='table_closed'; end if;
    if (v_context->>'age')::integer < 21 then v_reason:='profile_review_required'; end if;
  end if;
  select jsonb_build_object('attemptId',x.attempt_id,'invitationId',x.invitation_id,'state',x.state,'holdUntil',x.hold_until,
      'providerSessionExpiresAt',x.provider_session_expires_at)
    into v_active from public.app_checkout_attempts x where x.invitation_id=p_invitation_id
      and x.state in ('creating','open','unknown','processing') order by x.created_at desc limit 1;
  if v_reason is null and v_active is not null then v_reason:='attempt_recovery_required'; end if;
  if v_reason is null and exists(select 1 from public.app_seats s where s.invitation_id=p_invitation_id and s.state in ('confirmed','cancellation_requested','completed')) then v_reason:='seat_exists'; end if;
  if v_reason is null and (
    (select count(*) from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id
      where i.table_id=v_table and s.state in ('confirmed','cancellation_requested','completed'))
    + (select count(*) from public.app_checkout_attempts x where x.table_id=v_table and x.state in ('creating','open','unknown','processing') and x.hold_until>clock_timestamp())
    >= 5) then v_reason:='capacity_unavailable'; end if;
  if p_disclosure_version is null or length(btrim(p_disclosure_version))=0 or p_disclosure_text is null or length(btrim(p_disclosure_text))=0 then v_reason:='disclosure_not_configured'; end if;
  return jsonb_build_object('invitationId',p_invitation_id,'expectedProposalRevision',coalesce((v_context->>'proposalRevision')::integer,0),
    'expectedProfileRevision',coalesce((v_context->>'profileRevision')::integer,0),
    'eligibility',jsonb_build_object('status',case when v_reason is null then 'ready' else 'blocked' end,'reasonCode',v_reason),
    'price',jsonb_build_object('amountCents',2500,'currency','USD'),
    'disclosure',case when p_disclosure_version is null or p_disclosure_text is null or btrim(p_disclosure_text)='' then jsonb_build_object('status','not_configured')
      else jsonb_build_object('status','ready','version',p_disclosure_version,'text',p_disclosure_text,'requiresAcknowledgement',p_requires_ack) end,
    'activeAttempt',v_active);
end $function$;
revoke all on function public.read_checkout_eligibility(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.read_checkout_eligibility(uuid,uuid,text,text,boolean) to service_role;

create function app_private.checkout_attempt_dto(p_attempt public.app_checkout_attempts)
returns jsonb language sql immutable security definer set search_path = '' as $function$
  select jsonb_build_object('attemptId',p_attempt.attempt_id,'invitationId',p_attempt.invitation_id,'state',p_attempt.state,
    'holdUntil',p_attempt.hold_until,'providerSessionExpiresAt',p_attempt.provider_session_expires_at,
    'expectedAmountCents',p_attempt.amount_cents,'currency',p_attempt.currency,'mode',p_attempt.provider_mode,
    'providerIdempotencyKey',p_attempt.provider_idempotency_key,'providerSessionId',p_attempt.provider_session_id,
    'lastProviderErrorCode',p_attempt.last_provider_error_code,'dispatchClaimed',false,'providerReplay',false)
$function$;
revoke all on function app_private.checkout_attempt_dto(public.app_checkout_attempts) from public,anon,authenticated,service_role;
grant execute on function app_private.checkout_attempt_dto(public.app_checkout_attempts) to service_role;

create function app_private.checkout_claim_checkout_dispatch(p_attempt_id uuid,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype; v_claimed boolean:=false; v_replay boolean:=false;
begin
  perform app_private.require_service_role();
  select * into v_attempt from public.app_checkout_attempts where attempt_id=p_attempt_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_attempt.provider_session_id is null and v_attempt.state in ('creating','unknown')
    and v_attempt.hold_until>p_now
    and (v_attempt.provider_create_lease_until is null or v_attempt.provider_create_lease_until<=p_now) then
    v_replay:=v_attempt.state='unknown';
    update public.app_checkout_attempts set state='creating',provider_create_lease_until=p_now+interval '30 seconds',updated_at=p_now
      where attempt_id=p_attempt_id returning * into v_attempt;
    v_claimed:=true;
  end if;
  return app_private.checkout_attempt_dto(v_attempt)||jsonb_build_object('dispatchClaimed',v_claimed,'providerReplay',v_replay);
end $function$;
revoke all on function app_private.checkout_claim_checkout_dispatch(uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.checkout_claim_checkout_dispatch(uuid,timestamptz) to service_role;


create function public.reserve_table_checkout_attempt(
  p_actor uuid,p_invitation_id uuid,p_operation_id uuid,p_expected_proposal_revision integer,p_expected_profile_revision integer,
  p_disclosure_version text,p_disclosure_accepted_at timestamptz,p_provider_mode text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb; v_table uuid; v_existing public.app_checkout_attempts%rowtype; v_attempt public.app_checkout_attempts%rowtype;
  v_hash text; v_operation public.app_checkout_operations%rowtype; v_now timestamptz; v_hold timestamptz; v_provider_expiry timestamptz;
begin
  perform app_private.require_service_role();
  v_now:=clock_timestamp();
  if p_actor is null or p_invitation_id is null or p_operation_id is null or p_disclosure_version is null
    or p_provider_mode not in ('test','live') then raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(concat_ws('|',p_invitation_id::text,p_expected_proposal_revision::text,p_expected_profile_revision::text,p_disclosure_version,p_provider_mode));
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_operation from public.app_checkout_operations where operation_id=p_operation_id;
  if found then
    if v_operation.actor_user_id<>p_actor or v_operation.action<>'checkout.begin' or v_operation.request_hash<>v_hash then
      raise exception using errcode='P0001',message='operation_conflict';
    end if;
    select * into v_attempt from public.app_checkout_attempts where attempt_id=v_operation.attempt_id;
    if not found or v_attempt.invitation_id<>p_invitation_id or v_attempt.auth_user_id<>p_actor then
      raise exception using errcode='P0001',message='operation_conflict';
    end if;
    v_table:=v_attempt.table_id;
    perform 1 from public.app_supply_table_heads h where h.table_id=v_table for update;
    v_now:=clock_timestamp();
    v_context:=app_private.checkout_invitation_context(p_actor,p_invitation_id,false);
    if (v_context->>'proposalRevision')::integer<>p_expected_proposal_revision or (v_context->>'profileRevision')::integer<>p_expected_profile_revision then
      raise exception using errcode='P0001',message='stale_checkout'; end if;
    if v_context->>'runtimeState' not in ('open','proceeding')
      or (v_context->>'runtimeState'='open'
        and ((v_context->>'localDate')::date+(v_context->>'startLocalTime')::time)
          <= timezone('America/New_York',clock_timestamp())+interval '24 hours') then
      raise exception using errcode='P0001',message='table_closed'; end if;
    if (v_context->>'age')::integer<21 then raise exception using errcode='P0001',message='profile_review_required'; end if;
    return app_private.checkout_claim_checkout_dispatch(v_attempt.attempt_id,v_now);
  end if;
  select i.table_id into v_table from public.app_table_invitations i where i.invitation_id=p_invitation_id and i.auth_user_id=p_actor;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  perform 1 from public.app_supply_table_heads h where h.table_id=v_table for update;
  v_now:=clock_timestamp();
  v_context:=app_private.checkout_invitation_context(p_actor,p_invitation_id,false);
  if (v_context->>'proposalRevision')::integer<>p_expected_proposal_revision or (v_context->>'profileRevision')::integer<>p_expected_profile_revision then
    raise exception using errcode='P0001',message='stale_checkout'; end if;
  if v_context->>'runtimeState' not in ('open','proceeding')
    or (v_context->>'runtimeState'='open'
      and ((v_context->>'localDate')::date+(v_context->>'startLocalTime')::time)
        <= timezone('America/New_York',clock_timestamp())+interval '24 hours') then
    raise exception using errcode='P0001',message='table_closed'; end if;
  if (v_context->>'age')::integer<21 then raise exception using errcode='P0001',message='profile_review_required'; end if;
  -- Recheck idempotency after serializing with the Table transaction.
  select * into v_operation from public.app_checkout_operations where operation_id=p_operation_id;
  if found then
    if v_operation.actor_user_id<>p_actor or v_operation.action<>'checkout.begin' or v_operation.request_hash<>v_hash then
      raise exception using errcode='P0001',message='operation_conflict';
    end if;
    select * into v_attempt from public.app_checkout_attempts where attempt_id=v_operation.attempt_id;
    if not found or v_attempt.invitation_id<>p_invitation_id or v_attempt.auth_user_id<>p_actor then
      raise exception using errcode='P0001',message='operation_conflict';
    end if;
    return app_private.checkout_claim_checkout_dispatch(v_attempt.attempt_id,v_now);
  end if;
  if p_disclosure_accepted_at is not null and p_disclosure_version is null then raise exception using errcode='22023',message='invalid_input'; end if;
  -- The 30m capacity allocation ends here. Keep the invitation blocked from a
  -- second attempt until provider expiry is authoritatively reconciled.
  update public.app_checkout_attempts set state='unknown',updated_at=v_now
    where invitation_id=p_invitation_id and state in ('creating','open') and hold_until<=v_now;
  select * into v_existing from public.app_checkout_attempts x where x.invitation_id=p_invitation_id
    and x.state in ('creating','open','unknown','processing') order by x.created_at desc limit 1 for update;
  if found then
    insert into public.app_checkout_operations(operation_id,actor_user_id,action,request_hash,attempt_id)
      values(p_operation_id,p_actor,'checkout.begin',v_hash,v_existing.attempt_id);
    return app_private.checkout_claim_checkout_dispatch(v_existing.attempt_id,v_now);
  end if;
  if exists(select 1 from public.app_seats s where s.invitation_id=p_invitation_id and s.state in ('confirmed','cancellation_requested','completed')) then
    raise exception using errcode='P0001',message='seat_exists'; end if;
  if (select count(*) from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id
      where i.table_id=v_table and s.state in ('confirmed','cancellation_requested','completed'))
    + (select count(*) from public.app_checkout_attempts x where x.table_id=v_table and x.state in ('creating','open','unknown','processing') and x.hold_until>v_now) >= 5 then
    raise exception using errcode='P0001',message='capacity_unavailable'; end if;
  v_hold:=v_now+interval '30 minutes';
  v_provider_expiry:=v_hold+interval '2 minutes';
  insert into public.app_checkout_attempts(invitation_id,table_id,guest_id,auth_user_id,proposal_revision,profile_revision,
    supply_revision_id,state,hold_until,provider_session_expires_at,provider_mode,provider_idempotency_key,disclosure_version,disclosure_accepted_at)
  values(p_invitation_id,v_table,(v_context->>'guestId')::uuid,p_actor,p_expected_proposal_revision,p_expected_profile_revision,
    (v_context->>'supplyRevisionId')::uuid,'creating',v_hold,v_provider_expiry,p_provider_mode,'fw-checkout-'||p_operation_id::text,p_disclosure_version,p_disclosure_accepted_at)
  returning * into v_attempt;
  insert into public.app_checkout_operations(operation_id,actor_user_id,action,request_hash,attempt_id)
    values(p_operation_id,p_actor,'checkout.begin',v_hash,v_attempt.attempt_id);
  update public.app_supply_table_heads set protected_by_activity=true,updated_at=v_now where table_id=v_table;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,'checkout.hold.created','checkout_attempt',v_attempt.attempt_id,p_operation_id,jsonb_build_object('tableId',v_table,'holdUntil',v_hold));
  return app_private.checkout_claim_checkout_dispatch(v_attempt.attempt_id,v_now);
end $function$;
revoke all on function public.reserve_table_checkout_attempt(uuid,uuid,uuid,integer,integer,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.reserve_table_checkout_attempt(uuid,uuid,uuid,integer,integer,text,timestamptz,text) to service_role;

create function public.bind_table_checkout_session(
  p_actor uuid,p_attempt_id uuid,p_session_id text,p_mode text,p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_attempt from public.app_checkout_attempts where attempt_id=p_attempt_id and auth_user_id=p_actor for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if p_mode<>v_attempt.provider_mode or p_session_id !~ '^cs_(test_|live_)[A-Za-z0-9]+$'
    or (p_mode='test' and p_session_id not like 'cs_test_%') or (p_mode='live' and p_session_id like 'cs_test_%')
    or abs(extract(epoch from (p_expires_at-v_attempt.provider_session_expires_at)))>=1 then
    raise exception using errcode='22023',message='provider_response_invalid'; end if;
  if v_attempt.provider_session_id is not null and v_attempt.provider_session_id<>p_session_id then
    raise exception using errcode='P0001',message='provider_session_conflict'; end if;
  if v_attempt.state not in ('creating','unknown') then return app_private.checkout_attempt_dto(v_attempt); end if;
  update public.app_checkout_attempts set provider_session_id=p_session_id,state='open',provider_create_lease_until=null,last_provider_error_code=null,updated_at=now()
    where attempt_id=p_attempt_id returning * into v_attempt;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'checkout.session.created','checkout_attempt',v_attempt.attempt_id,jsonb_build_object('mode',p_mode));
  return app_private.checkout_attempt_dto(v_attempt);
end $function$;
revoke all on function public.bind_table_checkout_session(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.bind_table_checkout_session(uuid,uuid,text,text,timestamptz) to service_role;

create function public.mark_table_checkout_unknown(p_actor uuid,p_attempt_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  update public.app_checkout_attempts set state='unknown',provider_create_lease_until=null,updated_at=now()
    where attempt_id=p_attempt_id and auth_user_id=p_actor and state in ('creating','open');
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'checkout.session.unknown','checkout_attempt',p_attempt_id,'{}'::jsonb);
end $function$;
revoke all on function public.mark_table_checkout_unknown(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_table_checkout_unknown(uuid,uuid) to service_role;

create function public.release_table_checkout_attempt(p_actor uuid,p_attempt_id uuid,p_safe_error_code text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype;
begin
  perform app_private.require_service_role();
  if p_safe_error_code not in ('session_expiry_too_soon','provider_rejected') then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_attempt from public.app_checkout_attempts where attempt_id=p_attempt_id and auth_user_id=p_actor for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_attempt.provider_session_id is not null then raise exception using errcode='P0001',message='attempt_recovery_required'; end if;
  if v_attempt.state not in ('creating','unknown','released') then raise exception using errcode='P0001',message='attempt_not_releasable'; end if;
  update public.app_checkout_attempts set state='released',provider_create_lease_until=null,last_provider_error_code=p_safe_error_code,updated_at=now()
    where attempt_id=p_attempt_id returning * into v_attempt;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'checkout.hold.released','checkout_attempt',p_attempt_id,jsonb_build_object('code',p_safe_error_code));
  return app_private.checkout_attempt_dto(v_attempt);
end $function$;
revoke all on function public.release_table_checkout_attempt(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.release_table_checkout_attempt(uuid,uuid,text) to service_role;

create function public.read_my_checkout_attempt(p_actor uuid,p_attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_attempt public.app_checkout_attempts%rowtype; v_seat uuid; v_state text;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from auth.users u join public.app_admissions a on a.auth_user_id=u.id and a.state='activated'
    where u.id=p_actor and u.email_confirmed_at is not null) then raise exception using errcode='42501',message='member_not_admitted'; end if;
  select * into v_attempt from public.app_checkout_attempts where attempt_id=p_attempt_id and auth_user_id=p_actor;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select s.seat_id,p.state into v_seat,v_state from public.app_seats s join public.app_payments p on p.payment_id=s.payment_id
    where s.invitation_id=v_attempt.invitation_id and s.state in ('confirmed','cancellation_requested','completed') limit 1;
  return jsonb_build_object('attempt',app_private.checkout_attempt_dto(v_attempt),
    'paymentState',case when v_seat is not null then 'confirmed' when v_attempt.state='processing' then 'processing'
      when v_attempt.state='unknown' then 'unknown' else 'not_started' end,'seatId',v_seat);
end $function$;
revoke all on function public.read_my_checkout_attempt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_my_checkout_attempt(uuid,uuid) to service_role;
