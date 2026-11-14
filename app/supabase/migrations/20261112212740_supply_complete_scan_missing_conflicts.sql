-- A complete, valid supply scan may flag an already-mapped Table as missing.
-- It never deletes source mappings/revisions or changes Table lifecycle pointers.

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check (action in (
  'waitlist.signup.created', 'app.admission.invited', 'app.admission.activated', 'app.admission.deleted',
  'app.invitation.queued', 'app.invitation.accepted', 'app.invitation.delivered', 'app.invitation.failed',
  'app.invitation.unknown', 'app.invitation.retry_requested', 'member_link.requested', 'auth.callback.rejected',
  'authorization.denied', 'identity.evidence.read', 'identity.review.decided',
  'supply.sync.started', 'supply.sync.finished', 'supply.sync.missing_detected', 'supply.sync.missing_resolved',
  'supply.draft.created', 'supply.draft.updated', 'supply.draft.accepted', 'supply.draft.published'
));

create or replace function public.finish_supply_sync(
  p_run_id uuid, p_actor_user_id uuid, p_state text, p_counts jsonb,
  p_candidate_hash text default null, p_candidate jsonb default null,
  p_mappings jsonb default '[]'::jsonb, p_conflicts jsonb default '[]'::jsonb,
  p_retry_disposition text default 'blocked', p_safe_message text default null,
  p_total_conflict_count integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_run public.app_supply_sync_runs%rowtype;
  v_revision uuid;
  v_prior_hash text;
  v_missing_count integer := 0;
  v_missing_details jsonb := '[]'::jsonb;
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
    if exists(select 1 from jsonb_array_elements(p_mappings) as item(value)
      where jsonb_typeof(item.value)<>'object'
        or item.value->>'entityKind' not in ('table','venue')
        or item.value->>'sourceRecordId' is null or length(item.value->>'sourceRecordId') not between 1 and 200
        or item.value->>'coreId' is null or item.value->>'coreId' !~ '^[0-9a-fA-F-]{36}$') then
      raise exception using errcode='22023', message='mapping_invalid';
    end if;
    -- Serialize complete-snapshot reconciliation and staging so concurrent
    -- runs cannot interleave missing/current transitions.
    select latest_candidate_hash, latest_staged_revision_id into v_prior_hash, v_revision
      from public.app_supply_control where singleton=true for update;

    -- Only a fully validated candidate reaches this point. Reconcile absence
    -- against stable mappings, never names or partial provider pages.
    select count(*) into v_missing_count
      from public.app_supply_external_mappings m
      join public.app_supply_table_heads h on h.table_id=m.core_id
      where m.entity_kind='table'
        and not exists(select 1 from jsonb_array_elements(p_mappings) as incoming(value)
          where incoming.value->>'entityKind'='table' and incoming.value->>'sourceRecordId'=m.source_record_id);
    select coalesce(jsonb_agg(jsonb_build_object(
        'entityKind','table','recordOrdinal',missing.ordinal,'field','source',
        'code','invalid_source_record',
        'message','A previously mapped Table is absent from the complete source scan and needs admin review.'
      ) order by missing.ordinal),'[]'::jsonb)
      into v_missing_details
      from (
        select row_number() over(order by m.core_id)::integer as ordinal
        from public.app_supply_external_mappings m
        join public.app_supply_table_heads h on h.table_id=m.core_id
        where m.entity_kind='table'
          and not exists(select 1 from jsonb_array_elements(p_mappings) as incoming(value)
            where incoming.value->>'entityKind'='table' and incoming.value->>'sourceRecordId'=m.source_record_id)
        order by m.core_id limit greatest(0,100-jsonb_array_length(p_conflicts))
      ) missing;

    -- State-only changes: preserve lifecycle, source/draft/accepted/published
    -- pointers, revisions, and all runtime/financial rows.
    with changed as (
      update public.app_supply_table_heads h set sync_state='missing'
      from public.app_supply_external_mappings m
      where m.entity_kind='table' and m.core_id=h.table_id and h.sync_state<>'missing'
        and not exists(select 1 from jsonb_array_elements(p_mappings) as incoming(value)
          where incoming.value->>'entityKind'='table' and incoming.value->>'sourceRecordId'=m.source_record_id)
      returning h.table_id
    )
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    select 'user',p_actor_user_id,'supply.sync.missing_detected','supply_table',changed.table_id,v_run.operation_id,'{"reason_code":"conflict"}'::jsonb
      from changed;

    with changed as (
      update public.app_supply_table_heads h set sync_state='current'
      from public.app_supply_external_mappings m
      where m.entity_kind='table' and m.core_id=h.table_id and h.sync_state='missing'
        and exists(select 1 from jsonb_array_elements(p_mappings) as incoming(value)
          where incoming.value->>'entityKind'='table' and incoming.value->>'sourceRecordId'=m.source_record_id)
      returning h.table_id
    )
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    select 'user',p_actor_user_id,'supply.sync.missing_resolved','supply_table',changed.table_id,v_run.operation_id,'{"reason_code":"conflict"}'::jsonb
      from changed;

    if v_missing_count>0 then
      p_state:='conflict';
      p_total_conflict_count:=coalesce(p_total_conflict_count,jsonb_array_length(p_conflicts))+v_missing_count;
      p_conflicts:=p_conflicts||v_missing_details;
      p_retry_disposition:='blocked';
      p_safe_message:='A previously mapped Table is missing; review the retained Table before accepting or publishing supply.';
    else
      if v_prior_hash=p_candidate_hash then
        p_state:='no_change';
      else
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
  end if;

  update public.app_supply_sync_runs set state=p_state,finished_at=now(),
    table_pages=coalesce((p_counts->>'tablePages')::integer,0),venue_pages=coalesce((p_counts->>'venuePages')::integer,0),
    table_count=coalesce((p_counts->>'tables')::integer,0),venue_count=coalesce((p_counts->>'venues')::integer,0),
    candidate_revision_id=case when p_state in ('staged','no_change') then v_revision else null end,
    candidate_source_hash=case when p_state in ('staged','no_change') then p_candidate_hash else null end,
    conflict_count=coalesce(p_total_conflict_count,jsonb_array_length(p_conflicts)),conflicts=p_conflicts,retry_disposition=p_retry_disposition,
    safe_message=p_safe_message where run_id=p_run_id returning * into v_run;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
  values('user',p_actor_user_id,'supply.sync.finished','supply_sync_run',p_run_id,v_run.operation_id,
    case when v_run.state='conflict' then '{"reason_code":"conflict"}'::jsonb else '{}'::jsonb end);
  return to_jsonb(v_run);
end $function$;

create or replace function public.list_supply_tables(p_actor_user_id uuid,p_state text default null,p_cursor text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_items jsonb; v_candidates jsonb; v_next text; v_limit integer;
begin
  perform app_private.require_service_role();
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') into v_admin;
  if not v_admin and not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='host') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='invalid_input'; end if;
  v_limit:=p_limit;
  with matching as (
    select jsonb_build_object('tableId',h.table_id,'title',coalesce(d.content->>'title',a.content->>'title',p.content->>'title',''),
      'localDate',coalesce(d.content->>'localDate',a.content->>'localDate',p.content->>'localDate',''),
      'startLocalTime',coalesce(d.content->>'startLocalTime',a.content->>'startLocalTime',p.content->>'startLocalTime',''),
      'startsAt',null,'neighborhood',coalesce(d.content->>'neighborhood',a.content->>'neighborhood',p.content->>'neighborhood',''),
      'lifecycle',h.lifecycle,'draftRevision',d.revision,'acceptedRevisionId',h.accepted_revision_id,
      'publishedRevisionId',h.published_revision_id,'updatedAt',h.updated_at,'sourceRevisionId',h.source_revision_id,
      'syncState',h.sync_state,'canCreateDraft',false) item,h.updated_at,h.table_id
    from public.app_supply_table_heads h
    left join public.app_supply_table_revisions d on d.revision_id=h.draft_revision_id
    left join public.app_supply_table_revisions a on a.revision_id=h.accepted_revision_id
    left join public.app_supply_table_revisions p on p.revision_id=h.published_revision_id
    where (v_admin or exists(select 1 from public.app_supply_table_assignments x where x.table_id=h.table_id and x.user_id=p_actor_user_id))
      and (p_state is null or h.lifecycle=p_state)
      and (p_cursor is null or h.updated_at < split_part(p_cursor,'|',1)::timestamptz
        or (h.updated_at=split_part(p_cursor,'|',1)::timestamptz and h.table_id > split_part(p_cursor,'|',2)::uuid))
  ), page as (
    select matching.*,row_number() over(order by updated_at desc,table_id asc) rn from matching
    order by updated_at desc,table_id asc limit v_limit+1
  )
  select coalesce(jsonb_agg(item order by updated_at desc,table_id asc) filter(where rn<=v_limit),'[]'::jsonb),
    case when count(*)>v_limit then (select updated_at::text||'|'||table_id::text from page where rn=v_limit order by updated_at desc,table_id asc limit 1) else null end
    into v_items,v_next from page;
  if v_admin then
    select coalesce(jsonb_agg(jsonb_build_object('tableId',cand.value->>'id','sourceRevisionId',rev.revision_id,
      'title',cand.value->>'title','localDate',cand.value->>'localDate','startLocalTime',cand.value->>'startLocalTime','neighborhood',cand.value->>'neighborhood')),'[]'::jsonb)
      into v_candidates
    from public.app_supply_control c join public.app_supply_sync_revisions rev on rev.revision_id=c.latest_staged_revision_id and rev.state='staged'
    cross join lateral jsonb_array_elements(rev.normalized_candidate) as cand(value)
    where cand.value->>'title' is not null and cand.value->>'id' is not null
      and not exists(select 1 from public.app_supply_table_heads h where h.table_id=(cand.value->>'id')::uuid);
  else
    select coalesce(jsonb_agg(jsonb_build_object('tableId',cand.value->>'id','sourceRevisionId',rev.revision_id,
      'title',cand.value->>'title','localDate',cand.value->>'localDate','startLocalTime',cand.value->>'startLocalTime','neighborhood',cand.value->>'neighborhood')),'[]'::jsonb)
      into v_candidates
    from public.app_supply_control c join public.app_supply_sync_revisions rev on rev.revision_id=c.latest_staged_revision_id and rev.state='staged'
    cross join lateral jsonb_array_elements(rev.normalized_candidate) as cand(value)
    join public.app_supply_table_assignments a on a.table_id=(cand.value->>'id')::uuid and a.user_id=p_actor_user_id
    where cand.value->>'title' is not null and cand.value->>'id' is not null
      and not exists(select 1 from public.app_supply_table_heads h where h.table_id=(cand.value->>'id')::uuid);
  end if;
  return jsonb_build_object('items',v_items,'stagedCandidates',v_candidates,'nextCursor',v_next);
end $function$;

create or replace function public.read_supply_table_detail(p_actor_user_id uuid,p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare h public.app_supply_table_heads%rowtype; v_result jsonb; v_admin boolean;
begin
  perform app_private.require_service_role();
  if not app_private.supply_can_read_table(p_actor_user_id,p_table_id) then raise exception using errcode='42501',message='forbidden'; end if;
  select * into h from public.app_supply_table_heads where table_id=p_table_id;
  if not found then return null; end if;
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') into v_admin;
  v_result:=jsonb_build_object('tableId',h.table_id,'lifecycle',h.lifecycle,
    'draft',app_private.supply_revision_dto(h.draft_revision_id),'accepted',app_private.supply_revision_dto(h.accepted_revision_id),
    'published',app_private.supply_revision_dto(h.published_revision_id),'syncState',h.sync_state,
    'currentSyncState',case when h.sync_state='missing' then 'missing' when h.source_revision_id is null then 'current'
      when h.source_revision_id=(select latest_staged_revision_id from public.app_supply_control where singleton) then 'current' else 'stale' end,
    'canEditDraft',v_admin or exists(select 1 from public.app_supply_table_assignments a where a.table_id=p_table_id and a.user_id=p_actor_user_id),
    'canAccept',v_admin and h.sync_state<>'missing','canPublish',v_admin and h.sync_state<>'missing');
  return v_result;
end $function$;

create or replace function app_private.reject_missing_supply_operation()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_table uuid; v_state text;
begin
  perform app_private.require_service_role();
  if new.action='draft.accept' then
    select r.table_id into v_table from public.app_supply_table_revisions r where r.revision_id=(new.result->>'revisionId')::uuid;
  elsif new.action='draft.publish' then
    v_table:=(new.result->>'tableId')::uuid;
  else
    return new;
  end if;
  select h.sync_state into v_state from public.app_supply_table_heads h where h.table_id=v_table;
  if v_state='missing' then raise exception using errcode='P0001',message='revision_conflict'; end if;
  return new;
end $function$;
revoke all on function app_private.reject_missing_supply_operation() from public,anon,authenticated;
grant execute on function app_private.reject_missing_supply_operation() to service_role;
create trigger reject_missing_supply_operation before insert on public.app_supply_table_operations
  for each row execute function app_private.reject_missing_supply_operation();

revoke all on function public.finish_supply_sync(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,integer) from public,anon,authenticated;
grant execute on function public.finish_supply_sync(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,integer) to service_role;
revoke all on function public.list_supply_tables(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.list_supply_tables(uuid,text,text,integer) to service_role;
revoke all on function public.read_supply_table_detail(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_supply_table_detail(uuid,uuid) to service_role;
