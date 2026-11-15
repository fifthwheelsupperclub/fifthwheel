-- W05.2 synthetic supply drafts, immutable revision history and separate pointers.

create table public.app_supply_table_heads (
  table_id uuid primary key default gen_random_uuid(),
  source_revision_id uuid references public.app_supply_sync_revisions(revision_id) on delete restrict,
  sync_state text not null default 'current' check (sync_state in ('current','stale','missing')),
  lifecycle text not null default 'draft' check (lifecycle in ('draft','accepted','published','review_required','upstream_missing')),
  draft_revision_id uuid,
  accepted_revision_id uuid,
  published_revision_id uuid,
  protected_by_activity boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_supply_table_revisions (
  revision_id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  revision integer not null check (revision > 0),
  state text not null check (state in ('draft','accepted','published')),
  content jsonb not null check (jsonb_typeof(content)='object'),
  source_revision_id uuid references public.app_supply_sync_revisions(revision_id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(table_id, revision)
);
create index app_supply_table_revisions_table_idx on public.app_supply_table_revisions(table_id, revision desc);

alter table public.app_supply_table_heads
  add constraint app_supply_table_heads_draft_fk foreign key (draft_revision_id) references public.app_supply_table_revisions(revision_id) on delete restrict,
  add constraint app_supply_table_heads_accepted_fk foreign key (accepted_revision_id) references public.app_supply_table_revisions(revision_id) on delete restrict,
  add constraint app_supply_table_heads_published_fk foreign key (published_revision_id) references public.app_supply_table_revisions(revision_id) on delete restrict;

create table public.app_supply_table_assignments (
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key(table_id,user_id)
);

create table public.app_supply_table_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in ('draft.create','draft.update','draft.accept','draft.publish')),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{32}$'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);

alter table public.app_supply_table_heads enable row level security;
alter table public.app_supply_table_revisions enable row level security;
alter table public.app_supply_table_assignments enable row level security;
alter table public.app_supply_table_operations enable row level security;
revoke all on public.app_supply_table_heads, public.app_supply_table_revisions, public.app_supply_table_assignments,
  public.app_supply_table_operations from public, anon, authenticated, service_role;
grant select, insert, update on public.app_supply_table_heads to service_role;
grant select, insert, update on public.app_supply_table_revisions to service_role;
grant select, insert, delete on public.app_supply_table_assignments to service_role;
grant select, insert on public.app_supply_table_operations to service_role;

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check (action in (
  'waitlist.signup.created', 'app.admission.invited', 'app.admission.activated', 'app.admission.deleted',
  'app.invitation.queued', 'app.invitation.accepted', 'app.invitation.delivered', 'app.invitation.failed',
  'app.invitation.unknown', 'app.invitation.retry_requested', 'member_link.requested', 'auth.callback.rejected',
  'authorization.denied', 'identity.evidence.read', 'identity.review.decided',
  'supply.sync.started', 'supply.sync.finished', 'supply.draft.created', 'supply.draft.updated',
  'supply.draft.accepted', 'supply.draft.published'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check (subject_type in (
  'waitlist_signup', 'app_admission', 'invitation_delivery', 'delivery_attempt', 'auth_identity',
  'member_link_request', 'profile_file', 'identity_review', 'supply_sync_run', 'supply_table', 'supply_table_revision'
));

create function app_private.supply_can_read_table(p_actor uuid,p_table uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role='admin')
    or exists(select 1 from public.app_user_roles r join public.app_supply_table_assignments a on a.user_id=r.user_id
      where r.user_id=p_actor and r.role='host' and a.table_id=p_table)
$function$;
revoke all on function app_private.supply_can_read_table(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.supply_can_read_table(uuid,uuid) to service_role;

create function app_private.supply_valid_content(p_content jsonb)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_stop jsonb; v_index integer:=0; v_offset integer;
begin
  if p_content is null or jsonb_typeof(p_content)<>'object'
    or length(trim(coalesce(p_content->>'title',''))) not between 3 and 180
    or length(trim(coalesce(p_content->>'localDate','')))<>10
    or length(trim(coalesce(p_content->>'startLocalTime','')))<>5
    or length(trim(coalesce(p_content->>'neighborhood',''))) not between 2 and 120
    or length(coalesce(p_content->>'hostNotes',''))>2000
    or jsonb_typeof(p_content->'stops')<>'array' then return false; end if;
  if jsonb_array_length(p_content->'stops')<>3 then return false; end if;
  for v_stop in select value from jsonb_array_elements(p_content->'stops') loop
    v_index:=v_index+1;
    if v_stop->>'role' is distinct from (array['drinks','dinner','dessert'])[v_index]
      or v_stop->>'venueId' is null or v_stop->>'venueId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or length(trim(coalesce(v_stop->>'venueName','')))=0 or length(coalesce(v_stop->>'venueName',''))>180
      or length(trim(coalesce(v_stop->>'venueAddress','')))=0 or length(coalesce(v_stop->>'venueAddress',''))>400
      or coalesce(v_stop->>'minutesFromStart','') !~ '^[0-9]{1,3}$'
      or length(coalesce(v_stop->>'publicNotes',''))>500 then return false; end if;
    v_offset:=(v_stop->>'minutesFromStart')::integer;
    if v_offset not between 0 and 720 then return false; end if;
  end loop;
  if (p_content->'stops'->0->>'minutesFromStart')::integer > (p_content->'stops'->1->>'minutesFromStart')::integer
    or (p_content->'stops'->1->>'minutesFromStart')::integer > (p_content->'stops'->2->>'minutesFromStart')::integer then return false; end if;
  return true;
end
$function$;
revoke all on function app_private.supply_valid_content(jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.supply_valid_content(jsonb) to service_role;

create function app_private.supply_venues_exist(p_content jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $function$
declare v_stop jsonb;
begin
  if not app_private.supply_valid_content(p_content) then return false; end if;
  for v_stop in select value from jsonb_array_elements(p_content->'stops') loop
    if not exists(select 1 from public.app_supply_external_mappings m
      where m.entity_kind='venue' and m.core_id=(v_stop->>'venueId')::uuid) then return false; end if;
  end loop;
  return true;
end
$function$;
revoke all on function app_private.supply_venues_exist(jsonb) from public,anon,authenticated;
grant execute on function app_private.supply_venues_exist(jsonb) to service_role;

create function app_private.supply_critical_change(p_old jsonb,p_new jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select p_old->>'localDate' is distinct from p_new->>'localDate'
    or p_old->>'startLocalTime' is distinct from p_new->>'startLocalTime'
    or p_old->>'neighborhood' is distinct from p_new->>'neighborhood'
    or exists(select 1 from jsonb_array_elements(p_old->'stops') with ordinality oldstop(value,ord)
      join jsonb_array_elements(p_new->'stops') with ordinality newstop(value,ord) using(ord)
      where oldstop.value->>'venueId' is distinct from newstop.value->>'venueId'
        or oldstop.value->>'minutesFromStart' is distinct from newstop.value->>'minutesFromStart')
$function$;
revoke all on function app_private.supply_critical_change(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function app_private.supply_critical_change(jsonb,jsonb) to service_role;

create function app_private.supply_revision_dto(p_revision uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object('revisionId',r.revision_id,'revision',r.revision,'state',r.state,
    'createdAt',r.created_at,'updatedAt',r.updated_at,'content',r.content)
  from public.app_supply_table_revisions r where r.revision_id=p_revision
$function$;
revoke all on function app_private.supply_revision_dto(uuid) from public,anon,authenticated;
grant execute on function app_private.supply_revision_dto(uuid) to service_role;

create function public.list_supply_tables(p_actor_user_id uuid,p_state text default null,p_cursor text default null,p_limit integer default 25)
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
      'canCreateDraft',false) item,h.updated_at,h.table_id
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

create function public.read_supply_table_detail(p_actor_user_id uuid,p_table_id uuid)
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
    'published',app_private.supply_revision_dto(h.published_revision_id),
    'currentSyncState',case when h.source_revision_id is null then 'missing'
      when h.source_revision_id=(select latest_staged_revision_id from public.app_supply_control where singleton) then 'current' else 'stale' end,
    'canEditDraft',v_admin or exists(select 1 from public.app_supply_table_assignments a where a.table_id=h.table_id and a.user_id=p_actor_user_id),
    'canAccept',v_admin,'canPublish',v_admin);
  return v_result;
end $function$;

create function public.list_supply_venues(p_actor_user_id uuid,p_query text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_items jsonb;
begin
  perform app_private.require_service_role();
  select exists(select 1 from public.app_user_roles r where r.user_id=p_actor_user_id and r.role='admin') into v_admin;
  if not v_admin then raise exception using errcode='42501',message='forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('venueId',venue.value->>'id','name',venue.value->>'name','address',venue.value->>'address','neighborhood',venue.value->>'neighborhood')),'[]'::jsonb)
    into v_items
  from public.app_supply_control c join public.app_supply_sync_revisions rev on rev.revision_id=c.latest_staged_revision_id and rev.state='staged'
  cross join lateral jsonb_array_elements(rev.normalized_candidate) as venue(value)
  where venue.value->>'name' is not null and venue.value->>'id' is not null
    and (p_query is null or lower(venue.value->>'name') like '%'||lower(p_query)||'%' or lower(venue.value->>'neighborhood') like '%'||lower(p_query)||'%')
    and (v_admin or exists(select 1 from public.app_supply_table_assignments a join public.app_supply_table_heads h on h.table_id=a.table_id
      join public.app_supply_table_revisions r on r.revision_id=h.draft_revision_id
      cross join lateral jsonb_array_elements(r.content->'stops') as stop(value) where a.user_id=p_actor_user_id and stop.value->>'venueId'=venue.value->>'id'));
  return jsonb_build_object('items',v_items);
end $function$;

create function public.read_supply_draft_table_id(p_actor_user_id uuid,p_draft_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_table uuid;
begin
  perform app_private.require_service_role();
  select r.table_id into v_table from public.app_supply_table_revisions r
  where r.revision_id=p_draft_id and app_private.supply_can_read_table(p_actor_user_id,r.table_id);
  return v_table;
end $function$;

create function public.create_supply_draft(p_actor_user_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean; v_op uuid; v_hash text; v_prior public.app_supply_table_operations%rowtype; v_table uuid; v_source_revision uuid; v_content jsonb; v_revision uuid; v_result jsonb; v_item jsonb; v_stop jsonb; v_venue jsonb; v_candidate jsonb;
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
      'stops',(select jsonb_agg(jsonb_build_object('role',s->>'role','venueId',s->>'venueId','venueName',vn->>'name','venueAddress',vn->>'address',
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

create function public.update_supply_draft(p_actor_user_id uuid,p_draft_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
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
  if v_head.source_revision_id is not null and v_head.source_revision_id is distinct from (select latest_staged_revision_id from public.app_supply_control where singleton) then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_old.state not in ('draft','accepted','published') then raise exception using errcode='22023',message='invalid_state'; end if;
  if v_head.protected_by_activity and v_head.published_revision_id is not null and
    exists(select 1 from public.app_supply_table_revisions published where published.revision_id=v_head.published_revision_id
      and app_private.supply_critical_change(published.content,p_request->'content')) then
    raise exception using errcode='P0001',message='protected_change';
  end if;
  v_content:=p_request->'content';
  if not app_private.supply_venues_exist(v_content) then raise exception using errcode='22023',message='validation_failed'; end if;
  insert into public.app_supply_table_revisions(table_id,revision,state,content,source_revision_id,created_by)
  values(v_table,v_old.revision+1,'draft',v_content,v_head.source_revision_id,p_actor_user_id) returning revision_id into v_revision;
  update public.app_supply_table_heads set draft_revision_id=v_revision,lifecycle=case when published_revision_id is not null then 'published' else 'draft' end,updated_at=now() where table_id=v_table;
  v_result:=app_private.supply_revision_dto(v_revision);
  insert into public.app_supply_table_operations(operation_id,actor_user_id,action,request_hash,result) values(v_op,p_actor_user_id,'draft.update',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
  values('user',p_actor_user_id,'supply.draft.updated','supply_table_revision',v_revision,v_op,'{}'::jsonb);
  return v_result;
end $function$;

create function public.read_supply_draft_preview(p_actor_user_id uuid,p_draft_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_table uuid; v_revision public.app_supply_table_revisions%rowtype; v_head public.app_supply_table_heads%rowtype;
begin
  perform app_private.require_service_role();
  select table_id into v_table from public.app_supply_table_revisions where revision_id=p_draft_id;
  if not found or not app_private.supply_can_read_table(p_actor_user_id,v_table) then raise exception using errcode='42501',message='forbidden'; end if;
  select * into v_head from public.app_supply_table_heads where table_id=v_table;
  select * into v_revision from public.app_supply_table_revisions where revision_id=p_draft_id;
  if v_head.draft_revision_id<>p_draft_id or v_revision.revision<>p_expected_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;
  return public.read_supply_table_detail(p_actor_user_id,v_table);
end $function$;

create function public.accept_supply_draft(p_actor_user_id uuid,p_draft_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
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
  if v_head.source_revision_id is not null and v_head.source_revision_id is distinct from (select latest_staged_revision_id from public.app_supply_control where singleton) then raise exception using errcode='P0001',message='revision_conflict'; end if;
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

create function public.publish_supply_draft(p_actor_user_id uuid,p_draft_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
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
  if v_head.source_revision_id is not null and v_head.source_revision_id is distinct from (select latest_staged_revision_id from public.app_supply_control where singleton) then raise exception using errcode='P0001',message='revision_conflict'; end if;
  if v_head.protected_by_activity and v_head.published_revision_id is not null and exists(select 1 from public.app_supply_table_revisions p where p.revision_id=v_head.published_revision_id and
    app_private.supply_critical_change(p.content,v_revision.content)) then raise exception using errcode='P0001',message='protected_change'; end if;
  update public.app_supply_table_revisions set state='published',updated_at=now() where revision_id=p_draft_id;
  update public.app_supply_table_heads set published_revision_id=p_draft_id,lifecycle='published',updated_at=now() where table_id=v_head.table_id;
  v_result:=public.read_supply_table_detail(p_actor_user_id,v_head.table_id);
  insert into public.app_supply_table_operations(operation_id,actor_user_id,action,request_hash,result) values(v_op,p_actor_user_id,'draft.publish',v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata) values('user',p_actor_user_id,'supply.draft.published','supply_table',v_head.table_id,v_op,'{}'::jsonb);
  return v_result;
end $function$;

do $grants$
declare fn text;
begin
  foreach fn in array array[
    'public.list_supply_tables(uuid,text,text,integer)', 'public.read_supply_table_detail(uuid,uuid)',
    'public.list_supply_venues(uuid,text)', 'public.read_supply_draft_table_id(uuid,uuid)',
    'public.create_supply_draft(uuid,jsonb)', 'public.update_supply_draft(uuid,uuid,jsonb)',
    'public.read_supply_draft_preview(uuid,uuid,integer)', 'public.accept_supply_draft(uuid,uuid,jsonb)',
    'public.publish_supply_draft(uuid,uuid,jsonb)'
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',fn);
    execute format('grant execute on function %s to service_role',fn);
  end loop;
end $grants$;
