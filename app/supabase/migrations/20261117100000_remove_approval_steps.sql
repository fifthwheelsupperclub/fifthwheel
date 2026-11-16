-- No staff approval before an invitation. A waitlist signup waits in a staff placement queue; an admin adds them to a Table and the
-- invitation is queued in the same transaction. Removed: admission approval, photo/selfie identity review, member seat requests and
-- host roster proposals. Kept for history: the old tables, audit values and roster proposal rows.
--
-- Placement still writes a `pending` app_table_requests row and an approved roster revision, because checkout, fulfillment, the Seat
-- read model, invitation emails and removal all join through them. Each placement adds one guest to a new approved revision, exactly
-- as remove_and_replace already does for a replacement.

-- ---------------------------------------------------------------------------------------------------------------------
-- Photo and identity review: gone
-- ---------------------------------------------------------------------------------------------------------------------
drop function if exists public.create_profile_upload_intent;
drop function if exists public.consume_profile_upload_grant;
drop function if exists public.begin_profile_normalization;
drop function if exists public.finalize_profile_upload;
drop function if exists public.delete_member_profile_file;
drop function if exists public.prepare_identity_review_read;
drop function if exists public.confirm_identity_review_read_set;
drop function if exists public.claim_due_profile_evidence_cleanup;
drop function if exists public.finish_profile_evidence_cleanup;
drop function if exists public.fail_profile_upload;
drop function if exists public.get_owner_profile_file_read;
drop function if exists public.submit_member_profile;
drop function if exists public.decide_identity_review;
drop table public.app_identity_reviews;
drop table public.app_profile_files;
-- The `identity-evidence` Storage bucket is emptied and deleted through the Storage API (runbook), not from SQL.

-- ---------------------------------------------------------------------------------------------------------------------
-- Member self-serve browsing/requests, host roster proposals, admission approval: gone
-- ---------------------------------------------------------------------------------------------------------------------
drop function if exists public.list_published_tables;
drop function if exists public.read_published_table_detail;
drop function if exists public.read_published_table_preview;
drop function if exists public.create_table_request;
drop function if exists public.withdraw_table_request;
drop function if exists app_private.require_approved_table_member;
drop function if exists public.list_curation_assigned_tables;
drop function if exists public.read_table_roster_context;
drop function if exists public.save_table_roster_proposal;
drop function if exists public.submit_table_roster_proposal;
drop function if exists public.approve_table_roster;
drop function if exists app_private.roster_candidate_public;
drop function if exists app_private.roster_selected_guests;
drop function if exists app_private.validate_table_roster;
drop function if exists app_private.require_roster_staff;
drop function if exists public.admit_waitlist_signup;
drop function if exists public.begin_invitation_delivery_attempt;
drop function if exists public.finish_invitation_delivery_attempt;
drop function if exists public.reconcile_unknown_invitation_attempt;

alter table public.app_table_roster_proposal_members
  drop column captured_critical_identity_version,
  drop column captured_reviewed_identity_version;
alter table public.app_member_profiles
  drop column identity_status,
  drop column critical_identity_version,
  drop column reviewed_identity_version,
  drop column latest_correction_reason,
  drop column evidence_received_at,
  drop column evidence_deleted_at;

alter table public.app_table_requests add column placed_by uuid references auth.users(id) on delete restrict;
alter table public.app_ops_operations drop constraint app_ops_operations_action_check;
alter table public.app_ops_operations add constraint app_ops_operations_action_check check (action in ('proceed','remove_replace','place'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Profile edits no longer reset an approval
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.save_member_profile(
  p_auth_user_id uuid, p_expected_revision integer, p_operation_id uuid,
  p_first_name text, p_last_name text, p_date_of_birth date, p_identity text,
  p_open_to text[], p_match_age_min smallint, p_match_age_max smallint,
  p_neighborhood text, p_nights text[], p_looking_for text, p_surprise_game text,
  p_phone text, p_one_liner text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_profile public.app_member_profiles%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_profile from public.app_member_profiles p where p.auth_user_id = p_auth_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'profile_not_found'; end if;
  if v_profile.profile_revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'profile_revision_conflict'; end if;
  update public.app_member_profiles p set
    profile_revision = p.profile_revision + 1,
    first_name = p_first_name, last_name = p_last_name, date_of_birth = p_date_of_birth,
    identity = p_identity, open_to = p_open_to, match_age_min = p_match_age_min,
    match_age_max = p_match_age_max, neighborhood = p_neighborhood, nights = p_nights,
    looking_for = p_looking_for, surprise_game = p_surprise_game, phone = p_phone,
    one_liner = p_one_liner, updated_at = now()
  where p.guest_id = v_profile.guest_id returning * into v_profile;
  return to_jsonb(v_profile);
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Roster rules without the identity approval
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app_private.group_issues(p_table_id uuid,p_guest_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_date date; v_count integer; v_codes text[]:='{}';
begin
  select (r.content->>'localDate')::date into v_date from public.app_supply_table_heads h
    join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=p_table_id;
  with g as (
    select p.guest_id,p.identity,p.open_to,p.match_age_min,p.match_age_max,
      extract(year from age(v_date,p.date_of_birth))::integer as age
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
      case when exists(select 1 from pairs where not age_ok) then 'pair_age_mismatch' end,
      case when exists(select 1 from g where not exists(select 1 from pairs x where x.open_ok and g.guest_id in (x.a_id,x.b_id))) then 'missing_mutual_open_connection' end,
      case when (select max(age)-min(age) from g)>12 then 'age_span_exceeded' end],null)
  into v_count,v_codes;
  return jsonb_build_object('valid',coalesce(cardinality(v_codes),0)=0,'count',v_count,'issues',to_jsonb(coalesce(v_codes,'{}'::text[])));
end $function$;

-- Replacements now come from the placement queue (place_guest_at_table), so removal no longer suggests or sends one.
-- suggest_replacement keeps its shape for the removal dialog (expected roster revision) with no candidate.
drop function if exists app_private.replacement_candidates;
create or replace function public.suggest_replacement(p_actor uuid,p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_inv public.app_table_invitations%rowtype; v_remaining uuid[]; v_rev integer;
begin
  perform app_private.require_staff(p_actor,'admin');
  select * into v_inv from public.app_table_invitations where invitation_id=p_invitation_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_inv.state<>'active' then raise exception using errcode='P0001',message='invitation_not_removable'; end if;
  select coalesce(array_agg(i.guest_id),'{}'::uuid[]) into v_remaining from public.app_table_invitations i
    where i.table_id=v_inv.table_id and i.state='active' and i.invitation_id<>p_invitation_id;
  select p.revision into v_rev from public.app_table_roster_proposals p where p.table_id=v_inv.table_id and p.state='approved' order by p.revision desc limit 1;
  return jsonb_build_object('invitationId',p_invitation_id,'tableId',v_inv.table_id,'expectedRevision',v_rev,
    'remainingValid',(app_private.group_issues(v_inv.table_id,v_remaining)->>'valid')::boolean,'candidate',null);
end $function$;

create or replace function public.remove_and_replace(p_actor uuid,p_invitation_id uuid,p_operation_id uuid,p_expected_revision integer,
  p_refund_cents integer,p_replace_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text; v_prior public.app_ops_operations%rowtype; v_inv public.app_table_invitations%rowtype; v_runtime public.app_table_runtime%rowtype;
  v_seat public.app_seats%rowtype; v_payment public.app_payments%rowtype; v_old public.app_table_roster_proposals%rowtype; v_new public.app_table_roster_proposals%rowtype;
  v_committed integer:=0; v_remaining uuid[]; v_valid boolean; v_result jsonb;
  v_seat_cancelled boolean:=false; v_refund integer:=coalesce(p_refund_cents,0);
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_invitation_id is null or p_operation_id is null or p_expected_revision is null or v_refund not between 0 and 2500 or p_replace_request_id is not null then
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
  v_valid:=(app_private.group_issues(v_inv.table_id,v_remaining)->>'valid')::boolean;
  if v_valid then
    insert into public.app_table_roster_proposals(table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at)
      values(v_inv.table_id,v_old.revision+1,'approved',v_old.supply_revision_id,'{}'::jsonb,p_actor,p_actor,p_actor,p_actor,clock_timestamp(),clock_timestamp())
      returning * into v_new;
    insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision)
      select v_new.proposal_id,m.request_id,m.guest_id,m.captured_profile_revision
      from public.app_table_roster_proposal_members m where m.proposal_id=v_old.proposal_id and m.guest_id=any(v_remaining);
    update public.app_table_invitations set proposal_id=v_new.proposal_id where table_id=v_inv.table_id and state='active';
    update public.app_checkout_attempts set proposal_revision=v_new.revision where state in ('creating','open','unknown','processing')
      and invitation_id in (select invitation_id from public.app_table_invitations where table_id=v_inv.table_id and state='active');
  end if;

  v_result:=jsonb_build_object('removal',jsonb_build_object('invitationId',p_invitation_id,'guestId',v_inv.guest_id,'seatCancelled',v_seat_cancelled,'refundCents',v_refund),
    'replacement',jsonb_build_object('state','none','invitationId',null),
    'roster',jsonb_build_object('revision',coalesce(v_new.revision,v_old.revision),'valid',v_valid,'needsReview',not v_valid));
  insert into public.app_ops_operations(operation_id,actor_user_id,action,request_hash,result) values(p_operation_id,p_actor,'remove_replace',v_hash,v_result);
  return v_result;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Checkout and fulfillment: an active invitation on the current roster revision is enough (no identity or profile snapshot check)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function app_private.checkout_invitation_context(p_actor uuid,p_invitation uuid,p_for_update boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb;
begin
  perform app_private.require_service_role();
  select jsonb_build_object(
    'invitationId',i.invitation_id,'tableId',i.table_id,'guestId',i.guest_id,'authUserId',i.auth_user_id,
    'sourceRequestId',i.source_request_id,'proposalId',p.proposal_id,'proposalRevision',p.revision,
    'profileRevision',m.profile_revision,'supplyRevisionId',h.published_revision_id,
    'runtimeState',rt.state,'localDate',r.content->>'localDate','startLocalTime',r.content->>'startLocalTime',
    'age',extract(year from age((r.content->>'localDate')::date,m.date_of_birth))::integer
  ) into v_context
  from public.app_table_invitations i
  join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
  join public.app_table_roster_proposals p on p.proposal_id=i.proposal_id and p.table_id=i.table_id and p.state='approved'
  join public.app_table_roster_proposal_members pm on pm.proposal_id=p.proposal_id and pm.request_id=q.request_id and pm.guest_id=i.guest_id
  join public.app_member_profiles m on m.guest_id=i.guest_id and m.auth_user_id=i.auth_user_id
  join public.app_admissions a on a.id=m.admission_id and a.auth_user_id=i.auth_user_id and a.state='activated'
  join public.app_supply_table_heads h on h.table_id=i.table_id and h.published_revision_id=p.supply_revision_id and h.lifecycle='published' and h.sync_state='current'
  join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id and r.state='published' and r.table_id=h.table_id
  join public.app_table_runtime rt on rt.table_id=i.table_id
  where i.invitation_id=p_invitation and i.auth_user_id=p_actor and i.state='active'
    and (r.content->>'localDate')::date + (r.content->>'startLocalTime')::time > timezone('America/New_York',clock_timestamp())
  for update of h,m,i,p;
  if v_context is null then raise exception using errcode='P0001',message='invitation_ineligible'; end if;
  return v_context;
end $function$;

-- Same body as W07.2 except the eligibility check, which no longer requires an identity approval or an unchanged profile.
do $migration$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.fulfill_paid_checkout_session(text,text,text,uuid,text,text,text,text,integer,text,timestamptz)'::regprocedure) into v_def;
  v_new:=replace(replace(replace(v_def,
    E'      and m.profile_revision=v_attempt.profile_revision and pm.captured_profile_revision=m.profile_revision\n', ''),
    E'      and m.identity_status=''approved'' and m.reviewed_identity_version=m.critical_identity_version\n', ''),
    E'      and pm.captured_critical_identity_version=m.critical_identity_version\n', '');
  if v_new=v_def or v_new like '%identity_version%' or v_new like '%captured_profile_revision%' then
    raise exception 'fulfill_paid_checkout_session did not match the expected W07.2 definition';
  end if;
  execute v_new;
end $migration$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Invitation email: a placed guest has an `invited` admission and an unconfirmed Auth user until they first sign in
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.read_table_invitation_delivery_context(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb;
begin
  perform app_private.require_service_role();
  if p_invitation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  select jsonb_build_object('invitationId',i.invitation_id,'state',i.state,'recipientEmail',a.email_normalized,
      'table',jsonb_build_object('tableId',q.table_id,'title',q.table_title,'localDate',q.table_local_date::text,
        'startLocalTime',to_char(q.table_start_local_time,'HH24:MI'),'neighborhood',q.table_neighborhood))
    into v_context
    from public.app_table_invitations i
    join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id
      and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
    join public.app_member_profiles p on p.guest_id=i.guest_id and p.auth_user_id=i.auth_user_id
    join public.app_admissions a on a.id=p.admission_id and a.state in ('invited','activated')
    join auth.users u on u.id=i.auth_user_id and lower(u.email)=a.email_normalized
    where i.invitation_id=p_invitation_id;
  if v_context is null then raise exception using errcode='P0002',message='not_found'; end if;
  if v_context->>'state'<>'active' then raise exception using errcode='P0001',message='attempt_not_retryable'; end if;
  return v_context;
end $function$;

create or replace function public.read_unknown_table_invitation_delivery_context(p_invitation_id uuid,p_expected_attempt_count integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb;
begin
  perform app_private.require_service_role();
  if p_invitation_id is null or p_expected_attempt_count is null or p_expected_attempt_count<1 then
    raise exception using errcode='22023',message='invalid_input'; end if;
  select jsonb_build_object('invitationId',i.invitation_id,'state',i.state,'recipientEmail',a.email_normalized,
      'table',jsonb_build_object('title',q.table_title,'localDate',q.table_local_date::text,
        'startLocalTime',to_char(q.table_start_local_time,'HH24:MI'),'neighborhood',q.table_neighborhood),
      'attemptId',at.attempt_id,'attemptNumber',at.attempt_number,'providerMessageId',at.provider_message_id)
    into v_context
    from public.app_table_invitations i
    join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id
      and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
    join public.app_member_profiles p on p.guest_id=i.guest_id and p.auth_user_id=i.auth_user_id
    join public.app_admissions a on a.id=p.admission_id and a.state in ('invited','activated')
    join auth.users u on u.id=i.auth_user_id and lower(u.email)=a.email_normalized
    join public.app_table_invitation_outbox o on o.invitation_id=i.invitation_id and o.message_kind='invitation' and o.state='unknown'
    join public.app_table_invitation_attempts at on at.outbox_id=o.outbox_id and at.attempt_number=o.attempt_count and at.state='unknown'
    where i.invitation_id=p_invitation_id and at.attempt_number=p_expected_attempt_count;
  if v_context is null then raise exception using errcode='P0001',message='attempt_not_unknown'; end if;
  return v_context;
end $function$;

-- A placed guest may request a sign-in link before their first sign-in (their admission is still `invited`).
do $migration$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.claim_member_link_cooldown(uuid,timestamptz,integer)'::regprocedure) into v_def;
  v_new:=replace(v_def,'if v_state is distinct from ''activated'' then','if v_state is null or v_state not in (''invited'',''activated'') then');
  if v_new=v_def then raise exception 'claim_member_link_cooldown did not match the expected W03 definition'; end if;
  execute v_new;
end $migration$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Placement queue: real (non-test, not deleted) signups with no active invitation or live Seat on an active Table
-- ---------------------------------------------------------------------------------------------------------------------
create function app_private.signup_is_placed(p_signup_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists(
    select 1 from public.app_admissions a
    join public.app_member_profiles p on p.admission_id=a.id
    join public.app_table_invitations i on i.guest_id=p.guest_id
    join public.app_table_runtime rt on rt.table_id=i.table_id and rt.state in ('open','review_required','proceeding')
    where a.waitlist_signup_id=p_signup_id
      and (i.state='active' or exists(select 1 from public.app_seats s where s.invitation_id=i.invitation_id and s.state in ('confirmed','cancellation_requested'))))
$function$;

create function public.list_placement_queue(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  return jsonb_build_object(
    -- ponytail: first 500 by signup time; add paging when the queue is ever longer.
    'people',coalesce((select jsonb_agg(x.item order by x.received_at,x.id) from (
      select w.received_at,w.id,jsonb_build_object('signupId',w.id,'firstName',w.first_name,'lastName',w.last_name,'email',w.email_normalized,
        'age',extract(year from age(timezone('America/New_York',now())::date,w.birthdate))::integer,'birthdate',w.birthdate,
        'identity',w.identity,'openTo',to_jsonb(w.open_to),'matchAgeMin',w.match_age_min,'matchAgeMax',w.match_age_max,
        'neighborhood',w.neighborhood,'nights',to_jsonb(w.nights),'lookingFor',w.looking_for,'receivedAt',w.received_at) as item
      from public.waitlist_signups w
      where not w.is_test and w.email_normalized not like 'deleted+%'
        and not exists(select 1 from public.app_admissions a where a.waitlist_signup_id=w.id and a.state='deleted')
        and not app_private.signup_is_placed(w.id)
      order by w.received_at,w.id limit 500) x),'[]'::jsonb),
    'tables',coalesce((select jsonb_agg(t.item order by t.starts_at,t.table_id) from (
      select h.table_id,((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) as starts_at,
        jsonb_build_object('tableId',h.table_id,'title',r.content->>'title','localDate',r.content->>'localDate',
          'startLocalTime',r.content->>'startLocalTime','neighborhood',r.content->>'neighborhood','runtimeState',rt.state,
          'invitedCount',(select count(*) from public.app_table_invitations i where i.table_id=h.table_id and i.state='active')) as item
      from public.app_supply_table_heads h
      join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id and r.state='published'
      join public.app_table_runtime rt on rt.table_id=h.table_id and rt.state in ('open','review_required','proceeding')
      where h.lifecycle='published'
        and ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) > timezone('America/New_York',now())) t),'[]'::jsonb));
end $function$;

-- Admin adds one waitlisted person to one Table. Creates their admission and profile on first placement, then the request row,
-- the next approved roster revision, the invitation and its email in one transaction. The Auth user is created by the caller
-- (Supabase Admin API) and must match the signup email. Hard blocks: under 21 on the Table date, a full Table (5).
-- The other roster rules are warnings: the call fails with `placement_warnings` until p_acknowledge_warnings is true.
create function public.place_guest_at_table(p_actor uuid,p_signup_id uuid,p_table_id uuid,p_auth_user_id uuid,p_operation_id uuid,p_acknowledge_warnings boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text; v_prior public.app_ops_operations%rowtype; v_table jsonb; v_runtime text; v_signup public.waitlist_signups%rowtype;
  v_admission public.app_admissions%rowtype; v_profile public.app_member_profiles%rowtype; v_request public.app_table_requests%rowtype;
  v_old public.app_table_roster_proposals%rowtype; v_new public.app_table_roster_proposals%rowtype; v_active uuid[]; v_issues jsonb;
  v_invitation uuid; v_age integer; v_result jsonb;
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_signup_id is null or p_table_id is null or p_auth_user_id is null or p_operation_id is null then
    raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('signupId',p_signup_id,'tableId',p_table_id,'authUserId',p_auth_user_id,'ack',coalesce(p_acknowledge_warnings,false))::text);
  perform pg_advisory_xact_lock(hashtextextended('ops:'||p_operation_id::text,0));
  select * into v_prior from public.app_ops_operations where operation_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.action<>'place' or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;

  -- Lock order matches remove_and_replace: Table head, runtime, signup/admission/profile, invitations, roster.
  v_table:=app_private.roster_table_is_current(p_table_id,true);
  select state into v_runtime from public.app_table_runtime where table_id=p_table_id for update;
  if v_runtime is null or v_runtime not in ('open','review_required','proceeding') then raise exception using errcode='P0001',message='table_not_active'; end if;

  select * into v_signup from public.waitlist_signups where id=p_signup_id for update;
  if not found or v_signup.is_test or v_signup.email_normalized like 'deleted+%' then raise exception using errcode='P0002',message='not_found'; end if;
  if not exists(select 1 from auth.users u where u.id=p_auth_user_id and lower(u.email)=v_signup.email_normalized) then
    raise exception using errcode='P0001',message='auth_user_mismatch'; end if;

  select * into v_admission from public.app_admissions where waitlist_signup_id=p_signup_id for update;
  if not found then
    insert into public.app_admissions(waitlist_signup_id,email_normalized,state,approved_by)
      values(p_signup_id,v_signup.email_normalized,'invited',p_actor) returning * into v_admission;
    insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
      values('user',p_actor,'app.admission.invited','app_admission',v_admission.id,p_operation_id,'{}'::jsonb);
  elsif v_admission.state='deleted' then raise exception using errcode='P0002',message='not_found';
  elsif v_admission.auth_user_id is not null and v_admission.auth_user_id<>p_auth_user_id then raise exception using errcode='P0001',message='auth_user_mismatch';
  end if;

  select * into v_profile from public.app_member_profiles where admission_id=v_admission.id for update;
  if not found then
    insert into public.app_member_profiles(auth_user_id,admission_id,first_name,last_name,date_of_birth,identity,open_to,
      match_age_min,match_age_max,neighborhood,nights,looking_for,surprise_game)
    values(p_auth_user_id,v_admission.id,v_signup.first_name,v_signup.last_name,v_signup.birthdate,
      case v_signup.identity when 'Woman' then 'woman' when 'Man' then 'man' else 'non_binary' end,
      case when 'Women'=any(v_signup.open_to) then array['woman']::text[] else array[]::text[] end
        || case when 'Men'=any(v_signup.open_to) then array['man']::text[] else array[]::text[] end
        || case when 'Non-binary people'=any(v_signup.open_to) then array['non_binary']::text[] else array[]::text[] end,
      v_signup.match_age_min,v_signup.match_age_max,v_signup.neighborhood,v_signup.nights,v_signup.looking_for,v_signup.surprise_game)
    returning * into v_profile;
  elsif v_profile.auth_user_id<>p_auth_user_id then raise exception using errcode='P0001',message='auth_user_mismatch';
  end if;

  perform 1 from public.app_table_invitations where table_id=p_table_id and state='active' order by invitation_id for update;
  if exists(select 1 from public.app_table_invitations where table_id=p_table_id and auth_user_id=p_auth_user_id and state='active') then
    raise exception using errcode='P0001',message='already_invited'; end if;
  v_age:=extract(year from age((v_table->'content'->>'localDate')::date,v_profile.date_of_birth))::integer;
  if v_age<21 then raise exception using errcode='P0001',message='age_under_21'; end if;
  select coalesce(array_agg(guest_id),'{}'::uuid[]) into v_active from public.app_table_invitations where table_id=p_table_id and state='active';
  if cardinality(v_active)>=5 then raise exception using errcode='P0001',message='table_full'; end if;

  select coalesce(jsonb_agg(c),'[]'::jsonb) into v_issues
    from jsonb_array_elements_text(app_private.group_issues(p_table_id,v_active||v_profile.guest_id)->'issues') c
    where c not in ('select_three_to_five','age_under_21')
      and not (c='missing_mutual_open_connection' and cardinality(v_active)=0); -- the first guest at a Table has nobody to match yet
  if jsonb_array_length(v_issues)>0 and not coalesce(p_acknowledge_warnings,false) then
    raise exception using errcode='P0001',message='placement_warnings',detail=jsonb_build_object('issues',v_issues)::text;
  end if;

  select * into v_request from public.app_table_requests where auth_user_id=p_auth_user_id and table_id=p_table_id and state='pending' for update;
  if not found then
    insert into public.app_table_requests(table_id,guest_id,auth_user_id,table_title,table_local_date,table_start_local_time,table_neighborhood,state,placed_by)
      values(p_table_id,v_profile.guest_id,p_auth_user_id,v_table->'content'->>'title',(v_table->'content'->>'localDate')::date,
        (v_table->'content'->>'startLocalTime')::time,v_table->'content'->>'neighborhood','pending',p_actor) returning * into v_request;
  end if;

  select * into v_old from public.app_table_roster_proposals where table_id=p_table_id and state='approved' order by revision desc limit 1 for update;
  insert into public.app_table_roster_proposals(table_id,revision,state,supply_revision_id,validation,created_by,updated_by,submitted_by,approved_by,submitted_at,approved_at)
    values(p_table_id,coalesce((select max(revision) from public.app_table_roster_proposals where table_id=p_table_id),0)+1,'approved',
      (v_table->>'supplyRevisionId')::uuid,jsonb_build_object('warnings',v_issues),p_actor,p_actor,p_actor,p_actor,clock_timestamp(),clock_timestamp())
    returning * into v_new;
  if v_old.proposal_id is not null then
    insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision)
      select v_new.proposal_id,m.request_id,m.guest_id,m.captured_profile_revision
      from public.app_table_roster_proposal_members m where m.proposal_id=v_old.proposal_id and m.guest_id=any(v_active);
  end if;
  insert into public.app_table_roster_proposal_members(proposal_id,request_id,guest_id,captured_profile_revision)
    values(v_new.proposal_id,v_request.request_id,v_profile.guest_id,v_profile.profile_revision);
  update public.app_table_invitations set proposal_id=v_new.proposal_id where table_id=p_table_id and state='active';
  update public.app_checkout_attempts set proposal_revision=v_new.revision where state in ('creating','open','unknown','processing')
    and invitation_id in (select invitation_id from public.app_table_invitations where table_id=p_table_id and state='active');

  insert into public.app_table_invitations(table_id,guest_id,auth_user_id,source_request_id,proposal_id,approved_by)
    values(p_table_id,v_profile.guest_id,p_auth_user_id,v_request.request_id,v_new.proposal_id,p_actor) returning invitation_id into v_invitation;
  insert into public.app_table_invitation_outbox(invitation_id,operation_id) values(v_invitation,gen_random_uuid());
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,'table.invitation.queued','table_invitation',v_invitation,p_operation_id,'{}'::jsonb);
  update public.app_supply_table_heads set protected_by_activity=true,updated_at=now() where table_id=p_table_id;

  v_result:=jsonb_build_object('invitationId',v_invitation,'guestId',v_profile.guest_id,'tableId',p_table_id,'rosterRevision',v_new.revision,'warnings',v_issues);
  insert into public.app_ops_operations(operation_id,actor_user_id,action,request_hash,result) values(p_operation_id,p_actor,'place',v_hash,v_result);
  return v_result;
end $function$;

-- Host landing page (replaces the roster-proposal queue): upcoming Tables assigned to this host (every Table for an admin).
create function public.list_host_tables(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_admin boolean;
begin
  perform app_private.require_service_role();
  v_admin:=exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role='admin');
  if p_actor is null or not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null)
    or not (v_admin or exists(select 1 from public.app_user_roles r where r.user_id=p_actor and r.role='host')) then
    raise exception using errcode='42501',message='forbidden'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('tableId',h.table_id,'title',r.content->>'title','localDate',r.content->>'localDate',
      'startLocalTime',r.content->>'startLocalTime','neighborhood',r.content->>'neighborhood',
      'invitedCount',(select count(*) from public.app_table_invitations i where i.table_id=h.table_id and i.state='active'))
      order by r.content->>'localDate',r.content->>'startLocalTime',h.table_id)
    from public.app_supply_table_heads h
    join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id and r.state='published'
    where h.lifecycle='published'
      and ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York' > now()-interval '12 hours'
      and (v_admin or exists(select 1 from public.app_supply_table_assignments a where a.table_id=h.table_id and a.user_id=p_actor))),'[]'::jsonb));
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Overview and account deletion
-- ---------------------------------------------------------------------------------------------------------------------
do $migration$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.read_admin_overview(uuid)'::regprocedure) into v_def;
  v_new:=regexp_replace(v_def,
    '''waitlistAwaitingInvite'',.*?''rostersAwaitingApproval'',\(select count\(\*\) from public\.app_table_roster_proposals p where p\.state=''submitted''\),',
    '''waitlistAwaitingPlacement'',(select count(*) from public.waitlist_signups w where not w.is_test and w.email_normalized not like ''deleted+%'' and not app_private.signup_is_placed(w.id)
        and not exists(select 1 from public.app_admissions a where a.waitlist_signup_id=w.id and a.state=''deleted'')),', 's');
  if v_new=v_def or v_new like '%identity_status%' or v_new like '%rostersAwaitingApproval%' then
    raise exception 'read_admin_overview did not match the expected W10 definition';
  end if;
  execute v_new;
end $migration$;

do $migration$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.delete_member_account(uuid,uuid)'::regprocedure) into v_def;
  v_new:=replace(v_def,E'latest_correction_reason=null,\n    evidence_deleted_at=coalesce(evidence_deleted_at,clock_timestamp()),updated_at','updated_at');
  if v_new=v_def or v_new like '%evidence%' then raise exception 'delete_member_account did not match the expected W10 definition'; end if;
  execute v_new;
end $migration$;

do $$
declare v text;
begin
  foreach v in array array['public.list_placement_queue(uuid)','public.list_host_tables(uuid)','public.place_guest_at_table(uuid,uuid,uuid,uuid,uuid,boolean)',
    'public.save_member_profile(uuid,integer,uuid,text,text,date,text,text[],smallint,smallint,text,text[],text,text,text,text)',
    'public.remove_and_replace(uuid,uuid,uuid,integer,integer,uuid)',
    'public.read_table_invitation_delivery_context(uuid)','public.read_unknown_table_invitation_delivery_context(uuid,integer)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
    execute format('grant execute on function %s to service_role',v);
  end loop;
  foreach v in array array['app_private.signup_is_placed(uuid)','app_private.group_issues(uuid,uuid[])','app_private.checkout_invitation_context(uuid,uuid,boolean)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
    execute format('grant execute on function %s to service_role',v);
  end loop;
end $$;
