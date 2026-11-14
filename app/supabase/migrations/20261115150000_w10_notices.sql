-- W10.2: one durable notice outbox for guest emails about Seats, cancellations, removals, Table cancellation and the T-48 reminder.
-- Producers are triggers and one enqueue function, so no business action can forget to queue and none can send twice (dedupe key).
-- Delivery never repeats a business or money action. An outcome the provider did not confirm becomes `unknown` and waits for an operator.

create table public.app_notice_outbox (
  notice_id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('seat_confirmed','cancellation_decision','table_cancelled','member_removed','t48_reminder')),
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and length(payload::text) <= 1000),
  state text not null default 'queued' check (state in ('queued','sending','accepted','delivered','failed','unknown','dismissed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id text check (provider_message_id is null or provider_message_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz
);
create index app_notice_outbox_due_idx on public.app_notice_outbox(next_attempt_at) where state='queued';
create index app_notice_outbox_problem_idx on public.app_notice_outbox(created_at) where state in ('failed','unknown');
alter table public.app_notice_outbox enable row level security;
revoke all on public.app_notice_outbox from public,anon,authenticated,service_role;

create function app_private.queue_notice(p_kind text,p_user uuid,p_key text,p_payload jsonb)
returns void language sql security definer set search_path = '' as $function$
  insert into public.app_notice_outbox(kind,recipient_user_id,dedupe_key,payload) values(p_kind,p_user,p_key,coalesce(p_payload,'{}'::jsonb)) on conflict (dedupe_key) do nothing
$function$;

-- Seat confirmed (a Seat row only ever appears after verified payment)
create function app_private.notice_seat_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_user uuid;
begin
  select i.auth_user_id into v_user from public.app_table_invitations i where i.invitation_id=new.invitation_id;
  if v_user is not null then perform app_private.queue_notice('seat_confirmed',v_user,'seat:'||new.seat_id||':confirmed',jsonb_build_object('seatId',new.seat_id,'tableId',new.table_id)); end if;
  return null;
end $function$;
create trigger app_seats_notice_confirmed after insert on public.app_seats for each row execute function app_private.notice_seat_confirmed();

-- Cancellation request decided (skipped when the whole Table was cancelled: that guest gets the Table notice instead)
create function app_private.notice_cancellation_decision()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_user uuid; v_table uuid; v_state text;
begin
  select i.auth_user_id,s.table_id into v_user,v_table from public.app_seat_cancellation_requests cr join public.app_seats s on s.seat_id=cr.seat_id
    join public.app_table_invitations i on i.invitation_id=s.invitation_id where cr.cancellation_request_id=new.cancellation_request_id;
  select state into v_state from public.app_table_runtime where table_id=v_table;
  if v_user is not null and v_state is distinct from 'cancelled' then
    perform app_private.queue_notice('cancellation_decision',v_user,'cancel-decision:'||new.cancellation_request_id,jsonb_build_object('requestId',new.cancellation_request_id,'tableId',v_table));
  end if;
  return null;
end $function$;
create trigger app_cancel_notice_outbox_notice after insert on public.app_seat_cancellation_notice_outbox for each row execute function app_private.notice_cancellation_decision();

-- Table cancelled: everyone with a pending request, an active invitation or a live Seat, computed before cancel_table changes any of them
create function app_private.notice_table_cancelled()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_user uuid;
begin
  if new.state='cancelled' and old.state<>'cancelled' then
    for v_user in
      select q.auth_user_id from public.app_table_requests q where q.table_id=new.table_id and q.state='pending'
      union select i.auth_user_id from public.app_table_invitations i where i.table_id=new.table_id and i.state='active'
      union select i.auth_user_id from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id where s.table_id=new.table_id and s.state in ('confirmed','cancellation_requested')
    loop
      perform app_private.queue_notice('table_cancelled',v_user,'table-cancelled:'||new.table_id||':'||v_user,jsonb_build_object('tableId',new.table_id));
    end loop;
  end if;
  return null;
end $function$;
create trigger app_table_runtime_notice_cancelled after update of state on public.app_table_runtime for each row execute function app_private.notice_table_cancelled();

-- Admin removed a guest (their audit row carries the invitation id and refund amount, never text)
create function app_private.notice_member_removed()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_user uuid; v_table uuid;
begin
  if new.action='table.member.removed' then
    select i.auth_user_id,i.table_id into v_user,v_table from public.app_table_invitations i where i.invitation_id=new.subject_id;
    if v_user is not null then
      perform app_private.queue_notice('member_removed',v_user,'member-removed:'||new.subject_id,
        jsonb_build_object('tableId',v_table,'refundCents',coalesce((new.metadata->>'refund_cents')::integer,0)));
    end if;
  end if;
  return null;
end $function$;
create trigger app_audit_notice_member_removed after insert on public.app_audit_events for each row execute function app_private.notice_member_removed();

-- T-48 reminder to guests who hold an unpaid invitation. Idempotent: call it on every worker pass.
create function public.enqueue_due_notices()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_t48 integer;
begin
  perform app_private.require_service_role();
  with due as (
    select i.invitation_id,i.auth_user_id,i.table_id from public.app_table_invitations i
    join public.app_supply_table_heads h on h.table_id=i.table_id join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id
    join public.app_table_runtime rt on rt.table_id=i.table_id
    where i.state='active' and rt.state in ('open','proceeding')
      and not exists(select 1 from public.app_seats s where s.invitation_id=i.invitation_id)
      and ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York' between clock_timestamp() and clock_timestamp()+interval '48 hours')
  insert into public.app_notice_outbox(kind,recipient_user_id,dedupe_key,payload)
    select 't48_reminder',d.auth_user_id,'t48:'||d.invitation_id,jsonb_build_object('invitationId',d.invitation_id,'tableId',d.table_id) from due d
    on conflict (dedupe_key) do nothing;
  get diagnostics v_t48=row_count;
  return jsonb_build_object('t48Queued',v_t48);
end $function$;

-- Per-kind facts the template needs. Never a token, ballot, report, image or full name.
create function app_private.notice_context(p_kind text,p_payload jsonb,p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_table jsonb; v_first text; v_ctx jsonb;
begin
  select r.content into v_table from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=(p_payload->>'tableId')::uuid;
  select first_name into v_first from public.app_member_profiles where auth_user_id=p_user;
  v_ctx:=jsonb_build_object('firstName',coalesce(v_first,'there'),'tableTitle',coalesce(v_table->>'title','your Table'),'localDate',v_table->>'localDate',
    'startLocalTime',v_table->>'startLocalTime','neighborhood',v_table->>'neighborhood');
  if p_kind='cancellation_decision' then
    v_ctx:=v_ctx||(select jsonb_build_object('decision',cr.state,'reason',cr.guest_safe_reason,'refundCents',coalesce(cr.refund_cents,0)) from public.app_seat_cancellation_requests cr where cr.cancellation_request_id=(p_payload->>'requestId')::uuid);
  elsif p_kind='member_removed' then v_ctx:=v_ctx||jsonb_build_object('refundCents',coalesce((p_payload->>'refundCents')::integer,0));
  elsif p_kind='t48_reminder' then v_ctx:=v_ctx||jsonb_build_object('invitationId',p_payload->>'invitationId');
  end if;
  return v_ctx;
end $function$;

create function public.claim_notices(p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb;
begin
  perform app_private.require_service_role();
  if p_limit is null or p_limit not between 1 and 20 then raise exception using errcode='22023',message='invalid_input'; end if;
  -- A worker that died mid-send leaves the outcome unknown; it is never re-sent automatically.
  update public.app_notice_outbox set state='unknown',error_code='lease_expired',lease_token=null where state='sending' and lease_until<clock_timestamp();
  with picked as (
    select n.notice_id from public.app_notice_outbox n where n.state='queued' and n.next_attempt_at<=clock_timestamp() order by n.next_attempt_at,n.notice_id for update skip locked limit p_limit
  ), claimed as (
    update public.app_notice_outbox n set state='sending',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes',attempt_count=n.attempt_count+1
      from picked p where n.notice_id=p.notice_id returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('noticeId',c.notice_id,'leaseToken',c.lease_token,'kind',c.kind,'attempt',c.attempt_count,
      'to',u.email,'gone',(u.banned_until is not null or u.email_confirmed_at is null or u.email like 'deleted+%'),
      'context',app_private.notice_context(c.kind,c.payload,c.recipient_user_id)) order by c.created_at),'[]'::jsonb) into v_items
    from claimed c join auth.users u on u.id=c.recipient_user_id;
  return v_items;
end $function$;

create function public.finish_notice(p_notice_id uuid,p_lease_token uuid,p_outcome text,p_retryable boolean,p_message_id text,p_error text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v public.app_notice_outbox%rowtype; v_backoff interval;
begin
  perform app_private.require_service_role();
  if p_outcome not in ('accepted','failed','unknown') then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v from public.app_notice_outbox where notice_id=p_notice_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v.state<>'sending' or v.lease_token is distinct from p_lease_token then raise exception using errcode='P0001',message='lease_lost'; end if;
  if p_outcome='accepted' then
    update public.app_notice_outbox set state='accepted',accepted_at=clock_timestamp(),provider_message_id=p_message_id,error_code=null,lease_token=null where notice_id=p_notice_id;
  elsif p_outcome='unknown' then
    update public.app_notice_outbox set state='unknown',error_code=coalesce(p_error,'outcome_unknown'),lease_token=null where notice_id=p_notice_id;
  elsif coalesce(p_retryable,false) and v.attempt_count<8 then
    v_backoff:=case v.attempt_count when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes' else interval '60 minutes' end;
    update public.app_notice_outbox set state='queued',next_attempt_at=clock_timestamp()+v_backoff,error_code=coalesce(p_error,'send_failed'),lease_token=null where notice_id=p_notice_id;
  else
    update public.app_notice_outbox set state='failed',error_code=coalesce(p_error,'send_failed'),lease_token=null where notice_id=p_notice_id;
  end if;
  return jsonb_build_object('noticeId',p_notice_id,'state',(select state from public.app_notice_outbox where notice_id=p_notice_id));
end $function$;

-- Operator view and the only two choices: send again (after checking the provider's logs) or dismiss.
create function public.list_notice_problems(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('noticeId',n.notice_id,'kind',n.kind,'state',n.state,'attempts',n.attempt_count,
      'errorCode',n.error_code,'createdAt',n.created_at,'firstName',coalesce(p.first_name,'Guest'),'tableTitle',r.content->>'title') order by n.created_at)
    from public.app_notice_outbox n left join public.app_member_profiles p on p.auth_user_id=n.recipient_user_id
    left join public.app_supply_table_heads h on h.table_id=(n.payload->>'tableId')::uuid left join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id
    where n.state in ('failed','unknown')),'[]'::jsonb));
end $function$;

create function public.resolve_notice(p_actor uuid,p_notice_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v public.app_notice_outbox%rowtype;
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_notice_id is null or p_action not in ('retry','dismiss') then raise exception using errcode='22023',message='invalid_input'; end if;
  select * into v from public.app_notice_outbox where notice_id=p_notice_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v.state not in ('failed','unknown') then raise exception using errcode='P0001',message='notice_not_actionable'; end if;
  if p_action='retry' then
    update public.app_notice_outbox set state='queued',next_attempt_at=clock_timestamp(),attempt_count=least(attempt_count,7),error_code=null,lease_token=null where notice_id=p_notice_id;
  else
    update public.app_notice_outbox set state='dismissed',lease_token=null where notice_id=p_notice_id;
  end if;
  return jsonb_build_object('noticeId',p_notice_id,'state',(select state from public.app_notice_outbox where notice_id=p_notice_id));
end $function$;

do $$
declare v text;
begin
  foreach v in array array['public.enqueue_due_notices()','public.claim_notices(integer)','public.finish_notice(uuid,uuid,text,boolean,text,text)',
    'public.list_notice_problems(uuid)','public.resolve_notice(uuid,uuid,text)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
    execute format('grant execute on function %s to service_role',v);
  end loop;
  foreach v in array array['app_private.queue_notice(text,uuid,text,jsonb)','app_private.notice_seat_confirmed()','app_private.notice_cancellation_decision()','app_private.notice_table_cancelled()',
    'app_private.notice_member_removed()','app_private.notice_context(text,jsonb,uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
  end loop;
end $$;
