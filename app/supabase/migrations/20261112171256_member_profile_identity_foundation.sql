-- W04 private member profile, upload-intent, and identity-review foundation.
-- All writes are mediated by server-only RPCs; no Data API role can query these rows.

create or replace function app_private.is_safe_audit_metadata(p_metadata jsonb)
returns boolean language sql immutable strict set search_path = ''
as $function$
  select jsonb_typeof(p_metadata)='object'
    and (select count(*) from jsonb_object_keys(p_metadata))<=7
    and not exists(select 1 from jsonb_each(p_metadata) as entry(key,value) where case
      when entry.key in ('state','from_state','to_state') then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' in ('invited','activated','deleted','queued','sending','accepted','delivered','failed','unknown')
      when entry.key='reason_code' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' in ('validation_failed','unauthenticated','forbidden','not_found','rate_limited','conflict',
          'invalid_link','provider_rejected','provider_outcome_unknown','temporarily_unavailable','duplicate_request','honeypot_ignored')
      when entry.key='attempt_number' then jsonb_typeof(entry.value)='number' and entry.value #>> '{}' ~ '^[0-9]{1,3}$'
      when entry.key='retryable' then jsonb_typeof(entry.value)='boolean'
      when entry.key='guest_id' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      when entry.key='critical_identity_version' then jsonb_typeof(entry.value)='number'
        and entry.value #>> '{}' ~ '^[0-9]{1,9}$'
      when entry.key='decision' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' in ('approved','resubmission_required')
      else false end is not true);
$function$;
revoke all on function app_private.is_safe_audit_metadata(jsonb) from public,anon,authenticated;
grant execute on function app_private.is_safe_audit_metadata(jsonb) to service_role;

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check (action in (
  'waitlist.signup.created','app.admission.invited','app.admission.activated','app.admission.deleted',
  'app.invitation.queued','app.invitation.accepted','app.invitation.delivered','app.invitation.failed',
  'app.invitation.unknown','app.invitation.retry_requested','member_link.requested','auth.callback.rejected',
  'authorization.denied','identity.evidence.read','identity.review.decided'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup','app_admission','invitation_delivery','delivery_attempt','auth_identity','member_link_request',
  'profile_file','identity_review'
));

create table public.app_member_profiles (
  guest_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  admission_id uuid not null unique references public.app_admissions(id) on delete restrict,
  profile_revision integer not null default 1 check (profile_revision > 0),
  critical_identity_version integer not null default 1 check (critical_identity_version > 0),
  reviewed_identity_version integer,
  identity_status text not null default 'draft'
    check (identity_status in ('draft','submitted','approved','resubmission_required')),
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  date_of_birth date not null,
  identity text not null check (identity in ('woman','man','non_binary')),
  open_to text[] not null check (app_private.is_valid_open_to(open_to)),
  match_age_min smallint not null check (match_age_min between 21 and 120),
  match_age_max smallint not null check (match_age_max between match_age_min and 120),
  neighborhood text not null check (length(btrim(neighborhood)) between 1 and 120),
  nights text[] not null default '{}',
  looking_for text not null check (looking_for in ('Casual','Open','Relationship')),
  surprise_game text not null check (surprise_game in ('Yes, surprise me','I''d rather keep it conversational')),
  phone text check (phone is null or length(phone) <= 40),
  one_liner text check (one_liner is null or length(one_liner) <= 1000),
  latest_correction_reason text check (latest_correction_reason is null or length(latest_correction_reason) <= 2000),
  evidence_received_at timestamptz,
  evidence_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (match_age_max >= match_age_min),
  check (cardinality(nights) <= 7),
  check (nights <@ array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[]),
  check (date_of_birth <= (timezone('America/New_York', now())::date - interval '21 years')::date),
  check (reviewed_identity_version is null or reviewed_identity_version <= critical_identity_version)
);

create table public.app_identity_reviews (
  review_id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.app_member_profiles(guest_id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  profile_revision integer not null check (profile_revision > 0),
  critical_identity_version integer not null check (critical_identity_version > 0),
  state text not null check (state in ('submitted','approved','resubmission_required','superseded')),
  correction_reason text check (correction_reason is null or length(correction_reason) between 1 and 2000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  evidence_received_at timestamptz,
  evidence_deleted_at timestamptz,
  unique (guest_id, attempt_number),
  check ((state = 'submitted') = (reviewed_at is null)),
  check ((state in ('approved','resubmission_required')) = (reviewed_by is not null)),
  check ((state = 'resubmission_required') = (correction_reason is not null))
);

create table public.app_profile_files (
  file_id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.app_member_profiles(guest_id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('photo','selfie')),
  state text not null default 'pending_upload'
    check (state in ('pending_upload','quarantined','normalizing','ready','rejected','superseded','deleted')),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  declared_byte_size integer not null check (declared_byte_size between 1 and 8388608),
  actual_byte_size integer check (actual_byte_size between 1 and 8388608),
  normalized_byte_size integer check (normalized_byte_size between 1 and 8388608),
  width integer check (width between 1 and 4096),
  height integer check (height between 1 and 4096),
  profile_revision_at_intent integer not null,
  critical_identity_version integer not null,
  quarantine_key text unique,
  normalized_key text unique,
  upload_token_hash text,
  upload_expires_at timestamptz,
  upload_consumed_at timestamptz,
  received_at timestamptz,
  retention_due_at timestamptz,
  deleted_at timestamptz,
  cleanup_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'ready') = (normalized_key is not null and normalized_byte_size is not null)),
  check ((upload_token_hash is null) = (upload_expires_at is null)),
  check (state <> 'ready' or (received_at is not null and upload_consumed_at is not null))
);

create index app_profile_files_owner_idx on public.app_profile_files (guest_id, created_at, file_id);
create index app_profile_files_retention_idx on public.app_profile_files (retention_due_at, file_id)
  where deleted_at is null and state in ('ready','superseded','rejected','quarantined');
create index app_identity_reviews_queue_idx on public.app_identity_reviews (submitted_at, review_id)
  where state = 'submitted';
create unique index app_identity_reviews_one_active_per_guest_idx on public.app_identity_reviews (guest_id)
  where state = 'submitted';

alter table public.app_member_profiles enable row level security;
alter table public.app_identity_reviews enable row level security;
alter table public.app_profile_files enable row level security;
revoke all on public.app_member_profiles, public.app_identity_reviews, public.app_profile_files from public, anon, authenticated;
grant select, insert, update, delete on public.app_member_profiles, public.app_identity_reviews, public.app_profile_files to service_role;

-- Local rewrite Storage is server-mediated. No browser Data API role may read or mutate objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-evidence','identity-evidence',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
do $bucket_check$
begin
  if not exists (select 1 from storage.buckets b where b.id='identity-evidence' and b.public=false
    and b.file_size_limit=8388608 and b.allowed_mime_types @> array['image/jpeg','image/png','image/webp']::text[]
    and cardinality(b.allowed_mime_types)=3) then
    raise exception 'identity-evidence bucket exists with incompatible settings';
  end if;
end;
$bucket_check$;
revoke all on storage.objects from anon, authenticated;

create function app_private.require_service_role()
returns void language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role','') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service_role_required';
  end if;
end;
$function$;
revoke all on function app_private.require_service_role() from public, anon, authenticated;
grant execute on function app_private.require_service_role() to service_role;

create function public.ensure_member_profile(p_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_admission public.app_admissions%rowtype;
  v_signup public.waitlist_signups%rowtype;
  v_profile public.app_member_profiles%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_admission from public.app_admissions a
    where a.auth_user_id = p_auth_user_id and a.state = 'activated' for update;
  if not found then raise exception using errcode = 'P0002', message = 'member_not_admitted'; end if;
  select * into v_signup from public.waitlist_signups s where s.id = v_admission.waitlist_signup_id;
  insert into public.app_member_profiles (
    auth_user_id, admission_id, first_name, last_name, date_of_birth, identity, open_to,
    match_age_min, match_age_max, neighborhood, nights, looking_for, surprise_game
  ) values (
    p_auth_user_id, v_admission.id, v_signup.first_name, v_signup.last_name, v_signup.birthdate,
    case v_signup.identity when 'Woman' then 'woman' when 'Man' then 'man' else 'non_binary' end,
    case when 'Women' = any(v_signup.open_to) then array_append(array[]::text[],'woman') else array[]::text[] end
      || case when 'Men' = any(v_signup.open_to) then array['man']::text[] else array[]::text[] end
      || case when 'Non-binary people' = any(v_signup.open_to) then array['non_binary']::text[] else array[]::text[] end,
    v_signup.match_age_min, v_signup.match_age_max, v_signup.neighborhood, v_signup.nights,
    v_signup.looking_for, v_signup.surprise_game
  ) on conflict (auth_user_id) do nothing;
  select * into v_profile from public.app_member_profiles p where p.auth_user_id = p_auth_user_id;
  return to_jsonb(v_profile);
end;
$function$;

create function public.save_member_profile(
  p_auth_user_id uuid, p_expected_revision integer, p_operation_id uuid,
  p_first_name text, p_last_name text, p_date_of_birth date, p_identity text,
  p_open_to text[], p_match_age_min smallint, p_match_age_max smallint,
  p_neighborhood text, p_nights text[], p_looking_for text, p_surprise_game text,
  p_phone text, p_one_liner text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_critical boolean;
begin
  perform app_private.require_service_role();
  select * into v_profile from public.app_member_profiles p where p.auth_user_id = p_auth_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'profile_not_found'; end if;
  if v_profile.profile_revision <> p_expected_revision then raise exception using errcode = '40001', message = 'profile_revision_conflict'; end if;
  v_critical := v_profile.date_of_birth <> p_date_of_birth or v_profile.identity <> p_identity;
  update public.app_member_profiles p set
    profile_revision = p.profile_revision + 1,
    critical_identity_version = p.critical_identity_version + case when v_critical then 1 else 0 end,
    reviewed_identity_version = case when v_critical then null else p.reviewed_identity_version end,
    identity_status = case when v_critical then 'draft' else p.identity_status end,
    latest_correction_reason = case when v_critical then null else p.latest_correction_reason end,
    evidence_received_at = case when v_critical then null else p.evidence_received_at end,
    evidence_deleted_at = case when v_critical then null else p.evidence_deleted_at end,
    first_name = p_first_name, last_name = p_last_name, date_of_birth = p_date_of_birth,
    identity = p_identity, open_to = p_open_to, match_age_min = p_match_age_min,
    match_age_max = p_match_age_max, neighborhood = p_neighborhood, nights = p_nights,
    looking_for = p_looking_for, surprise_game = p_surprise_game, phone = p_phone,
    one_liner = p_one_liner, updated_at = now()
  where p.guest_id = v_profile.guest_id returning * into v_profile;
  if v_critical then
    update public.app_identity_reviews r set state='superseded',reviewed_at=now()
      where r.guest_id=v_profile.guest_id and r.state='submitted';
    update public.app_profile_files f set state='superseded',retention_due_at=now()+interval '7 days',updated_at=now()
      where f.guest_id=v_profile.guest_id and f.state in ('ready','pending_upload','quarantined','normalizing');
  end if;
  return to_jsonb(v_profile);
end;
$function$;

create function public.create_profile_upload_intent(
  p_auth_user_id uuid, p_expected_revision integer, p_expected_identity_version integer,
  p_operation_id uuid, p_file_id uuid, p_kind text, p_content_type text,
  p_byte_size integer, p_quarantine_key text, p_token_hash text, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_count integer;
begin
  perform app_private.require_service_role();
  select * into v_profile from public.app_member_profiles p where p.auth_user_id=p_auth_user_id for update;
  if not found then raise exception using errcode='P0002', message='profile_not_found'; end if;
  if v_profile.profile_revision <> p_expected_revision or v_profile.critical_identity_version <> p_expected_identity_version then
    raise exception using errcode='40001', message='profile_revision_conflict';
  end if;
  if v_profile.identity_status='submitted' then raise exception using errcode='55000', message='profile_locked_for_review'; end if;
  update public.app_profile_files f set state='rejected',retention_due_at=now()+interval '7 days',updated_at=now()
    where f.guest_id=v_profile.guest_id and f.state='pending_upload' and f.upload_expires_at<=now();
  if p_operation_id is null or p_file_id is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '5 minutes'
     or p_token_hash is null
     or p_quarantine_key is distinct from ('quarantine/'||v_profile.guest_id::text||'/'||p_file_id::text) then
    raise exception using errcode='22023',message='invalid_upload_intent';
  end if;
  if p_kind not in ('photo','selfie') or p_content_type not in ('image/jpeg','image/png','image/webp') or p_byte_size not between 1 and 8388608 then
    raise exception using errcode='22023', message='invalid_upload';
  end if;
  select count(*) into v_count from public.app_profile_files f where f.guest_id=v_profile.guest_id
    and f.kind='photo' and (f.state in ('normalizing','ready')
      or (f.state='quarantined' and f.retention_due_at>now() and f.cleanup_claimed_at is null)
      or (f.state='pending_upload' and f.upload_expires_at>now()));
  if p_kind='photo' and v_count >= 6 then raise exception using errcode='22023', message='photo_limit'; end if;
  if p_kind='selfie' and exists(select 1 from public.app_profile_files f where f.guest_id=v_profile.guest_id
      and f.kind='selfie' and (f.state in ('normalizing','ready')
        or (f.state='quarantined' and f.retention_due_at>now() and f.cleanup_claimed_at is null)
        or (f.state='pending_upload' and f.upload_expires_at>now()))) then
    raise exception using errcode='22023', message='selfie_limit';
  end if;
  insert into public.app_profile_files (
    file_id,guest_id,auth_user_id,kind,state,content_type,declared_byte_size,
    profile_revision_at_intent,critical_identity_version,quarantine_key,upload_token_hash,upload_expires_at
  ) values (
    p_file_id,v_profile.guest_id,p_auth_user_id,p_kind,'pending_upload',p_content_type,p_byte_size,
    v_profile.profile_revision,v_profile.critical_identity_version,p_quarantine_key,p_token_hash,p_expires_at
  );
  return jsonb_build_object('file_id',p_file_id,'guest_id',v_profile.guest_id,'profile_revision',v_profile.profile_revision,
    'critical_identity_version',v_profile.critical_identity_version,'kind',p_kind,'content_type',p_content_type,
    'byte_size',p_byte_size,'expires_at',p_expires_at);
end;
$function$;

create function public.consume_profile_upload_grant(p_auth_user_id uuid, p_file_id uuid, p_token_hash text, p_received_size integer)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_file public.app_profile_files%rowtype; v_profile public.app_member_profiles%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_file from public.app_profile_files f where f.file_id=p_file_id and f.auth_user_id=p_auth_user_id for update;
  if not found then raise exception using errcode='P0002', message='upload_not_found'; end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=v_file.guest_id for update;
  if v_file.state <> 'pending_upload' or v_file.upload_consumed_at is not null or v_file.upload_expires_at <= now()
     or v_file.upload_token_hash is distinct from p_token_hash then
    raise exception using errcode='42501', message='upload_grant_invalid';
  end if;
  if v_file.profile_revision_at_intent <> v_profile.profile_revision or v_file.critical_identity_version <> v_profile.critical_identity_version
     or v_received_size <> v_file.declared_byte_size or v_received_size > 8388608 then
    raise exception using errcode='40001', message='upload_intent_stale_or_size_mismatch';
  end if;
  update public.app_profile_files f set upload_consumed_at=now(),upload_token_hash=null,upload_expires_at=null,
    actual_byte_size=p_received_size,state='quarantined',received_at=now(),retention_due_at=now()+interval '7 days',updated_at=now()
    where f.file_id=p_file_id returning * into v_file;
  return to_jsonb(v_file);
end;
$function$;

create function public.begin_profile_normalization(p_auth_user_id uuid,p_file_id uuid,p_expected_revision integer,p_expected_identity_version integer)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_file public.app_profile_files%rowtype; v_profile public.app_member_profiles%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_file from public.app_profile_files f where f.file_id=p_file_id and f.auth_user_id=p_auth_user_id for update;
  if not found or v_file.state<>'quarantined' or v_file.upload_consumed_at is null then
    raise exception using errcode='P0002',message='upload_not_quarantined';
  end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=v_file.guest_id for update;
  if v_profile.profile_revision<>p_expected_revision or v_profile.critical_identity_version<>p_expected_identity_version
    or v_file.profile_revision_at_intent<>p_expected_revision or v_file.critical_identity_version<>p_expected_identity_version
    or v_profile.identity_status='submitted' then
    raise exception using errcode='40001',message='profile_revision_conflict';
  end if;
  update public.app_profile_files f set state='normalizing',retention_due_at=null,updated_at=now()
    where f.file_id=p_file_id returning * into v_file;
  return to_jsonb(v_file);
end;
$function$;

create function public.finalize_profile_upload(
  p_auth_user_id uuid,p_file_id uuid,p_expected_revision integer,p_expected_identity_version integer,
  p_normalized_key text,p_normalized_type text,p_normalized_size integer,p_width integer,p_height integer
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_file public.app_profile_files%rowtype; v_profile public.app_member_profiles%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_file from public.app_profile_files f where f.file_id=p_file_id and f.auth_user_id=p_auth_user_id for update;
  if not found then raise exception using errcode='P0002', message='upload_not_found'; end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=v_file.guest_id for update;
  if v_file.state <> 'normalizing' or v_file.upload_consumed_at is null then raise exception using errcode='55000',message='upload_not_normalizing'; end if;
  if v_profile.profile_revision <> p_expected_revision or v_profile.critical_identity_version <> p_expected_identity_version
     or v_file.profile_revision_at_intent <> p_expected_revision or v_file.critical_identity_version <> p_expected_identity_version then
    raise exception using errcode='40001',message='profile_revision_conflict';
  end if;
  if p_normalized_type not in ('image/jpeg','image/png','image/webp') or p_normalized_size not between 1 and 8388608
     or p_width not between 1 and 4096 or p_height not between 1 and 4096
     or p_normalized_key is distinct from ('normalized/'||v_profile.guest_id::text||'/'||v_file.file_id::text||'/'||split_part(p_normalized_key,'/',4))
     or cardinality(string_to_array(p_normalized_key,'/'))<>4
     or split_part(p_normalized_key,'/',4) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode='22023',message='normalized_image_invalid';
  end if;
  update public.app_profile_files f set critical_identity_version=v_profile.critical_identity_version+1
    where f.guest_id=v_profile.guest_id and f.state='ready' and f.deleted_at is null;
  update public.app_profile_files f set state='ready',normalized_key=p_normalized_key,
    content_type=p_normalized_type,normalized_byte_size=p_normalized_size,width=p_width,height=p_height,
    critical_identity_version=v_profile.critical_identity_version+1,
    retention_due_at=null,updated_at=now() where f.file_id=p_file_id returning * into v_file;
  update public.app_profile_files f set state='superseded',retention_due_at=now()+interval '7 days',updated_at=now()
    where f.guest_id=v_profile.guest_id and f.file_id<>p_file_id
      and f.state in ('pending_upload','quarantined','normalizing');
  update public.app_member_profiles p set profile_revision=p.profile_revision+1,
    critical_identity_version=p.critical_identity_version+1,reviewed_identity_version=null,
    identity_status='draft',latest_correction_reason=null,evidence_received_at=now(),evidence_deleted_at=null,updated_at=now()
    where p.guest_id=v_profile.guest_id returning * into v_profile;
  return jsonb_build_object('profile',to_jsonb(v_profile),'file',to_jsonb(v_file));
end;
$function$;

create function public.delete_member_profile_file(p_auth_user_id uuid,p_file_id uuid,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_file public.app_profile_files%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_file from public.app_profile_files f where f.file_id=p_file_id and f.auth_user_id=p_auth_user_id for update;
  if not found then raise exception using errcode='P0002',message='file_not_found'; end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=v_file.guest_id for update;
  if v_profile.profile_revision<>p_expected_revision then raise exception using errcode='40001',message='profile_revision_conflict'; end if;
  if v_profile.identity_status='submitted' then raise exception using errcode='55000',message='profile_locked_for_review'; end if;
  if v_file.state in ('deleted','superseded') then
    return jsonb_build_object('profile',to_jsonb(v_profile),'file',to_jsonb(v_file));
  end if;
  update public.app_profile_files f set state='superseded',retention_due_at=now()+interval '7 days',updated_at=now()
    where f.file_id=p_file_id returning * into v_file;
  update public.app_member_profiles p set profile_revision=p.profile_revision+1,
    critical_identity_version=p.critical_identity_version+1,reviewed_identity_version=null,
    identity_status='draft',latest_correction_reason=null,updated_at=now()
    where p.guest_id=v_profile.guest_id returning * into v_profile;
  update public.app_profile_files f set critical_identity_version=v_profile.critical_identity_version+1,updated_at=now()
    where f.guest_id=v_profile.guest_id and f.file_id<>p_file_id and f.state='ready' and f.deleted_at is null;
  update public.app_profile_files f set state='superseded',retention_due_at=now()+interval '7 days',updated_at=now()
    where f.guest_id=v_profile.guest_id and f.file_id<>p_file_id and f.state in ('pending_upload','quarantined','normalizing');
  return jsonb_build_object('profile',to_jsonb(v_profile),'file',to_jsonb(v_file));
end;
$function$;

create function public.prepare_identity_review_read(
  p_actor_user_id uuid,p_guest_id uuid,p_review_id uuid,p_expected_identity_version integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_review public.app_identity_reviews%rowtype; v_files jsonb;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501',message='admin_required';
  end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=p_guest_id for update;
  if not found or v_profile.identity_status<>'submitted' or v_profile.critical_identity_version<>p_expected_identity_version then
    raise exception using errcode='40001',message='review_revision_conflict';
  end if;
  select * into v_review from public.app_identity_reviews r where r.review_id=p_review_id and r.guest_id=p_guest_id
    and r.state='submitted' and r.critical_identity_version=p_expected_identity_version for update;
  if not found then raise exception using errcode='40001',message='review_revision_conflict'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('file_id',f.file_id,'kind',f.kind,'normalized_key',f.normalized_key)
    order by f.kind,f.created_at,f.file_id),'[]'::jsonb) into v_files
  from public.app_profile_files f where f.guest_id=p_guest_id and f.state='ready'
    and f.critical_identity_version=p_expected_identity_version and f.deleted_at is null and f.normalized_key is not null;
  if not exists(select 1 from public.app_profile_files f where f.guest_id=p_guest_id and f.kind='photo' and f.state='ready'
      and f.critical_identity_version=p_expected_identity_version and f.deleted_at is null and f.normalized_key is not null)
     or not exists(select 1 from public.app_profile_files f where f.guest_id=p_guest_id and f.kind='selfie' and f.state='ready'
      and f.critical_identity_version=p_expected_identity_version and f.deleted_at is null and f.normalized_key is not null) then
    raise exception using errcode='55000',message='current_evidence_unavailable';
  end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,request_id,metadata)
  select 'user',p_actor_user_id,'identity.evidence.read','profile_file',(file_json->>'file_id')::uuid,p_request_id,
    jsonb_build_object('guest_id',p_guest_id,'critical_identity_version',p_expected_identity_version)
  from jsonb_array_elements(v_files) as file_item(file_json);
  return jsonb_build_object('profile',to_jsonb(v_profile),'review',to_jsonb(v_review),'files',v_files);
end;
$function$;

create function public.confirm_identity_review_read_set(
  p_actor_user_id uuid,p_guest_id uuid,p_review_id uuid,p_expected_identity_version integer,
  p_request_id uuid,p_file_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_review public.app_identity_reviews%rowtype; v_files jsonb;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501',message='admin_required';
  end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=p_guest_id for update;
  if not found or v_profile.identity_status<>'submitted' or v_profile.critical_identity_version<>p_expected_identity_version then
    raise exception using errcode='40001',message='review_revision_conflict';
  end if;
  select * into v_review from public.app_identity_reviews r where r.review_id=p_review_id and r.guest_id=p_guest_id
    and r.state='submitted' and r.critical_identity_version=p_expected_identity_version for update;
  if not found or p_file_ids is null or cardinality(p_file_ids)<2 then
    raise exception using errcode='40001',message='review_revision_conflict';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('file_id',f.file_id,'kind',f.kind,'normalized_key',f.normalized_key)
    order by f.kind,f.created_at,f.file_id),'[]'::jsonb) into v_files
  from public.app_profile_files f where f.guest_id=p_guest_id and f.file_id=any(p_file_ids)
    and f.state='ready' and f.critical_identity_version=p_expected_identity_version and f.deleted_at is null
    and f.normalized_key is not null;
  if jsonb_array_length(v_files)<>cardinality(p_file_ids)
     or not exists(select 1 from jsonb_array_elements(v_files) as x(v) where x.v->>'kind'='photo')
     or not exists(select 1 from jsonb_array_elements(v_files) as x(v) where x.v->>'kind'='selfie') then
    raise exception using errcode='40001',message='review_file_set_stale';
  end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,request_id,metadata)
  select 'user',p_actor_user_id,'identity.evidence.read','profile_file',(file_json->>'file_id')::uuid,p_request_id,
    jsonb_build_object('guest_id',p_guest_id,'critical_identity_version',p_expected_identity_version)
  from jsonb_array_elements(v_files) as file_item(file_json);
  return v_files;
end;
$function$;

create function public.claim_due_profile_evidence_cleanup(p_limit integer)
returns setof jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_file public.app_profile_files%rowtype;
begin
  perform app_private.require_service_role();
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='invalid_limit'; end if;
  for v_file in
    select f.* from public.app_profile_files f join public.app_member_profiles p on p.guest_id=f.guest_id
    where f.retention_due_at<=now() and f.deleted_at is null
      and (f.cleanup_claimed_at is null or f.cleanup_claimed_at<=now()-interval '10 minutes')
      and (f.state in ('superseded','rejected') or f.state='quarantined' or
        (f.state='ready' and p.identity_status='approved' and p.reviewed_identity_version=f.critical_identity_version))
      and p.identity_status<>'submitted'
      and not exists(select 1 from public.app_identity_reviews r where r.guest_id=f.guest_id and r.state='submitted'
        and r.critical_identity_version=f.critical_identity_version)
    order by f.retention_due_at,f.file_id limit p_limit for update of f skip locked
  loop
    update public.app_profile_files f set cleanup_claimed_at=clock_timestamp(),updated_at=now() where f.file_id=v_file.file_id returning * into v_file;
    return next jsonb_build_object('file_id',v_file.file_id,'guest_id',v_file.guest_id,
      'quarantine_key',v_file.quarantine_key,'normalized_key',v_file.normalized_key,
      'critical_identity_version',v_file.critical_identity_version,'cleanup_claimed_at',v_file.cleanup_claimed_at);
  end loop;
end;
$function$;

create function public.finish_profile_evidence_cleanup(p_file_id uuid,p_claimed_at timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_file public.app_profile_files%rowtype; v_profile public.app_member_profiles%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_file from public.app_profile_files f where f.file_id=p_file_id for update;
  if not found then raise exception using errcode='P0002',message='file_not_found'; end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=v_file.guest_id for update;
  if v_file.cleanup_claimed_at is distinct from p_claimed_at or v_file.deleted_at is not null
     or not (v_file.state in ('superseded','rejected','quarantined')
       or (v_file.state='ready' and v_profile.identity_status='approved'
         and v_profile.reviewed_identity_version=v_file.critical_identity_version))
     or v_profile.identity_status='submitted'
     or exists(select 1 from public.app_identity_reviews r where r.guest_id=v_file.guest_id and r.state='submitted'
       and r.critical_identity_version=v_file.critical_identity_version) then
    raise exception using errcode='40001',message='cleanup_claim_stale';
  end if;
  update public.app_profile_files f set state='deleted',deleted_at=now(),quarantine_key=null,normalized_key=null,
    cleanup_claimed_at=null,updated_at=now() where f.file_id=p_file_id returning * into v_file;
  update public.app_member_profiles p set evidence_deleted_at=now(),updated_at=now() where p.guest_id=v_file.guest_id;
  update public.app_identity_reviews r set evidence_deleted_at=now() where r.guest_id=v_file.guest_id
    and r.critical_identity_version=v_file.critical_identity_version and r.state<>'submitted';
  return jsonb_build_object('file_id',v_file.file_id,'deleted_at',v_file.deleted_at);
end;
$function$;

create function public.fail_profile_upload(p_auth_user_id uuid,p_file_id uuid,p_safe_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_file public.app_profile_files%rowtype;
begin
  perform app_private.require_service_role();
  update public.app_profile_files f set state='rejected',upload_token_hash=null,upload_expires_at=null,
    retention_due_at=now()+interval '7 days',updated_at=now()
  where f.file_id=p_file_id and f.auth_user_id=p_auth_user_id and f.state in ('pending_upload','quarantined','normalizing')
  returning * into v_file;
  if not found then raise exception using errcode='P0002',message='upload_not_found_or_terminal'; end if;
  return jsonb_build_object('file_id',v_file.file_id,'state',v_file.state,
    'safe_reason',left(coalesce(p_safe_reason,'upload_failed'),80));
end;
$function$;

create function public.get_owner_profile_file_read(
  p_auth_user_id uuid,p_file_id uuid,p_expected_revision integer,p_expected_identity_version integer
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_file public.app_profile_files%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_profile from public.app_member_profiles p where p.auth_user_id=p_auth_user_id for update;
  if not found or v_profile.profile_revision<>p_expected_revision or v_profile.critical_identity_version<>p_expected_identity_version then
    raise exception using errcode='40001',message='profile_revision_conflict';
  end if;
  select * into v_file from public.app_profile_files f where f.file_id=p_file_id and f.guest_id=v_profile.guest_id
    and f.auth_user_id=p_auth_user_id and f.state='ready' and f.critical_identity_version=v_profile.critical_identity_version
    and f.deleted_at is null for share;
  if not found then raise exception using errcode='P0002',message='file_not_found'; end if;
  return jsonb_build_object('file_id',v_file.file_id,'normalized_key',v_file.normalized_key,
    'content_type',v_file.content_type,'critical_identity_version',v_file.critical_identity_version);
end;
$function$;

create function public.submit_member_profile(p_auth_user_id uuid,p_expected_revision integer,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_attempt integer; v_review public.app_identity_reviews%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_profile from public.app_member_profiles p where p.auth_user_id=p_auth_user_id for update;
  if not found then raise exception using errcode='P0002',message='profile_not_found'; end if;
  if v_profile.profile_revision <> p_expected_revision then raise exception using errcode='40001',message='profile_revision_conflict'; end if;
  if v_profile.identity_status='submitted' then
    select * into v_review from public.app_identity_reviews r where r.guest_id=v_profile.guest_id and r.state='submitted';
    return jsonb_build_object('profile',to_jsonb(v_profile),'review',to_jsonb(v_review));
  end if;
  update public.app_profile_files f set state='rejected',retention_due_at=now()+interval '7 days',updated_at=now()
    where f.guest_id=v_profile.guest_id and f.state='pending_upload' and f.upload_expires_at<=now();
  if not exists(select 1 from public.app_profile_files f where f.guest_id=v_profile.guest_id and f.kind='photo' and f.state='ready'
      and f.critical_identity_version=v_profile.critical_identity_version and f.deleted_at is null)
     or not exists(select 1 from public.app_profile_files f where f.guest_id=v_profile.guest_id and f.kind='selfie' and f.state='ready'
      and f.critical_identity_version=v_profile.critical_identity_version and f.deleted_at is null) then
    raise exception using errcode='22023',message='profile_evidence_incomplete';
  end if;
  select coalesce(max(r.attempt_number),0)+1 into v_attempt from public.app_identity_reviews r where r.guest_id=v_profile.guest_id;
  insert into public.app_identity_reviews (guest_id,attempt_number,profile_revision,critical_identity_version,state,evidence_received_at)
    values (v_profile.guest_id,v_attempt,v_profile.profile_revision+1,v_profile.critical_identity_version,'submitted',now()) returning * into v_review;
  update public.app_member_profiles p set profile_revision=p.profile_revision+1,identity_status='submitted',
    evidence_received_at=now(),updated_at=now() where p.guest_id=v_profile.guest_id returning * into v_profile;
  update public.app_profile_files f set retention_due_at=null,updated_at=now()
    where f.guest_id=v_profile.guest_id and f.state='ready' and f.critical_identity_version=v_profile.critical_identity_version;
  return jsonb_build_object('profile',to_jsonb(v_profile),'review',to_jsonb(v_review));
end;
$function$;

create function public.decide_identity_review(
  p_actor_user_id uuid,p_guest_id uuid,p_review_id uuid,p_expected_revision integer,p_operation_id uuid,
  p_decision text,p_correction_reason text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype; v_review public.app_identity_reviews%rowtype;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501',message='admin_required';
  end if;
  select * into v_profile from public.app_member_profiles p where p.guest_id=p_guest_id for update;
  if not found then raise exception using errcode='P0002',message='profile_not_found'; end if;
  select * into v_review from public.app_identity_reviews r where r.review_id=p_review_id and r.guest_id=p_guest_id for update;
  if not found or v_review.state <> 'submitted' or v_profile.identity_status <> 'submitted'
     or v_profile.profile_revision <> p_expected_revision
     or v_review.critical_identity_version <> v_profile.critical_identity_version then
    raise exception using errcode='40001',message='review_revision_conflict';
  end if;
  if p_decision not in ('approved','resubmission_required') then raise exception using errcode='22023',message='invalid_decision'; end if;
  if p_decision='approved' and (not exists(select 1 from public.app_profile_files f where f.guest_id=p_guest_id
       and f.kind='photo' and f.state='ready' and f.critical_identity_version=v_profile.critical_identity_version and f.deleted_at is null)
       or not exists(select 1 from public.app_profile_files f where f.guest_id=p_guest_id
       and f.kind='selfie' and f.state='ready' and f.critical_identity_version=v_profile.critical_identity_version and f.deleted_at is null)) then
    raise exception using errcode='22023',message='current_evidence_required';
  end if;
  if p_decision='resubmission_required' and (p_correction_reason is null or length(btrim(p_correction_reason)) not between 1 and 2000) then
    raise exception using errcode='22023',message='correction_reason_required';
  end if;
  update public.app_identity_reviews r set state=p_decision,correction_reason=p_correction_reason,
    reviewed_at=now(),reviewed_by=p_actor_user_id where r.review_id=p_review_id returning * into v_review;
  update public.app_member_profiles p set profile_revision=p.profile_revision+1,identity_status=p_decision,
    reviewed_identity_version=case when p_decision='approved' then p.critical_identity_version else p.reviewed_identity_version end,
    latest_correction_reason=p_correction_reason,updated_at=now()
    where p.guest_id=p_guest_id returning * into v_profile;
  update public.app_profile_files f set retention_due_at=now()+interval '30 days',updated_at=now()
    where f.guest_id=p_guest_id and f.state='ready' and f.critical_identity_version=v_profile.critical_identity_version;
  update public.app_member_profiles p set evidence_received_at=coalesce(p.evidence_received_at,now()) where p.guest_id=p_guest_id;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
  values('user',p_actor_user_id,'identity.review.decided','identity_review',p_review_id,p_operation_id,
    jsonb_build_object('decision',p_decision,'critical_identity_version',v_profile.critical_identity_version));
  return jsonb_build_object('profile',to_jsonb(v_profile),'review',to_jsonb(v_review));
end;
$function$;

-- Only service-role requests may execute privileged RPCs. The function body also checks JWT role.
revoke all on function public.ensure_member_profile(uuid) from public,anon,authenticated;
revoke all on function public.save_member_profile(uuid,integer,uuid,text,text,date,text,text[],smallint,smallint,text,text[],text,text,text,text) from public,anon,authenticated;
revoke all on function public.create_profile_upload_intent(uuid,integer,integer,uuid,uuid,text,text,integer,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.consume_profile_upload_grant(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.begin_profile_normalization(uuid,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.finalize_profile_upload(uuid,uuid,integer,integer,text,text,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.submit_member_profile(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.decide_identity_review(uuid,uuid,uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ensure_member_profile(uuid) to service_role;
grant execute on function public.save_member_profile(uuid,integer,uuid,text,text,date,text,text[],smallint,smallint,text,text[],text,text,text,text) to service_role;
grant execute on function public.create_profile_upload_intent(uuid,integer,integer,uuid,uuid,text,text,integer,text,text,timestamptz) to service_role;
grant execute on function public.consume_profile_upload_grant(uuid,uuid,text,integer) to service_role;
grant execute on function public.begin_profile_normalization(uuid,uuid,integer,integer) to service_role;
grant execute on function public.finalize_profile_upload(uuid,uuid,integer,integer,text,text,integer,integer,integer) to service_role;
grant execute on function public.submit_member_profile(uuid,integer,uuid) to service_role;
grant execute on function public.decide_identity_review(uuid,uuid,uuid,integer,uuid,text,text) to service_role;
revoke all on function public.delete_member_profile_file(uuid,uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.prepare_identity_review_read(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.confirm_identity_review_read_set(uuid,uuid,uuid,integer,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.claim_due_profile_evidence_cleanup(integer) from public,anon,authenticated;
revoke all on function public.finish_profile_evidence_cleanup(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.fail_profile_upload(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.get_owner_profile_file_read(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.delete_member_profile_file(uuid,uuid,integer,uuid) to service_role;
grant execute on function public.prepare_identity_review_read(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.confirm_identity_review_read_set(uuid,uuid,uuid,integer,uuid,uuid[]) to service_role;
grant execute on function public.claim_due_profile_evidence_cleanup(integer) to service_role;
grant execute on function public.finish_profile_evidence_cleanup(uuid,timestamptz) to service_role;
grant execute on function public.fail_profile_upload(uuid,uuid,text) to service_role;
grant execute on function public.get_owner_profile_file_read(uuid,uuid,integer,integer) to service_role;
