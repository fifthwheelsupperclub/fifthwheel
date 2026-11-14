-- Verified Auth callback activation and per-admission returning-link cooldown.
-- Existing rows are preserved; this is additive and does not reset local data.

create table public.app_member_link_cooldowns (
  admission_id uuid primary key references public.app_admissions(id) on delete cascade,
  last_requested_at timestamptz not null
);

alter table public.app_member_link_cooldowns enable row level security;
revoke all on public.app_member_link_cooldowns from anon, authenticated;
revoke all on public.app_member_link_cooldowns from public;
grant select, insert, update, delete on public.app_member_link_cooldowns to service_role;

create or replace function public.activate_app_admission(
  p_auth_user_id uuid,
  p_email_normalized text,
  p_activated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admission public.app_admissions%rowtype;
  v_kind text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_auth_user_id is null
     or p_email_normalized is null
     or p_email_normalized <> lower(btrim(p_email_normalized))
     or p_email_normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_activated_at is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select admission.* into v_admission
  from public.app_admissions as admission
  where admission.email_normalized = p_email_normalized
  for update;

  if not found or v_admission.state = 'deleted' then
    return jsonb_build_object('kind', 'not_admitted');
  end if;
  if v_admission.auth_user_id is not null and v_admission.auth_user_id <> p_auth_user_id then
    return jsonb_build_object('kind', 'not_admitted');
  end if;
  if v_admission.state = 'activated' then
    if v_admission.auth_user_id <> p_auth_user_id then
      return jsonb_build_object('kind', 'not_admitted');
    end if;
    v_kind := 'already_active';
  else
    update public.app_admissions as admission
    set auth_user_id = p_auth_user_id,
        state = 'activated',
        activated_at = p_activated_at,
        updated_at = p_activated_at
    where admission.id = v_admission.id
    returning admission.* into v_admission;
    v_kind := 'activated';

    insert into public.app_audit_events (
      actor_type, actor_user_id, system_actor, action, subject_type, subject_id,
      operation_id, metadata
    ) values (
      'system', null, 'auth_callback', 'app.admission.activated', 'app_admission', v_admission.id,
      null, jsonb_build_object('from_state', 'invited', 'to_state', 'activated')
    );
  end if;

  return jsonb_build_object('kind', v_kind, 'admission', to_jsonb(v_admission));
end;
$$;

revoke all on function public.activate_app_admission(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.activate_app_admission(uuid, text, timestamptz) to service_role;

create or replace function public.claim_member_link_cooldown(
  p_admission_id uuid,
  p_requested_at timestamptz,
  p_cooldown_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_claimed boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_admission_id is null or p_requested_at is null or p_cooldown_seconds is null or p_cooldown_seconds < 30 or p_cooldown_seconds > 3600 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select admission.state into v_state
  from public.app_admissions as admission
  where admission.id = p_admission_id
  for share;
  if v_state is distinct from 'activated' then
    return false;
  end if;

  insert into public.app_member_link_cooldowns as cooldown (admission_id, last_requested_at)
  values (p_admission_id, p_requested_at)
  on conflict (admission_id) do update
    set last_requested_at = excluded.last_requested_at
    where cooldown.last_requested_at <= excluded.last_requested_at - make_interval(secs => p_cooldown_seconds)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_member_link_cooldown(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_member_link_cooldown(uuid, timestamptz, integer) to service_role;
