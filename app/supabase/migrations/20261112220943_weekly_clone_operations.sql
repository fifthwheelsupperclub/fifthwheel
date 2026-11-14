-- W05.3 durable, server-only manifest for local fixture-backed weekly cloning.
-- Airtable remains disabled until the source mapping and dedicated marker field
-- are independently verified. No provider operation is executed by this DDL.

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
  'supply.weekly_clone.undo_unknown', 'supply.weekly_clone.undo_refused'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup', 'app_admission', 'invitation_delivery', 'delivery_attempt', 'auth_identity',
  'member_link_request', 'profile_file', 'identity_review', 'supply_sync_run', 'supply_table',
  'supply_table_revision', 'supply_weekly_clone_operation', 'supply_weekly_clone_item'
));

create table public.app_supply_weekly_clone_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  source_week_start date not null,
  target_week_start date not null,
  week_delta integer not null,
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{32}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{32}$'),
  state text not null check (state in ('running','partial','outcome_unknown','completed','undoing','undo_unknown','undone','undo_refused')),
  manifest_revision integer not null default 1 check (manifest_revision > 0),
  retry_disposition text not null default 'blocked' check (retry_disposition in ('reconcile_first','same_operation_after_no_write','new_operation_required','blocked')),
  undo_operation_id uuid unique,
  undo_request_hash text check (undo_request_hash is null or undo_request_hash ~ '^[a-f0-9]{32}$'),
  undo_retry_disposition text check (undo_retry_disposition is null or undo_retry_disposition in ('reconcile_first','same_operation_after_no_delete','blocked')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check (source_week_start <> target_week_start),
  check (extract(isodow from source_week_start)=1 and extract(isodow from target_week_start)=1),
  check ((state in ('running','undoing') and finished_at is null) or state not in ('running','undoing'))
);

create table public.app_supply_weekly_clone_items (
  operation_id uuid not null references public.app_supply_weekly_clone_operations(operation_id) on delete restrict,
  ordinal integer not null check (ordinal between 1 and 500),
  source_table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  source_revision_id uuid not null references public.app_supply_table_revisions(revision_id) on delete restrict,
  source_revision integer not null check (source_revision > 0),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{32}$'),
  target_table_id uuid not null,
  target_revision_id uuid not null,
  target_hash text not null check (target_hash ~ '^[a-f0-9]{32}$'),
  marker_id uuid not null unique,
  source_record_id text,
  provider_record_id text,
  target_content jsonb not null check (jsonb_typeof(target_content)='object'),
  state text not null check (state in ('pending','creating','created','failed','outcome_unknown','undoing','undone','undo_unknown','undo_refused')),
  safe_code text check (safe_code is null or safe_code in ('write_unknown','delete_unknown','target_changed','active_activity','source_changed','provider_unavailable','provider_conflict')),
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (operation_id, source_table_id),
  unique (operation_id, ordinal),
  unique (target_table_id),
  unique (target_revision_id),
  check (source_record_id is null or length(source_record_id) between 1 and 200),
  check (provider_record_id is null or length(provider_record_id) between 1 and 200)
);

alter table public.app_supply_table_heads add column weekly_clone_undo_operation_id uuid;

create function app_private.block_supply_mutation_during_clone_undo()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.weekly_clone_undo_operation_id is not null and (
      new.draft_revision_id is distinct from old.draft_revision_id
      or new.accepted_revision_id is distinct from old.accepted_revision_id
      or new.published_revision_id is distinct from old.published_revision_id
      or new.lifecycle is distinct from old.lifecycle
      or new.protected_by_activity is distinct from old.protected_by_activity
      or new.sync_state is distinct from old.sync_state
    ) then
    raise exception using errcode='P0001',message='undo_in_progress';
  end if;
  return new;
end $function$;
revoke all on function app_private.block_supply_mutation_during_clone_undo() from public,anon,authenticated,service_role;
create trigger supply_table_clone_undo_guard before update on public.app_supply_table_heads
  for each row execute function app_private.block_supply_mutation_during_clone_undo();

create table public.app_supply_weekly_clone_fixture_records (
  run_id text not null check (run_id ~ '^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'),
  marker_id uuid not null,
  source_record_id text,
  provider_record_id text not null unique check (length(provider_record_id) between 1 and 200),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{32}$'),
  content jsonb not null check (jsonb_typeof(content)='object'),
  state text not null check (state in ('active','deleted')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(run_id,marker_id),
  check (source_record_id is null or length(source_record_id) between 1 and 200)
);

alter table public.app_supply_weekly_clone_operations enable row level security;
alter table public.app_supply_weekly_clone_items enable row level security;
alter table public.app_supply_weekly_clone_fixture_records enable row level security;
revoke all on public.app_supply_weekly_clone_operations, public.app_supply_weekly_clone_items, public.app_supply_weekly_clone_fixture_records from public, anon, authenticated, service_role;
grant select, insert, update on public.app_supply_weekly_clone_operations to service_role;
grant select, insert, update, delete on public.app_supply_weekly_clone_items to service_role;
grant select, insert, update on public.app_supply_weekly_clone_fixture_records to service_role;
create index app_supply_weekly_clone_operation_state_idx on public.app_supply_weekly_clone_operations(state, updated_at desc);
create index app_supply_weekly_clone_item_state_idx on public.app_supply_weekly_clone_items(operation_id, state, ordinal);

comment on table public.app_supply_weekly_clone_operations is 'Private durable W05.3 clone/undo operation and idempotency manifest.';
comment on table public.app_supply_weekly_clone_items is 'Private per-source manifest; marker/provider IDs are never included in browser DTOs.';
comment on table public.app_supply_weekly_clone_fixture_records is 'Run-scoped synthetic provider evidence for local W05.3 recovery tests; never Airtable data.';

create function app_private.weekly_clone_plan(p_source_week date,p_target_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_rows jsonb; v_delta integer; v_hash text;
begin
  v_delta := (p_target_week-p_source_week)/7;
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceTableId',h.table_id,
    'sourceRevisionId',d.revision_id,
    'sourceRevision',d.revision,
    'sourceHash',md5(d.content::text),
    'content',d.content,
    'targetContent',jsonb_set(d.content,'{localDate}',to_jsonb(((d.content->>'localDate')::date+(v_delta*7))::text),false),
    'title',coalesce(d.content->>'title',''),
    'sourceLocalDate',d.content->>'localDate',
    'targetLocalDate',((d.content->>'localDate')::date+(v_delta*7))::text,
    'eligibility',case when d.state='draft' and h.lifecycle='draft' and h.sync_state='current' and not h.protected_by_activity then 'eligible' else 'conflict' end,
    'conflictCode',case
      when d.state<>'draft' or h.lifecycle<>'draft' then 'source_not_draft'
      when h.sync_state<>'current' then 'source_changed'
      when h.protected_by_activity then 'protected_change'
      else null end
  ) order by h.table_id),'[]'::jsonb)
  into v_rows
  from public.app_supply_table_heads h
  join public.app_supply_table_revisions d on d.revision_id=h.draft_revision_id
  where case when coalesce(d.content->>'localDate','') ~ '^\d{4}-\d{2}-\d{2}$'
    then (d.content->>'localDate')::date >= p_source_week and (d.content->>'localDate')::date < p_source_week+7
    else false end;
  v_hash:=md5(v_rows::text);
  return jsonb_build_object('planHash',v_hash,'weekDelta',v_delta,'items',v_rows);
end $function$;
revoke all on function app_private.weekly_clone_plan(date,date) from public,anon,authenticated;
grant execute on function app_private.weekly_clone_plan(date,date) to service_role;

create function app_private.weekly_clone_operation_json(p_operation_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select case when op.operation_id is null then null else jsonb_build_object(
    'operation',to_jsonb(op),
    'items',coalesce((select jsonb_agg(to_jsonb(item) order by item.ordinal)
      from public.app_supply_weekly_clone_items item where item.operation_id=op.operation_id),'[]'::jsonb)
  ) end
  from public.app_supply_weekly_clone_operations op where op.operation_id=p_operation_id
$function$;
revoke all on function app_private.weekly_clone_operation_json(uuid) from public,anon,authenticated;
grant execute on function app_private.weekly_clone_operation_json(uuid) to service_role;

create function public.preview_weekly_supply_clone(p_actor_user_id uuid,p_source_week_start date,p_target_week_start date)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_plan jsonb;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501',message='forbidden';
  end if;
  if p_source_week_start is null or p_target_week_start is null
    or extract(isodow from p_source_week_start)<>1 or extract(isodow from p_target_week_start)<>1
    or p_source_week_start=p_target_week_start then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  v_plan:=app_private.weekly_clone_plan(p_source_week_start,p_target_week_start);
  if jsonb_array_length(v_plan->'items')>500 then raise exception using errcode='22023',message='too_many_sources'; end if;
  return v_plan;
end $function$;

create function public.begin_weekly_supply_clone(
  p_actor_user_id uuid,p_operation_id uuid,p_source_week_start date,p_target_week_start date,p_expected_plan_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_plan jsonb; v_item jsonb; v_operation public.app_supply_weekly_clone_operations%rowtype;
  v_request_hash text; v_created boolean:=false; v_eligible integer:=0; v_source_record_id text;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501',message='forbidden';
  end if;
  if p_operation_id is null or p_source_week_start is null or p_target_week_start is null
    or extract(isodow from p_source_week_start)<>1 or extract(isodow from p_target_week_start)<>1
    or p_source_week_start=p_target_week_start or p_expected_plan_hash is null
    or p_expected_plan_hash !~ '^[a-f0-9]{32}$' then raise exception using errcode='22023',message='invalid_input'; end if;
  v_request_hash:=md5(jsonb_build_object('sourceWeekStart',p_source_week_start,'targetWeekStart',p_target_week_start,'planHash',p_expected_plan_hash)::text);

  select * into v_operation from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
  if found then
    if v_operation.actor_user_id<>p_actor_user_id or v_operation.request_hash<>v_request_hash then
      raise exception using errcode='23505',message='operation_conflict';
    end if;
    return app_private.weekly_clone_operation_json(p_operation_id);
  end if;

  -- Lock source heads in stable order, then recompute the exact plan under lock.
  perform h.table_id
  from public.app_supply_table_heads h
  join public.app_supply_table_revisions d on d.revision_id=h.draft_revision_id
  where case when coalesce(d.content->>'localDate','') ~ '^\d{4}-\d{2}-\d{2}$'
    then (d.content->>'localDate')::date >= p_source_week_start and (d.content->>'localDate')::date < p_source_week_start+7
    else false end
  order by h.table_id for update of h;
  v_plan:=app_private.weekly_clone_plan(p_source_week_start,p_target_week_start);
  if v_plan->>'planHash'<>p_expected_plan_hash then raise exception using errcode='P0001',message='revision_conflict'; end if;
  select count(*) into v_eligible from jsonb_array_elements(v_plan->'items') e(value) where e.value->>'eligibility'='eligible';
  if v_eligible=0 then raise exception using errcode='22023',message='no_eligible_sources'; end if;

  insert into public.app_supply_weekly_clone_operations(
    operation_id,actor_user_id,source_week_start,target_week_start,week_delta,plan_hash,request_hash,state,retry_disposition
  ) values(p_operation_id,p_actor_user_id,p_source_week_start,p_target_week_start,(p_target_week_start-p_source_week_start)/7,
    p_expected_plan_hash,v_request_hash,'running','blocked') on conflict(operation_id) do nothing returning * into v_operation;
  v_created:=found;
  if not v_created then
    select * into v_operation from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
    if v_operation.actor_user_id<>p_actor_user_id or v_operation.request_hash<>v_request_hash then raise exception using errcode='23505',message='operation_conflict'; end if;
    return app_private.weekly_clone_operation_json(p_operation_id);
  end if;

  for v_item in select value from jsonb_array_elements(v_plan->'items') as item(value) order by (value->>'sourceTableId') loop
    if v_item->>'eligibility'<>'eligible' then continue; end if;
    select m.source_record_id into v_source_record_id from public.app_supply_external_mappings m
      where m.entity_kind='table' and m.core_id=(v_item->>'sourceTableId')::uuid;
    insert into public.app_supply_weekly_clone_items(
      operation_id,ordinal,source_table_id,source_revision_id,source_revision,source_hash,
      target_table_id,target_revision_id,target_hash,marker_id,source_record_id,target_content,state
    ) values(
      p_operation_id,(select count(*)+1 from public.app_supply_weekly_clone_items where operation_id=p_operation_id),
      (v_item->>'sourceTableId')::uuid,(v_item->>'sourceRevisionId')::uuid,(v_item->>'sourceRevision')::integer,v_item->>'sourceHash',
      gen_random_uuid(),gen_random_uuid(),md5((v_item->'targetContent')::text),gen_random_uuid(),v_source_record_id,v_item->'targetContent','pending'
    );
  end loop;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'supply.weekly_clone.started','supply_weekly_clone_operation',p_operation_id,p_operation_id,'{}'::jsonb);
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;

create function public.claim_weekly_supply_clone_item(p_actor_user_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_op public.app_supply_weekly_clone_operations%rowtype; v_item public.app_supply_weekly_clone_items%rowtype;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  select * into v_op from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
  if not found or v_op.actor_user_id<>p_actor_user_id then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_item from public.app_supply_weekly_clone_items i where i.operation_id=p_operation_id and i.state in ('pending','failed') order by i.ordinal limit 1 for update;
  if not found then return null; end if;
  if v_item.state='failed' and v_op.retry_disposition<>'same_operation_after_no_write' then raise exception using errcode='P0001',message='operation_unresolved'; end if;
  update public.app_supply_weekly_clone_items set state='creating',safe_code=null,lease_until=now()+interval '5 minutes',updated_at=now()
    where operation_id=p_operation_id and source_table_id=v_item.source_table_id returning * into v_item;
  return jsonb_build_object('operationId',v_item.operation_id,'sourceTableId',v_item.source_table_id,'sourceRevisionId',v_item.source_revision_id,
    'sourceRecordId',v_item.source_record_id,'targetTableId',v_item.target_table_id,'markerId',v_item.marker_id,
    'content',v_item.target_content,'contentHash',v_item.target_hash,'state',v_item.state,'providerRecordId',v_item.provider_record_id);
end $function$;

create function public.finish_weekly_supply_clone_item(
  p_actor_user_id uuid,p_operation_id uuid,p_source_table_id uuid,p_state text,p_provider_record_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_op public.app_supply_weekly_clone_operations%rowtype; v_item public.app_supply_weekly_clone_items%rowtype; v_source public.app_supply_table_heads%rowtype;
  v_new_revision public.app_supply_table_revisions%rowtype; v_state text; v_retry text; v_count integer; v_created integer; v_unknown integer; v_failed integer; v_conflict integer;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_state is null or p_state not in ('created','failed','outcome_unknown','conflict')
    or p_state='created' and (p_provider_record_id is null or length(p_provider_record_id) not between 1 and 200)
    or p_state<>'created' and p_provider_record_id is not null then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_op from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
  if not found or v_op.actor_user_id<>p_actor_user_id then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_item from public.app_supply_weekly_clone_items where operation_id=p_operation_id and source_table_id=p_source_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_item.state='created' then
    if p_state='created' and v_item.provider_record_id=p_provider_record_id then return app_private.weekly_clone_operation_json(p_operation_id); end if;
    raise exception using errcode='P0001',message='operation_conflict';
  end if;
  if v_item.state<>'creating' or v_item.lease_until is null or v_item.lease_until<now() then raise exception using errcode='P0001',message='stale_worker'; end if;
  if p_state='created' then
    select * into v_source from public.app_supply_table_heads where table_id=v_item.source_table_id for update;
    if not found or v_source.draft_revision_id<>v_item.source_revision_id or v_source.lifecycle<>'draft' or v_source.sync_state<>'current'
      or v_source.protected_by_activity or not exists(select 1 from public.app_supply_table_revisions r where r.revision_id=v_item.source_revision_id and md5(r.content::text)=v_item.source_hash) then
      raise exception using errcode='P0001',message='revision_conflict';
    end if;
    if exists(select 1 from public.app_supply_external_mappings m where m.entity_kind='table' and m.source_record_id=p_provider_record_id and m.core_id<>v_item.target_table_id) then
      raise exception using errcode='P0001',message='marker_conflict';
    end if;
    insert into public.app_supply_table_heads(table_id,source_revision_id,lifecycle,sync_state,protected_by_activity)
      values(v_item.target_table_id,v_source.source_revision_id,'draft','current',false);
    insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,source_revision_id,created_by)
      values(v_item.target_revision_id,v_item.target_table_id,1,'draft',v_item.target_content,v_source.source_revision_id,p_actor_user_id)
      returning * into v_new_revision;
    update public.app_supply_table_heads set draft_revision_id=v_item.target_revision_id,updated_at=now() where table_id=v_item.target_table_id;
    insert into public.app_supply_external_mappings(entity_kind,source_record_id,core_id)
      values('table',p_provider_record_id,v_item.target_table_id) on conflict do nothing;
    update public.app_supply_weekly_clone_items set state='created',provider_record_id=p_provider_record_id,lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'supply.weekly_clone.item_created','supply_weekly_clone_item',p_source_table_id,p_operation_id,'{}'::jsonb);
  elsif p_state='outcome_unknown' then
    update public.app_supply_weekly_clone_items set state='outcome_unknown',safe_code='write_unknown',lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'supply.weekly_clone.item_unknown','supply_weekly_clone_item',p_source_table_id,p_operation_id,'{}'::jsonb);
  elsif p_state='conflict' then
    update public.app_supply_weekly_clone_items set state='failed',safe_code='provider_conflict',lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'supply.weekly_clone.item_conflict','supply_weekly_clone_item',p_source_table_id,p_operation_id,'{}'::jsonb);
  else
    update public.app_supply_weekly_clone_items set state='failed',safe_code='provider_unavailable',lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
  end if;
  select count(*),count(*) filter(where state='created'),count(*) filter(where state='outcome_unknown'),count(*) filter(where state='failed'),
    count(*) filter(where state='failed' and safe_code='provider_conflict')
    into v_count,v_created,v_unknown,v_failed,v_conflict from public.app_supply_weekly_clone_items where operation_id=p_operation_id;
  v_state:=case when v_unknown>0 then 'outcome_unknown' when v_created=v_count then 'completed' when v_failed>0 and v_created>0 then 'partial' when v_failed=v_count then 'partial' else 'running' end;
  v_retry:=case when v_unknown>0 then 'reconcile_first' when v_conflict>0 then 'blocked' when v_failed>0 then 'same_operation_after_no_write' else 'blocked' end;
  update public.app_supply_weekly_clone_operations set state=v_state,retry_disposition=v_retry,
    manifest_revision=manifest_revision+1,updated_at=now(),finished_at=case when v_state in ('completed','partial') then now() else null end
    where operation_id=p_operation_id;
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;

create function public.read_weekly_supply_clone_operation(p_actor_user_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;

create function public.list_weekly_supply_clone_operations(p_actor_user_id uuid,p_cursor text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb; v_next text; v_limit integer; v_cursor_time timestamptz; v_cursor_id uuid;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9TZ:.-]+\|[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='invalid_input'; end if;
    v_cursor_time:=split_part(p_cursor,'|',1)::timestamptz; v_cursor_id:=split_part(p_cursor,'|',2)::uuid;
  end if;
  v_limit:=p_limit;
  with matching as (
    select op.*,row_number() over(order by op.updated_at desc,op.operation_id asc) rn,
      (select count(*) from public.app_supply_weekly_clone_items i where i.operation_id=op.operation_id) total_count,
      (select count(*) from public.app_supply_weekly_clone_items i where i.operation_id=op.operation_id and i.state='created') created_count,
      (select count(*) from public.app_supply_weekly_clone_items i where i.operation_id=op.operation_id and i.state in ('creating','outcome_unknown','undoing','undo_unknown')) unresolved_count,
      (select count(*) from public.app_supply_weekly_clone_items i where i.operation_id=op.operation_id and i.state='failed') failed_count,
      (select count(*) from public.app_supply_weekly_clone_items i where i.operation_id=op.operation_id and i.state='undone') undone_count
    from public.app_supply_weekly_clone_operations op
    where v_cursor_time is null or op.updated_at<v_cursor_time or (op.updated_at=v_cursor_time and op.operation_id>v_cursor_id)
    order by op.updated_at desc,op.operation_id asc limit v_limit+1
  ), projected as (
    select jsonb_build_object('operationId',operation_id,'sourceWeekStart',source_week_start,'targetWeekStart',target_week_start,
      'state',state,'manifestRevision',manifest_revision,'startedAt',started_at,'updatedAt',updated_at,'finishedAt',finished_at,
      'retryDisposition',retry_disposition,
      'undoState',case when state='undone' then 'undone' when state in ('undoing','undo_unknown') then 'unknown'
        when state in ('completed','partial','outcome_unknown') then 'available' else 'not_started' end,
      'undoBlockedCode',case when state='outcome_unknown' then 'operation_unresolved' else null end,
      'counts',jsonb_build_object('total',total_count,'created',created_count,'unresolved',unresolved_count,'failed',failed_count,'undone',undone_count)) item,
      updated_at,operation_id,rn
    from matching
  )
  select coalesce(jsonb_agg(item order by updated_at desc,operation_id asc) filter(where rn<=v_limit),'[]'::jsonb),
    case when count(*)>v_limit then (select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||operation_id::text
      from projected where rn=v_limit order by updated_at desc,operation_id asc limit 1) else null end
    into v_items,v_next from projected;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $function$;

create function public.reconcile_weekly_supply_clone_item(
  p_actor_user_id uuid,p_operation_id uuid,p_source_table_id uuid,p_resolution text,p_provider_record_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_op public.app_supply_weekly_clone_operations%rowtype; v_item public.app_supply_weekly_clone_items%rowtype;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_resolution is null or p_resolution not in ('found','absent','unknown','conflict') then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_op from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
  if not found or v_op.actor_user_id<>p_actor_user_id then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_item from public.app_supply_weekly_clone_items where operation_id=p_operation_id and source_table_id=p_source_table_id for update;
  if not found or v_item.state not in ('creating','outcome_unknown','failed') then raise exception using errcode='P0001',message='operation_unresolved'; end if;
  if p_resolution='found' then
    if p_provider_record_id is null or length(p_provider_record_id) not between 1 and 200 then raise exception using errcode='22023',message='invalid_input'; end if;
    update public.app_supply_weekly_clone_items set state='creating',lease_until=now()+interval '1 minute',updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    return public.finish_weekly_supply_clone_item(p_actor_user_id,p_operation_id,p_source_table_id,'created',p_provider_record_id);
  elsif p_resolution='absent' then
    if p_provider_record_id is not null then raise exception using errcode='22023',message='invalid_input'; end if;
    update public.app_supply_weekly_clone_items set state='failed',safe_code=null,lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    update public.app_supply_weekly_clone_operations set state='partial',retry_disposition='same_operation_after_no_write',
      manifest_revision=manifest_revision+1,updated_at=now(),finished_at=now() where operation_id=p_operation_id;
  elsif p_resolution='unknown' then
    update public.app_supply_weekly_clone_items set state='outcome_unknown',safe_code='write_unknown',lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    update public.app_supply_weekly_clone_operations set state='outcome_unknown',retry_disposition='reconcile_first',
      manifest_revision=manifest_revision+1,updated_at=now(),finished_at=null where operation_id=p_operation_id;
  else
    update public.app_supply_weekly_clone_items set state='failed',safe_code='provider_conflict',lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    update public.app_supply_weekly_clone_operations set state='partial',retry_disposition='blocked',
      manifest_revision=manifest_revision+1,updated_at=now(),finished_at=now() where operation_id=p_operation_id;
  end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'supply.weekly_clone.reconciled','supply_weekly_clone_item',p_source_table_id,p_operation_id,'{}'::jsonb);
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;

create function public.begin_weekly_supply_clone_undo(
  p_actor_user_id uuid,p_operation_id uuid,p_undo_operation_id uuid,p_expected_manifest_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_op public.app_supply_weekly_clone_operations%rowtype; v_item public.app_supply_weekly_clone_items%rowtype; v_head public.app_supply_table_heads%rowtype; v_hash text;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_operation_id is null or p_undo_operation_id is null or p_expected_manifest_revision is null or p_expected_manifest_revision<1 then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_op from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
  if not found or v_op.actor_user_id<>p_actor_user_id then raise exception using errcode='P0002',message='not_found'; end if;
  v_hash:=md5(jsonb_build_object('operationId',p_operation_id,'undoOperationId',p_undo_operation_id,'manifestRevision',p_expected_manifest_revision)::text);
  if v_op.undo_operation_id is not null then
    if v_op.undo_operation_id<>p_undo_operation_id then raise exception using errcode='23505',message='operation_conflict'; end if;
    return app_private.weekly_clone_operation_json(p_operation_id);
  end if;
  if v_op.manifest_revision<>p_expected_manifest_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_op.state<>'completed' or exists(select 1 from public.app_supply_weekly_clone_items i where i.operation_id=p_operation_id and i.state<>'created') then
    raise exception using errcode='P0001',message='operation_unresolved';
  end if;
  -- All-or-nothing preflight: no delete starts unless every target remains an
  -- unchanged draft with no accepted/published pointer or protected activity.
  -- Persist a row guard before leaving this transaction; draft edit, accept,
  -- publish, sync, and activity-marker updates then fail until reconciliation.
  for v_item in select i.* from public.app_supply_weekly_clone_items i where i.operation_id=p_operation_id order by i.ordinal for update loop
    select h.* into v_head from public.app_supply_table_heads h
      join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id
      where h.table_id=v_item.target_table_id and h.lifecycle='draft' and h.sync_state='current' and not h.protected_by_activity
        and h.accepted_revision_id is null and h.published_revision_id is null and h.draft_revision_id=v_item.target_revision_id
        and (h.weekly_clone_undo_operation_id is null or h.weekly_clone_undo_operation_id=p_undo_operation_id)
        and r.table_id=h.table_id and md5(r.content::text)=v_item.target_hash
      for update of h;
    if not found then raise exception using errcode='P0001',message='undo_refused'; end if;
    update public.app_supply_table_heads set weekly_clone_undo_operation_id=p_undo_operation_id where table_id=v_item.target_table_id;
  end loop;
  update public.app_supply_weekly_clone_operations set undo_operation_id=p_undo_operation_id,undo_request_hash=v_hash,
    undo_retry_disposition='blocked',state='undoing',manifest_revision=manifest_revision+1,updated_at=now(),finished_at=null
    where operation_id=p_operation_id;
  update public.app_supply_weekly_clone_items set state='undoing',lease_until=now()+interval '5 minutes',updated_at=now()
    where operation_id=p_operation_id;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'supply.weekly_clone.undo_started','supply_weekly_clone_operation',p_operation_id,p_undo_operation_id,'{}'::jsonb);
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;

create function public.finish_weekly_supply_clone_undo_item(
  p_actor_user_id uuid,p_operation_id uuid,p_source_table_id uuid,p_resolution text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_op public.app_supply_weekly_clone_operations%rowtype; v_item public.app_supply_weekly_clone_items%rowtype; v_head public.app_supply_table_heads%rowtype; v_state text; v_unknown integer; v_undone integer; v_total integer;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_resolution is null or p_resolution not in ('deleted','present','outcome_unknown','refused') then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_op from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
  if not found or v_op.actor_user_id<>p_actor_user_id or v_op.undo_operation_id is null then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_item from public.app_supply_weekly_clone_items where operation_id=p_operation_id and source_table_id=p_source_table_id for update;
  if not found or v_item.state not in ('undoing','undo_unknown') then raise exception using errcode='P0001',message='operation_unresolved'; end if;
  if p_resolution='deleted' then
    select * into v_head from public.app_supply_table_heads where table_id=v_item.target_table_id for update;
    if found and v_head.lifecycle='draft' and v_head.sync_state='current' and not v_head.protected_by_activity
      and v_head.accepted_revision_id is null and v_head.published_revision_id is null
      and v_head.draft_revision_id=v_item.target_revision_id and v_head.weekly_clone_undo_operation_id=v_op.undo_operation_id
      and exists(select 1 from public.app_supply_table_revisions r where r.revision_id=v_item.target_revision_id and r.table_id=v_head.table_id and md5(r.content::text)=v_item.target_hash) then
      delete from public.app_supply_external_mappings where entity_kind='table' and core_id=v_item.target_table_id;
      delete from public.app_supply_table_assignments where table_id=v_item.target_table_id;
      delete from public.app_supply_table_revisions where table_id=v_item.target_table_id;
      delete from public.app_supply_table_heads where table_id=v_item.target_table_id;
      update public.app_supply_weekly_clone_items set state='undone',safe_code=null,lease_until=null,updated_at=now()
        where operation_id=p_operation_id and source_table_id=p_source_table_id;
      insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
        values('user',p_actor_user_id,'supply.weekly_clone.item_undone','supply_weekly_clone_item',p_source_table_id,v_op.undo_operation_id,'{}'::jsonb);
    else
      update public.app_supply_weekly_clone_items set state='undo_refused',safe_code='target_changed',lease_until=null,updated_at=now()
        where operation_id=p_operation_id and source_table_id=p_source_table_id;
    end if;
  elsif p_resolution='outcome_unknown' then
    update public.app_supply_weekly_clone_items set state='undo_unknown',safe_code='delete_unknown',lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'supply.weekly_clone.undo_unknown','supply_weekly_clone_item',p_source_table_id,v_op.undo_operation_id,'{}'::jsonb);
  elsif p_resolution='present' then
    update public.app_supply_weekly_clone_items set state='undoing',safe_code=null,lease_until=now()+interval '5 minutes',updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    update public.app_supply_weekly_clone_operations set state='undoing',undo_retry_disposition='same_operation_after_no_delete',
      manifest_revision=manifest_revision+1,updated_at=now(),finished_at=null where operation_id=p_operation_id;
  else
    update public.app_supply_table_heads set weekly_clone_undo_operation_id=null
      where table_id=v_item.target_table_id and weekly_clone_undo_operation_id=v_op.undo_operation_id;
    update public.app_supply_weekly_clone_items set state='undo_refused',safe_code='target_changed',lease_until=null,updated_at=now()
      where operation_id=p_operation_id and source_table_id=p_source_table_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'supply.weekly_clone.undo_refused','supply_weekly_clone_item',p_source_table_id,v_op.undo_operation_id,'{}'::jsonb);
  end if;
  select count(*),count(*) filter(where state='undo_unknown'),count(*) filter(where state='undone') into v_total,v_unknown,v_undone
    from public.app_supply_weekly_clone_items where operation_id=p_operation_id;
  v_state:=case when v_unknown>0 then 'undo_unknown' when v_undone=v_total then 'undone'
    when exists(select 1 from public.app_supply_weekly_clone_items i where i.operation_id=p_operation_id and i.state='undo_refused') then 'undo_refused'
    else 'undoing' end;
  update public.app_supply_weekly_clone_operations set state=v_state,undo_retry_disposition=case when v_unknown>0 then 'reconcile_first' else 'blocked' end,
    manifest_revision=manifest_revision+1,updated_at=now(),finished_at=case when v_state in ('undone','undo_refused') then now() else null end
    where operation_id=p_operation_id;
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;

revoke all on function public.preview_weekly_supply_clone(uuid,date,date) from public,anon,authenticated;
revoke all on function public.begin_weekly_supply_clone(uuid,uuid,date,date,text) from public,anon,authenticated;
revoke all on function public.claim_weekly_supply_clone_item(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_weekly_supply_clone_item(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.read_weekly_supply_clone_operation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_weekly_supply_clone_operations(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.reconcile_weekly_supply_clone_item(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.begin_weekly_supply_clone_undo(uuid,uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.finish_weekly_supply_clone_undo_item(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.preview_weekly_supply_clone(uuid,date,date) to service_role;
grant execute on function public.begin_weekly_supply_clone(uuid,uuid,date,date,text) to service_role;
grant execute on function public.claim_weekly_supply_clone_item(uuid,uuid) to service_role;
grant execute on function public.finish_weekly_supply_clone_item(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.read_weekly_supply_clone_operation(uuid,uuid) to service_role;
grant execute on function public.list_weekly_supply_clone_operations(uuid,text,integer) to service_role;
grant execute on function public.reconcile_weekly_supply_clone_item(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.begin_weekly_supply_clone_undo(uuid,uuid,uuid,integer) to service_role;
grant execute on function public.finish_weekly_supply_clone_undo_item(uuid,uuid,uuid,text) to service_role;

create function public.fixture_create_weekly_clone_record(
  p_actor_user_id uuid,p_run_id text,p_marker_id uuid,p_source_record_id text,p_content jsonb,p_content_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.app_supply_weekly_clone_fixture_records%rowtype; v_record_id text; v_created boolean;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_run_id is null or p_run_id !~ '^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
    or p_marker_id is null or p_content is null or jsonb_typeof(p_content)<>'object' or length(p_content::text)>65536
    or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{32}$'
    or p_source_record_id is not null and length(p_source_record_id) not between 1 and 200 then raise exception using errcode='22023',message='invalid_input'; end if;
  v_record_id:='fixture-weekly:'||replace(lower(p_run_id),'-','')||':'||p_marker_id::text;
  insert into public.app_supply_weekly_clone_fixture_records(run_id,marker_id,source_record_id,provider_record_id,content_hash,content,state,created_by)
    values(lower(p_run_id),p_marker_id,p_source_record_id,v_record_id,p_content_hash,p_content,'active',p_actor_user_id)
    on conflict(run_id,marker_id) do nothing returning * into v_row;
  v_created:=found;
  if not v_created then select * into v_row from public.app_supply_weekly_clone_fixture_records where run_id=lower(p_run_id) and marker_id=p_marker_id for update; end if;
  if v_row.source_record_id is distinct from p_source_record_id or v_row.content_hash<>p_content_hash or v_row.content<>p_content then
    return jsonb_build_object('state','conflict');
  end if;
  if v_row.state='deleted' then return jsonb_build_object('state','deleted','providerRecordId',v_row.provider_record_id,'contentHash',v_row.content_hash); end if;
  return jsonb_build_object('state','created','providerRecordId',v_row.provider_record_id,'contentHash',v_row.content_hash);
end $function$;

create function public.fixture_reconcile_weekly_clone_create(
  p_actor_user_id uuid,p_run_id text,p_marker_id uuid,p_source_record_id text,p_content_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.app_supply_weekly_clone_fixture_records%rowtype;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_run_id is null or p_run_id !~ '^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' or p_marker_id is null
    or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{32}$' then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_row from public.app_supply_weekly_clone_fixture_records where run_id=lower(p_run_id) and marker_id=p_marker_id;
  if not found or v_row.state='deleted' then return jsonb_build_object('state','absent'); end if;
  if v_row.content_hash<>p_content_hash or v_row.source_record_id is distinct from p_source_record_id then return jsonb_build_object('state','conflict'); end if;
  return jsonb_build_object('state','found','providerRecordId',v_row.provider_record_id,'contentHash',v_row.content_hash);
end $function$;

create function public.fixture_delete_weekly_clone_record(
  p_actor_user_id uuid,p_run_id text,p_marker_id uuid,p_provider_record_id text,p_content_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.app_supply_weekly_clone_fixture_records%rowtype;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_run_id is null or p_run_id !~ '^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
    or p_marker_id is null or p_provider_record_id is null or length(p_provider_record_id) not between 1 and 200
    or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{32}$' then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_row from public.app_supply_weekly_clone_fixture_records where run_id=lower(p_run_id) and marker_id=p_marker_id for update;
  if not found then return jsonb_build_object('state','absent'); end if;
  if v_row.provider_record_id<>p_provider_record_id or v_row.content_hash<>p_content_hash then return jsonb_build_object('state','conflict'); end if;
  if v_row.state='active' then update public.app_supply_weekly_clone_fixture_records set state='deleted',updated_at=now() where run_id=lower(p_run_id) and marker_id=p_marker_id; end if;
  return jsonb_build_object('state','deleted','providerRecordId',v_row.provider_record_id,'contentHash',v_row.content_hash);
end $function$;

create function public.fixture_reconcile_weekly_clone_delete(
  p_actor_user_id uuid,p_run_id text,p_marker_id uuid,p_provider_record_id text,p_content_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.app_supply_weekly_clone_fixture_records%rowtype;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_run_id is null or p_run_id !~ '^(?:[a-f0-9]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' or p_marker_id is null
    or p_provider_record_id is null or p_content_hash is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_row from public.app_supply_weekly_clone_fixture_records where run_id=lower(p_run_id) and marker_id=p_marker_id;
  if not found or v_row.state='deleted' then return jsonb_build_object('state','absent'); end if;
  if v_row.provider_record_id<>p_provider_record_id or v_row.content_hash<>p_content_hash then return jsonb_build_object('state','conflict'); end if;
  return jsonb_build_object('state','found','providerRecordId',v_row.provider_record_id,'contentHash',v_row.content_hash);
end $function$;

revoke all on function public.fixture_create_weekly_clone_record(uuid,text,uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.fixture_reconcile_weekly_clone_create(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.fixture_delete_weekly_clone_record(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.fixture_reconcile_weekly_clone_delete(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fixture_create_weekly_clone_record(uuid,text,uuid,text,jsonb,text) to service_role;
grant execute on function public.fixture_reconcile_weekly_clone_create(uuid,text,uuid,text,text) to service_role;
grant execute on function public.fixture_delete_weekly_clone_record(uuid,text,uuid,text,text) to service_role;
grant execute on function public.fixture_reconcile_weekly_clone_delete(uuid,text,uuid,text,text) to service_role;
