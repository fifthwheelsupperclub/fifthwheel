-- Preserve the same-undo retry disposition after a marker lookup finds the
-- exact provider record still present (the earlier branch was overwritten by
-- the final aggregate state update).
create or replace function public.finish_weekly_supply_clone_undo_item(
  p_actor_user_id uuid,p_operation_id uuid,p_source_table_id uuid,p_resolution text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_op public.app_supply_weekly_clone_operations%rowtype; v_item public.app_supply_weekly_clone_items%rowtype; v_head public.app_supply_table_heads%rowtype;
  v_state text; v_unknown integer; v_undone integer; v_total integer;
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
      update public.app_supply_table_heads set draft_revision_id=null,weekly_clone_undo_operation_id=null,updated_at=now()
        where table_id=v_item.target_table_id and weekly_clone_undo_operation_id=v_op.undo_operation_id;
      delete from public.app_supply_external_mappings where entity_kind='table' and core_id=v_item.target_table_id;
      delete from public.app_supply_table_assignments where table_id=v_item.target_table_id;
      delete from public.app_supply_table_revisions where table_id=v_item.target_table_id;
      delete from public.app_table_runtime where table_id=v_item.target_table_id;
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
  update public.app_supply_weekly_clone_operations set state=v_state,
    undo_retry_disposition=case when v_unknown>0 then 'reconcile_first' when p_resolution='present' then 'same_operation_after_no_delete' else 'blocked' end,
    manifest_revision=manifest_revision+1,updated_at=now(),finished_at=case when v_state in ('undone','undo_refused') then now() else null end
    where operation_id=p_operation_id;
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;
revoke all on function public.finish_weekly_supply_clone_undo_item(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_weekly_supply_clone_undo_item(uuid,uuid,uuid,text) to service_role;
