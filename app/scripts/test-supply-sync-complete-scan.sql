-- Run only through test-supply-sync.mjs after its isolated target/history guards.
-- Every fixture is inside this transaction and is rolled back.
begin;
select pg_advisory_xact_lock(hashtextextended('fifthwheel-w05-complete-scan-harness',0));
select set_config('w05.admin', :'admin', true);
select set_config('w05.member', :'member', true);
select set_config('w05.prior_operation', :'prior_operation', true);
select set_config('w05.incomplete_operation', :'incomplete_operation', true);
select set_config('w05.invalid_operation', :'invalid_operation', true);
select set_config('w05.missing_operation', :'missing_operation', true);
select set_config('w05.reappear_operation', :'reappear_operation', true);
select set_config('w05.accept_operation', :'accept_operation', true);
select set_config('w05.publish_operation', :'publish_operation', true);
select set_config('w05.table_id', :'table_id', true);
select set_config('w05.venue_id', :'venue_id', true);
select set_config('w05.prior_sync_revision', :'prior_sync_revision', true);
select set_config('w05.draft_revision', :'draft_revision', true);
select set_config('w05.accepted_revision', :'accepted_revision', true);
select set_config('w05.published_revision', :'published_revision', true);
select set_config('w05.admin_email', :'admin_email', true);
select set_config('w05.member_email', :'member_email', true);
select set_config('w05.table_source_id', :'table_source_id', true);
select set_config('w05.venue_source_id', :'venue_source_id', true);
select set_config('w05.hash_f', :'hash_f', true);
select set_config('w05.hash_a', :'hash_a', true);
select set_config('w05.hash_b', :'hash_b', true);

do $scenario$
declare
  v_admin_id uuid := current_setting('w05.admin')::uuid;
  v_member_id uuid := current_setting('w05.member')::uuid;
  v_prior_operation_id uuid := current_setting('w05.prior_operation')::uuid;
  v_incomplete_operation_id uuid := current_setting('w05.incomplete_operation')::uuid;
  v_invalid_operation_id uuid := current_setting('w05.invalid_operation')::uuid;
  v_missing_operation_id uuid := current_setting('w05.missing_operation')::uuid;
  v_reappear_operation_id uuid := current_setting('w05.reappear_operation')::uuid;
  v_accept_operation_id uuid := current_setting('w05.accept_operation')::uuid;
  v_publish_operation_id uuid := current_setting('w05.publish_operation')::uuid;
  v_table_id uuid := current_setting('w05.table_id')::uuid;
  v_venue_id uuid := current_setting('w05.venue_id')::uuid;
  v_prior_sync_revision uuid := current_setting('w05.prior_sync_revision')::uuid;
  v_draft_revision_id uuid := current_setting('w05.draft_revision')::uuid;
  v_accepted_revision_id uuid := current_setting('w05.accepted_revision')::uuid;
  v_published_revision_id uuid := current_setting('w05.published_revision')::uuid;
  v_admin_email text := current_setting('w05.admin_email');
  v_member_email text := current_setting('w05.member_email');
  v_table_source_id text := current_setting('w05.table_source_id');
  v_venue_source_id text := current_setting('w05.venue_source_id');
  v_hash_f text := current_setting('w05.hash_f');
  v_hash_a text := current_setting('w05.hash_a');
  v_hash_b text := current_setting('w05.hash_b');
  fixture_content jsonb;
  begun jsonb;
  finished jsonb;
  missing_run uuid;
  table_detail jsonb;
  table_list jsonb;
  baseline_control public.app_supply_control%rowtype;
  baseline_head public.app_supply_table_heads%rowtype;
  revision_count integer;
  mapping_count integer;
  guarded boolean;
begin
  if exists(select 1 from auth.users where id in (v_admin_id,v_member_id) or email in (v_admin_email,v_member_email))
    or exists(select 1 from public.app_user_roles where user_id in (v_admin_id,v_member_id))
    or exists(select 1 from public.app_supply_sync_runs where run_id=v_prior_sync_revision or operation_id in (v_prior_operation_id,v_incomplete_operation_id,v_invalid_operation_id,v_missing_operation_id,v_reappear_operation_id))
    or exists(select 1 from public.app_supply_table_heads where table_id=v_table_id)
    or exists(select 1 from public.app_supply_table_revisions where revision_id in (v_draft_revision_id,v_accepted_revision_id,v_published_revision_id))
    or exists(select 1 from public.app_supply_sync_revisions where revision_id=v_prior_sync_revision)
    or exists(select 1 from public.app_supply_external_mappings where (entity_kind='table' and source_record_id=v_table_source_id) or (entity_kind='venue' and source_record_id=v_venue_source_id) or core_id in (v_table_id,v_venue_id))
    or exists(select 1 from public.app_audit_events where operation_id in (v_prior_operation_id,v_incomplete_operation_id,v_invalid_operation_id,v_missing_operation_id,v_reappear_operation_id,v_accept_operation_id,v_publish_operation_id))
    or exists(select 1 from public.app_supply_table_operations where operation_id in (v_accept_operation_id,v_publish_operation_id)) then
    raise exception 'fixture_collision';
  end if;

  insert into auth.users(id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values (v_admin_id,'authenticated','authenticated',v_admin_email,'','{}','{}',now(),now()),
         (v_member_id,'authenticated','authenticated',v_member_email,'','{}','{}',now(),now());
  insert into public.app_user_roles(user_id,role) values (v_admin_id,'admin');
  insert into public.app_supply_sync_runs(run_id,operation_id,actor_user_id,state,started_at,finished_at,
    table_pages,venue_pages,table_count,venue_count,candidate_revision_id,candidate_source_hash)
  values (v_prior_sync_revision,v_prior_operation_id,v_admin_id,'staged',now()-interval '2 days',now()-interval '2 days',
    1,1,1,1,v_prior_sync_revision,v_hash_f);
  insert into public.app_supply_sync_revisions(revision_id,run_id,source_hash,table_count,venue_count,normalized_candidate,state)
  values (v_prior_sync_revision,v_prior_sync_revision,v_hash_f,1,1,'[]'::jsonb,'staged');
  insert into public.app_supply_external_mappings(entity_kind,source_record_id,core_id) values
    ('table',v_table_source_id,v_table_id),('venue',v_venue_source_id,v_venue_id);

  fixture_content:=jsonb_build_object('title','Published test Table','localDate','2026-11-19','startLocalTime','19:00',
    'neighborhood','Inman Park','hostNotes','',
    'stops',jsonb_build_array(
      jsonb_build_object('role','drinks','venueId',v_venue_id,'venueName','Example Room','venueAddress','1 Main St','minutesFromStart',0,'publicNotes',''),
      jsonb_build_object('role','dinner','venueId',v_venue_id,'venueName','Example Room','venueAddress','1 Main St','minutesFromStart',45,'publicNotes',''),
      jsonb_build_object('role','dessert','venueId',v_venue_id,'venueName','Example Room','venueAddress','1 Main St','minutesFromStart',120,'publicNotes','')));
  insert into public.app_supply_table_heads(table_id,source_revision_id,sync_state,lifecycle,protected_by_activity)
  values (v_table_id,v_prior_sync_revision,'current','published',true);
  insert into public.app_supply_table_revisions(revision_id,table_id,revision,state,content,source_revision_id,created_by)
  values (v_draft_revision_id,v_table_id,1,'draft',fixture_content,v_prior_sync_revision,v_admin_id),
         (v_accepted_revision_id,v_table_id,2,'accepted',fixture_content,v_prior_sync_revision,v_admin_id),
         (v_published_revision_id,v_table_id,3,'published',fixture_content,v_prior_sync_revision,v_admin_id);
  update public.app_supply_table_heads set draft_revision_id=v_draft_revision_id,accepted_revision_id=v_accepted_revision_id,
    published_revision_id=v_published_revision_id where table_id=v_table_id;
  update public.app_supply_control set latest_staged_revision_id=v_prior_sync_revision,latest_candidate_hash=v_hash_f,
    last_good_published_revision_id=v_prior_sync_revision,last_good_published_at='2026-11-10T12:00:00Z',
    updated_at='2026-11-10T12:00:00Z' where singleton=true;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select * into baseline_control from public.app_supply_control where singleton;
  select * into baseline_head from public.app_supply_table_heads where table_id=v_table_id;
  select count(*) into revision_count from public.app_supply_table_revisions where table_id=v_table_id;
  select count(*) into mapping_count from public.app_supply_external_mappings where entity_kind in ('table','venue');

  guarded:=false;
  begin
    perform public.begin_supply_sync(v_invalid_operation_id,v_member_id);
  exception when insufficient_privilege then guarded:=true;
  end;
  if not guarded or exists(select 1 from public.app_supply_sync_runs where operation_id=v_invalid_operation_id) then raise exception 'non-admin sync was not denied before run creation'; end if;

  begun:=public.begin_supply_sync(v_incomplete_operation_id,v_admin_id);
  finished:=public.finish_supply_sync((begun->'run'->>'run_id')::uuid,v_admin_id,'incomplete',
    '{"tablePages":1,"venuePages":0,"tables":1,"venues":0}'::jsonb,null,null,'[]'::jsonb,'[]'::jsonb,'new_operation_required','incomplete scan',null);
  if finished->>'state'<>'incomplete' or (select sync_state from public.app_supply_table_heads where table_id=v_table_id)<>'current' then raise exception 'incomplete scan inferred absence'; end if;
  if (select latest_staged_revision_id from public.app_supply_control where singleton) is distinct from baseline_control.latest_staged_revision_id
     or (select last_good_published_revision_id from public.app_supply_control where singleton) is distinct from baseline_control.last_good_published_revision_id
     or (select last_good_published_at from public.app_supply_control where singleton) is distinct from baseline_control.last_good_published_at then raise exception 'incomplete scan changed supply pointers'; end if;

  begun:=public.begin_supply_sync(v_invalid_operation_id,v_admin_id);
  finished:=public.finish_supply_sync((begun->'run'->>'run_id')::uuid,v_admin_id,'conflict',
    '{"tablePages":1,"venuePages":1,"tables":1,"venues":1}'::jsonb,null,null,'[]'::jsonb,
    '[{"entityKind":"table","recordOrdinal":1,"field":"source","code":"invalid_source_record","message":"Malformed source row."}]'::jsonb,'blocked','invalid source row',1);
  if finished->>'state'<>'conflict' or (select sync_state from public.app_supply_table_heads where table_id=v_table_id)<>'current' then raise exception 'malformed/conflicted scan inferred absence'; end if;

  begun:=public.begin_supply_sync(v_missing_operation_id,v_admin_id);
  missing_run:=(begun->'run'->>'run_id')::uuid;
  finished:=public.finish_supply_sync(missing_run,v_admin_id,'staged',
    '{"tablePages":1,"venuePages":1,"tables":0,"venues":1}'::jsonb,v_hash_a,
    jsonb_build_array(jsonb_build_object('id',v_venue_id,'name','Example Room')),
    jsonb_build_array(jsonb_build_object('entityKind','venue','sourceRecordId',v_venue_source_id,'coreId',v_venue_id)),
    '[]'::jsonb,'blocked',null,0);
  if finished->>'state'<>'conflict' or (finished->>'conflict_count')::integer<>1
     or finished->'conflicts'->0->>'code'<>'invalid_source_record' or finished->>'candidate_revision_id' is not null then raise exception 'missing source was not an explicit non-staged conflict'; end if;
  if (select sync_state from public.app_supply_table_heads where table_id=v_table_id)<>'missing' then raise exception 'complete scan did not mark mapped Table missing'; end if;
  if (select lifecycle from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.lifecycle
     or (select source_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.source_revision_id
     or (select draft_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.draft_revision_id
     or (select accepted_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.accepted_revision_id
     or (select published_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.published_revision_id
     or (select updated_at from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.updated_at then raise exception 'missing scan changed lifecycle or Table pointers'; end if;
  if (select latest_staged_revision_id from public.app_supply_control where singleton) is distinct from baseline_control.latest_staged_revision_id
     or (select latest_candidate_hash from public.app_supply_control where singleton) is distinct from baseline_control.latest_candidate_hash
     or (select last_good_published_revision_id from public.app_supply_control where singleton) is distinct from baseline_control.last_good_published_revision_id
     or (select last_good_published_at from public.app_supply_control where singleton) is distinct from baseline_control.last_good_published_at then raise exception 'missing scan changed staged or last-good pointers'; end if;
  if (select count(*) from public.app_supply_table_revisions where table_id=v_table_id)<>revision_count
     or (select count(*) from public.app_supply_external_mappings where entity_kind in ('table','venue'))<>mapping_count
     or not exists(select 1 from public.app_supply_external_mappings where entity_kind='table' and source_record_id=v_table_source_id and core_id=v_table_id) then raise exception 'missing scan changed mappings/revisions'; end if;
  if (select count(*) from public.app_audit_events where operation_id=v_missing_operation_id and action='supply.sync.missing_detected' and subject_id=v_table_id)<>1 then raise exception 'missing transition audit absent'; end if;

  table_detail:=public.read_supply_table_detail(v_admin_id,v_table_id);
  table_list:=public.list_supply_tables(v_admin_id,null,null,25);
  if table_detail->>'syncState'<>'missing' or table_detail->>'currentSyncState'<>'missing'
     or table_detail->>'lifecycle'<>'published' or table_detail->>'canAccept'<>'false' or table_detail->>'canPublish'<>'false'
     or not exists(select 1 from jsonb_array_elements(table_list->'items') item(value)
       where item.value->>'tableId'=v_table_id::text and item.value->>'syncState'='missing') then raise exception 'admin list/detail did not expose review state'; end if;

  guarded:=false;
  begin
    perform public.accept_supply_draft(v_admin_id,v_draft_revision_id,jsonb_build_object('operationId',v_accept_operation_id,'expectedDraftRevision',1));
  exception when sqlstate 'P0001' then if sqlerrm='revision_conflict' then guarded:=true; else raise; end if;
  end;
  if not guarded or exists(select 1 from public.app_supply_table_operations where operation_id=v_accept_operation_id) then raise exception 'missing Table accept was not safely blocked'; end if;
  guarded:=false;
  begin
    perform public.publish_supply_draft(v_admin_id,v_accepted_revision_id,jsonb_build_object('operationId',v_publish_operation_id,'expectedDraftRevision',2));
  exception when sqlstate 'P0001' then if sqlerrm='revision_conflict' then guarded:=true; else raise; end if;
  end;
  if not guarded or exists(select 1 from public.app_supply_table_operations where operation_id=v_publish_operation_id) then raise exception 'missing Table publish was not safely blocked'; end if;

  begun:=public.begin_supply_sync(v_reappear_operation_id,v_admin_id);
  finished:=public.finish_supply_sync((begun->'run'->>'run_id')::uuid,v_admin_id,'staged',
    '{"tablePages":1,"venuePages":1,"tables":1,"venues":1}'::jsonb,v_hash_b,
    jsonb_build_array(jsonb_build_object('id',v_table_id,'title','Published test Table'),jsonb_build_object('id',v_venue_id,'name','Example Room')),
    jsonb_build_array(jsonb_build_object('entityKind','table','sourceRecordId',v_table_source_id,'coreId',v_table_id),
      jsonb_build_object('entityKind','venue','sourceRecordId',v_venue_source_id,'coreId',v_venue_id)),
    '[]'::jsonb,'blocked',null,0);
  if finished->>'state'<>'staged' or (select sync_state from public.app_supply_table_heads where table_id=v_table_id)<>'current' then raise exception 'reappearing Table did not return to current'; end if;
  if (select lifecycle from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.lifecycle
     or (select source_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.source_revision_id
     or (select draft_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.draft_revision_id
     or (select accepted_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.accepted_revision_id
     or (select published_revision_id from public.app_supply_table_heads where table_id=v_table_id) is distinct from baseline_head.published_revision_id then raise exception 'reappearance changed lifecycle or Table pointers'; end if;
  if (select last_good_published_revision_id from public.app_supply_control where singleton) is distinct from baseline_control.last_good_published_revision_id
     or (select last_good_published_at from public.app_supply_control where singleton) is distinct from baseline_control.last_good_published_at then raise exception 'reappearance changed last-good pointer'; end if;
  if (select count(*) from public.app_supply_external_mappings where entity_kind in ('table','venue'))<>mapping_count
     or (select count(*) from public.app_supply_table_revisions where table_id=v_table_id)<>revision_count then raise exception 'reappearance duplicated mappings or Table revisions'; end if;
  if (select count(*) from public.app_audit_events where operation_id=v_reappear_operation_id and action='supply.sync.missing_resolved' and subject_id=v_table_id)<>1 then raise exception 'reappearance audit absent'; end if;
end;
$scenario$;

rollback;
