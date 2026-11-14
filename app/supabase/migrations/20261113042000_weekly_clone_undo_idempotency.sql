-- Bind a durable undo key to the manifest revision used on its first request.
-- Retries after an uncertain delete must replay the original revision and key.
alter table public.app_supply_weekly_clone_operations
  add column undo_expected_manifest_revision integer check (undo_expected_manifest_revision is null or undo_expected_manifest_revision > 0);

create or replace function public.begin_weekly_supply_clone_undo(
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
    if v_op.undo_operation_id<>p_undo_operation_id or v_op.undo_expected_manifest_revision is distinct from p_expected_manifest_revision or v_op.undo_request_hash is distinct from v_hash then
      raise exception using errcode='23505',message='operation_conflict';
    end if;
    return app_private.weekly_clone_operation_json(p_operation_id);
  end if;
  if v_op.manifest_revision<>p_expected_manifest_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_op.state<>'completed' or exists(select 1 from public.app_supply_weekly_clone_items i where i.operation_id=p_operation_id and i.state<>'created') then
    raise exception using errcode='P0001',message='operation_unresolved';
  end if;
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
  update public.app_supply_weekly_clone_operations set undo_operation_id=p_undo_operation_id,
    undo_expected_manifest_revision=p_expected_manifest_revision,undo_request_hash=v_hash,
    undo_retry_disposition='blocked',state='undoing',manifest_revision=manifest_revision+1,updated_at=now(),finished_at=null
    where operation_id=p_operation_id;
  update public.app_supply_weekly_clone_items set state='undoing',lease_until=now()+interval '5 minutes',updated_at=now()
    where operation_id=p_operation_id;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor_user_id,'supply.weekly_clone.undo_started','supply_weekly_clone_operation',p_operation_id,p_undo_operation_id,'{}'::jsonb);
  return app_private.weekly_clone_operation_json(p_operation_id);
end $function$;
revoke all on function public.begin_weekly_supply_clone_undo(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.begin_weekly_supply_clone_undo(uuid,uuid,uuid,integer) to service_role;
