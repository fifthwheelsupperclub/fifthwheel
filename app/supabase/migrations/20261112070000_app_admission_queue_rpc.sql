-- Atomically approve/reuse one app admission and queue one idempotent
-- invitation-delivery operation. This RPC is callable only by service_role;
-- the server must independently verify the requester before calling it.

create function public.admit_waitlist_signup(
  p_signup_id uuid,
  p_operation_id uuid,
  p_approved_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_signup public.waitlist_signups%rowtype;
  v_admission public.app_admissions%rowtype;
  v_delivery public.app_invitation_deliveries%rowtype;
  v_admission_created boolean := false;
  v_delivery_created boolean := false;
begin
  if p_signup_id is null or p_operation_id is null or p_approved_by is null then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  -- Check a trusted admin role in the database as a second authorization layer.
  -- Holding a key-share lock prevents the role from being removed mid-operation.
  perform 1
  from public.app_user_roles as role_row
  where role_row.user_id = p_approved_by
    and role_row.role = 'admin'
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;

  -- Serialize separate operation IDs for the same signup before admission lookup.
  select signup.*
  into v_signup
  from public.waitlist_signups as signup
  where signup.id = p_signup_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'waitlist_signup_not_found';
  end if;

  insert into public.app_admissions (
    waitlist_signup_id,
    email_normalized,
    approved_by
  ) values (
    v_signup.id,
    v_signup.email_normalized,
    p_approved_by
  )
  on conflict (waitlist_signup_id) do nothing
  returning * into v_admission;

  if found then
    v_admission_created := true;
  else
    select admission.*
    into v_admission
    from public.app_admissions as admission
    where admission.waitlist_signup_id = v_signup.id
    for update;
    if not found then
      -- Covers the email unique constraint conflicting with a different signup.
      raise exception using errcode = '23505', message = 'admission_conflict';
    end if;
  end if;

  if v_admission.state in ('activated', 'deleted') then
    raise exception using errcode = '23514', message = 'admission_not_invitable';
  end if;

  insert into public.app_invitation_deliveries (
    admission_id,
    operation_id,
    created_by
  ) values (
    v_admission.id,
    p_operation_id,
    p_approved_by
  )
  on conflict (operation_id) do nothing
  returning * into v_delivery;

  if found then
    v_delivery_created := true;
  else
    select delivery.*
    into v_delivery
    from public.app_invitation_deliveries as delivery
    where delivery.operation_id = p_operation_id
    for update;
    if not found then
      raise exception using errcode = '23505', message = 'delivery_operation_conflict';
    end if;
    if v_delivery.admission_id <> v_admission.id then
      raise exception using errcode = '23505', message = 'operation_id_subject_conflict';
    end if;
  end if;

  if v_admission_created then
    insert into public.app_audit_events (
      actor_type,
      actor_user_id,
      action,
      subject_type,
      subject_id,
      operation_id,
      metadata
    ) values (
      'user',
      p_approved_by,
      'app.admission.invited',
      'app_admission',
      v_admission.id,
      p_operation_id,
      '{"state":"invited"}'::jsonb
    );
  end if;

  if v_delivery_created then
    insert into public.app_audit_events (
      actor_type,
      actor_user_id,
      action,
      subject_type,
      subject_id,
      operation_id,
      metadata
    ) values (
      'user',
      p_approved_by,
      'app.invitation.queued',
      'invitation_delivery',
      v_delivery.id,
      p_operation_id,
      '{"state":"queued"}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'admission', to_jsonb(v_admission),
    'delivery', to_jsonb(v_delivery),
    'created', v_admission_created,
    'delivery_created', v_delivery_created
  );
end;
$function$;

revoke all on function public.admit_waitlist_signup(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admit_waitlist_signup(uuid, uuid, uuid)
  to service_role;

comment on function public.admit_waitlist_signup(uuid, uuid, uuid) is
  'Atomically reuses or creates an invited app admission and queues an idempotent invitation operation. Server authorization and database admin-role checks are both required.';
