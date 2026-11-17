-- Supply is app-owned (see 20261117090000). Remove the never-connected Airtable sync: staging tables,
-- sync RPCs, external mappings, the staleness gate and the staged-candidate draft source.
-- ponytail: app_supply_table_heads.sync_state stays (always 'current'); ~10 W06-W10 RPCs read it. Drop it if a later change touches them anyway.

CREATE OR REPLACE FUNCTION public.create_supply_draft(p_actor_user_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_admin boolean; v_op uuid; v_hash text; v_prior public.app_supply_table_operations%rowtype; v_table uuid; v_content jsonb; v_revision uuid; v_result jsonb; v_item jsonb;
begin
  perform app_private.require_service_role();
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') into v_admin;
  if not v_admin then raise exception using errcode='42501',message='forbidden'; end if;
  v_op:=(p_request->>'operationId')::uuid; v_hash:=md5(p_request::text);
  if v_op is null then raise exception using errcode='22023',message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_op::text,0));
  select * into v_prior from public.app_supply_table_operations where operation_id=v_op;
  if found then
    if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'draft.create' or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  if p_request->'source'->>'kind'='manual' then
    v_table:=gen_random_uuid(); v_content:=p_request->'source'->'content';
    if not app_private.supply_venues_exist(v_content) then raise exception using errcode='22023',message='validation_failed'; end if;
  else raise exception using errcode='22023',message='invalid_input'; end if;
  if exists(select 1 from public.app_supply_table_heads where table_id=v_table) then raise exception using errcode='23505',message='draft_exists'; end if;
  insert into public.app_supply_table_heads(table_id,lifecycle) values(v_table,'draft');
  insert into public.app_supply_table_revisions(table_id,revision,state,content,created_by)
  values(v_table,1,'draft',v_content,p_actor_user_id) returning revision_id into v_revision;
  update public.app_supply_table_heads set draft_revision_id=v_revision,updated_at=now() where table_id=v_table;
  v_item:=app_private.supply_revision_dto(v_revision);
  v_result:=jsonb_build_object('tableId',v_table,'draft',v_item);
  insert into public.app_supply_table_operations(operation_id,actor_user_id,action,request_hash,result) values(v_op,p_actor_user_id,'draft.create',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
  values('user',p_actor_user_id,'supply.draft.created','supply_table',v_table,v_op,'{}'::jsonb);
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.update_supply_draft(p_actor_user_id uuid, p_draft_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_admin boolean; v_table uuid; v_head public.app_supply_table_heads%rowtype; v_old public.app_supply_table_revisions%rowtype; v_op uuid; v_hash text; v_prior public.app_supply_table_operations%rowtype; v_revision uuid; v_result jsonb; v_content jsonb;
begin
  perform app_private.require_service_role();
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') into v_admin;
  select table_id into v_table from public.app_supply_table_revisions where revision_id=p_draft_id;
  if not found or not app_private.supply_can_read_table(p_actor_user_id,v_table) then raise exception using errcode='42501',message='forbidden'; end if;
  select * into v_head from public.app_supply_table_heads where table_id=v_table for update;
  select * into v_old from public.app_supply_table_revisions where revision_id=p_draft_id;
  v_op:=(p_request->>'operationId')::uuid; v_hash:=md5(p_request::text);
  if v_op is null then raise exception using errcode='22023',message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_op::text,0));
  select * into v_prior from public.app_supply_table_operations where operation_id=v_op;
  if found then
    if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'draft.update' or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  if v_head.draft_revision_id<>p_draft_id or v_old.revision<>(p_request->>'expectedDraftRevision')::integer then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_old.state not in ('draft','accepted','published') then raise exception using errcode='22023',message='invalid_state'; end if;
  if v_head.protected_by_activity and v_head.published_revision_id is not null and
    exists(select 1 from public.app_supply_table_revisions published where published.revision_id=v_head.published_revision_id
      and app_private.supply_critical_change(published.content,p_request->'content')) then
    raise exception using errcode='P0001',message='protected_change';
  end if;
  v_content:=p_request->'content';
  if not app_private.supply_venues_exist(v_content) then raise exception using errcode='22023',message='validation_failed'; end if;
  insert into public.app_supply_table_revisions(table_id,revision,state,content,created_by)
  values(v_table,v_old.revision+1,'draft',v_content,p_actor_user_id) returning revision_id into v_revision;
  update public.app_supply_table_heads set draft_revision_id=v_revision,lifecycle=case when published_revision_id is not null then 'published' else 'draft' end,updated_at=now() where table_id=v_table;
  v_result:=app_private.supply_revision_dto(v_revision);
  insert into public.app_supply_table_operations(operation_id,actor_user_id,action,request_hash,result) values(v_op,p_actor_user_id,'draft.update',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
  values('user',p_actor_user_id,'supply.draft.updated','supply_table_revision',v_revision,v_op,'{}'::jsonb);
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.accept_supply_draft(p_actor_user_id uuid, p_draft_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_head public.app_supply_table_heads%rowtype; v_revision public.app_supply_table_revisions%rowtype; v_op uuid; v_hash text; v_prior public.app_supply_table_operations%rowtype; v_result jsonb;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  select * into v_revision from public.app_supply_table_revisions where revision_id=p_draft_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_head from public.app_supply_table_heads where table_id=v_revision.table_id for update;
  v_op:=(p_request->>'operationId')::uuid; v_hash:=md5(p_request::text);
  if v_op is null then raise exception using errcode='22023',message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_op::text,0));
  select * into v_prior from public.app_supply_table_operations where operation_id=v_op;
  if found then if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'draft.accept' or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if; return v_prior.result; end if;
  if v_head.draft_revision_id<>p_draft_id or v_revision.revision<>(p_request->>'expectedDraftRevision')::integer then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if not app_private.supply_venues_exist(v_revision.content) then raise exception using errcode='22023',message='validation_failed'; end if;
  if v_head.protected_by_activity and v_head.published_revision_id is not null and exists(select 1 from public.app_supply_table_revisions p where p.revision_id=v_head.published_revision_id and
    app_private.supply_critical_change(p.content,v_revision.content)) then
    raise exception using errcode='P0001',message='protected_change';
  end if;
  update public.app_supply_table_revisions set state='accepted',updated_at=now() where revision_id=p_draft_id returning * into v_revision;
  update public.app_supply_table_heads set accepted_revision_id=p_draft_id,lifecycle=case when published_revision_id is not null then 'published' else 'accepted' end,updated_at=now() where table_id=v_head.table_id;
  v_result:=app_private.supply_revision_dto(p_draft_id);
  insert into public.app_supply_table_operations(operation_id,actor_user_id,action,request_hash,result) values(v_op,p_actor_user_id,'draft.accept',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata) values('user',p_actor_user_id,'supply.draft.accepted','supply_table_revision',p_draft_id,v_op,'{}'::jsonb);
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.publish_supply_draft(p_actor_user_id uuid, p_draft_id uuid, p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_head public.app_supply_table_heads%rowtype; v_revision public.app_supply_table_revisions%rowtype; v_op uuid; v_hash text; v_prior public.app_supply_table_operations%rowtype; v_result jsonb;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  select * into v_revision from public.app_supply_table_revisions where revision_id=p_draft_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_head from public.app_supply_table_heads where table_id=v_revision.table_id for update;
  v_op:=(p_request->>'operationId')::uuid; v_hash:=md5(p_request::text);
  if v_op is null then raise exception using errcode='22023',message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_op::text,0));
  select * into v_prior from public.app_supply_table_operations where operation_id=v_op;
  if found then if v_prior.actor_user_id<>p_actor_user_id or v_prior.action<>'draft.publish' or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if; return v_prior.result; end if;
  if v_head.accepted_revision_id<>p_draft_id or v_revision.revision<>(p_request->>'expectedDraftRevision')::integer or v_revision.state not in ('accepted','published') then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_head.protected_by_activity and v_head.published_revision_id is not null and exists(select 1 from public.app_supply_table_revisions p where p.revision_id=v_head.published_revision_id and
    app_private.supply_critical_change(p.content,v_revision.content)) then raise exception using errcode='P0001',message='protected_change'; end if;
  update public.app_supply_table_revisions set state='published',updated_at=now() where revision_id=p_draft_id;
  update public.app_supply_table_heads set published_revision_id=p_draft_id,lifecycle='published',updated_at=now() where table_id=v_head.table_id;
  v_result:=public.read_supply_table_detail(p_actor_user_id,v_head.table_id);
  insert into public.app_supply_table_operations(operation_id,actor_user_id,action,request_hash,result) values(v_op,p_actor_user_id,'draft.publish',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata) values('user',p_actor_user_id,'supply.draft.published','supply_table',v_head.table_id,v_op,'{}'::jsonb);
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.read_supply_table_detail(p_actor_user_id uuid, p_table_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'currentSyncState',h.sync_state,
    'canEditDraft',v_admin or exists(select 1 from public.app_supply_table_assignments a where a.table_id=p_table_id and a.user_id=p_actor_user_id),
    'canAccept',v_admin and h.sync_state<>'missing','canPublish',v_admin and h.sync_state<>'missing');
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.list_supply_tables(p_actor_user_id uuid, p_state text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_admin boolean; v_items jsonb; v_next text; v_limit integer;
begin
  perform app_private.require_service_role();
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') into v_admin;
  if not v_admin and not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='host') then
    raise exception using errcode='42501',message='forbidden';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception using errcode='22023',message='invalid_input'; end if;
  v_limit:=p_limit;
  with matching as (
    select jsonb_build_object('tableId',h.table_id,'title',coalesce(d.content->>'title',a.content->>'title',p.content->>'title',''),
      'localDate',coalesce(d.content->>'localDate',a.content->>'localDate',p.content->>'localDate',''),
      'startLocalTime',coalesce(d.content->>'startLocalTime',a.content->>'startLocalTime',p.content->>'startLocalTime',''),
      'startsAt',null,'neighborhood',coalesce(d.content->>'neighborhood',a.content->>'neighborhood',p.content->>'neighborhood',''),
      'lifecycle',h.lifecycle,'draftRevision',d.revision,'acceptedRevisionId',h.accepted_revision_id,
      'publishedRevisionId',h.published_revision_id,'updatedAt',h.updated_at,
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
  return jsonb_build_object('items',v_items,'nextCursor',v_next,'canCreateDraft',v_admin);
end $function$;

drop function public.begin_supply_sync(uuid,uuid);
drop function public.finish_supply_sync(uuid,uuid,text,jsonb,text,jsonb,jsonb,jsonb,text,text,integer);
drop function public.read_supply_sync_summary(uuid);
alter table public.app_supply_table_heads drop column source_revision_id;
alter table public.app_supply_table_revisions drop column source_revision_id;
drop table public.app_supply_control;
drop table public.app_supply_external_mappings;
drop table public.app_supply_sync_revisions;
drop table public.app_supply_sync_runs;
