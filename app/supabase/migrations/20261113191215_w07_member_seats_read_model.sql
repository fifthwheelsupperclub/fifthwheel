-- W07.3 member-owned Seat history and authoritative Seat status reads.
-- Draft only: review and guarded local acceptance required before apply.

create table public.app_seat_cancellation_requests (
  cancellation_request_id uuid primary key default gen_random_uuid(),
  seat_id uuid not null references public.app_seats(seat_id) on delete restrict,
  state text not null check (state in ('pending','approved','denied')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  guest_safe_reason text check (guest_safe_reason is null or length(guest_safe_reason) <= 500),
  check ((state = 'pending') = (decided_at is null)),
  check (state <> 'denied' or guest_safe_reason is not null)
);
create unique index app_seat_cancellation_requests_one_pending_idx
  on public.app_seat_cancellation_requests(seat_id) where state='pending';
create index app_seat_cancellation_requests_history_idx
  on public.app_seat_cancellation_requests(seat_id,requested_at desc,cancellation_request_id desc);
alter table public.app_seat_cancellation_requests enable row level security;
revoke all on public.app_seat_cancellation_requests from public,anon,authenticated,service_role;

create function app_private.member_seat_read_dto(p_actor uuid,p_seat_id uuid,p_detail boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb;
begin
  perform app_private.require_service_role();
  select jsonb_build_object(
    'seatId',s.seat_id,
    'state',s.state,
    'participationState',case when s.state in ('cancelled','completed') or
      ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York' <= clock_timestamp()
      then 'past' else 'current' end,
    'createdAt',s.created_at,
    'table',jsonb_build_object('tableId',s.table_id,'title',r.content->>'title','localDate',r.content->>'localDate',
      'startLocalTime',r.content->>'startLocalTime','timeZone','America/New_York',
      'startsAt',(((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York'),
      'neighborhood',r.content->>'neighborhood') || case when p_detail then jsonb_build_object('itinerary',coalesce((
        select jsonb_agg(jsonb_build_object('role',stop.value->>'role','venueName',stop.value->>'venueName',
          'venueAddress',stop.value->>'venueAddress','minutesFromStart',(stop.value->>'minutesFromStart')::integer,
          'publicNotes',coalesce(stop.value->>'publicNotes','')) order by stop.ordinality)
        from jsonb_array_elements(r.content->'stops') with ordinality stop(value,ordinality)), '[]'::jsonb)) else '{}'::jsonb end,
    'payment',jsonb_build_object(
      'state',case p.state when 'verified_paid' then 'paid' when 'refund_pending' then 'refund_pending' when 'refunded' then 'refunded' else 'unknown' end,
      'amountCents',p.amount_cents,'currency',p.currency,'paidAt',p.verified_at) || case when p_detail then
        jsonb_build_object('receipt',jsonb_build_object('state','unavailable','url',null)) else '{}'::jsonb end,
    'refund',(
      select jsonb_build_object('state',o.state,'amountCents',o.amount_cents,'currency',o.currency)
      from public.app_refund_obligations o where o.payment_id=p.payment_id
      order by o.created_at desc,o.obligation_id desc limit 1),
    'calendar',jsonb_build_object('available',s.state in ('confirmed','cancellation_requested') and
      (((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York')>clock_timestamp(),
      'href',case when s.state in ('confirmed','cancellation_requested') and
        (((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York')>clock_timestamp()
        then '/api/me/seats/'||s.seat_id::text||'/calendar.ics' else null end),
    'cancellation',case when p_detail then jsonb_build_object(
      'status',coalesce((select cr.state from public.app_seat_cancellation_requests cr where cr.seat_id=s.seat_id
        order by cr.requested_at desc,cr.cancellation_request_id desc limit 1),'none'),
      'history',coalesce((select jsonb_agg(jsonb_build_object('requestId',cr.cancellation_request_id,'status',cr.state,
        'requestedAt',cr.requested_at,'decidedAt',cr.decided_at,'safeReason',cr.guest_safe_reason)
        order by cr.requested_at desc,cr.cancellation_request_id desc)
        from public.app_seat_cancellation_requests cr where cr.seat_id=s.seat_id),'[]'::jsonb)) else null end
  ) into v_result
  from public.app_seats s
  join public.app_table_invitations i on i.invitation_id=s.invitation_id and i.table_id=s.table_id and i.guest_id=s.guest_id
  join public.app_table_requests q on q.request_id=i.source_request_id and q.table_id=i.table_id and q.guest_id=i.guest_id and q.auth_user_id=i.auth_user_id
  join public.app_table_roster_proposals rp on rp.proposal_id=i.proposal_id and rp.table_id=i.table_id and rp.state='approved'
  join public.app_table_roster_proposal_members pm on pm.proposal_id=rp.proposal_id and pm.request_id=q.request_id and pm.guest_id=i.guest_id
  join public.app_member_profiles m on m.guest_id=i.guest_id and m.auth_user_id=i.auth_user_id
  join public.app_admissions a on a.id=m.admission_id and a.auth_user_id=i.auth_user_id and a.state='activated'
  join public.app_payments p on p.payment_id=s.payment_id
  join public.app_checkout_attempts ca on ca.attempt_id=p.attempt_id and ca.invitation_id=i.invitation_id
  join public.app_supply_table_revisions r on r.revision_id=rp.supply_revision_id and r.table_id=s.table_id
  where s.seat_id=p_seat_id and i.auth_user_id=p_actor
    and exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null);
  if v_result is null then raise exception using errcode='P0002',message='not_found'; end if;
  return v_result;
end $function$;
revoke all on function app_private.member_seat_read_dto(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.member_seat_read_dto(uuid,uuid,boolean) to service_role;

create function public.read_my_seats(p_actor uuid,p_cursor_created_at timestamptz,p_cursor_seat_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_items jsonb; v_pending jsonb; v_next text; v_next_created_at timestamptz; v_next_seat_id uuid; v_has_more boolean:=false;
begin
  perform app_private.require_service_role();
  if p_actor is null or p_limit is null or p_limit < 1 or p_limit > 50
    or ((p_cursor_created_at is null) <> (p_cursor_seat_id is null)) then
    raise exception using errcode='22023',message='invalid_input';
  end if;
  if not exists(select 1 from auth.users u join public.app_admissions ad on ad.auth_user_id=u.id and ad.state='activated'
    where u.id=p_actor and u.email_confirmed_at is not null) then
    raise exception using errcode='42501',message='member_not_admitted';
  end if;
  with page as (
    select s.seat_id,s.created_at,row_number() over(order by s.created_at desc,s.seat_id desc) rn
    from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id and i.auth_user_id=p_actor
    where p_cursor_created_at is null or (s.created_at,s.seat_id)<(p_cursor_created_at,p_cursor_seat_id)
    order by s.created_at desc,s.seat_id desc limit p_limit+1
  ), rows as (
    select * from page where rn<=p_limit
  )
  select coalesce(jsonb_agg(app_private.member_seat_read_dto(p_actor,seat_id,false) order by created_at desc,seat_id desc),'[]'::jsonb),
    (select created_at from rows order by created_at asc,seat_id asc limit 1 offset greatest(p_limit-1,0)),
    (select seat_id from rows order by created_at asc,seat_id asc limit 1 offset greatest(p_limit-1,0)),
    (select count(*)>p_limit from page)
  into v_items,v_next_created_at,v_next_seat_id,v_has_more
  from rows;
  if v_has_more then
    v_next:=replace(translate(encode(convert_to(jsonb_build_object('createdAt',v_next_created_at,'seatId',v_next_seat_id)::text,'UTF8'),'base64'),'+/=','-_'),E'\n','');
  end if;
  select coalesce(jsonb_agg(x.item order by x.created_at desc,x.attempt_id desc),'[]'::jsonb) into v_pending
  from (
    select ca.attempt_id,ca.created_at,jsonb_build_object('attemptId',ca.attempt_id,'invitationId',i.invitation_id,
      'state',case when pp.state='refund_pending' then 'refund_pending'
        when ca.state='open' and ca.hold_until<=clock_timestamp() then 'unknown'
        when ca.state='open' then 'checkout_open' when ca.state='creating' then 'processing' when ca.state='processing' then 'processing'
        when ca.state='unknown' then 'unknown' when ca.state='released' then 'failed' when ca.state='expired' then 'expired' else 'unknown' end,
      'nextAction',case when pp.state='refund_pending' then 'contact_support'
        when pp.state='verified_paid' then 'contact_support'
        when pp.state='refunded' and i.state='active' and rt.state in ('open','proceeding') then 'retry_invitation'
        when ca.state='open' and ca.hold_until>clock_timestamp() then 'resume_checkout'
        when ca.state in ('open','creating','processing','unknown') then 'check_status'
        when ca.state in ('released','expired') and i.state='active' and rt.state in ('open','proceeding') then 'retry_invitation'
        when ca.state in ('released','expired') then 'contact_support' else 'contact_support' end,
      'createdAt',ca.created_at,'holdUntil',ca.hold_until,'price',jsonb_build_object('amountCents',2500,'currency','USD'),
      'payment',jsonb_build_object('state',case when pp.state='refund_pending' then 'refund_pending'
          when pp.state='verified_paid' then 'unknown' when pp.state='refunded' then 'refunded'
          when ca.state in ('creating','open','processing') then 'processing'
          when ca.state in ('released','expired') then 'not_started' else 'unknown' end,
        'amountCents',2500,'currency','USD','paidAt',pp.verified_at),
      'refund',(select jsonb_build_object('state',o.state,'amountCents',o.amount_cents,'currency',o.currency)
        from public.app_refund_obligations o where o.payment_id=pp.payment_id
        order by o.created_at desc,o.obligation_id desc limit 1),
      'table',jsonb_build_object('tableId',i.table_id,'title',r.content->>'title','localDate',r.content->>'localDate',
        'startLocalTime',r.content->>'startLocalTime','timeZone','America/New_York',
        'startsAt',(((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York'),
        'neighborhood',r.content->>'neighborhood')) item
    from public.app_checkout_attempts ca
    join public.app_table_invitations i on i.invitation_id=ca.invitation_id and i.auth_user_id=p_actor
    join public.app_table_roster_proposals rp on rp.proposal_id=i.proposal_id
    join public.app_supply_table_revisions r on r.revision_id=rp.supply_revision_id and r.table_id=i.table_id
    join public.app_table_runtime rt on rt.table_id=i.table_id
    left join public.app_payments pp on pp.attempt_id=ca.attempt_id
    where not exists(select 1 from public.app_seats s where s.invitation_id=i.invitation_id)
      and ca.attempt_id=(select latest.attempt_id from public.app_checkout_attempts latest where latest.invitation_id=i.invitation_id
        order by latest.created_at desc,latest.attempt_id desc limit 1)
    order by ca.created_at desc,ca.attempt_id desc limit 20
  ) x;
  return jsonb_build_object('items',v_items,'pendingCheckouts',v_pending,'nextCursor',v_next);
end $function$;
revoke all on function public.read_my_seats(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_my_seats(uuid,timestamptz,uuid,integer) to service_role;

create function public.read_my_seat(p_actor uuid,p_seat_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_service_role();
  if p_actor is null or p_seat_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  if not exists(select 1 from auth.users u join public.app_admissions ad on ad.auth_user_id=u.id and ad.state='activated'
    where u.id=p_actor and u.email_confirmed_at is not null) then
    raise exception using errcode='42501',message='member_not_admitted';
  end if;
  return app_private.member_seat_read_dto(p_actor,p_seat_id,true);
end $function$;
revoke all on function public.read_my_seat(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_my_seat(uuid,uuid) to service_role;

create function public.read_invitation_seat_status(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_status text:='no_confirmed_seat'; v_payment_state text;
begin
  perform app_private.require_service_role();
  if p_invitation_id is null then raise exception using errcode='22023',message='invalid_input'; end if;
  if not exists(select 1 from public.app_table_invitations i where i.invitation_id=p_invitation_id) then
    return jsonb_build_object('status','unknown');
  end if;
  select p.state into v_payment_state
  from public.app_seats s join public.app_payments p on p.payment_id=s.payment_id
  where s.invitation_id=p_invitation_id and s.state in ('confirmed','cancellation_requested','completed')
  order by s.created_at desc limit 1;
  if found then
    if v_payment_state='verified_paid' then return jsonb_build_object('status','confirmed_seat'); end if;
    return jsonb_build_object('status','unknown');
  end if;
  if exists(select 1 from public.app_checkout_attempts ca where ca.invitation_id=p_invitation_id
    and ca.state in ('creating','open','unknown','processing')) then
    return jsonb_build_object('status','unknown');
  end if;
  if exists(select 1 from public.app_payments p join public.app_checkout_attempts ca on ca.attempt_id=p.attempt_id
    where ca.invitation_id=p_invitation_id and p.state<>'refunded') then
    return jsonb_build_object('status','unknown');
  end if;
  if exists(select 1 from public.app_refund_obligations o join public.app_payments p on p.payment_id=o.payment_id
    join public.app_checkout_attempts ca on ca.attempt_id=p.attempt_id
    where ca.invitation_id=p_invitation_id and o.state<>'succeeded') then
    return jsonb_build_object('status','unknown');
  end if;
  return jsonb_build_object('status',v_status);
end $function$;
revoke all on function public.read_invitation_seat_status(uuid) from public,anon,authenticated;
grant execute on function public.read_invitation_seat_status(uuid) to service_role;
