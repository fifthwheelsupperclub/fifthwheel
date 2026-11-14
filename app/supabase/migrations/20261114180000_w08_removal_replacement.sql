-- W08.2: admin removal of one invited/paid guest with an optional single replacement suggestion.
-- Removal always commits; the replacement is sent only if it still validates under lock.

do $$
declare v_def text; v_add text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.app_audit_events'::regclass and conname='app_audit_events_action_check';
  foreach v_add in array array['table.member.removed'] loop
    if position(quote_literal(v_add) in v_def)=0 then
      v_def:=regexp_replace(v_def, '\]\)\)\)\s*$', ', '||quote_literal(v_add)||'::text]))) ');
    end if;
  end loop;
  alter table public.app_audit_events drop constraint app_audit_events_action_check;
  execute 'alter table public.app_audit_events add constraint app_audit_events_action_check '||v_def;
end $$;

alter table public.app_refund_obligations drop constraint app_refund_obligations_source_check;
alter table public.app_refund_obligations add constraint app_refund_obligations_source_check
  check (source in ('late_checkout_ineligible','cancellation','table_cancellation','removal'));
alter table public.app_ops_operations drop constraint app_ops_operations_action_check;
alter table public.app_ops_operations add constraint app_ops_operations_action_check check (action in ('proceed','remove_replace'));

-- ---------------------------------------------------------------------------------------------------------------------
-- One roster rule set for any guest set (paid group, or remaining-plus-replacement)
-- ---------------------------------------------------------------------------------------------------------------------
create function app_private.group_issues(p_table_id uuid,p_guest_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_date date; v_count integer; v_codes text[]:='{}';
begin
  select (r.content->>'localDate')::date into v_date from public.app_supply_table_heads h
    join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=p_table_id;
  with g as (
    select p.guest_id,p.identity,p.open_to,p.match_age_min,p.match_age_max,
      extract(year from age(v_date,p.date_of_birth))::integer as age,
      (p.identity_status='approved' and p.reviewed_identity_version=p.critical_identity_version) as approved
    from public.app_member_profiles p where p.guest_id=any(coalesce(p_guest_ids,'{}'::uuid[]))),
  pairs as (
    select a.guest_id as a_id,b.guest_id as b_id,
      (a.age between b.match_age_min and b.match_age_max and b.age between a.match_age_min and a.match_age_max) as age_ok,
      (a.identity=any(b.open_to) and b.identity=any(a.open_to)) as open_ok
    from g a join g b on a.guest_id<b.guest_id)
  select (select count(*)::integer from g),
    array_remove(array[
      case when (select count(*) from g) not between 3 and 5 then 'select_three_to_five' end,
      case when exists(select 1 from g where age is null or age<21) then 'age_under_21' end,
      case when exists(select 1 from g where not approved) then 'profile_not_approved' end,
      case when exists(select 1 from pairs where not age_ok) then 'pair_age_mismatch' end,
      case when exists(select 1 from g where not exists(select 1 from pairs x where x.open_ok and g.guest_id in (x.a_id,x.b_id))) then 'missing_mutual_open_connection' end,
      case when (select max(age)-min(age) from g)>12 then 'age_span_exceeded' end],null)
  into v_count,v_codes;
  return jsonb_build_object('valid',coalesce(cardinality(v_codes),0)=0,'count',v_count,'issues',to_jsonb(coalesce(v_codes,'{}'::text[])));
end $function$;

create or replace function app_private.paid_group_issues(p_table_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select app_private.group_issues(p_table_id,coalesce((select array_agg(distinct s.guest_id) from public.app_seats s
    where s.table_id=p_table_id and s.state in ('confirmed','cancellation_requested','completed')),'{}'::uuid[]))
$function$;

-- Eligible Table applicants, oldest request first then guest UUID, whose addition keeps the roster valid.
create function app_private.replacement_candidates(p_table_id uuid,p_remaining uuid[])
returns table(request_id uuid,guest_id uuid,auth_user_id uuid,created_at timestamptz,display_name text)
language sql stable security definer set search_path = '' as $function$
  select q.request_id,q.guest_id,q.auth_user_id,q.created_at,btrim(p.first_name||' '||p.last_name)
  from public.app_table_requests q
  join public.app_member_profiles p on p.guest_id=q.guest_id and p.auth_user_id=q.auth_user_id
  join public.app_admissions a on a.auth_user_id=q.auth_user_id and a.state='activated'
  join auth.users u on u.id=q.auth_user_id and u.email_confirmed_at is not null
  where q.table_id=p_table_id and q.state='pending'
    and p.identity_status='approved' and p.reviewed_identity_version=p.critical_identity_version and p.date_of_birth is not null
    and not exists(select 1 from public.app_table_invitations i where i.table_id=p_table_id and i.auth_user_id=q.auth_user_id and i.state='active')
    and not (q.guest_id=any(p_remaining))
    and (app_private.group_issues(p_table_id,p_remaining||q.guest_id)->>'valid')::boolean
  order by q.created_at,q.guest_id
$function$;

create function public.suggest_replacement(p_actor uuid,p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_inv public.app_table_invitations%rowtype; v_remaining uuid[]; v_cand record; v_rev integer;
begin
  perform app_private.require_staff(p_actor,'admin');
  select * into v_inv from public.app_table_invitations where invitation_id=p_invitation_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_inv.state<>'active' then raise exception using errcode='P0001',message='invitation_not_removable'; end if;
  select coalesce(array_agg(i.guest_id),'{}'::uuid[]) into v_remaining from public.app_table_invitations i
    where i.table_id=v_inv.table_id and i.state='active' and i.invitation_id<>p_invitation_id;
  select p.revision into v_rev from public.app_table_roster_proposals p where p.table_id=v_inv.table_id and p.state='approved' order by p.revision desc limit 1;
  select * into v_cand from app_private.replacement_candidates(v_inv.table_id,v_remaining) limit 1;
  return jsonb_build_object('invitationId',p_invitation_id,'tableId',v_inv.table_id,'expectedRevision',v_rev,
    'remainingValid',(app_private.group_issues(v_inv.table_id,v_remaining)->>'valid')::boolean,
    'candidate',case when v_cand.request_id is null then null else jsonb_build_object('requestId',v_cand.request_id,'guestId',v_cand.guest_id,
      'displayName',v_cand.display_name,'requestCreatedAt',v_cand.created_at) end);
end $function$;

create function public.remove_and_replace(p_actor uuid,p_invitation_id uuid,p_operation_id uuid,p_expected_revision integer,
  p_refund_cents integer,p_replace_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text; v_prior public.app_ops_operations%rowtype; v_inv public.app_table_invitations%rowtype; v_runtime public.app_table_runtime%rowtype;
  v_seat public.app_seats%rowtype; v_payment public.app_payments%rowtype; v_old public.app_table_roster_proposals%rowtype; v_new public.app_table_roster_proposals%rowtype;
  v_committed integer:=0; v_remaining uuid[]; v_cand_req uuid; v_cand_guest uuid; v_cand_user uuid; v_final uuid[]; v_valid boolean; v_replacement jsonb; v_new_inv uuid; v_result jsonb;
  v_seat_cancelled boolean:=false; v_refund integer:=coalesce(p_refund_cents,0);
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_invitation_id is null or p_operation_id is null or p_expected_revision is null or v_refund not between 0 and 2500 then
    raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('invitationId',p_invitation_id,'expectedRevision',p_expected_revision,'refundCents',v_refund,'replace',p_replace_request_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('ops:'||p_operation_id::text,0));
  select * into v_prior from public.app_ops_operations where operation_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.action<>'remove_replace' or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  select * into v_inv from public.app_table_invitations where invitation_id=p_invitation_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  perform 1 from public.app_supply_table_heads where table_id=v_inv.table_id for update;
  select * into v_runtime from public.app_table_runtime where table_id=v_inv.table_id for update;
  if v_runtime.state not in ('open','review_required','proceeding') then raise exception using errcode='P0001',message='table_not_active'; end if;
  select * into v_inv from public.app_table_invitations where invitation_id=p_invitation_id for update;
  if v_inv.state<>'active' then raise exception using errcode='P0001',message='invitation_not_removable'; end if;
  select * into v_old from public.app_table_roster_proposals where table_id=v_inv.table_id and state='approved' order by revision desc limit 1 for update;
  if not found or v_old.revision<>p_expected_revision then raise exception using errcode='P0001',message='revision_conflict'; end if;

  select * into v_seat from public.app_seats where invitation_id=p_invitation_id for update;
  if found and v_seat.state in ('confirmed','cancellation_requested') then
    select * into v_payment from public.app_payments where payment_id=v_seat.payment_id for update;
    perform 1 from public.app_refund_obligations where payment_id=v_payment.payment_id order by obligation_id for update;
    select coalesce(sum(amount_cents),0)::integer into v_committed from public.app_refund_obligations where payment_id=v_payment.payment_id;
    if v_refund>v_payment.amount_cents-v_committed then raise exception using errcode='P0001',message='refund_amount_exceeds_balance'; end if;
    update public.app_seat_cancellation_requests set state='approved',version=2,decided_at=clock_timestamp(),decided_by=p_actor,
      guest_safe_reason='Staff removed you from this Table.',refund_cents=v_refund where seat_id=v_seat.seat_id and state='pending';
    update public.app_seats set state='cancelled',cancelled_at=clock_timestamp() where seat_id=v_seat.seat_id;
    v_seat_cancelled:=true;
    if v_refund>0 then
      insert into public.app_refund_obligations(payment_id,source,amount_cents,currency,state) values(v_payment.payment_id,'removal',v_refund,'USD','open');
      update public.app_payments set state='refund_pending' where payment_id=v_payment.payment_id;
    end if;
  elsif v_refund>0 then raise exception using errcode='P0001',message='refund_amount_exceeds_balance';
  end if;
  update public.app_checkout_attempts set state='released' where invitation_id=p_invitation_id and state in ('creating','open','unknown');
  update public.app_table_invitations set state='revoked',revoked_at=clock_timestamp() where invitation_id=p_invitation_id;
  update public.app_table_requests set state='declined',decline_reason='Your place at this Table was removed by staff.' where request_id=v_inv.source_request_id and state='pending';
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,'table.member.removed','table_invitation',p_invitation_id,p_operation_id,
      jsonb_build_object('tableId',v_inv.table_id,'guest_id',v_inv.guest_id,'refund_cents',v_refund));

  select coalesce(array_agg(i.guest_id),'{}'::uuid[]) into v_remaining from public.app_table_invitations i where i.table_id=v_inv.table_id and i.state='active';
  v_replacement:=jsonb_build_object('state','none','invitationId',null);
  if p_replace_request_id is not null then
    perform 1 from public.app_table_requests where request_id=p_replace_request_id for update;
    select c.request_id,c.guest_id,c.auth_user_id into v_cand_req,v_cand_guest,v_cand_user from app_private.replacement_candidates(v_inv.table_id,v_remaining) c where c.request_id=p_replace_request_id;
    if v_cand_req is null then v_replacement:=jsonb_build_object('state','stale','invitationId',null); end if;
  end if;
  v_final:=case when v_cand_req is not null then v_remaining||v_cand_guest else v_remaining end;
  v_valid:=(app_private.group_issues(v_inv.table_id,v_final)->>'valid')::boolean;

  if v_valid then
    insert into public.app_table_roster_proposals(table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at)
      values(v_inv.table_id,v_old.revision+1,'approved',v_old.supply_revision_id,'{}'::jsonb,p_actor,p_actor,p_actor,p_actor,clock_timestamp(),clock_timestamp())
      returning * into v_new;
    insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version)
      select v_new.proposal_id,m.request_id,m.guest_id,m.captured_profile_revision,m.captured_critical_identity_version,m.captured_reviewed_identity_version
      from public.app_table_roster_proposal_members m where m.proposal_id=v_old.proposal_id and m.guest_id=any(v_remaining);
    update public.app_table_invitations set proposal_id=v_new.proposal_id where table_id=v_inv.table_id and state='active';
    update public.app_checkout_attempts set proposal_revision=v_new.revision where state in ('creating','open','unknown','processing')
      and invitation_id in (select invitation_id from public.app_table_invitations where table_id=v_inv.table_id and state='active');
    if v_cand_req is not null then
      insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision,captured_critical_identity_version,captured_reviewed_identity_version)
        select v_new.proposal_id,v_cand_req,v_cand_guest,p.profile_revision,p.critical_identity_version,p.reviewed_identity_version
        from public.app_member_profiles p where p.guest_id=v_cand_guest;
      insert into public.app_table_invitations(table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by)
        values(v_inv.table_id,v_cand_guest,v_cand_user,v_cand_req,v_new.proposal_id,p_actor) returning invitation_id into v_new_inv;
      insert into public.app_table_invitation_outbox(invitation_id,operation_id) values(v_new_inv,gen_random_uuid());
      insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
        values('user',p_actor,'table.invitation.queued','table_invitation',v_new_inv,p_operation_id,'{}'::jsonb);
      v_replacement:=jsonb_build_object('state','sent','invitationId',v_new_inv);
    end if;
  end if;

  v_result:=jsonb_build_object('removal',jsonb_build_object('invitationId',p_invitation_id,'guestId',v_inv.guest_id,'seatCancelled',v_seat_cancelled,'refundCents',v_refund),
    'replacement',v_replacement,'roster',jsonb_build_object('revision',coalesce(v_new.revision,v_old.revision),'valid',v_valid,'needsReview',not v_valid));
  insert into public.app_ops_operations(operation_id,actor_user_id,action,request_hash,result) values(p_operation_id,p_actor,'remove_replace',v_hash,v_result);
  return v_result;
end $function$;

revoke all on function app_private.group_issues(uuid,uuid[]),app_private.replacement_candidates(uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function app_private.group_issues(uuid,uuid[]),app_private.replacement_candidates(uuid,uuid[]) to service_role;
revoke all on function public.suggest_replacement(uuid,uuid),public.remove_and_replace(uuid,uuid,uuid,integer,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.suggest_replacement(uuid,uuid),public.remove_and_replace(uuid,uuid,uuid,integer,integer,uuid) to service_role;
