-- W06.3-W06.4: immutable roster proposal revisions, composition validation,
-- admin approval, named Table Invitations and durable email intent.
-- Additive and server-only; this migration must be reviewed before local apply.

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check (action in (
  'waitlist.signup.created', 'app.admission.invited', 'app.admission.activated', 'app.admission.deleted',
  'app.invitation.queued', 'app.invitation.accepted', 'app.invitation.delivered', 'app.invitation.failed',
  'app.invitation.unknown', 'app.invitation.retry_requested', 'member_link.requested', 'auth.callback.rejected',
  'authorization.denied', 'identity.evidence.read', 'identity.review.decided',
  'supply.sync.started', 'supply.sync.finished', 'supply.sync.missing_detected', 'supply.sync.missing_resolved',
  'supply.draft.created', 'supply.draft.updated', 'supply.draft.accepted', 'supply.draft.published',
  'supply.weekly_clone.started', 'supply.weekly_clone.item_created', 'supply.weekly_clone.item_unknown', 'supply.weekly_clone.item_conflict',
  'supply.weekly_clone.reconciled', 'supply.weekly_clone.undo_started', 'supply.weekly_clone.item_undone',
  'supply.weekly_clone.undo_unknown', 'supply.weekly_clone.undo_refused',
  'table.request.created', 'table.request.withdrawn',
  'table.roster.proposed', 'table.roster.submitted', 'table.roster.approved', 'table.invitation.queued'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup', 'app_admission', 'invitation_delivery', 'delivery_attempt', 'auth_identity', 'member_link_request',
  'profile_file', 'identity_review', 'supply_sync_run', 'supply_table', 'supply_table_revision',
  'supply_weekly_clone_operation', 'supply_weekly_clone_item', 'table_request', 'table_roster_proposal', 'table_invitation'
));

create table public.app_table_roster_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  revision integer not null check (revision > 0),
  state text not null check (state in ('draft','submitted','approved','superseded')),
  supply_revision_id uuid not null references public.app_supply_table_revisions(revision_id) on delete restrict,
  ruleset_version text not null default 'r03-v1' check (ruleset_version = 'r03-v1'),
  validation jsonb not null check (jsonb_typeof(validation) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  submitted_by uuid references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  unique (table_id, revision),
  check (state not in ('submitted','approved') or (submitted_at is not null and submitted_by is not null)),
  check ((state = 'approved') = (approved_by is not null and approved_at is not null))
);
create index app_table_roster_proposals_current_idx on public.app_table_roster_proposals(table_id, revision desc);

create table public.app_table_roster_proposal_members (
  proposal_id uuid not null references public.app_table_roster_proposals(proposal_id) on delete restrict,
  request_id uuid not null references public.app_table_requests(request_id) on delete restrict,
  guest_id uuid not null references public.app_member_profiles(guest_id) on delete restrict,
  captured_profile_revision integer not null check (captured_profile_revision > 0),
  captured_critical_identity_version integer not null check (captured_critical_identity_version > 0),
  captured_reviewed_identity_version integer,
  created_at timestamptz not null default now(),
  primary key (proposal_id, guest_id),
  unique (proposal_id, request_id)
);
create index app_table_roster_proposal_members_request_idx on public.app_table_roster_proposal_members(request_id, proposal_id);

create table public.app_table_invitations (
  invitation_id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  guest_id uuid not null references public.app_member_profiles(guest_id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  source_request_id uuid not null references public.app_table_requests(request_id) on delete restrict,
  proposal_id uuid not null references public.app_table_roster_proposals(proposal_id) on delete restrict,
  approved_by uuid not null references auth.users(id) on delete restrict,
  state text not null default 'active' check (state in ('active','revoked','closed')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  closed_at timestamptz,
  unique (proposal_id, guest_id),
  check ((state = 'revoked') = (revoked_at is not null)),
  check ((state = 'closed') = (closed_at is not null))
);
create unique index app_table_invitations_one_active_member_table
  on public.app_table_invitations(table_id, auth_user_id) where state = 'active';
create index app_table_invitations_table_state_idx on public.app_table_invitations(table_id, state, created_at);

create table public.app_table_invitation_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null unique references public.app_table_invitations(invitation_id) on delete restrict,
  operation_id uuid not null unique,
  state text not null default 'queued' check (state in ('queued','sending','accepted','delivered','failed','unknown')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text,
  error_code text check (error_code is null or length(error_code) <= 100),
  queued_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  attempted_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  check ((state in ('accepted','delivered')) = (accepted_at is not null)),
  check ((state = 'delivered') = (delivered_at is not null)),
  check (delivered_at is null or accepted_at <= delivered_at)
);
create index app_table_invitation_outbox_ready_idx on public.app_table_invitation_outbox(state,next_attempt_at,outbox_id);
create index app_table_invitation_outbox_lease_idx on public.app_table_invitation_outbox(lease_until,outbox_id) where state='sending';

create table public.app_table_roster_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('proposal.save','proposal.submit','proposal.approve')),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{32}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.app_table_roster_proposals enable row level security;
alter table public.app_table_roster_proposal_members enable row level security;
alter table public.app_table_invitations enable row level security;
alter table public.app_table_invitation_outbox enable row level security;
alter table public.app_table_roster_operations enable row level security;
revoke all on public.app_table_roster_proposals, public.app_table_roster_proposal_members,
  public.app_table_invitations, public.app_table_invitation_outbox, public.app_table_roster_operations
  from public, anon, authenticated, service_role;

create function app_private.require_roster_staff(p_actor uuid,p_table_id uuid,p_admin_only boolean default false)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_role text;
begin
  perform app_private.require_service_role();
  if p_actor is null or not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null for share) then
    raise exception using errcode='42501',message='forbidden';
  end if;
  if exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role='admin' for share) then return; end if;
  if p_admin_only then raise exception using errcode='42501',message='forbidden'; end if;
  select r.role into v_role from public.app_user_roles r where r.user_id=p_actor and r.role='host' for share;
  if not found then raise exception using errcode='42501',message='forbidden'; end if;
  if p_table_id is null or not exists(select 1 from public.app_supply_table_assignments a where a.user_id=p_actor and a.table_id=p_table_id for share) then
    raise exception using errcode='42501',message='not_assigned';
  end if;
end $function$;
revoke all on function app_private.require_roster_staff(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.require_roster_staff(uuid,uuid,boolean) to service_role;

create function app_private.roster_table_is_current(p_table_id uuid,p_for_update boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_head public.app_supply_table_heads%rowtype; v_content jsonb; v_start timestamptz;
begin
  if p_for_update then
    select * into v_head from public.app_supply_table_heads h where h.table_id=p_table_id for update;
  else
    select * into v_head from public.app_supply_table_heads h where h.table_id=p_table_id for share;
  end if;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_head.lifecycle<>'published' or v_head.published_revision_id is null then
    raise exception using errcode='P0001',message='stale_table';
  end if;
  select r.content into v_content from public.app_supply_table_revisions r
   where r.revision_id=v_head.published_revision_id and r.table_id=p_table_id and r.state='published';
  if not found then raise exception using errcode='P0001',message='stale_table'; end if;
  v_start:=((v_content->>'localDate')::date+(v_content->>'startLocalTime')::time) at time zone 'America/New_York';
  if v_start<=now() then raise exception using errcode='P0001',message='table_not_future'; end if;
  return jsonb_build_object('tableId',v_head.table_id,'supplyRevisionId',v_head.published_revision_id,'content',v_content,'protectedByActivity',v_head.protected_by_activity);
end $function$;
revoke all on function app_private.roster_table_is_current(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.roster_table_is_current(uuid,boolean) to service_role;

create function app_private.validate_table_roster(p_proposal_id uuid,p_compare_snapshots boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_proposal public.app_table_roster_proposals%rowtype;
  v_table jsonb;
  v_ids uuid[];
  v_issues jsonb:='[]'::jsonb;
  v_selected jsonb:='[]'::jsonb;
  v_member record;
  v_other record;
  v_count integer;
  v_age integer;
  v_other_age integer;
  v_oldest integer;
  v_youngest integer;
  v_connected uuid[]:='{}'::uuid[];
begin
  select * into v_proposal from public.app_table_roster_proposals p where p.proposal_id=p_proposal_id;
  if not found then raise exception using errcode='P0001',message='stale_table'; end if;
  v_table:=app_private.roster_table_is_current(v_proposal.table_id,false);
  select coalesce(array_agg(m.request_id order by m.request_id),'{}'::uuid[]),count(*)::integer
    into v_ids,v_count from public.app_table_roster_proposal_members m where m.proposal_id=p_proposal_id;
  if v_count<3 or v_count>5 then
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','select_three_to_five'));
  end if;

  for v_member in
    select m.request_id,m.guest_id,q.guest_id as request_guest_id,m.captured_profile_revision,m.captured_critical_identity_version,
      m.captured_reviewed_identity_version,q.state as request_state,q.table_id as request_table_id,q.auth_user_id,
      q.created_at as request_created_at,p.profile_revision,p.critical_identity_version,p.reviewed_identity_version,
      p.identity_status,p.first_name,p.last_name,p.date_of_birth,p.identity,p.open_to,p.match_age_min,p.match_age_max,
      p.auth_user_id as profile_auth_user_id,
      a.state as admission_state,u.email_confirmed_at,
      exists(select 1 from public.app_table_invitations i where i.table_id=v_proposal.table_id and i.auth_user_id=q.auth_user_id
        and i.state='active' and i.proposal_id<>v_proposal.proposal_id) as has_active_invitation
    from public.app_table_roster_proposal_members m
    join public.app_table_requests q on q.request_id=m.request_id
    left join public.app_member_profiles p on p.guest_id=m.guest_id
    left join public.app_admissions a on a.auth_user_id=q.auth_user_id
    left join auth.users u on u.id=q.auth_user_id
    where m.proposal_id=p_proposal_id order by m.guest_id
  loop
    if v_member.request_table_id<>v_proposal.table_id or v_member.guest_id is null
      or v_member.guest_id is distinct from v_member.request_guest_id then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','candidate_not_found'));
      continue;
    end if;
    if v_member.request_state<>'pending' then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','request_not_pending','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if v_member.admission_state<>'activated' or v_member.email_confirmed_at is null then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','member_not_admitted','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if v_member.profile_auth_user_id is distinct from v_member.auth_user_id then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','member_not_admitted','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if v_member.profile_revision is null or v_member.identity_status<>'approved'
      or v_member.reviewed_identity_version is distinct from v_member.critical_identity_version then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','profile_not_approved','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if v_member.date_of_birth is null then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','profile_incomplete','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if p_compare_snapshots and (v_member.profile_revision is distinct from v_member.captured_profile_revision
      or v_member.critical_identity_version is distinct from v_member.captured_critical_identity_version
      or v_member.reviewed_identity_version is distinct from v_member.captured_reviewed_identity_version) then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','stale_profile','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if v_member.request_state='pending' and v_member.admission_state='activated' and v_member.email_confirmed_at is not null
      and v_member.identity_status='approved' and v_member.reviewed_identity_version=v_member.critical_identity_version then
      if v_member.date_of_birth is null then v_age:=null;
      else v_age:=extract(year from age((v_table->'content'->>'localDate')::date,v_member.date_of_birth))::integer; end if;
      if v_age<21 then
        v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','age_under_21','guestIds',jsonb_build_array(v_member.guest_id)));
      end if;
    else v_age:=null;
    end if;
    if v_member.match_age_min is null or v_member.match_age_max is null or v_member.match_age_min>v_member.match_age_max
      or v_member.match_age_min<21 or v_member.match_age_max>120 then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','age_range_invalid','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if coalesce(cardinality(v_member.open_to),0)=0 or v_member.identity not in ('woman','man','non_binary') then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','profile_incomplete','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if v_member.has_active_invitation then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','candidate_already_invited','guestIds',jsonb_build_array(v_member.guest_id)));
    end if;
    if v_age is not null and v_age>=21 and v_member.match_age_min<=v_member.match_age_max then
      v_oldest:=greatest(coalesce(v_oldest,v_age),v_age);
      v_youngest:=least(coalesce(v_youngest,v_age),v_age);
    end if;
    v_selected:=v_selected||jsonb_build_array(jsonb_build_object('requestId',v_member.request_id,'guestId',v_member.guest_id,
      'displayName',btrim(v_member.first_name||' '||v_member.last_name),'requestCreatedAt',v_member.request_created_at,
      'profileRevision',v_member.profile_revision,'criticalIdentityVersion',v_member.critical_identity_version,
      'reviewedIdentityVersion',v_member.reviewed_identity_version,'age',v_age,'matchAgeMin',v_member.match_age_min,
      'matchAgeMax',v_member.match_age_max,'identity',v_member.identity,'openTo',to_jsonb(v_member.open_to)));
  end loop;

  for v_member in select value as item from jsonb_array_elements(v_selected) loop
    if v_member.item->>'age' is null then continue; end if;
    for v_other in select value as item from jsonb_array_elements(v_selected) loop
      if v_other.item->>'guestId'<=v_member.item->>'guestId' or v_other.item->>'age' is null then continue; end if;
      v_age:=(v_member.item->>'age')::integer; v_other_age:=(v_other.item->>'age')::integer;
      if v_age < (v_other.item->>'matchAgeMin')::integer or v_age > (v_other.item->>'matchAgeMax')::integer
        or v_other_age < (v_member.item->>'matchAgeMin')::integer or v_other_age > (v_member.item->>'matchAgeMax')::integer then
        v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','pair_age_mismatch',
          'guestIds',jsonb_build_array((v_member.item->>'guestId')::uuid,(v_other.item->>'guestId')::uuid)));
      end if;
      if (v_member.item->'openTo') ? (v_other.item->>'identity')
        and (v_other.item->'openTo') ? (v_member.item->>'identity') then
        v_connected:=array_append(v_connected,(v_member.item->>'guestId')::uuid);
        v_connected:=array_append(v_connected,(v_other.item->>'guestId')::uuid);
      end if;
    end loop;
    if not (v_member.item->>'guestId')::uuid=any(v_connected) then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','missing_mutual_open_connection','guestIds',jsonb_build_array((v_member.item->>'guestId')::uuid)));
    end if;
  end loop;
  if v_oldest is not null and v_youngest is not null and v_oldest-v_youngest>12 then
    v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','age_span_exceeded'));
  end if;
  return jsonb_build_object('valid',jsonb_array_length(v_issues)=0,'issues',v_issues,'selected',v_selected,
    'supplyRevisionId',v_table->>'supplyRevisionId');
end $function$;
revoke all on function app_private.validate_table_roster(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.validate_table_roster(uuid,boolean) to service_role;

create function app_private.roster_candidate_public(p_table_id uuid,p_request_id uuid,p_selected boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v record;
  v_reasons jsonb:='[]'::jsonb;
  v_age integer;
  v_eligible boolean;
begin
  select q.request_id,q.guest_id,q.table_id,q.state,q.created_at,q.auth_user_id,
    p.auth_user_id as profile_auth_user_id,p.profile_revision,p.critical_identity_version,p.reviewed_identity_version,p.identity_status,p.first_name,p.last_name,
    p.date_of_birth,p.identity,p.open_to,p.match_age_min,p.match_age_max,p.neighborhood,p.looking_for,p.surprise_game,
    a.state as admission_state,u.email_confirmed_at,
    (select r.content->>'localDate' from public.app_supply_table_heads h join public.app_supply_table_revisions r
      on r.revision_id=h.published_revision_id where h.table_id=p_table_id) as table_date,
    exists(select 1 from public.app_table_invitations i where i.table_id=p_table_id and i.auth_user_id=q.auth_user_id and i.state='active') as has_active_invitation
  into v
  from public.app_table_requests q left join public.app_member_profiles p on p.guest_id=q.guest_id
    left join public.app_admissions a on a.auth_user_id=q.auth_user_id left join auth.users u on u.id=q.auth_user_id
  where q.request_id=p_request_id and q.table_id=p_table_id;
  if not found then raise exception using errcode='P0002',message='request_not_found'; end if;
  if v.state<>'pending' then v_reasons:=v_reasons||jsonb_build_array('request_not_pending'); end if;
  if v.admission_state<>'activated' or v.email_confirmed_at is null then v_reasons:=v_reasons||jsonb_build_array('member_not_admitted'); end if;
  if v.profile_auth_user_id is distinct from v.auth_user_id then v_reasons:=v_reasons||jsonb_build_array('member_not_admitted'); end if;
  if v.profile_revision is null or v.identity_status<>'approved' or v.reviewed_identity_version is distinct from v.critical_identity_version then
    v_reasons:=v_reasons||jsonb_build_array('profile_not_approved');
  end if;
  if v.date_of_birth is null or v.identity not in ('woman','man','non_binary') or coalesce(cardinality(v.open_to),0)=0
    or v.match_age_min is null or v.match_age_max is null or v.first_name is null or v.last_name is null then
    v_reasons:=v_reasons||jsonb_build_array('profile_incomplete');
  end if;
  if v.date_of_birth is not null and v.table_date is not null then
    v_age:=extract(year from age((v.table_date)::date,v.date_of_birth))::integer;
    if v_age<21 then v_reasons:=v_reasons||jsonb_build_array('age_under_21'); end if;
  else v_age:=null; end if;
  if v.match_age_min is null or v.match_age_max is null or v.match_age_min<21 or v.match_age_max>120 or v.match_age_min>v.match_age_max then
    v_reasons:=v_reasons||jsonb_build_array('age_range_invalid');
  end if;
  if v.has_active_invitation then v_reasons:=v_reasons||jsonb_build_array('candidate_already_invited'); end if;
  v_eligible:=jsonb_array_length(v_reasons)=0;
  return jsonb_build_object('requestId',v.request_id,'guestId',v.guest_id,
    'displayName',case when v.first_name is null then 'Member' else btrim(v.first_name||' '||coalesce(v.last_name,'')) end,
    'requestCreatedAt',v.created_at,'eligible',v_eligible,'reasonCodes',v_reasons,
    'recommendationRank',null,'selected',p_selected);
end $function$;
revoke all on function app_private.roster_candidate_public(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.roster_candidate_public(uuid,uuid,boolean) to service_role;

create function app_private.roster_selected_guests(p_proposal_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('guestId',m.guest_id,
    'displayName',case when p.first_name is null then 'Member' else btrim(p.first_name||' '||coalesce(p.last_name,'')) end)
    order by m.guest_id),'[]'::jsonb)
  from public.app_table_roster_proposal_members m
  left join public.app_member_profiles p on p.guest_id=m.guest_id
  where m.proposal_id=p_proposal_id
$function$;
revoke all on function app_private.roster_selected_guests(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.roster_selected_guests(uuid) to service_role;

create function public.list_curation_assigned_tables(p_actor_user_id uuid,p_cursor text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_date date; v_time time; v_table uuid; v_items jsonb; v_next text;
begin
  perform app_private.require_service_role();
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_actor_user_id is null or not exists(select 1 from auth.users u where u.id=p_actor_user_id and u.email_confirmed_at is not null) then
    raise exception using errcode='42501',message='forbidden';
  end if;
  v_admin:=exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin');
  if not v_admin and not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='host') then
    raise exception using errcode='42501',message='forbidden';
  end if;
  if p_cursor is not null then
    if length(p_cursor)>160 or p_cursor !~ '^\d{4}-\d{2}-\d{2}\|([01]\d|2[0-3]):[0-5]\d\|[0-9a-fA-F-]{36}$' then
      raise exception using errcode='22023',message='invalid_input';
    end if;
    begin v_date:=split_part(p_cursor,'|',1)::date; v_time:=split_part(p_cursor,'|',2)::time; v_table:=split_part(p_cursor,'|',3)::uuid;
    exception when others then raise exception using errcode='22023',message='invalid_input'; end;
  end if;
  with current_tables as (
    select h.table_id,h.published_revision_id,r.content,
      r.content->>'title' as title,r.content->>'localDate' as local_date,r.content->>'startLocalTime' as start_time,
      r.content->>'neighborhood' as neighborhood,
      (select count(*)::integer from public.app_table_requests q where q.table_id=h.table_id and q.state='pending'
        and not exists(select 1 from public.app_table_invitations i where i.table_id=q.table_id and i.auth_user_id=q.auth_user_id and i.state='active')) as request_count
    from public.app_supply_table_heads h join public.app_supply_table_revisions r
      on r.revision_id=h.published_revision_id and r.state='published' and r.table_id=h.table_id
    where h.lifecycle='published'
      and (((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York')>now()
      and (v_admin or exists(select 1 from public.app_supply_table_assignments a where a.table_id=h.table_id and a.user_id=p_actor_user_id))
  ), enriched as (
    select t.*,(select jsonb_build_object('proposalId',p.proposal_id,'revision',p.revision,'state',p.state,
      'selectedCount',(select count(*)::integer from public.app_table_roster_proposal_members m where m.proposal_id=p.proposal_id),
      'valid',coalesce((p.validation->>'valid')::boolean,false)
        and p.supply_revision_id=t.published_revision_id
        and not exists(select 1 from public.app_table_roster_proposal_members m join public.app_member_profiles mp on mp.guest_id=m.guest_id
          where m.proposal_id=p.proposal_id and (mp.profile_revision<>m.captured_profile_revision
            or mp.critical_identity_version<>m.captured_critical_identity_version
            or mp.reviewed_identity_version is distinct from m.captured_reviewed_identity_version))
        and not exists(select 1 from public.app_table_roster_proposal_members m join public.app_table_requests q on q.request_id=m.request_id
          left join public.app_admissions a on a.auth_user_id=q.auth_user_id left join auth.users u on u.id=q.auth_user_id
          left join public.app_member_profiles mp on mp.guest_id=m.guest_id
          where m.proposal_id=p.proposal_id and (q.state<>'pending' or a.state<>'activated' or u.email_confirmed_at is null
            or mp.identity_status<>'approved' or mp.reviewed_identity_version is distinct from mp.critical_identity_version)))
      from public.app_table_roster_proposals p where p.table_id=t.table_id order by p.revision desc limit 1) as proposal
    from current_tables t
  ), page as (
    select *,row_number() over(order by local_date,start_time,table_id) rn
    from enriched
    where v_date is null or local_date::date>v_date or (local_date::date=v_date and start_time::time>v_time)
      or (local_date::date=v_date and start_time::time=v_time and table_id>v_table)
    order by local_date,start_time,table_id limit p_limit+1
  )
  select coalesce(jsonb_agg(jsonb_build_object('tableId',table_id,'title',title,'localDate',local_date,
      'startLocalTime',start_time,'neighborhood',neighborhood,'publishedRevisionId',published_revision_id,
      'pendingRequestCount',request_count,'currentProposal',proposal) order by local_date,start_time,table_id) filter(where rn<=p_limit),'[]'::jsonb),
    case when count(*)>p_limit then (select local_date||'|'||start_time||'|'||table_id::text from page where rn=p_limit) else null end
  into v_items,v_next from page;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $function$;
revoke all on function public.list_curation_assigned_tables(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_curation_assigned_tables(uuid,text,integer) to service_role;

create function public.read_table_roster_context(p_actor_user_id uuid,p_table_id uuid,p_cursor text default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_table jsonb;
  v_head record;
  v_content jsonb;
  v_read_revision uuid;
  v_published_revision uuid;
  v_read_only text;
  v_start timestamptz;
  v_admin boolean;
  v_cursor_at timestamptz;
  v_cursor_guest uuid;
  v_proposal public.app_table_roster_proposals%rowtype;
  v_has_proposal boolean:=false;
  v_validation jsonb:='{"valid":false,"issues":[]}'::jsonb;
  v_selected_ids jsonb:='[]'::jsonb;
  v_candidate record;
  v_candidate_dto jsonb;
  v_rank integer:=0;
  v_page_count integer:=0;
  v_items jsonb:='[]'::jsonb;
  v_next text;
  v_current_proposal jsonb;
  v_valid boolean:=false;
begin
  perform app_private.require_service_role();
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_cursor is not null then
    if length(p_cursor)>180 or p_cursor !~ '^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]{1,40}\|[0-9a-fA-F-]{36}$' then
      raise exception using errcode='22023',message='invalid_input';
    end if;
    begin v_cursor_at:=split_part(p_cursor,'|',1)::timestamptz; v_cursor_guest:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception using errcode='22023',message='invalid_input'; end;
  end if;
  perform app_private.require_roster_staff(p_actor_user_id,p_table_id,false);
  v_admin:=exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin');
  select h.table_id,h.lifecycle,h.published_revision_id into v_head
    from public.app_supply_table_heads h where h.table_id=p_table_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  v_published_revision:=v_head.published_revision_id;
  if v_head.lifecycle='published' and v_published_revision is not null then
    select r.content into v_content from public.app_supply_table_revisions r
      where r.revision_id=v_published_revision and r.table_id=p_table_id and r.state='published';
    if found then
      v_start:=((v_content->>'localDate')::date+(v_content->>'startLocalTime')::time) at time zone 'America/New_York';
      if v_start<=now() then v_read_only:='past'; end if;
      v_read_revision:=v_published_revision;
    else v_read_only:='unpublished'; end if;
  else v_read_only:='unpublished'; end if;
  select * into v_proposal from public.app_table_roster_proposals p where p.table_id=p_table_id order by p.revision desc limit 1;
  v_has_proposal:=found;
  if v_has_proposal and v_head.lifecycle='published' and v_published_revision is not null
    and v_proposal.supply_revision_id is distinct from v_published_revision then
    v_read_only:='revision_changed';
    v_read_revision:=v_proposal.supply_revision_id;
    select r.content into v_content from public.app_supply_table_revisions r
      where r.revision_id=v_read_revision and r.table_id=p_table_id;
    if not found then raise exception using errcode='P0001',message='stale_table'; end if;
  elsif v_read_only is not null and v_has_proposal then
    v_read_revision:=v_proposal.supply_revision_id;
    select r.content into v_content from public.app_supply_table_revisions r
      where r.revision_id=v_read_revision and r.table_id=p_table_id;
    if not found then raise exception using errcode='P0001',message='stale_table'; end if;
  end if;
  if v_read_only is not null and not v_has_proposal then raise exception using errcode='P0002',message='not_found'; end if;
  if v_has_proposal then
    if v_read_only is not null then
      v_validation:=jsonb_build_object('valid',false,'issues',coalesce(v_proposal.validation->'issues','[]'::jsonb)
        ||jsonb_build_array(jsonb_build_object('code','stale_table')));
    else
      v_validation:=app_private.validate_table_roster(v_proposal.proposal_id,true);
    end if;
    v_valid:=coalesce((v_validation->>'valid')::boolean,false);
    select coalesce(jsonb_agg(m.request_id order by m.guest_id),'[]'::jsonb) into v_selected_ids
      from public.app_table_roster_proposal_members m where m.proposal_id=v_proposal.proposal_id;
    v_current_proposal:=jsonb_build_object('proposalId',v_proposal.proposal_id,'revision',v_proposal.revision,
      'state',v_proposal.state,'supplyRevisionId',v_proposal.supply_revision_id,'selectedRequestIds',v_selected_ids,
      'selectedGuests',app_private.roster_selected_guests(v_proposal.proposal_id),
      'validation',jsonb_build_object('valid',v_valid,'issues',v_validation->'issues'),
      'createdAt',v_proposal.created_at,'updatedAt',v_proposal.updated_at);
  else v_current_proposal:=null; end if;

  v_table:=jsonb_build_object('tableId',p_table_id,'title',v_content->>'title','localDate',v_content->>'localDate',
    'startLocalTime',v_content->>'startLocalTime','neighborhood',v_content->>'neighborhood',
    'publishedRevisionId',case when v_read_only='unpublished' then null else v_published_revision end,'readOnlyReason',v_read_only);

  if v_read_only is null then
  for v_candidate in
    select q.request_id,q.guest_id,q.created_at from public.app_table_requests q
    where q.table_id=p_table_id and q.state='pending'
    order by q.created_at,q.guest_id
  loop
    v_candidate_dto:=app_private.roster_candidate_public(p_table_id,v_candidate.request_id,
      exists(select 1 from public.app_table_roster_proposal_members m where m.proposal_id=v_proposal.proposal_id and m.request_id=v_candidate.request_id));
    if (v_candidate_dto->>'eligible')::boolean then v_rank:=v_rank+1; v_candidate_dto:=jsonb_set(v_candidate_dto,'{recommendationRank}',to_jsonb(v_rank)); end if;
    if v_cursor_at is not null and (v_candidate.created_at<v_cursor_at or (v_candidate.created_at=v_cursor_at and v_candidate.guest_id<=v_cursor_guest)) then continue; end if;
    v_page_count:=v_page_count+1;
    if v_page_count<=p_limit then
      v_items:=v_items||jsonb_build_array(v_candidate_dto);
      if v_page_count=p_limit then
        v_next:=to_char(v_candidate.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||v_candidate.guest_id::text;
      end if;
    elsif v_page_count=p_limit+1 then exit;
    end if;
  end loop;
  if v_page_count<=p_limit then v_next:=null; end if;
  end if;
  return jsonb_build_object('table',v_table,'applicants',jsonb_build_object('items',v_items,'nextCursor',v_next),
    'currentProposal',v_current_proposal,'permissions',jsonb_build_object('canEditProposal',v_read_only is null and not(v_has_proposal and v_proposal.state='approved'),
      'canSubmit',v_read_only is null and not v_admin and v_has_proposal and v_proposal.state='draft' and v_valid,
      'canApprove',v_read_only is null and v_admin and v_has_proposal and v_proposal.state='submitted' and v_valid));
end $function$;
revoke all on function public.read_table_roster_context(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.read_table_roster_context(uuid,uuid,text,integer) to service_role;

create function public.save_table_roster_proposal(p_actor_user_id uuid,p_table_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_operation_id uuid;
  v_expected_revision integer;
  v_supply_revision_id uuid;
  v_request_ids uuid[]:='{}'::uuid[];
  v_item jsonb;
  v_latest public.app_table_roster_proposals%rowtype;
  v_latest_revision integer:=0;
  v_has_latest boolean:=false;
  v_table jsonb;
  v_proposal public.app_table_roster_proposals%rowtype;
  v_validation jsonb;
  v_prior public.app_table_roster_operations%rowtype;
  v_hash text;
  v_result jsonb;
begin
  perform app_private.require_service_role();
  if jsonb_typeof(p_request)<>'object' or jsonb_typeof(p_request->'selectedRequestIds')<>'array'
    or jsonb_array_length(p_request->'selectedRequestIds')>6 then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  begin
    v_operation_id:=(p_request->>'operationId')::uuid;
    v_supply_revision_id:=(p_request->>'supplyRevisionId')::uuid;
    if p_request->'expectedProposalRevision' is not null and p_request->'expectedProposalRevision'<>'null'::jsonb then
      v_expected_revision:=(p_request->>'expectedProposalRevision')::integer;
    end if;
    for v_item in select value from jsonb_array_elements(p_request->'selectedRequestIds') loop
      if jsonb_typeof(v_item)<>'string' then raise exception using errcode='22023',message='invalid_input'; end if;
      v_request_ids:=array_append(v_request_ids,(v_item#>>'{}')::uuid);
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='22023',message='invalid_input';
  end;
  if v_operation_id is null or v_supply_revision_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  if cardinality(v_request_ids)<>(select count(distinct x) from unnest(v_request_ids) x) then
    raise exception using errcode='22023',message='duplicate_request_id';
  end if;
  select coalesce(array_agg(x order by x),'{}'::uuid[]) into v_request_ids from unnest(v_request_ids) as selected(x);
  v_hash:=md5(jsonb_build_object('tableId',p_table_id,'expectedProposalRevision',v_expected_revision,
    'supplyRevisionId',v_supply_revision_id,'selectedRequestIds',to_jsonb(v_request_ids))::text);
  perform pg_advisory_xact_lock(hashtextextended(v_operation_id::text,0));
  perform app_private.require_roster_staff(p_actor_user_id,p_table_id,false);
  select * into v_prior from public.app_table_roster_operations o where o.operation_id=v_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'proposal.save' or v_prior.request_hash<>v_hash then
      raise exception using errcode='P0001',message='operation_conflict';
    end if;
    return v_prior.result;
  end if;
  v_table:=app_private.roster_table_is_current(p_table_id,true);
  if v_supply_revision_id<>(v_table->>'supplyRevisionId')::uuid then raise exception using errcode='P0001',message='stale_table'; end if;
  select * into v_latest from public.app_table_roster_proposals p where p.table_id=p_table_id order by p.revision desc limit 1 for update;
  v_has_latest:=found;
  if v_has_latest then v_latest_revision:=v_latest.revision; end if;
  if v_expected_revision is distinct from (case when v_has_latest then v_latest_revision else null end) then
    raise exception using errcode='P0001',message='revision_conflict';
  end if;
  if v_has_latest and v_latest.state='approved' then raise exception using errcode='P0001',message='roster_already_active'; end if;
  if exists(select 1 from unnest(v_request_ids) x where not exists(
      select 1 from public.app_table_requests q where q.request_id=x and q.table_id=p_table_id)) then
    raise exception using errcode='P0002',message='request_not_found';
  end if;
  if exists(select 1 from public.app_table_invitations i where i.table_id=p_table_id and i.state='active') then
    raise exception using errcode='P0001',message='roster_already_active';
  end if;
  perform 1 from public.app_member_profiles p join public.app_table_requests q on q.guest_id=p.guest_id
    where q.table_id=p_table_id and q.request_id=any(v_request_ids) order by p.guest_id for share of p;
  if v_has_latest then update public.app_table_roster_proposals set state='superseded',updated_at=now() where proposal_id=v_latest.proposal_id; end if;
  insert into public.app_table_roster_proposals(table_id,revision,state,supply_revision_id,created_by,updated_by,validation)
    values(p_table_id,v_latest_revision+1,'draft',v_supply_revision_id,p_actor_user_id,p_actor_user_id,'{"valid":false,"issues":[]}'::jsonb)
    returning * into v_proposal;
  insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,
    captured_critical_identity_version,captured_reviewed_identity_version)
  select v_proposal.proposal_id,q.request_id,q.guest_id,p.profile_revision,p.critical_identity_version,p.reviewed_identity_version
    from public.app_table_requests q join public.app_member_profiles p on p.guest_id=q.guest_id
    where q.table_id=p_table_id and q.request_id=any(v_request_ids) order by q.guest_id;
  v_validation:=app_private.validate_table_roster(v_proposal.proposal_id,false);
  update public.app_table_roster_proposals set validation=v_validation,updated_at=now() where proposal_id=v_proposal.proposal_id;
  v_result:=jsonb_build_object('proposalId',v_proposal.proposal_id,'revision',v_proposal.revision,'state','draft',
    'supplyRevisionId',v_supply_revision_id,'selectedRequestIds',to_jsonb(v_request_ids),
    'selectedGuests',app_private.roster_selected_guests(v_proposal.proposal_id),
    'validation',jsonb_build_object('valid',v_validation->'valid','issues',v_validation->'issues'),
    'createdAt',v_proposal.created_at,'updatedAt',now());
  insert into public.app_table_roster_operations(operation_id,actor_user_id,action,request_hash,result)
    values(v_operation_id,p_actor_user_id,'proposal.save',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'table.roster.proposed','table_roster_proposal',v_proposal.proposal_id,v_operation_id,'{}'::jsonb);
  return v_result;
end $function$;
revoke all on function public.save_table_roster_proposal(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_table_roster_proposal(uuid,uuid,jsonb) to service_role;

create function public.submit_table_roster_proposal(p_actor_user_id uuid,p_table_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_operation_id uuid;
  v_expected_revision integer;
  v_proposal public.app_table_roster_proposals%rowtype;
  v_table jsonb;
  v_validation jsonb;
  v_prior public.app_table_roster_operations%rowtype;
  v_hash text;
  v_result jsonb;
begin
  perform app_private.require_service_role();
  if jsonb_typeof(p_request)<>'object' then raise exception using errcode='22023',message='invalid_input'; end if;
  begin v_operation_id:=(p_request->>'operationId')::uuid; v_expected_revision:=(p_request->>'expectedProposalRevision')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
  if v_operation_id is null or v_expected_revision is null then raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('tableId',p_table_id,'expectedProposalRevision',v_expected_revision)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_operation_id::text,0));
  perform app_private.require_roster_staff(p_actor_user_id,p_table_id,false);
  select * into v_prior from public.app_table_roster_operations o where o.operation_id=v_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'proposal.submit' or v_prior.request_hash<>v_hash then raise exception using errcode='P0001',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  v_table:=app_private.roster_table_is_current(p_table_id,true);
  select * into v_proposal from public.app_table_roster_proposals p where p.table_id=p_table_id order by p.revision desc limit 1 for update;
  if not found or v_proposal.revision<>v_expected_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_proposal.state<>'draft' then raise exception using errcode='P0001',message='proposal_not_editable'; end if;
  if v_proposal.supply_revision_id<>(v_table->>'supplyRevisionId')::uuid then raise exception using errcode='P0001',message='stale_table'; end if;
  perform 1 from public.app_table_requests q join public.app_table_roster_proposal_members m on m.request_id=q.request_id
    where m.proposal_id=v_proposal.proposal_id order by q.request_id for update of q;
  perform 1 from public.app_member_profiles p join public.app_table_roster_proposal_members m on m.guest_id=p.guest_id
    where m.proposal_id=v_proposal.proposal_id order by p.guest_id for share of p;
  v_validation:=app_private.validate_table_roster(v_proposal.proposal_id,true);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode='P0001',message='validation_failed',detail=jsonb_build_object('issues',v_validation->'issues')::text;
  end if;
  update public.app_table_roster_proposals set state='submitted',submitted_by=p_actor_user_id,submitted_at=now(),updated_by=p_actor_user_id,
    updated_at=now(),validation=v_validation where proposal_id=v_proposal.proposal_id returning * into v_proposal;
  v_result:=jsonb_build_object('proposalId',v_proposal.proposal_id,'revision',v_proposal.revision,'state','submitted',
    'supplyRevisionId',v_proposal.supply_revision_id,'selectedRequestIds',coalesce((select jsonb_agg(m.request_id order by m.guest_id)
      from public.app_table_roster_proposal_members m where m.proposal_id=v_proposal.proposal_id),'[]'::jsonb),
    'selectedGuests',app_private.roster_selected_guests(v_proposal.proposal_id),
    'validation',jsonb_build_object('valid',true,'issues','[]'::jsonb),'createdAt',v_proposal.created_at,'updatedAt',v_proposal.updated_at);
  insert into public.app_table_roster_operations(operation_id,actor_user_id,action,request_hash,result)
    values(v_operation_id,p_actor_user_id,'proposal.submit',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'table.roster.submitted','table_roster_proposal',v_proposal.proposal_id,v_operation_id,'{}'::jsonb);
  return v_result;
end $function$;
revoke all on function public.submit_table_roster_proposal(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_table_roster_proposal(uuid,uuid,jsonb) to service_role;

create function public.approve_table_roster(p_actor_user_id uuid,p_table_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_operation_id uuid;
  v_expected_revision integer;
  v_proposal public.app_table_roster_proposals%rowtype;
  v_table jsonb;
  v_validation jsonb;
  v_prior public.app_table_roster_operations%rowtype;
  v_hash text;
  v_result jsonb;
  v_invites jsonb:='[]'::jsonb;
  v_member record;
  v_auth_email text;
begin
  perform app_private.require_service_role();
  if jsonb_typeof(p_request)<>'object' then raise exception using errcode='22023',message='invalid_input'; end if;
  begin v_operation_id:=(p_request->>'operationId')::uuid; v_expected_revision:=(p_request->>'expectedProposalRevision')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='22023',message='invalid_input'; end;
  if v_operation_id is null or v_expected_revision is null then raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('tableId',p_table_id,'expectedProposalRevision',v_expected_revision)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_operation_id::text,0));
  perform app_private.require_roster_staff(p_actor_user_id,p_table_id,true);
  select * into v_prior from public.app_table_roster_operations o where o.operation_id=v_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'proposal.approve' or v_prior.request_hash<>v_hash then raise exception using errcode='P0001',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  v_table:=app_private.roster_table_is_current(p_table_id,true);
  select * into v_proposal from public.app_table_roster_proposals p where p.table_id=p_table_id order by p.revision desc limit 1 for update;
  if not found or v_proposal.revision<>v_expected_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_proposal.state='approved' then raise exception using errcode='P0001',message='roster_already_active'; end if;
  if v_proposal.state<>'submitted' then raise exception using errcode='P0001',message='proposal_not_submitted'; end if;
  if v_proposal.supply_revision_id<>(v_table->>'supplyRevisionId')::uuid then raise exception using errcode='P0001',message='stale_table'; end if;
  perform 1 from public.app_table_requests q join public.app_table_roster_proposal_members m on m.request_id=q.request_id
    where m.proposal_id=v_proposal.proposal_id order by q.request_id for update of q;
  perform 1 from public.app_member_profiles p join public.app_table_roster_proposal_members m on m.guest_id=p.guest_id
    where m.proposal_id=v_proposal.proposal_id order by p.guest_id for share of p;
  perform 1 from public.app_admissions a join public.app_table_requests q on q.auth_user_id=a.auth_user_id
    join public.app_table_roster_proposal_members m on m.request_id=q.request_id
    where m.proposal_id=v_proposal.proposal_id order by a.auth_user_id for share of a;
  perform 1 from auth.users u join public.app_table_requests q on q.auth_user_id=u.id
    join public.app_table_roster_proposal_members m on m.request_id=q.request_id
    where m.proposal_id=v_proposal.proposal_id order by u.id for share of u;
  if exists(select 1 from public.app_table_invitations i where i.table_id=p_table_id and i.state='active') then
    raise exception using errcode='P0001',message='roster_already_active';
  end if;
  v_validation:=app_private.validate_table_roster(v_proposal.proposal_id,true);
  if not (v_validation->>'valid')::boolean then
    raise exception using errcode='P0001',message='validation_failed',detail=jsonb_build_object('issues',v_validation->'issues')::text;
  end if;
  for v_member in
    select q.request_id,q.guest_id,q.auth_user_id from public.app_table_roster_proposal_members m
      join public.app_table_requests q on q.request_id=m.request_id
      where m.proposal_id=v_proposal.proposal_id order by q.guest_id
  loop
    insert into public.app_table_invitations(table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by)
      values(p_table_id,v_member.guest_id,v_member.auth_user_id,v_member.request_id,v_proposal.proposal_id,p_actor_user_id)
      returning invitation_id into v_member.request_id;
    insert into public.app_table_invitation_outbox(invitation_id,operation_id)
      values(v_member.request_id,gen_random_uuid());
    v_invites:=v_invites||jsonb_build_array(jsonb_build_object('invitationId',v_member.request_id,'guestId',v_member.guest_id,'state','active','deliveryState','queued'));
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'table.invitation.queued','table_invitation',v_member.request_id,v_operation_id,'{}'::jsonb);
  end loop;
  update public.app_table_roster_proposals set state='approved',approved_by=p_actor_user_id,approved_at=now(),updated_by=p_actor_user_id,
    updated_at=now(),validation=v_validation where proposal_id=v_proposal.proposal_id returning * into v_proposal;
  update public.app_supply_table_heads set protected_by_activity=true,updated_at=now() where table_id=p_table_id;
  v_result:=jsonb_build_object('proposal',jsonb_build_object('proposalId',v_proposal.proposal_id,'revision',v_proposal.revision,'state','approved'),
    'invitations',v_invites);
  insert into public.app_table_roster_operations(operation_id,actor_user_id,action,request_hash,result)
    values(v_operation_id,p_actor_user_id,'proposal.approve',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'table.roster.approved','table_roster_proposal',v_proposal.proposal_id,v_operation_id,'{}'::jsonb);
  return v_result;
end $function$;
revoke all on function public.approve_table_roster(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.approve_table_roster(uuid,uuid,jsonb) to service_role;

comment on table public.app_table_roster_proposals is 'Private immutable roster revisions; only the approved current revision may create Table Invitations.';
comment on table public.app_table_invitations is 'Named Table offers, distinct from app-admission emails and from paid Seats.';
comment on table public.app_table_invitation_outbox is 'Durable email intent committed atomically with Table Invitation creation; worker delivery is separate.';

