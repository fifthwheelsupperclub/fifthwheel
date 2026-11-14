-- Correct the consumed-byte comparison in the upload state transition.
create or replace function public.consume_profile_upload_grant(
  p_auth_user_id uuid,
  p_file_id uuid,
  p_token_hash text,
  p_received_size integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_file public.app_profile_files%rowtype;
  v_profile public.app_member_profiles%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_file from public.app_profile_files f
    where f.file_id = p_file_id and f.auth_user_id = p_auth_user_id for update;
  if not found then raise exception using errcode='P0002', message='upload_not_found'; end if;

  select * into v_profile from public.app_member_profiles p where p.guest_id=v_file.guest_id for update;
  if v_file.state <> 'pending_upload' or v_file.upload_consumed_at is not null
     or v_file.upload_expires_at <= now() or v_file.upload_token_hash is distinct from p_token_hash then
    raise exception using errcode='42501', message='upload_grant_invalid';
  end if;
  if v_file.profile_revision_at_intent <> v_profile.profile_revision
     or v_file.critical_identity_version <> v_profile.critical_identity_version
     or p_received_size <> v_file.declared_byte_size or p_received_size > 8388608 then
    raise exception using errcode='40001', message='upload_intent_stale_or_size_mismatch';
  end if;

  update public.app_profile_files f set
    upload_consumed_at=now(), upload_token_hash=null, upload_expires_at=null,
    actual_byte_size=p_received_size, state='quarantined', received_at=now(),
    retention_due_at=now()+interval '7 days', updated_at=now()
  where f.file_id=p_file_id returning * into v_file;
  return to_jsonb(v_file);
end;
$function$;

revoke all on function public.consume_profile_upload_grant(uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.consume_profile_upload_grant(uuid,uuid,text,integer) to service_role;
