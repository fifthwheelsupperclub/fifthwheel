-- Every new waitlist signup gets a confirmation email through the existing notice outbox (retries, `unknown` handling and the operator view come with it).
-- A signup has no auth user yet, so an outbox row may address an email directly. Test signups and the reviewed legacy import queue nothing.

alter table public.app_notice_outbox
  alter column recipient_user_id drop not null,
  add column recipient_email text check (recipient_email is null or (recipient_email = lower(btrim(recipient_email)) and length(recipient_email) between 3 and 320)),
  add constraint app_notice_outbox_one_recipient check ((recipient_user_id is null) <> (recipient_email is null)),
  drop constraint app_notice_outbox_kind_check,
  add constraint app_notice_outbox_kind_check check (kind in ('seat_confirmed','cancellation_decision','table_cancelled','member_removed','t48_reminder','waitlist_confirmed'));

create function app_private.notice_waitlist_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if not new.is_test and coalesce(current_setting('app.skip_waitlist_confirmation', true), '') <> 'on' then
    insert into public.app_notice_outbox(kind,recipient_email,dedupe_key,payload)
      values('waitlist_confirmed',new.email_normalized,'waitlist:'||new.id,jsonb_build_object('signupId',new.id))
      on conflict (dedupe_key) do nothing;
  end if;
  return null;
end $function$;
create trigger waitlist_signups_notice_confirmed after insert on public.waitlist_signups for each row execute function app_private.notice_waitlist_confirmed();

create or replace function app_private.notice_context(p_kind text,p_payload jsonb,p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_table jsonb; v_first text; v_ctx jsonb;
begin
  if p_kind='waitlist_confirmed' then
    select first_name into v_first from public.waitlist_signups where id=(p_payload->>'signupId')::uuid;
    return jsonb_build_object('firstName',coalesce(v_first,'there'),'tableTitle','','localDate',null,'startLocalTime',null,'neighborhood',null);
  end if;
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

create or replace function public.claim_notices(p_limit integer)
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
      'to',coalesce(u.email,c.recipient_email),
      'gone',case when c.recipient_user_id is null then false else (u.id is null or u.banned_until is not null or u.email_confirmed_at is null or u.email like 'deleted+%') end,
      'context',app_private.notice_context(c.kind,c.payload,c.recipient_user_id)) order by c.created_at),'[]'::jsonb) into v_items
    from claimed c left join auth.users u on u.id=c.recipient_user_id;
  return v_items;
end $function$;

create or replace function public.list_notice_problems(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('noticeId',n.notice_id,'kind',n.kind,'state',n.state,'attempts',n.attempt_count,
      'errorCode',n.error_code,'createdAt',n.created_at,'firstName',coalesce(p.first_name,w.first_name,'Guest'),'tableTitle',r.content->>'title') order by n.created_at)
    from public.app_notice_outbox n left join public.app_member_profiles p on p.auth_user_id=n.recipient_user_id
    left join public.waitlist_signups w on w.id=(n.payload->>'signupId')::uuid
    left join public.app_supply_table_heads h on h.table_id=(n.payload->>'tableId')::uuid left join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id
    where n.state in ('failed','unknown')),'[]'::jsonb));
end $function$;

revoke all on function app_private.notice_waitlist_confirmed() from public,anon,authenticated,service_role;
revoke all on function app_private.notice_context(text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_notices(integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_notices(integer) to service_role;
revoke all on function public.list_notice_problems(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_notice_problems(uuid) to service_role;
