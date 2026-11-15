-- Resolve an unknown attempt only from exact provider evidence; this never resends.
create function public.reconcile_unknown_invitation_attempt(
  p_attempt_id uuid,
  p_state text,
  p_provider_message_id text,
  p_resolved_at timestamptz
) returns jsonb
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
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_attempt_id is null or p_state is null or p_state not in ('accepted', 'failed', 'unknown') or p_resolved_at is null
    or (p_provider_message_id is not null and (pg_catalog.length(p_provider_message_id) > 200 or p_provider_message_id ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  select attempt.delivery_id into v_delivery_id
  from public.app_invitation_delivery_attempts as attempt
  where attempt.id = p_attempt_id;
  if not found then raise exception using errcode = 'P0002', message = 'attempt_not_found'; end if;

  select delivery.* into v_delivery
  from public.app_invitation_deliveries as delivery
  where delivery.id = v_delivery_id for update;
  select attempt.* into v_attempt
  from public.app_invitation_delivery_attempts as attempt
  where attempt.id = p_attempt_id for update;

  if p_state = 'unknown' then
    if v_attempt.state = 'unknown' and v_delivery.state = 'unknown' then
      return pg_catalog.jsonb_build_object('delivery', pg_catalog.to_jsonb(v_delivery), 'attempt', pg_catalog.to_jsonb(v_attempt), 'changed', false);
    end if;
    raise exception using errcode = '23514', message = 'attempt_not_unknown';
  end if;

  if v_attempt.state <> 'unknown' or v_delivery.state <> 'unknown'
    or v_attempt.attempt_number <> v_delivery.attempt_count
    or p_resolved_at < v_attempt.started_at
    or p_resolved_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '23514', message = 'stale_or_unresolved_attempt';
  end if;

  update public.app_invitation_delivery_attempts
  set state = p_state, provider_message_id = p_provider_message_id, error_code = null, finished_at = p_resolved_at
  where id = p_attempt_id returning * into v_attempt;
  update public.app_invitation_deliveries
  set state = p_state, provider_message_id = p_provider_message_id, error_code = null, lease_until = null,
      accepted_at = case when p_state = 'accepted' then p_resolved_at else null end,
      delivered_at = null,
      next_attempt_at = case when p_state = 'failed' then p_resolved_at else next_attempt_at end
  where id = v_delivery_id returning * into v_delivery;
  v_action := case p_state when 'accepted' then 'app.invitation.accepted' else 'app.invitation.failed' end;
  insert into public.app_audit_events (actor_type, system_actor, action, subject_type, subject_id, operation_id, metadata)
  values ('system', 'email_delivery_worker', v_action, 'delivery_attempt', v_attempt.id, v_attempt.operation_id,
    pg_catalog.jsonb_build_object('from_state', 'unknown', 'to_state', p_state, 'attempt_number', v_attempt.attempt_number));
  return pg_catalog.jsonb_build_object('delivery', pg_catalog.to_jsonb(v_delivery), 'attempt', pg_catalog.to_jsonb(v_attempt), 'changed', true);
end;
$function$;

revoke all on function public.reconcile_unknown_invitation_attempt(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_unknown_invitation_attempt(uuid, text, text, timestamptz) to service_role;
