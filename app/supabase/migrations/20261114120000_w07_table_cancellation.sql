-- W07.6 full Table cancellation: one admin operation that closes the Table and records every remaining refund.
-- Additive: extends existing allowlists by appending, so earlier migrations' values are never dropped.

do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.app_audit_events'::regclass and conname='app_audit_events_action_check';
  if position('''table.cancelled''' in v_def)=0 then
    alter table public.app_audit_events drop constraint app_audit_events_action_check;
    execute 'alter table public.app_audit_events add constraint app_audit_events_action_check '
      || regexp_replace(v_def, '\]\)\)\)$', ', ''table.cancelled''::text]))) ');
  end if;
end $$;

alter table public.app_table_requests drop constraint app_table_requests_state_check;
alter table public.app_table_requests add constraint app_table_requests_state_check
  check (state in ('pending','withdrawn','declined','closed_by_table'));

alter table public.app_refund_obligations drop constraint app_refund_obligations_source_check;
alter table public.app_refund_obligations add constraint app_refund_obligations_source_check
  check (source in ('late_checkout_ineligible','cancellation','table_cancellation'));

create table public.app_table_cancel_operations (
  operation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{32}$'),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now()
);
alter table public.app_table_cancel_operations enable row level security;
revoke all on public.app_table_cancel_operations from public,anon,authenticated,service_role;
grant select,insert on public.app_table_cancel_operations to service_role;

create function public.cancel_table(p_actor uuid,p_table_id uuid,p_operation_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_hash text; v_prior public.app_table_cancel_operations%rowtype; v_runtime public.app_table_runtime%rowtype;
  v_reason text; v_requests integer; v_invitations integer; v_holds integer; v_seats integer; v_notes integer:=0;
  v_obligations integer:=0; v_total integer:=0; v_pay record; v_remaining integer; v_result jsonb; v_now timestamptz:=clock_timestamp();
begin
  perform app_private.require_cancellation_admin(p_actor);
  v_reason:=btrim(coalesce(p_reason,''));
  if p_table_id is null or p_operation_id is null or length(v_reason) not between 1 and 500 then
    raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('tableId',p_table_id,'reason',v_reason)::text);
  perform pg_advisory_xact_lock(hashtextextended('table-cancel:'||p_operation_id::text,0));
  select * into v_prior from public.app_table_cancel_operations where operation_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.request_hash<>v_hash then raise exception using errcode='23505',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  -- Table head first, as every capacity-changing transaction does, then the runtime row.
  perform 1 from public.app_supply_table_heads where table_id=p_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_runtime from public.app_table_runtime where table_id=p_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_runtime.state in ('cancelled','completed') then raise exception using errcode='P0001',message='table_not_cancellable'; end if;

  update public.app_table_runtime set state='cancelled',version=version+1,updated_at=v_now where table_id=p_table_id;
  update public.app_supply_table_heads set protected_by_activity=true,updated_at=v_now where table_id=p_table_id;

  update public.app_table_requests set state='closed_by_table' where table_id=p_table_id and state='pending';
  get diagnostics v_requests = row_count;
  update public.app_table_invitations set state='closed',closed_at=v_now where table_id=p_table_id and state='active';
  get diagnostics v_invitations = row_count;
  -- 'processing' checkouts are left alone: a payment that completes later is refunded by fulfillment (runtime is cancelled).
  update public.app_checkout_attempts set state='released' where table_id=p_table_id and state in ('creating','open','unknown');
  get diagnostics v_holds = row_count;

  -- Lock every payment for this Table in a stable order, then its obligations, before computing remainders.
  for v_pay in select p.payment_id,p.amount_cents,p.state from public.app_payments p
      join public.app_checkout_attempts x on x.attempt_id=p.attempt_id
      where x.table_id=p_table_id and p.state in ('verified_paid','refund_pending') order by p.payment_id for update of p loop
    perform 1 from public.app_refund_obligations where payment_id=v_pay.payment_id order by obligation_id for update;
    select v_pay.amount_cents-coalesce(sum(amount_cents),0)::integer into v_remaining
      from public.app_refund_obligations where payment_id=v_pay.payment_id;
    if v_remaining>0 then
      insert into public.app_refund_obligations(payment_id,source,amount_cents,currency,state)
        values(v_pay.payment_id,'table_cancellation',v_remaining,'USD','open');
      update public.app_payments set state='refund_pending' where payment_id=v_pay.payment_id;
      v_obligations:=v_obligations+1; v_total:=v_total+v_remaining;
    end if;
  end loop;

  -- Pending Seat cancellation requests resolve with the Table: approved, refund = what the Table cancellation now owes that payment.
  update public.app_seat_cancellation_requests cr set state='approved',version=2,decided_at=v_now,decided_by=p_actor,
      guest_safe_reason='This Table was cancelled, so your Seat was cancelled and any remaining payment will be refunded.',
      refund_cents=coalesce((select o.amount_cents from public.app_refund_obligations o join public.app_seats s on s.payment_id=o.payment_id
        where s.seat_id=cr.seat_id and o.source='table_cancellation'),0)
    where cr.state='pending' and cr.seat_id in (select seat_id from public.app_seats where table_id=p_table_id);
  get diagnostics v_notes = row_count;
  insert into public.app_seat_cancellation_notice_outbox(cancellation_request_id,notice_kind,state)
    select cancellation_request_id,'decision','queued' from public.app_seat_cancellation_requests cr
    where cr.decided_at=v_now and cr.seat_id in (select seat_id from public.app_seats where table_id=p_table_id)
    on conflict(cancellation_request_id,notice_kind) do nothing;

  update public.app_seats set state='cancelled',cancelled_at=v_now where table_id=p_table_id and state in ('confirmed','cancellation_requested');
  get diagnostics v_seats = row_count;

  v_result:=jsonb_build_object('tableId',p_table_id,'state','cancelled','closedRequests',v_requests,'closedInvitations',v_invitations,
    'releasedHolds',v_holds,'cancelledSeats',v_seats,'resolvedCancellationRequests',v_notes,'refundObligations',v_obligations,'refundTotalCents',v_total);
  insert into public.app_table_cancel_operations(operation_id,actor_user_id,table_id,request_hash,result)
    values(p_operation_id,p_actor,p_table_id,v_hash,v_result);
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,'table.cancelled','supply_table',p_table_id,p_operation_id,
      jsonb_build_object('tableId',p_table_id,'to_state','cancelled'));
  return v_result;
end
$function$;

revoke all on function public.cancel_table(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.cancel_table(uuid,uuid,uuid,text) to service_role;

comment on function public.cancel_table(uuid,uuid,uuid,text) is 'W07.6: admin-only, idempotent Table cancellation. Records only each payment''s uncovered remainder so retries and earlier partial refunds cannot over-refund.';
