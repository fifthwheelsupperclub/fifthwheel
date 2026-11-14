-- Durable per-attempt admission delivery claims and outcomes.
-- Caller operation IDs are independent from the admission's queue operation ID.

alter table public.app_invitation_delivery_attempts
  add column operation_id uuid default gen_random_uuid(),
  add column started_by_user_id uuid references auth.users(id) on delete restrict;

update public.app_invitation_delivery_attempts
set operation_id = gen_random_uuid()
where operation_id is null;

alter table public.app_invitation_delivery_attempts
  alter column operation_id set not null;

create unique index app_delivery_attempts_operation_idx
  on public.app_invitation_delivery_attempts (operation_id);

comment on column public.app_invitation_delivery_attempts.operation_id is
  'Caller-supplied idempotency key for this attempt, distinct from the delivery queue operation ID.';
comment on column public.app_invitation_delivery_attempts.started_by_user_id is
  'Trusted admin Auth user who explicitly started this delivery attempt; null only for historical pre-RPC rows.';

-- The existing smallint bound reflects storage capacity, not product policy.
-- NOT VALID preserves compatibility with any prior rows while enforcing the
-- 21–120 matching-age range on all new or updated waitlist rows.
alter table public.waitlist_signups
  add constraint waitlist_signups_matching_age_21_120
  check (
    match_age_min between 21 and 120
    and match_age_max between match_age_min and 120
  ) not valid;

create function public.begin_invitation_delivery_attempt(
  p_delivery_id uuid,
  p_operation_id uuid,
  p_started_by_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery public.app_invitation_deliveries%rowtype;
  v_admission public.app_admissions%rowtype;
  v_attempt public.app_invitation_delivery_attempts%rowtype;
  v_created boolean := false;
  v_attempt_number integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_delivery_id is null or p_operation_id is null or p_started_by_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  perform 1
  from public.app_user_roles as role_row
  where role_row.user_id = p_started_by_user_id
    and role_row.role = 'admin'
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  -- Serialize reuse of one operation UUID, including attempts targeting
  -- different deliveries. A retry with the same key returns its prior row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_operation_id::text, 0)
  );

  select attempt.*
  into v_attempt
  from public.app_invitation_delivery_attempts as attempt
  where attempt.operation_id = p_operation_id
  for update;
  if found then
    if v_attempt.delivery_id <> p_delivery_id
      or v_attempt.started_by_user_id is distinct from p_started_by_user_id then
      raise exception using errcode = '23505', message = 'attempt_operation_id_conflict';
    end if;
    select delivery.* into v_delivery
    from public.app_invitation_deliveries as delivery
    where delivery.id = p_delivery_id;
    if not found then
      raise exception using errcode = 'P0002', message = 'delivery_not_found';
    end if;
    return pg_catalog.jsonb_build_object(
      'delivery', pg_catalog.to_jsonb(v_delivery),
      'attempt', pg_catalog.to_jsonb(v_attempt),
      'created', false
    );
  end if;

  select delivery.*
  into v_delivery
  from public.app_invitation_deliveries as delivery
  where delivery.id = p_delivery_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'delivery_not_found';
  end if;

  select admission.*
  into v_admission
  from public.app_admissions as admission
  where admission.id = v_delivery.admission_id
  for key share;
  if not found then
    raise exception using errcode = 'P0002', message = 'admission_not_found';
  end if;
  if v_admission.state <> 'invited' then
    return null;
  end if;

  -- Unknown is deliberately terminal until a separate reconciliation decision.
  -- An in-flight, accepted, delivered, deleted-member or not-yet-due delivery
  -- cannot be claimed by another attempt.
  if v_delivery.state not in ('queued', 'failed')
    or v_delivery.next_attempt_at > v_now then
    return null;
  end if;

  v_attempt_number := v_delivery.attempt_count + 1;
  update public.app_invitation_deliveries
  set state = 'sending',
      attempt_count = v_attempt_number,
      attempted_at = v_now,
      lease_until = v_now + interval '10 minutes',
      provider_message_id = null,
      error_code = null,
      accepted_at = null,
      delivered_at = null
  where id = v_delivery.id
  returning * into v_delivery;

  insert into public.app_invitation_delivery_attempts (
    delivery_id,
    operation_id,
    started_by_user_id,
    attempt_number,
    state,
    started_at
  ) values (
    v_delivery.id,
    p_operation_id,
    p_started_by_user_id,
    v_attempt_number,
    'sending',
    v_now
  ) returning * into v_attempt;
  v_created := true;

  if v_attempt_number > 1 then
    insert into public.app_audit_events (
      actor_type, actor_user_id, action, subject_type, subject_id,
      operation_id, metadata
    ) values (
      'user', p_started_by_user_id, 'app.invitation.retry_requested',
      'invitation_delivery', v_delivery.id, p_operation_id,
      pg_catalog.jsonb_build_object('state', 'sending', 'attempt_number', v_attempt_number)
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'delivery', pg_catalog.to_jsonb(v_delivery),
    'attempt', pg_catalog.to_jsonb(v_attempt),
    'created', v_created
  );
end;
$function$;

revoke all on function public.begin_invitation_delivery_attempt(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_invitation_delivery_attempt(uuid, uuid, uuid)
  to service_role;

comment on function public.begin_invitation_delivery_attempt(uuid, uuid, uuid) is
  'Claims an invitation send attempt once per operation UUID; service-role only, with a database-verified admin actor. Unknown attempts are never resent.';

create function public.finish_invitation_delivery_attempt(
  p_attempt_id uuid,
  p_state text,
  p_provider_message_id text,
  p_error_code text,
  p_finished_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delivery_id uuid;
  v_delivery public.app_invitation_deliveries%rowtype;
  v_attempt public.app_invitation_delivery_attempts%rowtype;
  v_action text;
begin
  if p_attempt_id is null
    or p_state not in ('accepted', 'failed', 'unknown')
    or p_finished_at is null
    or (p_provider_message_id is not null and (
      pg_catalog.length(p_provider_message_id) > 200
      or p_provider_message_id ~ '[[:cntrl:]]'
    ))
    or (p_error_code is not null and p_error_code !~ '^[a-z0-9_.-]{1,100}$') then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select attempt.delivery_id into v_delivery_id
  from public.app_invitation_delivery_attempts as attempt
  where attempt.id = p_attempt_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'attempt_not_found';
  end if;

  -- Use the same delivery-before-attempt lock order as begin, so a finisher
  -- cannot race a newer claim or deadlock with one.
  select delivery.* into v_delivery
  from public.app_invitation_deliveries as delivery
  where delivery.id = v_delivery_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'delivery_not_found';
  end if;

  select attempt.* into v_attempt
  from public.app_invitation_delivery_attempts as attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'attempt_not_found';
  end if;

  if v_attempt.state <> 'sending' then
    -- Exact duplicate finishes are idempotent. A different result can never
    -- rewrite a completed attempt or its parent delivery.
    if v_attempt.state = p_state
      and v_attempt.provider_message_id is not distinct from p_provider_message_id
      and v_attempt.error_code is not distinct from p_error_code
      and v_attempt.finished_at = p_finished_at then
      return pg_catalog.jsonb_build_object('delivery', pg_catalog.to_jsonb(v_delivery), 'attempt', pg_catalog.to_jsonb(v_attempt));
    end if;
    raise exception using errcode = '23514', message = 'attempt_already_finished';
  end if;

  if v_attempt.attempt_number <> v_delivery.attempt_count
    or v_delivery.state <> 'sending'
    or p_finished_at < v_attempt.started_at
    or p_finished_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '23514', message = 'stale_or_invalid_attempt_finish';
  end if;

  update public.app_invitation_delivery_attempts
  set state = p_state,
      provider_message_id = p_provider_message_id,
      error_code = p_error_code,
      finished_at = p_finished_at
  where id = p_attempt_id
  returning * into v_attempt;

  update public.app_invitation_deliveries
  set state = p_state,
      provider_message_id = p_provider_message_id,
      error_code = p_error_code,
      lease_until = null,
      next_attempt_at = case when p_state = 'failed' then p_finished_at else next_attempt_at end,
      accepted_at = case when p_state = 'accepted' then p_finished_at else null end,
      delivered_at = null
  where id = v_delivery.id
  returning * into v_delivery;

  v_action := case p_state
    when 'accepted' then 'app.invitation.accepted'
    when 'failed' then 'app.invitation.failed'
    else 'app.invitation.unknown'
  end;
  insert into public.app_audit_events (
    actor_type, system_actor, action, subject_type, subject_id,
    operation_id, metadata
  ) values (
    'system', 'email_delivery_worker', v_action, 'delivery_attempt', v_attempt.id,
    v_attempt.operation_id,
    pg_catalog.jsonb_build_object('state', p_state, 'attempt_number', v_attempt.attempt_number)
  );

  return pg_catalog.jsonb_build_object('delivery', pg_catalog.to_jsonb(v_delivery), 'attempt', pg_catalog.to_jsonb(v_attempt));
end;
$function$;

revoke all on function public.finish_invitation_delivery_attempt(uuid, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_invitation_delivery_attempt(uuid, text, text, text, timestamptz)
  to service_role;

comment on function public.finish_invitation_delivery_attempt(uuid, text, text, text, timestamptz) is
  'Persists one provider attempt result atomically; only the current sending attempt can update its delivery, and unknown remains non-resendable.';
