-- The "oldest invitation email waiting" alert counted queued outbox rows whose invitation was already closed or revoked
-- (Table cancelled, guest removed). The delivery worker never claims those rows, so the alert grew forever.
-- Count only rows for active invitations, matching the worker's claim and the sibling delivery-problem count.
do $migration$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.read_admin_overview(uuid)'::regprocedure) into v_def;
  v_new:=replace(v_def,
    $a$from public.app_table_invitation_outbox o where o.state in ('queued','sending')),$a$,
    $b$from public.app_table_invitation_outbox o join public.app_table_invitations i on i.invitation_id=o.invitation_id
        where o.state in ('queued','sending') and i.state='active'),$b$);
  if v_new=v_def then raise exception 'read_admin_overview did not match the expected definition'; end if;
  execute v_new;
end $migration$;
