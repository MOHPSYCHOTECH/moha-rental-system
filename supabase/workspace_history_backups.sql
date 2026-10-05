-- Run after schema.sql and user_hierarchy.sql.
-- Records changes to workspace sections and schedules one full snapshot per workspace per day.

create table if not exists public.rental_workspace_audit (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created', 'updated')),
  changed_at timestamptz not null default now(),
  changed_sections text[] not null default '{}',
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb
);

create index if not exists rental_workspace_audit_owner_changed_idx
  on public.rental_workspace_audit(owner_id, changed_at desc);

create table if not exists public.rental_workspace_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  backup_date date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  workspace_data jsonb not null,
  unique (owner_id, backup_date)
);

create index if not exists rental_workspace_backups_owner_created_idx
  on public.rental_workspace_backups(owner_id, created_at desc);

alter table public.rental_workspace_audit enable row level security;
alter table public.rental_workspace_backups enable row level security;

revoke all on public.rental_workspace_audit from anon, authenticated;
revoke all on public.rental_workspace_backups from anon, authenticated;
grant select on public.rental_workspace_audit to authenticated;
grant select on public.rental_workspace_backups to authenticated;

drop policy if exists "Workspace admins can read audit history" on public.rental_workspace_audit;
create policy "Workspace admins can read audit history"
  on public.rental_workspace_audit for select to authenticated
  using (public.can_access_rental_workspace(owner_id) and public.is_subscription_admin());

drop policy if exists "Workspace admins can read backups" on public.rental_workspace_backups;
create policy "Workspace admins can read backups"
  on public.rental_workspace_backups for select to authenticated
  using (public.can_access_rental_workspace(owner_id) and public.is_subscription_admin());

create or replace function public.audit_rental_workspace_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := coalesce(new.data, '{}'::jsonb);
  v_sections text[];
  v_before_values jsonb;
  v_after_values jsonb;
begin
  if tg_op = 'UPDATE' then
    v_before := coalesce(old.data, '{}'::jsonb);
    if v_before is not distinct from v_after then
      return new;
    end if;
  end if;

  select coalesce(array_agg(changed.key order by changed.key), array[]::text[])
  into v_sections
  from (
    select coalesce(previous.key, current.key) as key
    from jsonb_each(v_before) as previous(key, value)
    full join jsonb_each(v_after) as current(key, value) using (key)
    where previous.value is distinct from current.value
  ) as changed;

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into v_before_values
  from jsonb_each(v_before) as entry(key, value)
  where entry.key = any(v_sections);

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  into v_after_values
  from jsonb_each(v_after) as entry(key, value)
  where entry.key = any(v_sections);

  insert into public.rental_workspace_audit (
    owner_id, actor_id, action, changed_sections, before_values, after_values
  ) values (
    new.owner_id,
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    v_sections,
    v_before_values,
    v_after_values
  );

  return new;
end;
$$;

revoke all on function public.audit_rental_workspace_change() from public, anon, authenticated;

drop trigger if exists rental_workspace_audit_changes on public.rental_workspaces;
create trigger rental_workspace_audit_changes
after insert or update on public.rental_workspaces
for each row execute function public.audit_rental_workspace_change();

create or replace function public.create_daily_rental_workspace_backups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  insert into public.rental_workspace_backups (owner_id, backup_date, workspace_data)
  select workspace.owner_id, (now() at time zone 'UTC')::date, workspace.data
  from public.rental_workspaces as workspace
  on conflict (owner_id, backup_date) do nothing;

  get diagnostics v_inserted = row_count;

  delete from public.rental_workspace_backups
  where created_at < now() - interval '365 days';

  delete from public.rental_workspace_audit
  where changed_at < now() - interval '365 days';

  return v_inserted;
end;
$$;

revoke all on function public.create_daily_rental_workspace_backups() from public, anon, authenticated;

create or replace function public.restore_rental_workspace_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_workspace_data jsonb;
begin
  if (select auth.uid()) is null or not public.is_subscription_admin() then
    raise exception 'Active workspace administrator access is required.' using errcode = '42501';
  end if;

  select backup.owner_id, backup.workspace_data
  into v_owner_id, v_workspace_data
  from public.rental_workspace_backups as backup
  where backup.id = p_backup_id;

  if not found then
    raise exception 'Workspace backup not found.' using errcode = 'P0002';
  end if;

  if not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'This backup is outside your workspace.' using errcode = '42501';
  end if;

  update public.rental_workspaces
  set data = v_workspace_data
  where owner_id = v_owner_id;

  if not found then
    raise exception 'Workspace no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.restore_rental_workspace_backup(uuid) from public, anon;
grant execute on function public.restore_rental_workspace_backup(uuid) to authenticated;

create or replace function public.delete_rental_workspace_backup(p_backup_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  if (select auth.uid()) is null or not public.is_subscription_admin() then
    raise exception 'Active workspace administrator access is required.' using errcode = '42501';
  end if;

  select backup.owner_id
  into v_owner_id
  from public.rental_workspace_backups as backup
  where backup.id = p_backup_id;

  if not found then
    raise exception 'Workspace backup not found.' using errcode = 'P0002';
  end if;

  if not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'This backup is outside your workspace.' using errcode = '42501';
  end if;

  delete from public.rental_workspace_backups
  where id = p_backup_id and owner_id = v_owner_id;
end;
$$;

revoke all on function public.delete_rental_workspace_backup(uuid) from public, anon;
grant execute on function public.delete_rental_workspace_backup(uuid) to authenticated;

-- Capture an initial snapshot now, then once each day at 05:15 UTC.
select public.create_daily_rental_workspace_backups();
create extension if not exists pg_cron;
select cron.unschedule(jobid)
from cron.job
where jobname = 'rental-workspace-daily-backup';
select cron.schedule(
  'rental-workspace-daily-backup',
  '15 5 * * *',
  'select public.create_daily_rental_workspace_backups();'
);
