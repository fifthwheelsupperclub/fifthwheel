-- The provider request executes outside the source-locking transaction. Once a
-- durable operation has captured and accepted its immutable manifest, a later
-- source edit must not strand a successful provider create. Materialize the
-- captured revision snapshot rather than rejecting its post-start head change.
create or replace function public.finish_weekly_supply_clone_item(
  p_actor_user_id uuid,p_operation_id uuid,p_source_table_id uuid,p_state text,p_provider_record_id text default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_op public.app_supply_weekly_clone_operations%rowtype;
  v_item public.app_supply_weekly_clone_items%rowtype;
  v_new_revision public.app_supply_table_revisions%rowtype;
  v_upstream_revision uuid;
  v_state text; v_retry text; v_count integer; v_created integer; v_unknown integer; v_failed integer; v_conflict integer;
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
    -- Verify that the operation's immutable source revision still matches its
    -- recorded hash. The mutable source head may have advanced after begin().
    select r.source_revision_id into v_upstream_revision from public.app_supply_table_revisions r
      where r.revision_id=v_item.source_revision_id and r.table_id=v_item.source_table_id and md5(r.content::text)=v_item.source_hash;
    if not found then raise exception using errcode='P0001',message='manifest_source_invalid'; end if;
    if exists(select 1 from public.app_supply_external_mappings m where m.entity_kind='table' and m.source_record_id=p_provider_record_id and m.core_id<>v_item.target_table_id) then
      raise exception using errcode='P0001',message='marker_conflict';
    end if;
    insert into public.app_supply_table_heads(table_id,source_revision_id,lifecycle,sync_state,protected_by_activity)
      values(v_item.target_table_id,v_upstream_revision,'draft','current',false);
    insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,source_revision_id,created_by)
      values(v_item.target_revision_id,v_item.target_table_id,1,'draft',v_item.target_content,v_upstream_revision,p_actor_user_id)
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
revoke all on function public.finish_weekly_supply_clone_item(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_weekly_supply_clone_item(uuid,uuid,uuid,text,text) to service_role;
