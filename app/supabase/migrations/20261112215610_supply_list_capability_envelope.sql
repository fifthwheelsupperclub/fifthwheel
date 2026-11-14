-- Restore the browser-safe capability envelope while retaining W05.1 missing
-- state and W05.2 admin/assigned-host visibility boundaries.

create or replace function public.list_supply_tables(p_actor_user_id uuid,p_state text default null,p_cursor text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_items jsonb; v_candidates jsonb; v_next text; v_limit integer;
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
      'title',cand.value->>'title','localDate',cand.value->>'localDate','startLocalTime',cand.value->>'startLocalTime',
      'neighborhood',cand.value->>'neighborhood','canCreateDraft',true)),'[]'::jsonb)
      into v_candidates
    from public.app_supply_control c join public.app_supply_sync_revisions rev on rev.revision_id=c.latest_staged_revision_id and rev.state='staged'
    cross join lateral jsonb_array_elements(rev.normalized_candidate) as cand(value)
    where cand.value->>'title' is not null and cand.value->>'id' is not null
      and not exists(select 1 from public.app_supply_table_heads h where h.table_id=(cand.value->>'id')::uuid);
  else
    v_candidates:='[]'::jsonb;
  end if;
  return jsonb_build_object('items',v_items,'stagedCandidates',v_candidates,'nextCursor',v_next,'canCreateDraft',v_admin);
end $function$;

revoke all on function public.list_supply_tables(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.list_supply_tables(uuid,text,text,integer) to service_role;
