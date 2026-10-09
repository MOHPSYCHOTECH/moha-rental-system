-- Run after schema.sql, subscription_payments.sql, and user_hierarchy.sql in the Supabase SQL Editor.
-- Tenant portal credentials submit/list notices; workspace managers approve or decline them.

create table if not exists public.tenant_notices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  tenant_email text not null,
  tenant_name text not null,
  property_name text not null,
  unit_name text not null,
  intended_move_out_date date not null,
  reason text not null default '' check (char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists tenant_notices_workspace_status_created_idx
  on public.tenant_notices(owner_id, status, created_at desc);
create index if not exists tenant_notices_tenant_created_idx
  on public.tenant_notices(owner_id, tenant_email, property_name, unit_name, created_at desc);
create unique index if not exists tenant_notices_one_pending_per_tenant_unit_idx
  on public.tenant_notices(owner_id, tenant_email, property_name, unit_name)
  where status = 'pending';

alter table public.tenant_notices enable row level security;
revoke all on public.tenant_notices from anon, authenticated;

create or replace function public.tenant_notice_list(
  p_owner_id uuid,
  p_email text default null,
  p_portal_code text default null,
  p_tenant_property text default null,
  p_unit_name text default null
)
returns table(
  id uuid,
  tenant_email text,
  tenant_name text,
  property_name text,
  unit_name text,
  intended_move_out_date date,
  reason text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_tenant jsonb;
begin
  if p_email is not null or p_portal_code is not null then
    select workspace.owner_id, tenant.value
    into v_owner_id, v_tenant
    from public.rental_workspaces as workspace
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(workspace.data->'tenants') = 'array'
        then workspace.data->'tenants' else '[]'::jsonb end
    ) as tenant(value)
    where pg_catalog.lower(pg_catalog.btrim(coalesce(tenant.value->>'email', ''))) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')))
      and pg_catalog.lower(pg_catalog.btrim(coalesce(tenant.value->>'portalCode', ''))) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_portal_code, '')))
      and tenant.value->>'property' = p_tenant_property
      and coalesce(tenant.value->>'unitDisplayName', tenant.value->>'unit') = p_unit_name
      and pg_catalog.lower(coalesce(tenant.value->>'status', 'active')) = 'active'
    limit 1;
    if v_owner_id is null then
      raise exception 'Tenant credentials are invalid for this property and unit.' using errcode = '42501';
    end if;
    return query
    select notice.id, notice.tenant_email, notice.tenant_name, notice.property_name,
      notice.unit_name, notice.intended_move_out_date, notice.reason, notice.status,
      notice.created_at, notice.reviewed_at
    from public.tenant_notices as notice
    where notice.owner_id = v_owner_id
      and notice.tenant_email = pg_catalog.lower(pg_catalog.btrim(p_email))
      and notice.property_name = p_tenant_property
      and notice.unit_name = p_unit_name
    order by notice.created_at desc
    limit 500;
    return;
  end if;

  v_owner_id := p_owner_id;
  if (select auth.uid()) is null or v_owner_id is null or not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'Active workspace access is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.user_roles as role
    join public.profiles as profile on profile.user_id = role.user_id
    where role.user_id = (select auth.uid())
      and role.owner_id = v_owner_id
      and role.active
      and profile.user_type in ('landlord', 'property_manager')
      and role.role in ('admin', 'manager')
  ) then
    raise exception 'Landlord or property-manager access is required to view notices.' using errcode = '42501';
  end if;

  return query
  select notice.id, notice.tenant_email, notice.tenant_name, notice.property_name,
    notice.unit_name, notice.intended_move_out_date, notice.reason, notice.status,
    notice.created_at, notice.reviewed_at
  from public.tenant_notices as notice
  where notice.owner_id = v_owner_id
  order by notice.created_at desc
  limit 500;
end;
$$;

create or replace function public.tenant_notice_create(
  p_email text,
  p_portal_code text,
  p_property_name text,
  p_unit_name text,
  p_move_out_date date,
  p_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_tenant jsonb;
  v_notice_id uuid;
begin
  if p_move_out_date is null or p_move_out_date <= current_date then
    raise exception 'The intended move-out date must be in the future.' using errcode = '22023';
  end if;
  if pg_catalog.char_length(coalesce(p_reason, '')) > 1000 then
    raise exception 'The reason must be 1000 characters or fewer.' using errcode = '22023';
  end if;

  select workspace.owner_id, tenant.value
  into v_owner_id, v_tenant
  from public.rental_workspaces as workspace
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(workspace.data->'tenants') = 'array'
      then workspace.data->'tenants' else '[]'::jsonb end
  ) as tenant(value)
  where pg_catalog.lower(pg_catalog.btrim(coalesce(tenant.value->>'email', ''))) = pg_catalog.lower(pg_catalog.btrim(p_email))
    and pg_catalog.lower(pg_catalog.btrim(coalesce(tenant.value->>'portalCode', ''))) = pg_catalog.lower(pg_catalog.btrim(p_portal_code))
    and tenant.value->>'property' = p_property_name
    and coalesce(tenant.value->>'unitDisplayName', tenant.value->>'unit') = p_unit_name
    and pg_catalog.lower(coalesce(tenant.value->>'status', 'active')) = 'active'
  limit 1;
  if v_owner_id is null then
    raise exception 'Tenant credentials are invalid for this property and unit.' using errcode = '42501';
  end if;

  insert into public.tenant_notices(
    owner_id, tenant_email, tenant_name, property_name, unit_name,
    intended_move_out_date, reason
  ) values (
    v_owner_id, pg_catalog.lower(pg_catalog.btrim(p_email)),
    coalesce(nullif(v_tenant->>'name', ''), 'Tenant'), p_property_name, p_unit_name,
    p_move_out_date, pg_catalog.btrim(coalesce(p_reason, ''))
  )
  returning id into v_notice_id;
  return v_notice_id;
exception
  when unique_violation then
    raise exception 'You already have a notice awaiting landlord approval.' using errcode = '23505';
end;
$$;

create or replace function public.tenant_notice_review(
  p_notice_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before reviewing tenant notices.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or decline.' using errcode = '22023';
  end if;

  select role.owner_id
  into v_owner_id
  from public.user_roles as role
  join public.profiles as profile on profile.user_id = role.user_id
  where role.user_id = (select auth.uid())
    and role.active
    and profile.user_type in ('landlord', 'property_manager')
    and role.role in ('admin', 'manager');
  if v_owner_id is null or not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'Landlord or property-manager access is required to review notices.' using errcode = '42501';
  end if;

  update public.tenant_notices
  set status = p_decision, reviewed_at = now()
  where id = p_notice_id
    and owner_id = v_owner_id
    and status = 'pending';
  if not found then
    raise exception 'Notice not found or already reviewed.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.tenant_notice_list(uuid, text, text, text, text) from public;
revoke all on function public.tenant_notice_create(text, text, text, text, date, text) from public;
revoke all on function public.tenant_notice_review(uuid, text) from public;
grant execute on function public.tenant_notice_list(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.tenant_notice_create(text, text, text, text, date, text) to anon, authenticated;
grant execute on function public.tenant_notice_review(uuid, text) to authenticated;
