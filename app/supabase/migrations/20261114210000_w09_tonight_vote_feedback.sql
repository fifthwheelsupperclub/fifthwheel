-- W09: Tonight, private ballot and reveal, ratings and conduct reports.
-- Eligibility is frozen lazily and idempotently under the Table lock at start+90m from attendance committed by then.
-- The voting window is the half-open interval [start+90m, start+120m) on the database clock. All RPCs are service-role only.

do $$
declare v_def text; v_add text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
    where conrelid='public.app_audit_events'::regclass and conname='app_audit_events_action_check';
  foreach v_add in array array['conduct.report.triaged'] loop
    if position(quote_literal(v_add) in v_def)=0 then
      v_def:=regexp_replace(v_def, '\]\)\)\)\s*$', ', '||quote_literal(v_add)||'::text]))) ');
    end if;
  end loop;
  alter table public.app_audit_events drop constraint app_audit_events_action_check;
  execute 'alter table public.app_audit_events add constraint app_audit_events_action_check '||v_def;
end $$;

create table public.app_vote_periods (
  table_id uuid primary key references public.app_supply_table_heads(table_id) on delete restrict,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  frozen_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  check (closes_at = opens_at + interval '30 minutes')
);
create table public.app_ballot_eligibility (
  table_id uuid not null references public.app_vote_periods(table_id) on delete restrict,
  guest_id uuid not null,
  seat_id uuid not null references public.app_seats(seat_id) on delete restrict,
  auth_user_id uuid not null,
  invalidated_at timestamptz,
  primary key (table_id, guest_id)
);
create table public.app_ballots (
  table_id uuid not null,
  voter_guest_id uuid not null,
  choice_guest_id uuid,
  submitted_at timestamptz not null default clock_timestamp(),
  primary key (table_id, voter_guest_id),
  foreign key (table_id, voter_guest_id) references public.app_ballot_eligibility(table_id, guest_id) on delete restrict,
  foreign key (table_id, choice_guest_id) references public.app_ballot_eligibility(table_id, guest_id) on delete restrict,
  check (choice_guest_id is null or choice_guest_id <> voter_guest_id)
);
create table public.app_mutual_results (
  table_id uuid not null,
  guest_id uuid not null,
  counterpart_guest_id uuid,
  finalized_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  invalidated_at timestamptz,
  primary key (table_id, guest_id),
  foreign key (table_id, guest_id) references public.app_ballot_eligibility(table_id, guest_id) on delete restrict
);
create table public.app_ratings (
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  guest_id uuid not null,
  overall smallint not null check (overall between 1 and 5),
  venue_scores jsonb not null default '{}'::jsonb check (jsonb_typeof(venue_scores)='object'),
  note text check (note is null or length(note) <= 2000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (table_id, guest_id)
);
create table public.app_conduct_reports (
  report_id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  table_id uuid not null references public.app_supply_table_heads(table_id) on delete restrict,
  author_guest_id uuid not null,
  subject_guest_id uuid,
  body text not null check (length(btrim(body)) between 1 and 4000),
  status text not null default 'new' check (status in ('new','reviewing','resolved')),
  held boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (subject_guest_id is null or subject_guest_id <> author_guest_id)
);

alter table public.app_vote_periods enable row level security;
alter table public.app_ballot_eligibility enable row level security;
alter table public.app_ballots enable row level security;
alter table public.app_mutual_results enable row level security;
alter table public.app_ratings enable row level security;
alter table public.app_conduct_reports enable row level security;
revoke all on public.app_vote_periods,public.app_ballot_eligibility,public.app_ballots,public.app_mutual_results,public.app_ratings,public.app_conduct_reports
  from public,anon,authenticated,service_role;
grant select,insert,update on public.app_vote_periods,public.app_ballot_eligibility,public.app_mutual_results,public.app_ratings,public.app_conduct_reports to service_role;
grant select,insert,delete on public.app_ballots to service_role;
grant delete on public.app_mutual_results to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers (callers hold the Table head lock where noted)
-- ---------------------------------------------------------------------------------------------------------------------
create function app_private.table_start(p_table_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $function$
  select ((r.content->>'localDate')::date+(r.content->>'startLocalTime')::time) at time zone 'America/New_York'
  from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=p_table_id
$function$;

create function app_private.member_guest(p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_guest uuid;
begin
  perform app_private.require_admitted_table_member(p_actor);
  select guest_id into v_guest from public.app_member_profiles where auth_user_id=p_actor;
  if v_guest is null then raise exception using errcode='P0001',message='profile_incomplete'; end if;
  return v_guest;
end $function$;

create function app_private.lock_table(p_table_id uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare v_state text;
begin
  perform 1 from public.app_supply_table_heads where table_id=p_table_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  select state into v_state from public.app_table_runtime where table_id=p_table_id for update;
  return v_state;
end $function$;

-- Materialises the eligibility snapshot once, never before start+90m. Requires the Table lock.
create function app_private.ensure_vote_period(p_table_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_start timestamptz; v_state text; v_open timestamptz;
begin
  if exists(select 1 from public.app_vote_periods where table_id=p_table_id) then return; end if;
  v_start:=app_private.table_start(p_table_id);
  select state into v_state from public.app_table_runtime where table_id=p_table_id;
  if v_start is null or v_state not in ('proceeding','completed') or clock_timestamp()<v_start+interval '90 minutes' then return; end if;
  v_open:=v_start+interval '90 minutes';
  insert into public.app_vote_periods(table_id,opens_at,closes_at) values(p_table_id,v_open,v_open+interval '30 minutes');
  insert into public.app_ballot_eligibility(table_id,guest_id,seat_id,auth_user_id)
    select s.table_id,s.guest_id,s.seat_id,i.auth_user_id
    from public.app_seats s join public.app_table_invitations i on i.invitation_id=s.invitation_id
    join public.app_table_attendance a on a.seat_id=s.seat_id and a.checked_in_at<=v_open
    where s.table_id=p_table_id and s.state in ('confirmed','cancellation_requested','completed');
end $function$;

-- Writes one private result row per eligible guest after close. Idempotent. Requires the Table lock.
create function app_private.finalize_vote_period(p_table_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_period public.app_vote_periods%rowtype;
begin
  select * into v_period from public.app_vote_periods where table_id=p_table_id for update;
  if not found or v_period.finalized_at is not null or clock_timestamp()<v_period.closes_at then return; end if;
  insert into public.app_mutual_results(table_id,guest_id,counterpart_guest_id,expires_at)
    select e.table_id,e.guest_id,
      (select b.choice_guest_id from public.app_ballots b
         join public.app_ballot_eligibility e2 on e2.table_id=b.table_id and e2.guest_id=b.choice_guest_id and e2.invalidated_at is null
         join public.app_ballots r on r.table_id=b.table_id and r.voter_guest_id=b.choice_guest_id and r.choice_guest_id=b.voter_guest_id
         where b.table_id=e.table_id and b.voter_guest_id=e.guest_id),
      app_private.table_start(p_table_id)+interval '90 days'
    from public.app_ballot_eligibility e where e.table_id=p_table_id and e.invalidated_at is null
    on conflict do nothing;
  update public.app_vote_periods set finalized_at=clock_timestamp() where table_id=p_table_id;
end $function$;

-- Approved removal or cancellation ends ballot participation and any result involving that guest, on both sides.
create function app_private.invalidate_vote_participation()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.state='cancelled' and old.state<>'cancelled' then
    update public.app_ballot_eligibility set invalidated_at=clock_timestamp() where table_id=new.table_id and guest_id=new.guest_id and invalidated_at is null;
    update public.app_mutual_results set invalidated_at=clock_timestamp()
      where table_id=new.table_id and (guest_id=new.guest_id or counterpart_guest_id=new.guest_id) and invalidated_at is null;
  end if;
  return null;
end $function$;
create trigger app_seats_invalidate_vote after update of state on public.app_seats
  for each row execute function app_private.invalidate_vote_participation();

-- The caller's own active paid Seat on this Table, or a uniform not_found.
create function app_private.own_active_seat(p_guest uuid,p_table_id uuid)
returns public.app_seats language plpgsql security definer set search_path = '' as $function$
declare v_seat public.app_seats%rowtype;
begin
  select * into v_seat from public.app_seats s where s.table_id=p_table_id and s.guest_id=p_guest and s.state in ('confirmed','cancellation_requested','completed');
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  return v_seat;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- W09.1 Tonight
-- ---------------------------------------------------------------------------------------------------------------------
create function public.read_tonight(p_actor uuid,p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_guest uuid; v_seat public.app_seats%rowtype; v_state text; v_start timestamptz; v_opens timestamptz; v_closes timestamp with time zone;
  v_content jsonb; v_checked timestamptz; v_vote text; v_elig record; v_submitted timestamptz; v_candidates jsonb:='[]'::jsonb;
begin
  v_guest:=app_private.member_guest(p_actor);
  v_state:=app_private.lock_table(p_table_id);
  v_seat:=app_private.own_active_seat(v_guest,p_table_id);
  select r.content into v_content from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=p_table_id;
  v_start:=app_private.table_start(p_table_id); v_opens:=v_start+interval '90 minutes'; v_closes:=v_start+interval '120 minutes';
  select checked_in_at into v_checked from public.app_table_attendance where seat_id=v_seat.seat_id;
  perform app_private.ensure_vote_period(p_table_id);
  v_vote:=case when v_state not in ('proceeding','completed') then 'unavailable' when clock_timestamp()<v_opens then 'wait' when clock_timestamp()<v_closes then 'open' else 'closed' end;
  select e.invalidated_at is null as active into v_elig from public.app_ballot_eligibility e where e.table_id=p_table_id and e.guest_id=v_guest;
  select submitted_at into v_submitted from public.app_ballots where table_id=p_table_id and voter_guest_id=v_guest;
  if v_vote='open' and coalesce(v_elig.active,false) then
    select coalesce(jsonb_agg(jsonb_build_object('guestId',e.guest_id,'firstName',m.first_name) order by m.first_name,e.guest_id),'[]'::jsonb) into v_candidates
      from public.app_ballot_eligibility e join public.app_member_profiles m on m.guest_id=e.guest_id
      where e.table_id=p_table_id and e.guest_id<>v_guest and e.invalidated_at is null;
  end if;
  return jsonb_build_object('table',jsonb_build_object('tableId',p_table_id,'title',v_content->>'title','localDate',v_content->>'localDate',
      'startLocalTime',v_content->>'startLocalTime','neighborhood',v_content->>'neighborhood','stops',coalesce(
        (select jsonb_agg(jsonb_build_object('role',s.value->>'role','venueName',s.value->>'venueName','venueAddress',s.value->>'venueAddress',
          'minutesFromStart',(s.value->>'minutesFromStart')::integer,'publicNotes',s.value->>'publicNotes') order by s.ordinality)
         from jsonb_array_elements(v_content->'stops') with ordinality s(value,ordinality)),'[]'::jsonb)),
    'attendance',jsonb_build_object('checkedInAt',v_checked),
    'vote',jsonb_build_object('state',v_vote,'opensAt',v_opens,'closesAt',v_closes,
      'eligible',case when v_vote in ('open','closed') then coalesce(v_elig.active,false) else null end,
      'submittedAt',v_submitted,'candidates',v_candidates));
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- W09.2 ballot
-- ---------------------------------------------------------------------------------------------------------------------
create function public.submit_ballot(p_actor uuid,p_table_id uuid,p_choice_guest_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest uuid; v_state text; v_start timestamptz; v_prior public.app_ballots%rowtype; v_now timestamptz;
begin
  v_guest:=app_private.member_guest(p_actor);
  v_state:=app_private.lock_table(p_table_id);
  perform app_private.own_active_seat(v_guest,p_table_id);
  v_start:=app_private.table_start(p_table_id); v_now:=clock_timestamp();
  if v_state not in ('proceeding','completed') then raise exception using errcode='P0001',message='voting_unavailable'; end if;
  if v_now<v_start+interval '90 minutes' then raise exception using errcode='P0001',message='voting_not_open'; end if;
  if v_now>=v_start+interval '120 minutes' then raise exception using errcode='P0001',message='voting_closed'; end if;
  perform app_private.ensure_vote_period(p_table_id);
  if not exists(select 1 from public.app_ballot_eligibility e where e.table_id=p_table_id and e.guest_id=v_guest and e.invalidated_at is null) then
    raise exception using errcode='42501',message='not_eligible'; end if;
  if p_choice_guest_id is not null and (p_choice_guest_id=v_guest or not exists(select 1 from public.app_ballot_eligibility e
      where e.table_id=p_table_id and e.guest_id=p_choice_guest_id and e.invalidated_at is null)) then
    raise exception using errcode='22023',message='invalid_choice'; end if;
  select * into v_prior from public.app_ballots where table_id=p_table_id and voter_guest_id=v_guest;
  if found then
    if v_prior.choice_guest_id is distinct from p_choice_guest_id then raise exception using errcode='P0001',message='ballot_conflict'; end if;
    return jsonb_build_object('submittedAt',v_prior.submitted_at);
  end if;
  insert into public.app_ballots(table_id,voter_guest_id,choice_guest_id,submitted_at) values(p_table_id,v_guest,p_choice_guest_id,v_now) returning * into v_prior;
  return jsonb_build_object('submittedAt',v_prior.submitted_at);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- W09.3 reveal
-- ---------------------------------------------------------------------------------------------------------------------
create function public.read_my_reveal(p_actor uuid,p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest uuid; v_start timestamptz; v_res public.app_mutual_results%rowtype; v_match jsonb:=null; v_name text;
begin
  v_guest:=app_private.member_guest(p_actor);
  perform app_private.lock_table(p_table_id);
  v_start:=app_private.table_start(p_table_id);
  if v_start is null then raise exception using errcode='P0002',message='not_found'; end if;
  perform app_private.ensure_vote_period(p_table_id);
  if not exists(select 1 from public.app_ballot_eligibility e where e.table_id=p_table_id and e.guest_id=v_guest) then
    if clock_timestamp()>=v_start+interval '90 days' then return jsonb_build_object('state','results_unavailable','match',null); end if;
    raise exception using errcode='42501',message='not_eligible';
  end if;
  if clock_timestamp()<v_start+interval '120 minutes' then return jsonb_build_object('state','pending','match',null); end if;
  perform app_private.finalize_vote_period(p_table_id);
  if clock_timestamp()>=v_start+interval '90 days' then return jsonb_build_object('state','results_unavailable','match',null); end if;
  select * into v_res from public.app_mutual_results where table_id=p_table_id and guest_id=v_guest;
  if found and v_res.invalidated_at is null and v_res.counterpart_guest_id is not null then
    select m.first_name into v_name from public.app_member_profiles m where m.guest_id=v_res.counterpart_guest_id;
    v_match:=jsonb_build_object('guestId',v_res.counterpart_guest_id,'firstName',v_name);
  end if;
  return jsonb_build_object('state','revealed','match',v_match);
end $function$;

-- Removes ballots 30 days after the Table (once finalized) and results past their 90-day expiry. Idempotent.
create function public.purge_vote_data()
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_ballots integer; v_results integer;
begin
  perform app_private.require_service_role();
  delete from public.app_ballots b using public.app_vote_periods p
    where p.table_id=b.table_id and p.finalized_at is not null and clock_timestamp()>=p.opens_at-interval '90 minutes'+interval '30 days';
  get diagnostics v_ballots=row_count;
  delete from public.app_mutual_results where expires_at<=clock_timestamp();
  get diagnostics v_results=row_count;
  return jsonb_build_object('ballotsDeleted',v_ballots,'resultsDeleted',v_results);
end $function$;

-- ---------------------------------------------------------------------------------------------------------------------
-- W09.4 recap and ratings, W09.5 conduct reports
-- ---------------------------------------------------------------------------------------------------------------------

create function public.read_my_recap(p_actor uuid,p_table_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest uuid; v_seat public.app_seats%rowtype; v_start timestamptz; v_attended boolean; v_content jsonb; v_open boolean;
begin
  v_guest:=app_private.member_guest(p_actor);
  v_seat:=app_private.own_active_seat(v_guest,p_table_id);
  v_start:=app_private.table_start(p_table_id);
  v_attended:=exists(select 1 from public.app_table_attendance where seat_id=v_seat.seat_id);
  v_open:=v_attended and clock_timestamp()>=v_start+interval '120 minutes';
  select r.content into v_content from public.app_supply_table_heads h join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id where h.table_id=p_table_id;
  return jsonb_build_object('tableTitle',v_content->>'title','canSubmit',v_open,
    'venues',coalesce((select jsonb_agg(jsonb_build_object('venueId',x.venue_id,'name',x.name) order by x.first_pos) from (
        select s.value->>'venueId' as venue_id,min(s.value->>'venueName') as name,min(s.ordinality) as first_pos
        from jsonb_array_elements(v_content->'stops') with ordinality s(value,ordinality) group by s.value->>'venueId') x),'[]'::jsonb),
    'rating',(select jsonb_build_object('overall',overall,'venueScores',venue_scores,'note',note,'updatedAt',updated_at) from public.app_ratings where table_id=p_table_id and guest_id=v_guest),
    'attendees',case when v_open then coalesce((select jsonb_agg(jsonb_build_object('guestId',a.guest_id,'firstName',m.first_name) order by m.first_name,a.guest_id)
        from public.app_table_attendance a join public.app_member_profiles m on m.guest_id=a.guest_id where a.table_id=p_table_id and a.guest_id<>v_guest),'[]'::jsonb) else '[]'::jsonb end,
    'reports',coalesce((select jsonb_agg(jsonb_build_object('reportId',c.report_id,'createdAt',c.created_at,'status',c.status) order by c.created_at desc)
        from public.app_conduct_reports c where c.table_id=p_table_id and c.author_guest_id=v_guest),'[]'::jsonb));
end $function$;

create function public.save_rating(p_actor uuid,p_table_id uuid,p_overall integer,p_venue_scores jsonb,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest uuid; v_seat public.app_seats%rowtype; v_start timestamptz; v_venues text[]; v_key text; v_val jsonb; v_note text; v_row public.app_ratings%rowtype;
begin
  v_guest:=app_private.member_guest(p_actor);
  v_seat:=app_private.own_active_seat(v_guest,p_table_id);
  v_start:=app_private.table_start(p_table_id);
  if not exists(select 1 from public.app_table_attendance where seat_id=v_seat.seat_id) or clock_timestamp()<v_start+interval '120 minutes' then
    raise exception using errcode='P0001',message='feedback_not_open'; end if;
  v_note:=nullif(btrim(coalesce(p_note,'')),'');
  if p_overall is null or p_overall not between 1 and 5 or jsonb_typeof(coalesce(p_venue_scores,'{}'::jsonb))<>'object' or length(coalesce(v_note,''))>2000 then
    raise exception using errcode='22023',message='invalid_input'; end if;
  select array_agg(distinct s.value->>'venueId') into v_venues from public.app_supply_table_heads h
    join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id cross join lateral jsonb_array_elements(r.content->'stops') s(value) where h.table_id=p_table_id;
  for v_key,v_val in select * from jsonb_each(coalesce(p_venue_scores,'{}'::jsonb)) loop
    if not v_key=any(v_venues) or jsonb_typeof(v_val)<>'number' or (v_val #>> '{}') !~ '^[1-5]$' then raise exception using errcode='22023',message='invalid_input'; end if;
  end loop;
  insert into public.app_ratings(table_id,guest_id,overall,venue_scores,note) values(p_table_id,v_guest,p_overall,coalesce(p_venue_scores,'{}'::jsonb),v_note)
    on conflict (table_id,guest_id) do update set overall=excluded.overall,venue_scores=excluded.venue_scores,note=excluded.note,updated_at=clock_timestamp()
    returning * into v_row;
  return jsonb_build_object('overall',v_row.overall,'venueScores',v_row.venue_scores,'note',v_row.note,'updatedAt',v_row.updated_at);
end $function$;

create function public.submit_conduct_report(p_actor uuid,p_table_id uuid,p_subject_guest_id uuid,p_body text,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_guest uuid; v_seat public.app_seats%rowtype; v_start timestamptz; v_row public.app_conduct_reports%rowtype; v_body text:=btrim(coalesce(p_body,''));
begin
  v_guest:=app_private.member_guest(p_actor);
  if p_operation_id is null or length(v_body) not between 1 and 4000 then raise exception using errcode='22023',message='invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conduct:'||p_operation_id::text,0));
  select * into v_row from public.app_conduct_reports where operation_id=p_operation_id;
  if found then
    if v_row.author_guest_id<>v_guest or v_row.table_id<>p_table_id or v_row.body<>v_body or v_row.subject_guest_id is distinct from p_subject_guest_id then
      raise exception using errcode='23505',message='operation_conflict'; end if;
    return jsonb_build_object('reportId',v_row.report_id,'createdAt',v_row.created_at,'status',v_row.status);
  end if;
  v_seat:=app_private.own_active_seat(v_guest,p_table_id);
  v_start:=app_private.table_start(p_table_id);
  if not exists(select 1 from public.app_table_attendance where seat_id=v_seat.seat_id) or clock_timestamp()<v_start+interval '120 minutes' then
    raise exception using errcode='P0001',message='feedback_not_open'; end if;
  if p_subject_guest_id is not null and (p_subject_guest_id=v_guest or not exists(select 1 from public.app_table_attendance a where a.table_id=p_table_id and a.guest_id=p_subject_guest_id)) then
    raise exception using errcode='22023',message='invalid_input'; end if;
  insert into public.app_conduct_reports(operation_id,table_id,author_guest_id,subject_guest_id,body) values(p_operation_id,p_table_id,v_guest,p_subject_guest_id,v_body) returning * into v_row;
  return jsonb_build_object('reportId',v_row.report_id,'createdAt',v_row.created_at,'status',v_row.status);
end $function$;

create function public.list_conduct_reports(p_actor uuid,p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_status is not null and p_status not in ('new','reviewing','resolved') then raise exception using errcode='22023',message='invalid_input'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('reportId',c.report_id,'tableId',c.table_id,'tableTitle',r.content->>'title','status',c.status,'held',c.held,
      'createdAt',c.created_at,'author',btrim(a.first_name||' '||a.last_name),'subject',case when s.guest_id is null then null else btrim(s.first_name||' '||s.last_name) end,'body',c.body)
      order by (c.status='resolved'),c.created_at desc)
    from public.app_conduct_reports c join public.app_member_profiles a on a.guest_id=c.author_guest_id left join public.app_member_profiles s on s.guest_id=c.subject_guest_id
    join public.app_supply_table_heads h on h.table_id=c.table_id join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id
    where p_status is null or c.status=p_status),'[]'::jsonb));
end $function$;

create function public.update_conduct_report(p_actor uuid,p_report_id uuid,p_status text,p_held boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_row public.app_conduct_reports%rowtype;
begin
  perform app_private.require_staff(p_actor,'admin');
  if p_report_id is null or p_status not in ('new','reviewing','resolved') or p_held is null then raise exception using errcode='22023',message='invalid_input'; end if;
  update public.app_conduct_reports set status=p_status,held=p_held,updated_at=clock_timestamp() where report_id=p_report_id returning * into v_row;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  insert into public.app_audit_events(actor_type,actor_user_id,action,subject_type,subject_id,metadata)
    values('user',p_actor,'conduct.report.triaged','supply_table',v_row.table_id,jsonb_build_object('tableId',v_row.table_id));
  return jsonb_build_object('reportId',v_row.report_id,'status',v_row.status,'held',v_row.held);
end $function$;

-- Averages only where at least three guests responded; free text never leaves this function.
create function public.read_rating_aggregates(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  perform app_private.require_staff(p_actor,'admin');
  return jsonb_build_object('tables',coalesce((select jsonb_agg(x.item order by x.item->>'localDate' desc) from (
    select jsonb_build_object('tableId',t.table_id,'title',r.content->>'title','localDate',r.content->>'localDate','responses',t.n,
      'overallAverage',case when t.n>=3 then round(t.avg_overall,2) else null end,
      'venues',case when t.n>=3 then coalesce((select jsonb_agg(jsonb_build_object('venueId',v.venue_id,'responses',v.n,'average',case when v.n>=3 then round(v.avg,2) else null end))
          from (select e.key as venue_id,count(*) as n,avg((e.value #>> '{}')::numeric) as avg from public.app_ratings q,jsonb_each(q.venue_scores) e where q.table_id=t.table_id group by e.key) v),'[]'::jsonb) else '[]'::jsonb end) as item
    from (select table_id,count(*) as n,avg(overall) as avg_overall from public.app_ratings group by table_id) t
    join public.app_supply_table_heads h on h.table_id=t.table_id join public.app_supply_table_revisions r on r.revision_id=h.published_revision_id) x),'[]'::jsonb));
end $function$;

do $$
declare v text;
begin
  foreach v in array array['public.read_tonight(uuid,uuid)','public.submit_ballot(uuid,uuid,uuid)','public.read_my_reveal(uuid,uuid)','public.purge_vote_data()',
    'public.read_my_recap(uuid,uuid)','public.save_rating(uuid,uuid,integer,jsonb,text)','public.submit_conduct_report(uuid,uuid,uuid,text,uuid)',
    'public.list_conduct_reports(uuid,text)','public.update_conduct_report(uuid,uuid,text,boolean)','public.read_rating_aggregates(uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
    execute format('grant execute on function %s to service_role',v);
  end loop;
  foreach v in array array['app_private.table_start(uuid)','app_private.member_guest(uuid)','app_private.lock_table(uuid)','app_private.ensure_vote_period(uuid)',
    'app_private.finalize_vote_period(uuid)','app_private.invalidate_vote_participation()','app_private.own_active_seat(uuid,uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v);
  end loop;
end $$;
