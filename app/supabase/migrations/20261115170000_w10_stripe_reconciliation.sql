-- Nightly Stripe-vs-ledger reconciliation. The worker claims a run (at most one a day), compares Stripe's recent
-- Checkout Sessions and Refunds with the ledger, and records only ids, amounts and a finding kind: no names, emails or card data.

create table public.app_reconciliation_state (
  name text primary key check (name = 'stripe'),
  last_run_at timestamptz not null,
  last_ok_at timestamptz
);
create table public.app_reconciliation_findings (
  kind text not null check (kind in ('paid_not_recorded','payment_amount_mismatch','ledger_payment_not_in_stripe','refund_outside_app',
    'refund_unrecorded','refund_state_mismatch','ledger_refund_not_in_stripe','over_refunded','reconciliation_incomplete')),
  ref text not null check (length(ref) between 1 and 100),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail)='object' and length(detail::text) <= 1000),
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  primary key (kind, ref)
);
create index app_reconciliation_findings_open_idx on public.app_reconciliation_findings(first_seen_at) where resolved_at is null;
alter table public.app_reconciliation_state enable row level security;
alter table public.app_reconciliation_findings enable row level security;
revoke all on public.app_reconciliation_state, public.app_reconciliation_findings from public, anon, authenticated, service_role;

-- Returns {due:false} unless a successful run is more than 20h old and no attempt started in the last 30 minutes.
-- Claiming records the attempt, so concurrent passes skip and a failed run retries after the backoff.
create function public.claim_reconciliation_run()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v public.app_reconciliation_state%rowtype;
begin
  perform app_private.require_service_role();
  select * into v from public.app_reconciliation_state where name='stripe' for update;
  if found and (v.last_run_at > clock_timestamp() - interval '30 minutes' or (v.last_ok_at is not null and v.last_ok_at > clock_timestamp() - interval '20 hours')) then
    return jsonb_build_object('due', false);
  end if;
  insert into public.app_reconciliation_state(name,last_run_at) values ('stripe',clock_timestamp())
    on conflict (name) do update set last_run_at=excluded.last_run_at;
  return jsonb_build_object('due', true,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('paymentIntentId',p.provider_payment_id,'mode',p.provider_mode,'amountCents',p.amount_cents,
        'currency',p.currency,'createdAt',p.created_at) order by p.created_at) from public.app_payments p where p.created_at > clock_timestamp() - interval '96 hours'),'[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('operationId',o.operation_id,'refundId',o.provider_refund_id,'paymentIntentId',p.provider_payment_id,
        'state',o.state,'amountCents',o.amount_cents,'createdAt',o.created_at) order by o.created_at)
      from public.app_refund_operations o join public.app_payments p on p.payment_id=o.payment_id where o.created_at > clock_timestamp() - interval '96 hours'),'[]'::jsonb));
end $function$;

-- Upserts what this run found. A complete run resolves findings it no longer sees; an incomplete one only adds.
create function public.record_reconciliation_findings(p_findings jsonb, p_complete boolean)
returns integer language plpgsql security definer set search_path = '' as $function$
declare v_open integer;
begin
  perform app_private.require_service_role();
  if jsonb_typeof(p_findings) is distinct from 'array' or jsonb_array_length(p_findings) > 200 then raise exception using errcode='P0001', message='invalid_findings'; end if;
  insert into public.app_reconciliation_findings(kind,ref,detail)
    select f->>'kind', f->>'ref', coalesce(f->'detail','{}'::jsonb) from jsonb_array_elements(p_findings) f
    on conflict (kind,ref) do update set detail=excluded.detail, last_seen_at=clock_timestamp(), resolved_at=null;
  if p_complete then
    update public.app_reconciliation_findings x set resolved_at=clock_timestamp()
      where x.resolved_at is null and not exists (select 1 from jsonb_array_elements(p_findings) f where f->>'kind'=x.kind and f->>'ref'=x.ref);
    update public.app_reconciliation_state set last_ok_at=clock_timestamp() where name='stripe';
  end if;
  select count(*) into v_open from public.app_reconciliation_findings where resolved_at is null;
  return v_open;
end $function$;

do $$
declare v text;
begin
  foreach v in array array['public.claim_reconciliation_run()','public.record_reconciliation_findings(jsonb,boolean)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role', v);
    execute format('grant execute on function %s to service_role', v);
  end loop;
end $$;

-- Surface it on the admin overview: a count (open findings, plus one when the nightly check has gone stale) and the findings themselves.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.read_admin_overview(uuid)'::regprocedure);
  v_new := replace(v_def, $a$'votesNotFinalized',$a$, $b$'reconciliationOpen',(select count(*) from public.app_reconciliation_findings where resolved_at is null)
      + (select count(*) from public.app_reconciliation_state where last_ok_at is null or last_ok_at < clock_timestamp() - interval '36 hours'),
    'votesNotFinalized',$b$);
  v_new := replace(v_new, $a$'counts',v_out)$a$, $b$'counts',v_out,
    'reconciliation',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'ref',ref,'detail',detail,'firstSeenAt',first_seen_at) order by first_seen_at)
      from (select * from public.app_reconciliation_findings where resolved_at is null order by first_seen_at limit 20) f),'[]'::jsonb),
    'reconciliationLastOkAt',(select last_ok_at from public.app_reconciliation_state where name='stripe'))$b$);
  if v_new = v_def or position('reconciliationOpen' in v_new) = 0 or position('reconciliationLastOkAt' in v_new) = 0 then raise exception 'overview definition not patched'; end if;
  execute v_new;
end $$;
