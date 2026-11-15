-- W10.1/W10.3/W10.4: worker heartbeat, admin overview counts, retention jobs, conduct-report deletion review, account deletion procedure.
-- All functions are service-role only; admin RPCs re-check the actor.

do $$
declare v_def text; v_add text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.app_audit_events'::regclass and conname='app_audit_events_action_check';
  foreach v_add in array array['account.deleted','conduct.report.deleted'] loop
    if position(quote_literal(v_add) in v_def)=0 then
      v_def:=regexp_replace(v_def, '\]\)\)\)\s*$', ', '||quote_literal(v_add)||'::text]))) ');
    end if;
  end loop;
  alter table public.app_audit_events drop constraint app_audit_events_action_check;
  execute 'alter table public.app_audit_events add constraint app_audit_events_action_check '||v_def;
end $$;

alter table public.app_ratings add column anonymized_at timestamptz;

create table public.app_worker_heartbeats (
  name text primary key check (name = 'worker'),
  last_run_at timestamptz not null,
  last_ok_at timestamptz,
  last_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(last_summary)='object' and length(last_summary::text) <= 2000)
);
alter table public.app_worker_heartbeats enable row level security;
revoke all on public.app_worker_heartbeats from public,anon,authenticated,service_role;

create function public.record_worker_heartbeat(p_ok boolean,p_summary jsonb)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  insert into public.app_worker_heartbeats(name,last_run_at,last_ok_at,last_summary)
    values('worker',clock_timestamp(),case when p_ok then clock_timestamp() end,case when jsonb_typeof(coalesce(p_summary,'{}'::jsonb))='object' and length(coalesce(p_summary,'{}'::jsonb)::text)<=2000 then coalesce(p_summary,'{}'::jsonb) else '{}'::jsonb end)
    on conflict (name) do update set last_run_at=excluded.last_run_at,
      last_ok_at=case when p_ok then excluded.last_run_at else public.app_worker_heartbeats.last_ok_at end,last_summary=excluded.last_summary;
end $function$;

-- One read of everything an admin should act on. Counts and ages only: no names, bodies, ballots or evidence.
create function public.read_admin_overview(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_hb public.app_worker_heartbeats%rowtype; v_queue jsonb; v_out jsonb;
begin
  perform app_private.require_staff(p_actor,'admin');
  select * into v_hb from public.app_worker_heartbeats where name='worker';
  v_queue:=public.read_table_decision_queue(p_actor)->'items';
  select jsonb_build_object(
    'waitlistAwaitingInvite',(select count(*) from public.waitlist_signups w where not exists(select 1 from public.app_admissions a where a.waitlist_signup_id=w.id)),
    'admissionDeliveryProblems',(select count(*) from public.app_invitation_deliveries d where d.state in ('failed','unknown')),
    'identityReviews',(select count(*) from public.app_member_profiles p where p.identity_status='submitted'),
    'seatRequests',(select count(*) from public.app_table_requests q where q.state='pending'
        and not exists(select 1 from public.app_table_invitations i where i.table_id=q.table_id and i.auth_user_id=q.auth_user_id and i.state='active')),
    'rostersAwaitingApproval',(select count(*) from public.app_table_roster_proposals p where p.state='submitted'),
    'decisionsNeeded',(select count(*) from jsonb_array_elements(v_queue) i where i->>'status'='needs_decision'),
    'decisionsSuspended',(select count(*) from jsonb_array_elements(v_queue) i where i->>'status'='suspended'),
    'cancellationsPending',(select count(*) from public.app_seat_cancellation_requests where state='pending'),
    'cancellationsFlagged',(select count(*) from public.app_seat_cancellation_requests where state='pending' and host_flagged_at is not null),
    'refundsOpen',(select count(*) from public.app_refund_obligations where state<>'succeeded'),
    'refundsNeedingAttention',(select count(*) from public.app_refund_operations where state in ('unknown','failed')),
    'paymentsUnaccounted',(select count(*) from public.app_payments p join public.app_checkout_attempts x on x.attempt_id=p.attempt_id
        where p.state='verified_paid' and not exists(select 1 from public.app_seats s where s.invitation_id=x.invitation_id)
          and not exists(select 1 from public.app_refund_obligations o where o.payment_id=p.payment_id)),
    'tableInvitationDeliveryProblems',(select count(*) from public.app_table_invitation_outbox o join public.app_table_invitations i on i.invitation_id=o.invitation_id
        where o.state in ('failed','unknown') and i.state='active'),
    'oldestPendingDeliveryMinutes',(select floor(extract(epoch from (clock_timestamp()-min(o.queued_at)))/60)::integer from public.app_table_invitation_outbox o where o.state in ('queued','sending')),
    'conductReportsNew',(select count(*) from public.app_conduct_reports where status='new'),
    'conductReportsReviewDue',(select count(*) from public.app_conduct_reports where created_at<=clock_timestamp()-interval '12 months' and not held),
    'supplyNeedsAttention',(select count(*) from public.app_supply_table_heads where sync_state<>'current'),
    'unstaffedWithinSevenDays',(select count(*) from public.app_supply_table_heads h
        join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id join public.app_table_runtime rt on rt.table_id=h.table_id
        where rt.state in ('open','review_required','proceeding')
          and ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York' between now() and now()+interval '7 days'
          and not exists(select 1 from public.app_supply_table_assignments a where a.table_id=h.table_id)),
    'noticeProblems',(select count(*) from public.app_notice_outbox where state in ('failed','unknown')),
    'votesNotFinalized',(select count(*) from public.app_vote_periods where finalized_at is null and closes_at<clock_timestamp()-interval '1 day')
  ) into v_out;
  return jsonb_build_object('generatedAt',clock_timestamp(),
    'heartbeat',jsonb_build_object('lastRunAt',v_hb.last_run_at,'lastOkAt',v_hb.last_ok_at,
      'ageMinutes',case when v_hb.last_run_at is null then null else floor(extract(epoch from (clock_timestamp()-v_hb.last_run_at))/60)::integer end,
      'healthy',v_hb.last_run_at is not null and clock_timestamp()-v_hb.last_run_at<=interval '10 minutes' and v_hb.last_ok_at is not null and clock_timestamp()-v_hb.last_ok_at<=interval '30 minutes'),
    'counts',v_out);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Retention: ratings lose identifiers after 90 days and are deleted at 12 months; audit is kept 90 days.
-- Conduct reports are never deleted automatically (admin review at 12 months, blocked by a hold).
-- ---------------------------------------------------------------------------------------------------------------------
create function public.run_retention()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_anon integer; v_rat integer; v_audit integer;
begin
  perform app_private.require_service_role();
  update public.app_ratings r set guest_id=gen_random_uuid(),anonymized_at=clock_timestamp()
    where r.anonymized_at is null and app_private.table_start(r.table_id)+interval '90 days'<=clock_timestamp();
  get diagnostics v_anon=row_count;
  delete from public.app_ratings r where app_private.table_start(r.table_id)+interval '12 months'<=clock_timestamp();
  get diagnostics v_rat=row_count;
  delete from public.app_audit_events where occurred_at<clock_timestamp()-interval '90 days';
  get diagnostics v_audit=row_count;
  return jsonb_build_object('ratingsAnonymized',v_anon,'ratingsDeleted',v_rat,'auditDeleted',v_audit);
end $function$;

create function public.delete_conduct_report(p_actor uuid,p_report_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.app_conduct_reports%rowtype;
begin
  perform app_private.require_staff(p_actor,'admin');
  select * into v_row from public.app_conduct_reports where report_id=p_report_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_row.held then raise exception using errcode='P0001',message='case_held'; end if;
  if v_row.created_at>clock_timestamp()-interval '12 months' then raise exception using errcode='P0001',message='review_not_due'; end if;
  delete from public.app_conduct_reports where report_id=p_report_id;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'conduct.report.deleted','supply_table',v_row.table_id,jsonb_build_object('tableId',v_row.table_id));
  return jsonb_build_object('reportId',p_report_id,'deleted',true);
end $function$;

-- Support procedure: ends sign-in authority and pseudonymises the person. Refuses while a live paid Seat exists
-- (staff remove it first, with its refund decision). Money rows, held cases and other guests' records keep their ids.
create function public.delete_member_account(p_actor uuid,p_guest_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_profile public.app_member_profiles%rowtype; v_admission public.app_admissions%rowtype; v_tag text;
begin
  perform app_private.require_staff(p_actor,'admin');
  select * into v_profile from public.app_member_profiles where guest_id=p_guest_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_admission from public.app_admissions where id=v_profile.admission_id for update;
  if v_admission.state='deleted' then return jsonb_build_object('guestId',p_guest_id,'deleted',true,'alreadyDeleted',true); end if;
  if exists(select 1 from public.app_seats s join public.app_table_runtime rt on rt.table_id=s.table_id
      where s.guest_id=p_guest_id and s.state in ('confirmed','cancellation_requested') and rt.state in ('open','review_required','proceeding')) then
    raise exception using errcode='P0001',message='active_seat_exists'; end if;
  if exists(select 1 from public.app_user_roles r where r.user_id=v_profile.auth_user_id) then raise exception using errcode='P0001',message='staff_account'; end if;
  v_tag:=replace(p_guest_id::text,'-','');
  update public.app_table_requests set state='withdrawn' where auth_user_id=v_profile.auth_user_id and state='pending';
  update public.app_table_invitations set state='revoked',revoked_at=clock_timestamp() where auth_user_id=v_profile.auth_user_id and state='active';
  update public.app_checkout_attempts set state='released' where auth_user_id=v_profile.auth_user_id and state in ('creating','open','unknown');
  update public.app_ballot_eligibility set invalidated_at=clock_timestamp() where guest_id=p_guest_id and invalidated_at is null;
  update public.app_mutual_results set invalidated_at=clock_timestamp() where (guest_id=p_guest_id or counterpart_guest_id=p_guest_id) and invalidated_at is null;
  update public.waitlist_signups set email_normalized='deleted+'||v_tag||'@deleted.invalid',first_name='Deleted',last_name='Member',birthdate='1990-01-01' where id=v_admission.waitlist_signup_id;
  update public.app_admissions set state='deleted',deleted_at=clock_timestamp(),activated_at=null,auth_user_id=null,updated_at=clock_timestamp() where id=v_admission.id;
  update public.app_member_profiles set first_name='Deleted',last_name='Member',date_of_birth='1990-01-01',phone=null,one_liner=null,latest_correction_reason=null,
    evidence_deleted_at=coalesce(evidence_deleted_at,clock_timestamp()),updated_at=clock_timestamp() where guest_id=p_guest_id;
  update auth.users set email='deleted+'||v_tag||'@deleted.invalid',encrypted_password='',banned_until='infinity',raw_user_meta_data='{}'::jsonb,updated_at=clock_timestamp() where id=v_profile.auth_user_id;
  delete from auth.refresh_tokens where user_id=v_profile.auth_user_id::text;
  delete from auth.sessions where user_id=v_profile.auth_user_id;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'account.deleted','auth_identity',v_profile.auth_user_id,jsonb_build_object('guest_id',p_guest_id));
  return jsonb_build_object('guestId',p_guest_id,'deleted',true,'alreadyDeleted',false);
end $function$;

do $$
declare v text;
begin
  foreach v in array array['public.record_worker_heartbeat(boolean,jsonb)','public.read_admin_overview(uuid)','public.run_retention()',
    'public.delete_conduct_report(uuid,uuid)','public.delete_member_account(uuid,uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
    execute format('grant execute on function %s to service_role',v);
  end loop;
end $$;
