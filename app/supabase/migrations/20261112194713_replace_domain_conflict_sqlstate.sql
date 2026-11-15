-- Domain conflicts are not PostgreSQL serialization failures. PostgREST 14
-- retries SQLSTATE 40001, which can turn an expected stale-revision response
-- into an unbounded retry loop. Use the ordinary application-exception code
-- and preserve the stable message consumed by the server repository mapper.
do $migration$
declare
  v_function record;
  v_definition text;
  v_changed integer := 0;
begin
  for v_function in
    select p.oid, p.prosrc, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'save_member_profile',
        'create_profile_upload_intent',
        'consume_profile_upload_grant',
        'begin_profile_normalization',
        'finalize_profile_upload',
        'delete_member_profile_file',
        'prepare_identity_review_read',
        'confirm_identity_review_read_set',
        'finish_profile_evidence_cleanup',
        'get_owner_profile_file_read',
        'submit_member_profile',
        'decide_identity_review'
      ])
      and p.prosrc like '%40001%'
  loop
    v_definition := replace(v_function.definition, '''40001''', '''P0001''');
    if v_definition = v_function.definition then
      raise exception 'Expected SQLSTATE literal was not found in function OID %', v_function.oid;
    end if;
    execute v_definition;
    v_changed := v_changed + 1;
  end loop;

  if v_changed < 1 then
    raise exception 'No W04 domain-conflict functions were updated';
  end if;
  raise notice 'Updated % W04 functions to use non-retryable domain errors', v_changed;
end;
$migration$;
