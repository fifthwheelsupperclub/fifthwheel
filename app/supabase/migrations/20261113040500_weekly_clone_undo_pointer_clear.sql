-- Permit exactly the draft-pointer clear needed by the guarded undo deletion.
-- All other mutations remain blocked while an undo owns the head.
create or replace function app_private.block_supply_mutation_during_clone_undo()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.weekly_clone_undo_operation_id is not null then
    if new.weekly_clone_undo_operation_id is distinct from old.weekly_clone_undo_operation_id then
      if new.weekly_clone_undo_operation_id is not null
        or new.draft_revision_id is not null
        or new.accepted_revision_id is distinct from old.accepted_revision_id
        or new.published_revision_id is distinct from old.published_revision_id
        or new.lifecycle is distinct from old.lifecycle
        or new.protected_by_activity is distinct from old.protected_by_activity
        or new.sync_state is distinct from old.sync_state then
        raise exception using errcode='P0001',message='undo_in_progress';
      end if;
    elsif new.draft_revision_id is distinct from old.draft_revision_id
      or new.accepted_revision_id is distinct from old.accepted_revision_id
      or new.published_revision_id is distinct from old.published_revision_id
      or new.lifecycle is distinct from old.lifecycle
      or new.protected_by_activity is distinct from old.protected_by_activity
      or new.sync_state is distinct from old.sync_state then
      raise exception using errcode='P0001',message='undo_in_progress';
    end if;
  end if;
  return new;
end $function$;
revoke all on function app_private.block_supply_mutation_during_clone_undo() from public,anon,authenticated,service_role;
