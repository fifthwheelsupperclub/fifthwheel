-- W07.5 refund operations and worker. Draft only: dependent W07.2/W07.4 migrations
-- and the provider/browser acceptance work must be reviewed before local apply.

alter table public.app_refund_obligations
  add constraint app_refund_obligations_payment_pair_uq unique(payment_id,obligation_id);

create table public.app_refund_operations (
  operation_id uuid primary key,
  obligation_id uuid not null unique,
  payment_id uuid not null,
  provider_mode text not null check(provider_mode in ('test','live')),
  provider_account_id text not null default '' check(length(provider_account_id)<=255),
  provider_refund_id text,
  amount_cents integer not null check(amount_cents between 1 and 2500),
  currency text not null default 'USD' check(currency='USD'),
  state text not null default 'pending' check(state in ('pending','submitted','unknown','failed','succeeded')),
  safe_code text check(safe_code is null or safe_code in ('provider_pending','provider_failed','provider_unknown','provider_unavailable','provider_rejected','payment_mismatch')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(payment_id,obligation_id) references public.app_refund_obligations(payment_id,obligation_id) on delete restrict,
  check(provider_refund_id is null or provider_refund_id ~ '^re_[A-Za-z0-9]+$')
);
create unique index app_refund_operations_provider_id_uq
  on public.app_refund_operations(provider_mode,provider_account_id,provider_refund_id) where provider_refund_id is not null;
create index app_refund_operations_payment_idx on public.app_refund_operations(payment_id,created_at,operation_id);

create function app_private.guard_refund_obligation_balance()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_payment public.app_payments%rowtype; v_total integer;
begin
  perform app_private.require_service_role();
  select * into v_payment from public.app_payments where payment_id=new.payment_id for update;
  if not found or v_payment.state not in ('verified_paid','refund_pending','refunded') or new.currency<>'USD'
    or new.amount_cents<1 or new.amount_cents>v_payment.amount_cents then
    raise exception using errcode='P0001',message='balance_exhausted';
  end if;
  select coalesce(sum(o.amount_cents),0)::integer into v_total from public.app_refund_obligations o
    where o.payment_id=new.payment_id and o.obligation_id<>new.obligation_id;
  if v_total+new.amount_cents>v_payment.amount_cents then raise exception using errcode='P0001',message='balance_exhausted'; end if;
  return new;
end
$function$;
create trigger app_refund_obligation_balance_guard before insert or update of payment_id,amount_cents,currency
on public.app_refund_obligations for each row execute function app_private.guard_refund_obligation_balance();

create function app_private.guard_refund_operation_allocation()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_obligation public.app_refund_obligations%rowtype; v_payment public.app_payments%rowtype;
begin
  perform app_private.require_service_role();
  select * into v_payment from public.app_payments where payment_id=new.payment_id for update;
  select * into v_obligation from public.app_refund_obligations where obligation_id=new.obligation_id and payment_id=new.payment_id for update;
  if not found or new.amount_cents<>v_obligation.amount_cents or new.currency<>v_payment.currency
    or new.provider_mode<>v_payment.provider_mode or v_payment.state not in ('verified_paid','refund_pending','refunded') then
    raise exception using errcode='P0001',message='balance_exhausted';
  end if;
  if tg_op='UPDATE' and (new.operation_id<>old.operation_id or new.obligation_id<>old.obligation_id or new.payment_id<>old.payment_id
    or new.provider_mode<>old.provider_mode or new.provider_account_id<>old.provider_account_id or new.amount_cents<>old.amount_cents
    or new.currency<>old.currency or new.created_by<>old.created_by or (old.provider_refund_id is not null and new.provider_refund_id<>old.provider_refund_id)) then
    raise exception using errcode='P0001',message='refund_allocation_immutable';
  end if;
  return new;
end
$function$;
create trigger app_refund_operation_allocation_guard before insert or update on public.app_refund_operations
for each row execute function app_private.guard_refund_operation_allocation();

create table public.app_refund_action_operations (
  request_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check(action in ('dispatch','retry','reconcile')),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{32}$'),
  refund_operation_id uuid not null references public.app_refund_operations(operation_id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table public.app_refund_work_items (
  job_id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.app_refund_action_operations(request_id) on delete restrict,
  operation_id uuid not null references public.app_refund_operations(operation_id) on delete restrict,
  action text not null check(action in ('dispatch','reconcile')),
  state text not null default 'queued' check(state in ('queued','leased','completed')),
  attempts integer not null default 0 check(attempts>=0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((state='leased')=(lease_token is not null and lease_until is not null))
);
create index app_refund_work_items_recovery_idx on public.app_refund_work_items(state,available_at,created_at)
  where state in ('queued','leased');

alter table public.app_refund_operations enable row level security;
alter table public.app_refund_action_operations enable row level security;
alter table public.app_refund_work_items enable row level security;
revoke all on public.app_refund_operations,public.app_refund_action_operations,public.app_refund_work_items from public,anon,authenticated,service_role;
grant select,insert,update on public.app_refund_operations to service_role;
grant select,insert on public.app_refund_action_operations to service_role;
grant select,insert,update on public.app_refund_work_items to service_role;

create function app_private.require_refund_admin(p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  if p_actor is null or not exists(select 1 from auth.users u join public.app_user_roles r on r.user_id=u.id and r.role='admin'
    where u.id=p_actor and u.email_confirmed_at is not null) then
    raise exception using errcode='42501',message='admin_required';
  end if;
end
$function$;

create function app_private.refund_summary(p_obligation_id uuid,p_provider_available boolean)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'obligationId',o.obligation_id,'source',o.source,'state',o.state,'amountCents',o.amount_cents,'currency',o.currency,
    'createdAt',o.created_at,'updatedAt',o.updated_at,'memberName',coalesce(nullif(concat_ws(' ',m.first_name,m.last_name),''),'Former member'),
    'tableTitle',coalesce(nullif(r.content->>'title',''),'Table details unavailable'),'reservedCents',balances.reserved_cents,'availableCents',balances.available_cents,
    'latestSafeCode',op.safe_code,'canDispatch',o.state='open' and op.operation_id is null and p_provider_available and balances.available_cents>=o.amount_cents,
    'dispatchBlockedReason',case when o.state='succeeded' or op.state='succeeded' then 'settled'
      when op.state='failed' then 'manual_review' when not p_provider_available then 'provider_unavailable'
      when op.state in ('pending','submitted','unknown') then 'operation_in_progress' when op.operation_id is not null then 'manual_review'
      when o.state<>'open' then 'manual_review'
      when balances.available_cents<o.amount_cents then 'balance_reserved' else null end)
  from public.app_refund_obligations o
  join public.app_payments p on p.payment_id=o.payment_id
  join public.app_checkout_attempts ca on ca.attempt_id=p.attempt_id
  left join public.app_member_profiles m on m.guest_id=ca.guest_id and m.auth_user_id=ca.auth_user_id
  left join public.app_supply_table_revisions r on r.revision_id=ca.supply_revision_id and r.table_id=ca.table_id
  left join public.app_refund_operations op on op.obligation_id=o.obligation_id
  cross join lateral (
    select coalesce((select sum(x.amount_cents) from public.app_refund_obligations x
        where x.payment_id=p.payment_id and x.state<>'succeeded'),0)::integer reserved_cents,
      greatest(0,least(o.amount_cents-coalesce((select sum(ro.amount_cents) from public.app_refund_operations ro
          where ro.obligation_id=o.obligation_id and ro.state='succeeded'),0),
        p.amount_cents-coalesce((select sum(ro.amount_cents) from public.app_refund_operations ro
          where ro.payment_id=p.payment_id and ro.state='succeeded'),0)-coalesce((select sum(x.amount_cents) from public.app_refund_obligations x
          where x.payment_id=p.payment_id and x.obligation_id<>o.obligation_id and x.state<>'succeeded'),0)))::integer available_cents
  ) balances
  where o.obligation_id=p_obligation_id
$function$;

create function app_private.refund_detail(p_obligation_id uuid,p_provider_available boolean)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select app_private.refund_summary(o.obligation_id,p_provider_available) || jsonb_build_object(
    'paymentAmountCents',p.amount_cents,
    'refundedCents',coalesce((select sum(amount_cents)::integer from public.app_refund_operations where payment_id=p.payment_id and state='succeeded'),0),
    'operations',coalesce((select jsonb_agg(jsonb_build_object('operationId',x.operation_id,'amountCents',x.amount_cents,'state',x.state,
      'createdAt',x.created_at,'updatedAt',x.updated_at,'safeCode',x.safe_code,
      'canRetry',p_provider_available and x.state in ('unknown','failed') and x.provider_refund_id is null and x.safe_code is distinct from 'payment_mismatch',
      'canReconcile',p_provider_available and x.provider_refund_id is not null and x.state in ('submitted','unknown','failed'))
      order by x.created_at desc,x.operation_id desc) from public.app_refund_operations x where x.obligation_id=o.obligation_id),'[]'::jsonb))
  from public.app_refund_obligations o join public.app_payments p on p.payment_id=o.payment_id
  where o.obligation_id=p_obligation_id
$function$;

create function public.list_admin_refunds(p_actor uuid,p_cursor_created_at timestamptz,p_cursor_obligation_id uuid,p_limit integer,p_provider_available boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb; v_next text; v_last_created timestamptz; v_last_id uuid; v_has_more boolean;
begin
  perform app_private.require_refund_admin(p_actor);
  if p_limit is null or p_limit not between 1 and 50 or p_provider_available is null or ((p_cursor_created_at is null)<>(p_cursor_obligation_id is null)) then
    raise exception using errcode='22023',message='invalid_input'; end if;
  with page as (
    select o.obligation_id,o.created_at,row_number() over(order by o.created_at desc,o.obligation_id desc) rn
    from public.app_refund_obligations o
    where p_cursor_created_at is null or (o.created_at,o.obligation_id)<(p_cursor_created_at,p_cursor_obligation_id)
    order by o.created_at desc,o.obligation_id desc limit p_limit+1
  ), rows as (select * from page where rn<=p_limit)
  select coalesce(jsonb_agg(app_private.refund_summary(obligation_id,p_provider_available) order by created_at desc,obligation_id desc),'[]'::jsonb),
    (select created_at from rows order by created_at asc,obligation_id asc limit 1 offset p_limit-1),
    (select obligation_id from rows order by created_at asc,obligation_id asc limit 1 offset p_limit-1),
    (select count(*)>p_limit from page)
  into v_items,v_last_created,v_last_id,v_has_more from rows;
  if v_has_more then v_next:=replace(translate(encode(convert_to(jsonb_build_object('createdAt',v_last_created,'obligationId',v_last_id)::text,'UTF8'),'base64'),'+/=','-_'),E'\n',''); end if;
  return jsonb_build_object('items',v_items,'nextCursor',v_next);
end
$function$;

create function public.read_admin_refund(p_actor uuid,p_obligation_id uuid,p_provider_available boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_refund_admin(p_actor);
  if p_obligation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  if not exists(select 1 from public.app_refund_obligations where obligation_id=p_obligation_id) then raise exception using errcode='P0002',message='not_found'; end if;
  return app_private.refund_detail(p_obligation_id,p_provider_available);
end
$function$;

create function app_private.refund_action_result(p_operation_id uuid,p_provider_available boolean)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object('operation',jsonb_build_object('operationId',op.operation_id,'amountCents',op.amount_cents,'state',op.state,
    'createdAt',op.created_at,'updatedAt',op.updated_at,'safeCode',op.safe_code,
    'canRetry',p_provider_available and op.state in ('unknown','failed') and op.provider_refund_id is null and op.safe_code is distinct from 'payment_mismatch',
    'canReconcile',p_provider_available and op.provider_refund_id is not null and op.state in ('submitted','unknown','failed')),
    'obligation',app_private.refund_summary(op.obligation_id,p_provider_available))
  from public.app_refund_operations op where op.operation_id=p_operation_id
$function$;

create function public.queue_refund_dispatch(p_actor uuid,p_obligation_id uuid,p_operation_id uuid,p_provider_available boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_obligation public.app_refund_obligations%rowtype; v_payment public.app_payments%rowtype; v_prior public.app_refund_action_operations%rowtype;
  v_hash text; v_result jsonb; v_committed integer;
begin
  perform app_private.require_refund_admin(p_actor);
  if p_obligation_id is null or p_operation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('action','dispatch','obligationId',p_obligation_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('refund-request:'||p_operation_id::text,0));
  select * into v_prior from public.app_refund_action_operations where request_id=p_operation_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.action<>'dispatch' or v_prior.request_hash<>v_hash then raise exception using errcode='P0001',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  select * into v_obligation from public.app_refund_obligations where obligation_id=p_obligation_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_payment from public.app_payments where payment_id=v_obligation.payment_id for update;
  perform 1 from public.app_refund_obligations where payment_id=v_payment.payment_id order by obligation_id for update;
  perform 1 from public.app_refund_operations where payment_id=v_payment.payment_id order by operation_id for update;
  select coalesce(sum(amount_cents),0)::integer into v_committed from public.app_refund_obligations where payment_id=v_payment.payment_id;
  if not p_provider_available then raise exception using errcode='P0001',message='provider_unavailable'; end if;
  if v_payment.state not in ('verified_paid','refund_pending') or v_payment.currency<>'USD' or v_committed>v_payment.amount_cents then
    raise exception using errcode='P0001',message='balance_exhausted'; end if;
  if exists(select 1 from public.app_refund_operations where obligation_id=p_obligation_id) or v_obligation.state<>'open' then
    raise exception using errcode='P0001',message='conflict'; end if;
  insert into public.app_refund_operations(operation_id,obligation_id,payment_id,provider_mode,provider_account_id,amount_cents,currency,created_by)
    values(p_operation_id,p_obligation_id,v_payment.payment_id,v_payment.provider_mode,'',v_obligation.amount_cents,'USD',p_actor);
  update public.app_refund_obligations set state='pending',updated_at=clock_timestamp() where obligation_id=p_obligation_id returning * into v_obligation;
  insert into public.app_refund_action_operations(request_id,actor_user_id,action,request_hash,refund_operation_id,result)
    values(p_operation_id,p_actor,'dispatch',v_hash,p_operation_id,'{}'::jsonb);
  insert into public.app_refund_work_items(request_id,operation_id,action) values(p_operation_id,p_operation_id,'dispatch');
  v_result:=app_private.refund_action_result(p_operation_id,p_provider_available);
  update public.app_refund_action_operations set result=v_result where request_id=p_operation_id;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,'refund.dispatch.queued','refund_obligation',p_obligation_id,p_operation_id,
      jsonb_build_object('refund_cents',v_obligation.amount_cents,'from_state','open','to_state','pending'));
  return v_result;
end
$function$;

create function app_private.queue_refund_followup(p_actor uuid,p_operation_id uuid,p_request_id uuid,p_action text,p_provider_available boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_operation public.app_refund_operations%rowtype; v_payment public.app_payments%rowtype; v_prior public.app_refund_action_operations%rowtype;
  v_hash text; v_result jsonb; v_work_action text;
begin
  perform app_private.require_refund_admin(p_actor);
  if p_operation_id is null or p_request_id is null or p_action not in ('retry','reconcile') then raise exception using errcode='22023',message='invalid_input'; end if;
  v_hash:=md5(jsonb_build_object('action',p_action,'operationId',p_operation_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('refund-request:'||p_request_id::text,0));
  select * into v_prior from public.app_refund_action_operations where request_id=p_request_id;
  if found then
    if v_prior.actor_user_id<>p_actor or v_prior.action<>p_action or v_prior.request_hash<>v_hash then raise exception using errcode='P0001',message='operation_conflict'; end if;
    return v_prior.result;
  end if;
  select * into v_operation from public.app_refund_operations where operation_id=p_operation_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select * into v_payment from public.app_payments where payment_id=v_operation.payment_id for update;
  perform 1 from public.app_refund_obligations where payment_id=v_payment.payment_id order by obligation_id for update;
  select * into v_operation from public.app_refund_operations where operation_id=p_operation_id for update;
  if not p_provider_available then raise exception using errcode='P0001',message='provider_unavailable'; end if;
  if p_action='retry' then
    if v_operation.state not in ('unknown','failed') or v_operation.provider_refund_id is not null then raise exception using errcode='P0001',message='not_retryable'; end if;
    update public.app_refund_operations set state='pending',safe_code=null,updated_at=clock_timestamp() where operation_id=p_operation_id returning * into v_operation;
    update public.app_refund_obligations set state='pending',updated_at=clock_timestamp() where obligation_id=v_operation.obligation_id;
    v_work_action:='dispatch';
  else
    if v_operation.provider_refund_id is null or v_operation.state not in ('submitted','unknown','failed') then raise exception using errcode='P0001',message='not_reconcilable'; end if;
    v_work_action:='reconcile';
  end if;
  insert into public.app_refund_action_operations(request_id,actor_user_id,action,request_hash,refund_operation_id,result)
    values(p_request_id,p_actor,p_action,v_hash,p_operation_id,'{}'::jsonb);
  insert into public.app_refund_work_items(request_id,operation_id,action) values(p_request_id,p_operation_id,v_work_action);
  v_result:=app_private.refund_action_result(p_operation_id,p_provider_available);
  update public.app_refund_action_operations set result=v_result where request_id=p_request_id;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,operation_id,metadata)
    values('user',p_actor,case p_action when 'retry' then 'refund.retry.queued' else 'refund.reconcile.queued' end,
      'refund_obligation',v_operation.obligation_id,p_request_id,jsonb_build_object('target_operation_id',p_operation_id,'state',v_operation.state));
  return v_result;
end
$function$;

create function public.queue_refund_retry(p_actor uuid,p_operation_id uuid,p_request_id uuid,p_provider_available boolean)
returns jsonb language sql security definer set search_path = '' as $function$
  select app_private.queue_refund_followup(p_actor,p_operation_id,p_request_id,'retry',p_provider_available)
$function$;
create function public.queue_refund_reconcile(p_actor uuid,p_operation_id uuid,p_request_id uuid,p_provider_available boolean)
returns jsonb language sql security definer set search_path = '' as $function$
  select app_private.queue_refund_followup(p_actor,p_operation_id,p_request_id,'reconcile',p_provider_available)
$function$;

create function public.claim_refund_work(p_worker_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb;
begin
  perform app_private.require_service_role();
  if p_worker_id is null or p_limit is null or p_limit not between 1 and 20 then raise exception using errcode='22023',message='invalid_input'; end if;
  with candidates as (
    select w.job_id from public.app_refund_work_items w where w.available_at<=clock_timestamp()
      and (w.state='queued' or w.state='leased' and w.lease_until<clock_timestamp())
    order by w.available_at,w.created_at for update skip locked limit p_limit
  ), claimed as (
    update public.app_refund_work_items w set state='leased',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',
      attempts=attempts+1,updated_at=clock_timestamp() from candidates c where w.job_id=c.job_id returning w.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('jobId',w.job_id,'leaseToken',w.lease_token,'operationId',op.operation_id,
    'action',w.action,'mode',op.provider_mode,'providerAccountId',op.provider_account_id,'providerPaymentIntentId',p.provider_payment_id,
    'providerRefundId',op.provider_refund_id,'amountCents',op.amount_cents,'currency',op.currency)
    order by w.created_at,w.job_id),'[]'::jsonb)
  into v_items from claimed w join public.app_refund_operations op on op.operation_id=w.operation_id
    join public.app_payments p on p.payment_id=op.payment_id;
  return v_items;
end
$function$;

create function public.finish_refund_work(p_job_id uuid,p_lease_token uuid,p_outcome text,p_safe_code text,
  p_refund_id text,p_mode text,p_account_id text,p_payment_intent_id text,p_amount_cents integer,p_currency text,p_provider_status text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_work public.app_refund_work_items%rowtype; v_op public.app_refund_operations%rowtype; v_payment public.app_payments%rowtype;
  v_state text; v_obligation_state text; v_mismatch boolean:=false;
begin
  perform app_private.require_service_role();
  if p_job_id is null or p_lease_token is null or p_outcome not in ('pending','succeeded','failed','unknown')
    or (p_safe_code is not null and p_safe_code not in ('provider_pending','provider_failed','provider_unknown','provider_unavailable','provider_rejected','payment_mismatch')) then
    raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v_work from public.app_refund_work_items where job_id=p_job_id and state='leased' and lease_token=p_lease_token for update;
  if not found then raise exception using errcode='P0002',message='lease_not_found'; end if;
  select * into v_op from public.app_refund_operations where operation_id=v_work.operation_id;
  select * into v_payment from public.app_payments where payment_id=v_op.payment_id for update;
  perform 1 from public.app_refund_obligations where payment_id=v_payment.payment_id order by obligation_id for update;
  select * into v_op from public.app_refund_operations where operation_id=v_work.operation_id for update;
  if (p_outcome in ('pending','succeeded') and p_refund_id is null)
    or (p_outcome='unknown' and p_refund_id is not null)
    or (p_refund_id is null and p_provider_status is not null)
    or (p_outcome='failed' and p_refund_id is null and p_safe_code<>'provider_rejected') then v_mismatch:=true; end if;
  if p_refund_id is not null then
    if p_refund_id !~ '^re_[A-Za-z0-9]+$' or p_mode is distinct from v_op.provider_mode or p_account_id is distinct from v_op.provider_account_id
      or p_payment_intent_id is distinct from v_payment.provider_payment_id or p_amount_cents is distinct from v_op.amount_cents
      or lower(p_currency) is distinct from lower(v_op.currency)
      or p_provider_status not in ('pending','requires_action','succeeded','failed','canceled')
      or (p_outcome='succeeded' and p_provider_status<>'succeeded')
      or (p_outcome='pending' and p_provider_status not in ('pending','requires_action'))
      or (p_outcome='failed' and p_provider_status not in ('failed','canceled')) then
      v_mismatch:=true;
    else
      update public.app_refund_operations set provider_refund_id=coalesce(provider_refund_id,p_refund_id) where operation_id=v_op.operation_id;
    end if;
  end if;
  if v_mismatch then v_state:='unknown'; p_safe_code:='payment_mismatch';
  else v_state:=case when p_outcome='pending' then 'submitted' when p_outcome in ('failed','succeeded','unknown') then p_outcome end; end if;
  update public.app_refund_operations set state=v_state,safe_code=p_safe_code,updated_at=clock_timestamp() where operation_id=v_op.operation_id returning * into v_op;
  v_obligation_state:=case when v_state='succeeded' then 'succeeded' when v_state='submitted' then 'submitted'
    when v_state='unknown' then 'unknown' when v_state='failed' then 'failed' else 'pending' end;
  update public.app_refund_obligations set state=v_obligation_state,updated_at=clock_timestamp() where obligation_id=v_op.obligation_id;
  update public.app_payments set state=case
    when exists(select 1 from public.app_refund_obligations o where o.payment_id=v_payment.payment_id and o.state<>'succeeded') then 'refund_pending'
    when (select coalesce(sum(x.amount_cents),0) from public.app_refund_operations x where x.payment_id=v_payment.payment_id and x.state='succeeded')>=v_payment.amount_cents then 'refunded'
    else 'verified_paid' end where payment_id=v_payment.payment_id;
  update public.app_refund_work_items set state='completed',lease_token=null,lease_until=null,updated_at=clock_timestamp() where job_id=p_job_id;
  insert into public.app_audit_events(actor_type,actor_user_id,system_actor,action,subject_type,subject_id,operation_id,metadata)
    values('system',null,'refund_worker',case v_state when 'succeeded' then 'refund.provider.succeeded' when 'failed' then 'refund.provider.failed'
      when 'unknown' then 'refund.provider.unknown' else 'refund.provider.submitted' end,'refund_obligation',v_op.obligation_id,v_op.operation_id,
      jsonb_strip_nulls(jsonb_build_object('refund_cents',v_op.amount_cents,'from_state','pending','to_state',v_state,'safe_code',p_safe_code)));
  return app_private.refund_action_result(v_op.operation_id,true);
end
$function$;

alter table public.app_audit_events drop constraint app_audit_events_action_check;
alter table public.app_audit_events add constraint app_audit_events_action_check check(action in (
  'waitlist.signup.created','app.admission.invited','app.admission.activated','app.admission.deleted',
  'app.invitation.queued','app.invitation.accepted','app.invitation.delivered','app.invitation.failed',
  'app.invitation.unknown','app.invitation.retry_requested','member_link.requested','auth.callback.rejected',
  'authorization.denied','identity.evidence.read','identity.review.decided',
  'supply.sync.started','supply.sync.finished','supply.sync.missing_detected','supply.sync.missing_resolved',
  'supply.draft.created','supply.draft.updated','supply.draft.accepted','supply.draft.published',
  'supply.weekly_clone.started','supply.weekly_clone.item_created','supply.weekly_clone.item_unknown','supply.weekly_clone.item_conflict',
  'supply.weekly_clone.reconciled','supply.weekly_clone.undo_started','supply.weekly_clone.item_undone','supply.weekly_clone.undo_unknown','supply.weekly_clone.undo_refused',
  'table.request.created','table.request.withdrawn','table.roster.proposed','table.roster.submitted','table.roster.approved','table.invitation.queued',
  'checkout.hold.created','checkout.session.created','checkout.session.unknown','checkout.hold.released','checkout.hold.expired',
  'checkout.payment.fulfilled','checkout.refund.obligation.created','seat.cancellation.requested','seat.cancellation.approved','seat.cancellation.denied',
  'refund.dispatch.queued','refund.retry.queued','refund.reconcile.queued','refund.provider.succeeded','refund.provider.failed','refund.provider.unknown','refund.provider.submitted'
));
alter table public.app_audit_events drop constraint app_audit_events_subject_type_check;
alter table public.app_audit_events add constraint app_audit_events_subject_type_check check(subject_type in (
  'waitlist_signup','app_admission','invitation_delivery','delivery_attempt','auth_identity','member_link_request','profile_file','identity_review',
  'supply_sync_run','supply_table','supply_table_revision','supply_weekly_clone_operation','supply_weekly_clone_item','table_request',
  'table_roster_proposal','table_invitation','checkout_attempt','payment','seat','stripe_event','refund_obligation','seat_cancellation_request'
));

alter table public.app_audit_events drop constraint app_audit_events_system_actor_check;
alter table public.app_audit_events add constraint app_audit_events_system_actor_check
  check(system_actor is null or system_actor in ('auth_callback','email_delivery_worker','retention_worker','supply_sync_worker','refund_worker'));

create or replace function app_private.is_safe_audit_metadata(p_metadata jsonb)
returns boolean language sql immutable strict set search_path = ''
as $function$
  select jsonb_typeof(p_metadata)='object'
    and (select count(*) from jsonb_object_keys(p_metadata))<=7
    and not exists(select 1 from jsonb_each(p_metadata) as entry(key,value) where case
      when entry.key in ('state','from_state','to_state') then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' in ('invited','activated','deleted','queued','sending','accepted','delivered','failed','unknown',
          'confirmed','cancellation_requested','cancelled','completed','pending','approved','denied','open','submitted','succeeded')
      when entry.key in ('reason_code','safe_code') then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' in ('validation_failed','unauthenticated','forbidden','not_found','rate_limited','conflict',
          'invalid_link','provider_rejected','provider_outcome_unknown','temporarily_unavailable','duplicate_request','honeypot_ignored',
          'provider_pending','provider_failed','provider_unknown','provider_unavailable','payment_mismatch')
      when entry.key in ('attempt_number','refund_cents') then jsonb_typeof(entry.value)='number'
        and entry.value #>> '{}' ~ '^(0|[1-9][0-9]{0,3})$' and (entry.value #>> '{}')::integer between 0 and 2500
      when entry.key='retryable' then jsonb_typeof(entry.value)='boolean'
      when entry.key in ('guest_id','target_operation_id') then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      when entry.key='critical_identity_version' then jsonb_typeof(entry.value)='number' and entry.value #>> '{}' ~ '^[0-9]{1,9}$'
      when entry.key='decision' then jsonb_typeof(entry.value)='string' and entry.value #>> '{}' in ('approved','resubmission_required','denied')
      when entry.key='tableId' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      when entry.key='holdUntil' then jsonb_typeof(entry.value)='string'
        and entry.value #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      when entry.key='mode' then jsonb_typeof(entry.value)='string' and entry.value #>> '{}' in ('test','live')
      when entry.key='code' then jsonb_typeof(entry.value)='string' and entry.value #>> '{}' in ('session_expiry_too_soon','provider_rejected')
      else false end is not true);
$function$;
revoke all on function app_private.is_safe_audit_metadata(jsonb) from public,anon,authenticated;
grant execute on function app_private.is_safe_audit_metadata(jsonb) to service_role;

revoke all on function app_private.require_refund_admin(uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.refund_summary(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function app_private.refund_detail(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function app_private.refund_action_result(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function app_private.queue_refund_followup(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.list_admin_refunds(uuid,timestamptz,uuid,integer,boolean) from public,anon,authenticated,service_role;
revoke all on function public.read_admin_refund(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.queue_refund_dispatch(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.queue_refund_retry(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.queue_refund_reconcile(uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.claim_refund_work(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.finish_refund_work(uuid,uuid,text,text,text,text,text,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.list_admin_refunds(uuid,timestamptz,uuid,integer,boolean) to service_role;
grant execute on function public.read_admin_refund(uuid,uuid,boolean) to service_role;
grant execute on function public.queue_refund_dispatch(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.queue_refund_retry(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.queue_refund_reconcile(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.claim_refund_work(uuid,integer) to service_role;
grant execute on function public.finish_refund_work(uuid,uuid,text,text,text,text,text,text,integer,text,text) to service_role;
