-- Run after user_hierarchy.sql to enable public visit/app-download tracking and
-- platform-administrator-only access to aggregate analytics.
create table if not exists public.public_app_analytics_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  app_role text check (app_role in ('landlord', 'caretaker', 'tenant')),
  created_at timestamptz not null default now()
);

alter table public.public_app_analytics_events
  drop constraint if exists public_app_analytics_events_event_type_check;
alter table public.public_app_analytics_events
  drop constraint if exists public_app_analytics_event_role_check;
update public.public_app_analytics_events
  set event_type = 'download'
  where event_type = 'app_open';
alter table public.public_app_analytics_events
  add constraint public_app_analytics_events_event_type_check
  check (event_type in ('visit', 'download'));
alter table public.public_app_analytics_events
  add constraint public_app_analytics_event_role_check
  check (
    (event_type = 'visit' and app_role is null)
    or (event_type = 'download' and app_role is not null)
  );

create index if not exists public_app_analytics_events_type_role_idx
  on public.public_app_analytics_events (event_type, app_role);

alter table public.public_app_analytics_events enable row level security;
revoke all on table public.public_app_analytics_events from public, anon, authenticated;

create or replace function public.record_public_app_event(p_event_type text, p_app_role text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event_type = 'visit' and p_app_role is null then
    insert into public.public_app_analytics_events (event_type, app_role)
    values ('visit', null);
    return;
  end if;

  if p_event_type = 'download' and p_app_role in ('landlord', 'caretaker', 'tenant') then
    insert into public.public_app_analytics_events (event_type, app_role)
    values ('download', p_app_role);
    return;
  end if;

  raise exception 'Invalid public analytics event.' using errcode = '22023';
end;
$$;

revoke all on function public.record_public_app_event(text, text) from public, anon, authenticated;
grant execute on function public.record_public_app_event(text, text) to anon, authenticated;

create or replace function public.get_platform_app_analytics()
returns table (
  web_visits bigint,
  landlord_downloads bigint,
  caretaker_downloads bigint,
  tenant_downloads bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required.' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where event.event_type = 'visit'),
    count(*) filter (where event.event_type = 'download' and event.app_role = 'landlord'),
    count(*) filter (where event.event_type = 'download' and event.app_role = 'caretaker'),
    count(*) filter (where event.event_type = 'download' and event.app_role = 'tenant')
  from public.public_app_analytics_events as event;
end;
$$;

revoke all on function public.get_platform_app_analytics() from public, anon;
grant execute on function public.get_platform_app_analytics() to authenticated;
