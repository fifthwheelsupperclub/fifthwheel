-- Weekly clone becomes one Supabase transaction. Supabase is the only supply
-- source, so the provider marker/lease/claim/reconcile machinery that guarded
-- non-transactional Airtable writes is removed. Clone writes were gated on the
-- local fixture provider (never production), so any non-terminal manifest rows
-- are local synthetic data and are discarded here.

drop function public.begin_weekly_supply_clone(uuid,uuid,date,date,text);
drop function public.claim_weekly_supply_clone_item(uuid,uuid);
drop function public.finish_weekly_supply_clone_item(uuid,uuid,uuid,text,text);
drop function public.reconcile_weekly_supply_clone_item(uuid,uuid,uuid,text,text);
drop function public.begin_weekly_supply_clone_undo(uuid,uuid,uuid,integer);
drop function public.finish_weekly_supply_clone_undo_item(uuid,uuid,uuid,text);
drop function public.fixture_create_weekly_clone_record(uuid,text,uuid,text,jsonb,text);
drop function public.fixture_reconcile_weekly_clone_create(uuid,text,uuid,text,text);
drop function public.fixture_delete_weekly_clone_record(uuid,text,uuid,text,text);
drop function public.fixture_reconcile_weekly_clone_delete(uuid,text,uuid,text,text);
drop table public.app_supply_weekly_clone_fixture_records;

-- The cross-transaction undo guard is unnecessary once undo is one transaction.
drop trigger supply_table_clone_undo_guard on public.app_supply_table_heads;
drop function app_private.block_supply_mutation_during_clone_undo();
alter table public.app_supply_table_heads drop column weekly_clone_undo_operation_id;

delete from public.app_supply_weekly_clone_items i using public.app_supply_weekly_clone_operations o
  where o.operation_id=i.operation_id and o.state not in ('completed','undone');
delete from public.app_supply_weekly_clone_operations where state not in ('completed','undone');
alter table public.app_supply_weekly_clone_operations
  drop column manifest_revision, drop column retry_disposition, drop column undo_operation_id,
  drop column undo_request_hash, drop column undo_retry_disposition, drop column undo_expected_manifest_revision,
  drop constraint app_supply_weekly_clone_operations_state_check,
  add constraint app_supply_weekly_clone_operations_state_check check (state in ('completed','undone'));
alter table public.app_supply_weekly_clone_items
  drop column marker_id, drop column source_record_id, drop column provider_record_id, drop column safe_code, drop column lease_until,
  drop constraint app_supply_weekly_clone_items_state_check,
  add constraint app_supply_weekly_clone_items_state_check check (state in ('created','undone'));
comment on table public.app_supply_weekly_clone_operations is 'Private weekly clone history; each row is one committed clone transaction.';
comment on table public.app_supply_weekly_clone_items is 'Private per-source clone record used for history and guarded undo.';

-- Undo is allowed only while every cloned draft is exactly as the clone left it.
create function app_private.weekly_clone_undoable(p_operation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select not exists(
    select 1 from public.app_supply_weekly_clone_items i
    where i.operation_id=p_operation_id and i.state='created'
      and not exists(
        select 1 from public.app_supply_table_heads h
        join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id
        where h.table_id=i.target_table_id and h.draft_revision_id=i.target_revision_id
          and h.lifecycle='draft' and h.sync_state='current' and not h.protected_by_activity
          and h.accepted_revision_id is null and h.published_revision_id is null
          and md5(r.content::text)=i.target_hash))
$function$;
revoke all on function app_private.weekly_clone_undoable(uuid) from public,anon,authenticated;
grant execute on function app_private.weekly_clone_undoable(uuid) to service_role;

create function app_private.weekly_clone_summary_json(p_op public.app_supply_weekly_clone_operations)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'operationId',p_op.operation_id,'sourceWeekStart',p_op.source_week_start,'targetWeekStart',p_op.target_week_start,
    'state',p_op.state,'startedAt',p_op.started_at,'updatedAt',p_op.updated_at,
    'undoState',case when p_op.state='undone' then 'undone' when app_private.weekly_clone_undoable(p_op.operation_id) then 'available' else 'blocked' end,
    'draftCount',(select count(*) from public.app_supply_weekly_clone_items i where i.operation_id=p_op.operation_id))
$function$;
revoke all on function app_private.weekly_clone_summary_json(public.app_supply_weekly_clone_operations) from public,anon,authenticated;
grant execute on function app_private.weekly_clone_summary_json(public.app_supply_weekly_clone_operations) to service_role;

create or replace function app_private.weekly_clone_operation_json(p_operation_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select app_private.weekly_clone_summary_json(op) || jsonb_build_object('items',coalesce((
    select jsonb_agg(jsonb_build_object('sourceTableId',i.source_table_id,'targetTableId',i.target_table_id,
      'title',coalesce(i.target_content->>'title',''),'targetLocalDate',i.target_content->>'localDate','state',i.state) order by i.ordinal)
    from public.app_supply_weekly_clone_items i where i.operation_id=op.operation_id),'[]'::jsonb))
  from public.app_supply_weekly_clone_operations op where op.operation_id=p_operation_id
$function$;

create function public.clone_weekly_supply(p_actor_user_id uuid,p_operation_id uuid,p_source_week date,p_target_week date)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_op public.app_supply_weekly_clone_operations%rowtype; v_plan jsonb; v_item jsonb; v_request_hash text;
  v_table uuid; v_revision uuid; v_ordinal integer:=0;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501',message='forbidden';
  end if;
  if p_operation_id is null or p_source_week is null or p_target_week is null
    or extract(isodow from p_source_week)<>1 or extract(isodow from p_target_week)<>1 or p_source_week=p_target_week then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  v_request_hash:=md5(jsonb_build_object('sourceWeekStart',p_source_week,'targetWeekStart',p_target_week)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_op from public.app_supply_weekly_clone_operations where operation_id=p_operation_id;
  if found then
    if v_op.actor_user_id<>p_actor_user_id or v_op.request_hash<>v_request_hash then
      raise exception using errcode='23505',message='operation_conflict';
    end if;
    return app_private.weekly_clone_operation_json(p_operation_id);
  end if;

  -- Lock source heads in stable order so the plan cannot change underneath the copy.
  perform h.table_id
  from public.app_supply_table_heads h
  join public.app_supply_table_revisions d on d.revision_id=h.draft_revision_id
  where case when coalesce(d.content->>'localDate','') ~ '^\d{4}-\d{2}-\d{2}$'
    then (d.content->>'localDate')::date >= p_source_week and (d.content->>'localDate')::date < p_source_week+7
    else false end
  order by h.table_id for update of h;
  v_plan:=app_private.weekly_clone_plan(p_source_week,p_target_week);
  if jsonb_array_length(v_plan->'items')>500 then raise exception using errcode='22023',message='too_many_sources'; end if;
  if not exists(select 1 from jsonb_array_elements(v_plan->'items') e(value) where e.value->>'eligibility'='eligible') then
    raise exception using errcode='22023',message='no_eligible_sources';
  end if;

  insert into public.app_supply_weekly_clone_operations(
    operation_id,actor_user_id,source_week_start,target_week_start,week_delta,plan_hash,request_hash,state,finished_at
  ) values(p_operation_id,p_actor_user_id,p_source_week,p_target_week,(p_target_week-p_source_week)/7,
    v_plan->>'planHash',v_request_hash,'completed',now());
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'supply.weekly_clone.started','supply_weekly_clone_operation',p_operation_id,p_operation_id,'{}'::jsonb);

  for v_item in select e.value from jsonb_array_elements(v_plan->'items') e(value) where e.value->>'eligibility'='eligible' loop
    v_ordinal:=v_ordinal+1;
    insert into public.app_supply_table_heads(lifecycle) values('draft') returning table_id into v_table;
    insert into public.app_supply_table_revisions(table_id,revision,state,content,created_by)
      values(v_table,1,'draft',v_item->'targetContent',p_actor_user_id) returning revision_id into v_revision;
    update public.app_supply_table_heads set draft_revision_id=v_revision,updated_at=now() where table_id=v_table;
    insert into public.app_supply_weekly_clone_items(
      operation_id,ordinal,source_table_id,source_revision_id,source_revision,source_hash,
      target_table_id,target_revision_id,target_hash,target_content,state
    ) values(p_operation_id,v_ordinal,(v_item->>'sourceTableId')::uuid,(v_item->>'sourceRevisionId')::uuid,
      (v_item->>'sourceRevision')::integer,v_item->>'sourceHash',v_table,v_revision,md5((v_item->'targetContent')::text),
      v_item->'targetContent','created');
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'supply.weekly_clone.item_created','supply_weekly_clone_item',(v_item->>'sourceTableId')::uuid,p_operation_id,'{}'::jsonb);
  end loop;
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;
revoke all on function public.clone_weekly_supply(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.clone_weekly_supply(uuid,uuid,date,date) to service_role;

-- All-or-nothing: removes every cloned draft, or refuses if any was edited or used.
create function public.undo_weekly_supply_clone(p_actor_user_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_op public.app_supply_weekly_clone_operations%rowtype; v_item public.app_supply_weekly_clone_items%rowtype;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then
    raise exception using errcode='42501',message='forbidden';
  end if;
  if p_operation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_op from public.app_supply_weekly_clone_operations where operation_id=p_operation_id for update;
  if not found or v_op.actor_user_id<>p_actor_user_id then raise exception using errcode='P0002',message='not_found'; end if;
  if v_op.state='undone' then return app_private.weekly_clone_operation_json(p_operation_id); end if;
  perform h.table_id from public.app_supply_table_heads h
    where h.table_id in (select i.target_table_id from public.app_supply_weekly_clone_items i where i.operation_id=p_operation_id and i.state='created')
    order by h.table_id for update;
  if not app_private.weekly_clone_undoable(p_operation_id) then raise exception using errcode='P0001',message='undo_refused'; end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'supply.weekly_clone.undo_started','supply_weekly_clone_operation',p_operation_id,p_operation_id,'{}'::jsonb);
  for v_item in select i.* from public.app_supply_weekly_clone_items i where i.operation_id=p_operation_id and i.state='created' order by i.ordinal loop
    update public.app_supply_table_heads set draft_revision_id=null,updated_at=now() where table_id=v_item.target_table_id;
    delete from public.app_supply_table_assignments where table_id=v_item.target_table_id;
    delete from public.app_supply_table_revisions where table_id=v_item.target_table_id;
    delete from public.app_table_runtime where table_id=v_item.target_table_id;
    delete from public.app_supply_table_heads where table_id=v_item.target_table_id;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor_user_id,'supply.weekly_clone.item_undone','supply_weekly_clone_item',v_item.source_table_id,p_operation_id,'{}'::jsonb);
  end loop;
  update public.app_supply_weekly_clone_items set state='undone',updated_at=now() where operation_id=p_operation_id;
  update public.app_supply_weekly_clone_operations set state='undone',updated_at=now(),finished_at=now() where operation_id=p_operation_id;
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;
revoke all on function public.undo_weekly_supply_clone(uuid,uuid) from public,anon,authenticated;
grant execute on function public.undo_weekly_supply_clone(uuid,uuid) to service_role;

create or replace function public.list_weekly_supply_clone_operations(p_actor_user_id uuid,p_cursor text default null,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb; v_next text; v_cursor_time timestamptz; v_cursor_id uuid;
begin
  perform app_private.require_service_role();
  if not exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') then raise exception using errcode='42501',message='forbidden'; end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception using errcode='22023',message='invalid_input'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9TZ:.-]+\|[0-9a-fA-F-]{36}$' then raise exception using errcode='22023',message='invalid_input'; end if;
    v_cursor_time:=split_part(p_cursor,'|',1)::timestamptz; v_cursor_id:=split_part(p_cursor,'|',2)::uuid;
  end if;
  with page as (
    select op.operation_id,op.updated_at,row_number() over(order by op.updated_at desc,op.operation_id asc) rn
    from public.app_supply_weekly_clone_operations op
    where v_cursor_time is null or op.updated_at<v_cursor_time or (op.updated_at=v_cursor_time and op.operation_id>v_cursor_id)
    order by op.updated_at desc,op.operation_id asc limit p_limit+1
  )
  select coalesce(jsonb_agg(app_private.weekly_clone_summary_json(op) order by p.rn) filter(where p.rn<=p_limit),'[]'::jsonb),
    case when count(*)>p_limit then (select to_char(x.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||x.operation_id::text
      from page x where x.rn=p_limit) end
    into v_items,v_next
  from page p join public.app_supply_weekly_clone_operations op on op.operation_id=p.operation_id;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end $function$;
