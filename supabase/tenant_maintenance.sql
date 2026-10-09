-- Run after schema.sql and user_hierarchy.sql.
-- Tenant portal credentials can submit/read their own requests. Workspace managers approve and complete them.

create table if not exists public.tenant_maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  property_name text not null,
  tenant_email text not null,
  tenant_name text not null,
  unit_name text not null,
  issue_type text not null,
  description text not null check (char_length(description) between 5 and 1000),
  priority text not null check (priority in ('Low', 'Medium', 'High')),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'completed')),
  tenant_responsible boolean not null default false,
  final_cost numeric(12, 2) check (final_cost is null or final_cost >= 0),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  completed_at timestamptz
);

create index if not exists tenant_maintenance_requests_workspace_status_idx
  on public.tenant_maintenance_requests(owner_id, property_name, status, created_at desc);
create index if not exists tenant_maintenance_requests_tenant_idx
  on public.tenant_maintenance_requests(owner_id, tenant_email, property_name, unit_name, created_at desc);

alter table public.tenant_maintenance_requests enable row level security;
revoke all on public.tenant_maintenance_requests from anon, authenticated;

create or replace function public.tenant_maintenance_list(
  p_owner_id uuid,
  p_property_name text default null,
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
  issue_type text,
  description text,
  priority text,
  status text,
  tenant_responsible boolean,
  final_cost numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_tenant jsonb;
  v_data jsonb;
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
    select request.id, request.tenant_email, request.tenant_name, request.property_name, request.unit_name,
      request.issue_type, request.description, request.priority, request.status,
      request.tenant_responsible, request.final_cost, request.created_at
    from public.tenant_maintenance_requests as request
    where request.owner_id = v_owner_id
      and request.property_name = p_tenant_property
      and request.tenant_email = pg_catalog.lower(pg_catalog.btrim(p_email))
      and request.unit_name = p_unit_name
    order by request.created_at desc
    limit 200;
    return;
  end if;

  v_owner_id := p_owner_id;
  if (select auth.uid()) is null or v_owner_id is null or not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'Active workspace access is required.' using errcode = '42501';
  end if;
  select data into v_data from public.rental_workspaces where owner_id = v_owner_id;
  if p_property_name is not null and not exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(v_data->'properties') = 'array'
        then v_data->'properties' else '[]'::jsonb end
    ) as property(value)
    where property.value->>'name' = p_property_name
  ) then
    raise exception 'Property not found in this workspace.' using errcode = '22023';
  end if;

  return query
  select request.id, request.tenant_email, request.tenant_name, request.property_name, request.unit_name,
    request.issue_type, request.description, request.priority, request.status,
    request.tenant_responsible, request.final_cost, request.created_at
  from public.tenant_maintenance_requests as request
  where request.owner_id = v_owner_id
    and (p_property_name is null or request.property_name = p_property_name)
  order by request.created_at desc
  limit 500;
end;
$$;

create or replace function public.tenant_maintenance_create(
  p_email text,
  p_portal_code text,
  p_property_name text,
  p_unit_name text,
  p_issue_type text,
  p_description text,
  p_priority text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_tenant jsonb;
  v_request_id uuid;
begin
  if nullif(pg_catalog.btrim(p_description), '') is null or pg_catalog.char_length(pg_catalog.btrim(p_description)) < 5 or pg_catalog.char_length(p_description) > 1000 then
    raise exception 'Describe the issue in 5 to 1000 characters.' using errcode = '22023';
  end if;
  if p_issue_type not in ('Plumbing', 'Electrical', 'Appliance', 'Pest control', 'Security', 'Common area', 'Other')
    or p_priority not in ('Low', 'Medium', 'High') then
    raise exception 'Choose a valid issue type and priority.' using errcode = '22023';
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

  insert into public.tenant_maintenance_requests(
    owner_id, property_name, tenant_email, tenant_name, unit_name, issue_type, description, priority
  ) values (
    v_owner_id, p_property_name, pg_catalog.lower(pg_catalog.btrim(p_email)),
    coalesce(nullif(v_tenant->>'name', ''), 'Tenant'), p_unit_name,
    p_issue_type, pg_catalog.btrim(p_description), p_priority
  )
  returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.tenant_maintenance_review(
  p_request_id uuid,
  p_decision text,
  p_tenant_responsible boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before reviewing maintenance requests.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approve or decline.' using errcode = '22023';
  end if;

  select role.owner_id, role.role
  into v_owner_id, v_role
  from public.user_roles as role
  join public.profiles as profile on profile.user_id = role.user_id
  where role.user_id = (select auth.uid())
    and role.active
    and profile.user_type in ('landlord', 'property_manager')
    and role.role in ('admin', 'manager');
  if v_owner_id is null or not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'Landlord or property-manager access is required to review requests.' using errcode = '42501';
  end if;

  update public.tenant_maintenance_requests
  set status = p_decision,
      tenant_responsible = case when p_decision = 'approved' then coalesce(p_tenant_responsible, false) else false end,
      reviewed_at = now()
  where id = p_request_id
    and owner_id = v_owner_id
    and status = 'submitted';
  if not found then
    raise exception 'Request not found or already reviewed.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.tenant_maintenance_complete(
  p_request_id uuid,
  p_final_cost numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before completing maintenance requests.' using errcode = '42501';
  end if;
  if p_final_cost is null or p_final_cost < 0 then
    raise exception 'Enter a valid final cost.' using errcode = '22023';
  end if;

  select role.owner_id, role.role
  into v_owner_id, v_role
  from public.user_roles as role
  join public.profiles as profile on profile.user_id = role.user_id
  where role.user_id = (select auth.uid())
    and role.active
    and profile.user_type in ('landlord', 'property_manager')
    and role.role in ('admin', 'manager');
  if v_owner_id is null or not public.can_access_rental_workspace(v_owner_id) then
    raise exception 'Landlord or property-manager access is required to complete requests.' using errcode = '42501';
  end if;

  update public.tenant_maintenance_requests
  set status = 'completed', final_cost = p_final_cost, completed_at = now()
  where id = p_request_id and owner_id = v_owner_id and status = 'approved';
  if not found then
    raise exception 'Only an approved request can be marked completed.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.tenant_maintenance_list(uuid, text, text, text, text, text) from public;
revoke all on function public.tenant_maintenance_create(text, text, text, text, text, text, text) from public;
revoke all on function public.tenant_maintenance_review(uuid, text, boolean) from public;
revoke all on function public.tenant_maintenance_complete(uuid, numeric) from public;
grant execute on function public.tenant_maintenance_list(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function public.tenant_maintenance_create(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.tenant_maintenance_review(uuid, text, boolean) to authenticated;
grant execute on function public.tenant_maintenance_complete(uuid, numeric) to authenticated;
