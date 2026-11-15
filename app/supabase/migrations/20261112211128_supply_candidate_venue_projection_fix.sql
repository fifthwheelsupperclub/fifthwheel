-- Fix the candidate-to-draft venue projection: the lateral subquery alias is a
-- record whose selected JSONB value lives in its `value` field.

create or replace function public.create_supply_draft(p_actor_user_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_op uuid; v_hash text; v_prior public.app_supply_table_operations%rowtype; v_table uuid; v_source_revision uuid; v_content jsonb; v_revision uuid; v_result jsonb; v_item jsonb; v_candidate jsonb;
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
    v_table:=gen_random_uuid(); v_content:=p_request->'source'->'content'; v_source_revision:=null;
    if not app_private.supply_venues_exist(v_content) then raise exception using errcode='22023',message='validation_failed'; end if;
  elsif p_request->'source'->>'kind'='candidate' then
    v_table:=(p_request->'source'->>'tableId')::uuid; v_source_revision:=(p_request->'source'->>'revisionId')::uuid;
    select item.value into v_candidate from public.app_supply_sync_revisions rev cross join lateral jsonb_array_elements(rev.normalized_candidate) as item(value)
      where rev.revision_id=v_source_revision and rev.revision_id=(select latest_staged_revision_id from public.app_supply_control where singleton)
        and rev.state='staged' and item.value->>'id'=v_table::text and item.value->>'title' is not null;
    if not found then raise exception using errcode='P0002',message='not_found'; end if;
    select jsonb_build_object('title',v_candidate->>'title','localDate',v_candidate->>'localDate','startLocalTime',v_candidate->>'startLocalTime',
      'neighborhood',v_candidate->>'neighborhood','hostNotes','',
      'stops',(select jsonb_agg(jsonb_build_object('role',s->>'role','venueId',s->>'venueId','venueName',vn.value->>'name','venueAddress',vn.value->>'address',
        'minutesFromStart',(s->>'minutesFromStart')::integer,'publicNotes','') order by ord)
        from jsonb_array_elements(v_candidate->'stops') with ordinality as stop(s,ord)
        left join lateral (select venue.value from public.app_supply_sync_revisions rr cross join lateral jsonb_array_elements(rr.normalized_candidate) venue(value)
          where rr.revision_id=v_source_revision and venue.value->>'id'=s->>'venueId' and venue.value->>'name' is not null limit 1) vn on true))
      into v_content;
    if not app_private.supply_venues_exist(v_content) then raise exception using errcode='22023',message='validation_failed'; end if;
  else raise exception using errcode='22023',message='invalid_input'; end if;
  if exists(select 1 from public.app_supply_table_heads where table_id=v_table) then raise exception using errcode='23505',message='draft_exists'; end if;
  insert into public.app_supply_table_heads(table_id,source_revision_id,lifecycle) values(v_table,v_source_revision,'draft');
  insert into public.app_supply_table_revisions(table_id,revision,state,content,source_revision_id,created_by)
  values(v_table,1,'draft',v_content,v_source_revision,p_actor_user_id) returning revision_id into v_revision;
  update public.app_supply_table_heads set draft_revision_id=v_revision,updated_at=now() where table_id=v_table;
  v_item:=app_private.supply_revision_dto(v_revision);
  v_result:=jsonb_build_object('tableId',v_table,'draft',v_item);
  insert into public.app_supply_table_operations(operation_id,actor_user_id,action,request_hash,result) values(v_op,p_actor_user_id,'draft.create',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
  values('user',p_actor_user_id,'supply.draft.created','supply_table',v_table,v_op,'{}'::jsonb);
  return v_result;
end $function$;

revoke all on function public.create_supply_draft(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_supply_draft(uuid,jsonb) to service_role;
