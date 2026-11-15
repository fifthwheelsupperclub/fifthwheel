-- W05.1 durable sync ledger. Sync may stage candidates; it cannot accept or publish.

create table public.app_supply_sync_runs (
  run_id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  actor_user_id uuid not null,
  state text not null check (state in ('running','staged','no_change','incomplete','conflict','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  table_pages integer not null default 0 check (table_pages >= 0),
  venue_pages integer not null default 0 check (venue_pages >= 0),
  table_count integer not null default 0 check (table_count >= 0),
  venue_count integer not null default 0 check (venue_count >= 0),
  candidate_revision_id uuid,
  candidate_source_hash text check (candidate_source_hash is null or candidate_source_hash ~ '^[a-f0-9]{64}$'),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  conflicts jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts) = 'array' and jsonb_array_length(conflicts) <= 100),
  retry_disposition text not null default 'blocked' check (retry_disposition in ('safe_to_retry','new_operation_required','blocked')),
  safe_message text check (safe_message is null or length(safe_message) <= 180),
  check ((state = 'running' and finished_at is null) or (state <> 'running' and finished_at is not null))
);

create index app_supply_sync_runs_started_idx on public.app_supply_sync_runs (started_at desc, run_id desc);

create table public.app_supply_sync_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.app_supply_sync_runs(run_id) on delete restrict,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  table_count integer not null check (table_count >= 0),
  venue_count integer not null check (venue_count >= 0),
  normalized_candidate jsonb not null check (jsonb_typeof(normalized_candidate) = 'array'),
  created_at timestamptz not null default now(),
  state text not null default 'staged' check (state in ('staged','accepted','rejected'))
);

create table public.app_supply_external_mappings (
  entity_kind text not null check (entity_kind in ('table','venue')),
  source_record_id text not null check (length(source_record_id) between 1 and 200),
  core_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (entity_kind, source_record_id),
  unique (entity_kind, core_id)
);

create table public.app_supply_control (
  singleton boolean primary key default true check (singleton),
  latest_staged_revision_id uuid references public.app_supply_sync_revisions(revision_id),
  latest_candidate_hash text check (latest_candidate_hash is null or latest_candidate_hash ~ '^[a-f0-9]{64}$'),
  last_good_published_revision_id uuid,
  last_good_published_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((last_good_published_revision_id is null) = (last_good_published_at is null))
);
insert into public.app_supply_control(singleton) values (true);

alter table public.app_supply_sync_runs enable row level security;
alter table public.app_supply_sync_revisions enable row level security;
alter table public.app_supply_external_mappings enable row level security;
alter table public.app_supply_control enable row level security;
revoke all on public.app_supply_sync_runs, public.app_supply_sync_revisions,
  public.app_supply_external_mappings, public.app_supply_control from public, anon, authenticated, service_role;
grant select, insert, update on public.app_supply_sync_runs to service_role;
grant select, insert, update on public.app_supply_sync_revisions to service_role;
grant select, insert on public.app_supply_external_mappings to service_role;
grant select, update on public.app_supply_control to service_role;

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check (action in (
  'waitlist.signup.created', 'app.admission.invited', 'app.admission.activated',
  'app.admission.deleted', 'app.invitation.queued', 'app.invitation.accepted',
  'app.invitation.delivered', 'app.invitation.failed', 'app.invitation.unknown',
  'app.invitation.retry_requested', 'member_link.requested', 'auth.callback.rejected',
  'authorization.denied', 'identity.evidence.read', 'identity.review.decided',
  'supply.sync.started', 'supply.sync.finished'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup', 'app_admission', 'invitation_delivery', 'delivery_attempt',
  'auth_identity', 'member_link_request', 'profile_file', 'identity_review', 'supply_sync_run'
));

create function public.begin_supply_sync(p_operation_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_run public.app_supply_sync_runs%rowtype; v_created boolean := false;
begin
  perform app_private.require_service_role();
  if p_operation_id is null or p_actor_user_id is null then raise exception using errcode='22023', message='invalid_input'; end if;
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501', message='forbidden';
  end if;
  insert into public.app_supply_sync_runs(operation_id,actor_user_id,state)
  values(p_operation_id,p_actor_user_id,'running') on conflict(operation_id) do nothing
  returning * into v_run;
  v_created := found;
  if v_created then
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'supply.sync.started','supply_sync_run',v_run.run_id,p_operation_id,'{}'::jsonb);
  end if;
  select * into v_run from public.app_supply_sync_runs where operation_id=p_operation_id for update;
  if v_run.actor_user_id <> p_actor_user_id then raise exception using errcode='23505', message='operation_conflict'; end if;
  if v_run.state='running' and v_run.started_at < now() - interval '10 minutes' then
    update public.app_supply_sync_runs set state='failed',finished_at=now(),retry_disposition='new_operation_required',
      safe_message='A prior sync stopped before completion.' where run_id=v_run.run_id returning * into v_run;
  end if;
  return jsonb_build_object('run',to_jsonb(v_run),'created',v_created);
end $function$;

create function public.finish_supply_sync(
  p_run_id uuid, p_actor_user_id uuid, p_state text, p_counts jsonb,
  p_candidate_hash text default null, p_candidate jsonb default null,
  p_mappings jsonb default '[]'::jsonb, p_conflicts jsonb default '[]'::jsonb,
  p_retry_disposition text default 'blocked', p_safe_message text default null,
  p_total_conflict_count integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_run public.app_supply_sync_runs%rowtype; v_revision uuid; v_prior_hash text;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501', message='forbidden';
  end if;
  if p_state is null or p_state not in ('staged','no_change','incomplete','conflict','failed')
     or p_counts is null or jsonb_typeof(p_counts)<>'object' or p_conflicts is null or jsonb_typeof(p_conflicts)<>'array'
     or jsonb_array_length(p_conflicts)>100 or p_retry_disposition is null or p_retry_disposition not in ('safe_to_retry','new_operation_required','blocked')
     or p_total_conflict_count is not null and p_total_conflict_count < jsonb_array_length(p_conflicts)
     or not (p_counts ?& array['tablePages','venuePages','tables','venues'])
     or exists(select 1 from jsonb_each(p_counts) c where c.key in ('tablePages','venuePages','tables','venues') and (jsonb_typeof(c.value)<>'number' or c.value::text !~ '^[0-9]+$'))
     or p_safe_message is not null and length(p_safe_message)>180 then
    raise exception using errcode='22023', message='invalid_input';
  end if;
  select * into v_run from public.app_supply_sync_runs where run_id=p_run_id for update;
  if not found or v_run.actor_user_id<>p_actor_user_id then raise exception using errcode='P0002', message='not_found'; end if;
  if v_run.state<>'running' then return to_jsonb(v_run); end if;
  if p_state in ('staged','no_change') then
    if p_candidate is null or jsonb_typeof(p_candidate)<>'array' or p_candidate_hash is null or p_candidate_hash !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(p_mappings)<>'array' then raise exception using errcode='22023', message='candidate_invalid'; end if;
    select latest_candidate_hash, latest_staged_revision_id into v_prior_hash, v_revision
      from public.app_supply_control where singleton=true for update;
    if v_prior_hash=p_candidate_hash then
      p_state := 'no_change';
    else
      if exists(select 1 from jsonb_array_elements(p_mappings) as item(value)
        where jsonb_typeof(item.value)<>'object'
          or item.value->>'entityKind' not in ('table','venue')
          or item.value->>'sourceRecordId' is null or length(item.value->>'sourceRecordId') not between 1 and 200
          or item.value->>'coreId' is null or item.value->>'coreId' !~ '^[0-9a-fA-F-]{36}$') then
        raise exception using errcode='22023', message='mapping_invalid';
      end if;
      insert into public.app_supply_external_mappings(entity_kind,source_record_id,core_id)
      select item.value->>'entityKind',item.value->>'sourceRecordId',(item.value->>'coreId')::uuid
      from jsonb_array_elements(p_mappings) as item(value)
      on conflict(entity_kind,source_record_id) do nothing;
      if exists (
        select 1 from jsonb_array_elements(p_mappings) m
        left join public.app_supply_external_mappings x on x.entity_kind=m.value->>'entityKind' and x.source_record_id=m.value->>'sourceRecordId'
        where x.core_id is distinct from (m.value->>'coreId')::uuid
      ) then raise exception using errcode='23505', message='mapping_conflict'; end if;
      insert into public.app_supply_sync_revisions(run_id,source_hash,table_count,venue_count,normalized_candidate)
      values(p_run_id,p_candidate_hash,(p_counts->>'tables')::integer,(p_counts->>'venues')::integer,p_candidate)
      returning revision_id into v_revision;
      update public.app_supply_control set latest_staged_revision_id=v_revision,latest_candidate_hash=p_candidate_hash,updated_at=now() where singleton=true;
    end if;
  end if;
  update public.app_supply_sync_runs set state=p_state,finished_at=now(),
    table_pages=coalesce((p_counts->>'tablePages')::integer,0),venue_pages=coalesce((p_counts->>'venuePages')::integer,0),
    table_count=coalesce((p_counts->>'tables')::integer,0),venue_count=coalesce((p_counts->>'venues')::integer,0),
    candidate_revision_id=case when p_state in ('staged','no_change') then v_revision else null end,
    candidate_source_hash=case when p_state in ('staged','no_change') then p_candidate_hash else null end,
    conflict_count=coalesce(p_total_conflict_count,jsonb_array_length(p_conflicts)),conflicts=p_conflicts,retry_disposition=p_retry_disposition,
    safe_message=p_safe_message where run_id=p_run_id returning * into v_run;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
  values('user',p_actor_user_id,'supply.sync.finished','supply_sync_run',p_run_id,v_run.operation_id,'{}'::jsonb);
  return to_jsonb(v_run);
end $function$;

create function public.read_supply_sync_summary(p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_latest jsonb; v_published jsonb;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501', message='forbidden';
  end if;
  select to_jsonb(r) into v_latest from public.app_supply_sync_runs r order by started_at desc,run_id desc limit 1;
  select case when last_good_published_revision_id is null then null else jsonb_build_object(
    'revisionId',last_good_published_revision_id,'publishedAt',last_good_published_at) end
    into v_published from public.app_supply_control where singleton=true;
  return jsonb_build_object('latestRun',v_latest,'lastGoodPublished',v_published);
end $function$;

revoke all on function public.begin_supply_sync(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finish_supply_sync(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,integer) from public, anon, authenticated;
revoke all on function public.read_supply_sync_summary(uuid) from public, anon, authenticated;
grant execute on function public.begin_supply_sync(uuid,uuid) to service_role;
grant execute on function public.finish_supply_sync(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,integer) to service_role;
grant execute on function public.read_supply_sync_summary(uuid) to service_role;

comment on table public.app_supply_sync_revisions is 'Immutable normalized source candidate; staged revisions are not accepted or published.';
comment on table public.app_supply_control is 'Supply pointers. W05.1 sync can update staged pointers only; publishing requires a separate reviewed operation.';
