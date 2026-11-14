-- Append-only audit foundation. Keep actor/subject/request/operation identifiers
-- separate from metadata so metadata can be tightly allowlisted and PII-free.

create function app_private.is_safe_audit_metadata(p_metadata jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $function$
  select jsonb_typeof(p_metadata) = 'object'
    and (select count(*) from jsonb_object_keys(p_metadata)) <= 5
    and not exists (
      select 1
      from jsonb_each(p_metadata) as entry(key, value)
      where case
        when entry.key in ('state', 'from_state', 'to_state')
          then jsonb_typeof(entry.value) = 'string'
            and entry.value #>> '{}' in (
              'invited', 'activated', 'deleted', 'queued', 'sending',
              'accepted', 'delivered', 'failed', 'unknown'
            )
        when entry.key = 'reason_code'
          then jsonb_typeof(entry.value) = 'string'
            and entry.value #>> '{}' in (
              'validation_failed', 'unauthenticated', 'forbidden', 'not_found',
              'rate_limited', 'conflict', 'invalid_link', 'provider_rejected',
              'provider_outcome_unknown', 'temporarily_unavailable',
              'duplicate_request', 'honeypot_ignored'
            )
        when entry.key = 'attempt_number'
          then jsonb_typeof(entry.value) = 'number'
            and entry.value #>> '{}' ~ '^[0-9]{1,3}$'
        when entry.key = 'retryable'
          then jsonb_typeof(entry.value) = 'boolean'
        else false
      end is not true
    );
$function$;

revoke all on function app_private.is_safe_audit_metadata(jsonb) from public, anon, authenticated;
grant execute on function app_private.is_safe_audit_metadata(jsonb) to service_role;

create table public.app_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_user_id uuid,
  system_actor text check (system_actor is null or system_actor in (
    'auth_callback', 'email_delivery_worker', 'retention_worker', 'supply_sync_worker'
  )),
  action text not null check (action in (
    'waitlist.signup.created', 'app.admission.invited', 'app.admission.activated',
    'app.admission.deleted', 'app.invitation.queued', 'app.invitation.accepted',
    'app.invitation.delivered', 'app.invitation.failed', 'app.invitation.unknown',
    'app.invitation.retry_requested', 'member_link.requested',
    'auth.callback.rejected', 'authorization.denied'
  )),
  subject_type text not null check (subject_type in (
    'waitlist_signup', 'app_admission', 'invitation_delivery',
    'delivery_attempt', 'auth_identity', 'member_link_request'
  )),
  subject_id uuid not null,
  request_id uuid,
  operation_id uuid,
  metadata jsonb not null default '{}'::jsonb
    check (app_private.is_safe_audit_metadata(metadata)),
  occurred_at timestamptz not null default now(),
  check (
    (actor_type = 'user' and actor_user_id is not null and system_actor is null)
    or (actor_type = 'system' and actor_user_id is null and system_actor is not null)
  )
);

create index app_audit_events_occurred_idx on public.app_audit_events (occurred_at desc, event_id);
create index app_audit_events_subject_idx on public.app_audit_events (subject_type, subject_id, occurred_at desc);
create index app_audit_events_request_idx on public.app_audit_events (request_id) where request_id is not null;
create index app_audit_events_operation_idx on public.app_audit_events (operation_id) where operation_id is not null;

alter table public.app_audit_events enable row level security;

revoke all on public.app_audit_events from public, anon, authenticated, service_role;
grant select, insert on public.app_audit_events to service_role;

comment on table public.app_audit_events is
  'Append-only server audit events. Metadata is restricted to redacted state/reason/counter fields; never place names, emails, tokens, provider payloads, or free-form errors here.';
