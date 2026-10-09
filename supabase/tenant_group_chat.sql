-- Run after schema.sql and user_hierarchy.sql in the Supabase SQL Editor.
-- Tenant portal codes act as credentials; only these RPCs can read or write chat messages.

create table if not exists public.tenant_group_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  property_name text not null,
  sender_name text not null,
  sender_unit text not null default '',
  sender_role text not null check (sender_role in ('tenant', 'landlord')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists tenant_group_messages_property_created_idx
  on public.tenant_group_messages(owner_id, property_name, created_at desc);

alter table public.tenant_group_messages enable row level security;
revoke all on public.tenant_group_messages from anon, authenticated;

create table if not exists public.tenant_group_message_rate_limits (
  owner_id uuid not null references auth.users(id) on delete cascade,
  property_name text not null,
  sender_key text not null,
  window_started_at timestamptz not null default now(),
  message_count integer not null default 1,
  primary key (owner_id, property_name, sender_key)
);

alter table public.tenant_group_message_rate_limits enable row level security;
revoke all on public.tenant_group_message_rate_limits from anon, authenticated;

create or replace function public.tenant_portal_login(p_email text, p_portal_code text)
returns table(tenant jsonb, workspace_name text, property_group text, payment_history jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_data jsonb;
  v_tenant jsonb;
  v_public_tenant jsonb;
begin
  if nullif(pg_catalog.btrim(p_email), '') is null or nullif(pg_catalog.btrim(p_portal_code), '') is null then
    raise exception 'Enter your tenant email and portal code.' using errcode = '22023';
  end if;

  select workspace.owner_id, workspace.data, tenant.value
  into v_owner_id, v_data, v_tenant
  from public.rental_workspaces as workspace
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(workspace.data->'tenants') = 'array'
      then workspace.data->'tenants' else '[]'::jsonb end
  ) as tenant(value)
  where pg_catalog.lower(pg_catalog.btrim(coalesce(tenant.value->>'email', ''))) = pg_catalog.lower(pg_catalog.btrim(p_email))
    and pg_catalog.lower(pg_catalog.btrim(coalesce(tenant.value->>'portalCode', ''))) = pg_catalog.lower(pg_catalog.btrim(p_portal_code))
  limit 1;

  if v_owner_id is null then
    raise exception 'Invalid tenant email or portal code.' using errcode = '42501';
  end if;

  v_public_tenant := pg_catalog.jsonb_build_object(
    'name', v_tenant->'name',
    'email', v_tenant->'email',
    'property', v_tenant->'property',
    'unit', v_tenant->'unit',
    'unitDisplayName', v_tenant->'unitDisplayName',
    'unitType', v_tenant->'unitType',
    'rent', v_tenant->'rent',
    'lease', v_tenant->'lease',
    'leaseEnd', v_tenant->'leaseEnd',
    'movedIn', v_tenant->'movedIn',
    'status', v_tenant->'status',
    'waterBill', v_tenant->'waterBill',
    'phone', v_tenant->'phone'
  );

  return query
  select v_public_tenant,
    coalesce(v_data->'settings'->>'workspaceName', 'Rental workspace'),
    coalesce(v_data->'settings'->>'propertyGroup', 'Residential'),
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'label', coalesce(nullif(pg_catalog.split_part(payment, ' · ', 7), ''), 'Manual payment'),
        'amount', coalesce(nullif(pg_catalog.regexp_replace(pg_catalog.split_part(payment, ' · ', 1), '[^0-9.]', '', 'g'), '')::numeric, 0),
        'date', pg_catalog.split_part(payment, ' · ', 5),
        'method', coalesce(nullif(pg_catalog.split_part(payment, ' · ', 6), ''), 'Manual')
      ) order by pg_catalog.split_part(payment, ' · ', 5) desc)
      from pg_catalog.jsonb_array_elements_text(
        case when pg_catalog.jsonb_typeof(v_data->'records'->'Payments') = 'array'
          then v_data->'records'->'Payments' else '[]'::jsonb end
      ) as item(payment)
      where pg_catalog.split_part(payment, ' · ', 2) = coalesce(v_tenant->>'name', '')
        and pg_catalog.split_part(payment, ' · ', 4) = coalesce(v_tenant->>'property', '')
        and pg_catalog.replace(pg_catalog.split_part(payment, ' · ', 3), 'House ', '') in (
          coalesce(v_tenant->>'unit', ''),
          coalesce(v_tenant->>'unitDisplayName', '')
        )
    ), '[]'::jsonb);
end;
$$;

create or replace function public.tenant_group_chat_read(
  p_owner_id uuid,
  p_property_name text,
  p_email text default null,
  p_portal_code text default null
)
returns table(id uuid, sender_name text, sender_unit text, sender_role text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_data jsonb;
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
      and tenant.value->>'property' = p_property_name
    limit 1;
    if v_owner_id is null then
      raise exception 'Tenant portal credentials are invalid for this property.' using errcode = '42501';
    end if;
  else
    v_owner_id := p_owner_id;
    if (select auth.uid()) is null or v_owner_id is null or not public.can_access_rental_workspace(v_owner_id) then
      raise exception 'Active workspace access is required.' using errcode = '42501';
    end if;
    select data into v_data from public.rental_workspaces where owner_id = v_owner_id;
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(v_data->'properties') = 'array'
          then v_data->'properties' else '[]'::jsonb end
      ) as property(value)
      where property.value->>'name' = p_property_name
    ) then
      raise exception 'Property not found in this workspace.' using errcode = '22023';
    end if;
  end if;

  return query
  select chat.id, chat.sender_name, chat.sender_unit, chat.sender_role, chat.body, chat.created_at
  from public.tenant_group_messages as chat
  where chat.owner_id = v_owner_id and chat.property_name = p_property_name
  order by chat.created_at desc
  limit 200;
end;
$$;

create or replace function public.tenant_group_chat_send(
  p_owner_id uuid,
  p_property_name text,
  p_body text,
  p_email text default null,
  p_portal_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_tenant jsonb;
  v_sender_name text;
  v_sender_unit text := '';
  v_sender_role text;
  v_sender_key text;
  v_count integer;
  v_message_id uuid;
  v_data jsonb;
begin
  if nullif(pg_catalog.btrim(p_body), '') is null or pg_catalog.char_length(p_body) > 1000 then
    raise exception 'Messages must contain 1 to 1000 characters.' using errcode = '22023';
  end if;

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
      and tenant.value->>'property' = p_property_name
    limit 1;
    if v_owner_id is null then
      raise exception 'Tenant portal credentials are invalid for this property.' using errcode = '42501';
    end if;
    v_sender_name := coalesce(nullif(v_tenant->>'name', ''), 'Tenant');
    v_sender_unit := coalesce(nullif(v_tenant->>'unitDisplayName', ''), nullif(v_tenant->>'unit', ''), '');
    v_sender_role := 'tenant';
    v_sender_key := 'tenant:' || pg_catalog.lower(pg_catalog.btrim(p_email)) || ':' || coalesce(v_tenant->>'unit', '');
  else
    v_owner_id := p_owner_id;
    if (select auth.uid()) is null or v_owner_id is null or not public.can_access_rental_workspace(v_owner_id) then
      raise exception 'Active workspace access is required.' using errcode = '42501';
    end if;
    select data into v_data from public.rental_workspaces where owner_id = v_owner_id;
    if not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(v_data->'properties') = 'array'
          then v_data->'properties' else '[]'::jsonb end
      ) as property(value)
      where property.value->>'name' = p_property_name
    ) then
      raise exception 'Property not found in this workspace.' using errcode = '22023';
    end if;
    select coalesce(nullif(display_name, ''), 'Property team')
    into v_sender_name
    from public.profiles
    where user_id = (select auth.uid());
    v_sender_name := coalesce(v_sender_name, 'Property team');
    v_sender_role := 'landlord';
    v_sender_key := 'staff:' || (select auth.uid())::text;
  end if;

  insert into public.tenant_group_message_rate_limits(owner_id, property_name, sender_key, window_started_at, message_count)
  values (v_owner_id, p_property_name, v_sender_key, now(), 1)
  on conflict (owner_id, property_name, sender_key) do update
  set window_started_at = case
        when public.tenant_group_message_rate_limits.window_started_at <= now() - interval '1 minute' then now()
        else public.tenant_group_message_rate_limits.window_started_at
      end,
      message_count = case
        when public.tenant_group_message_rate_limits.window_started_at <= now() - interval '1 minute' then 1
        else public.tenant_group_message_rate_limits.message_count + 1
      end
  returning message_count into v_count;
  if v_count > 10 then
    raise exception 'Message limit reached. Please wait a minute before posting again.' using errcode = '42900';
  end if;

  insert into public.tenant_group_messages(owner_id, property_name, sender_name, sender_unit, sender_role, body)
  values (v_owner_id, p_property_name, v_sender_name, v_sender_unit, v_sender_role, pg_catalog.btrim(p_body))
  returning id into v_message_id;
  return v_message_id;
end;
$$;

revoke all on function public.tenant_portal_login(text, text) from public;
revoke all on function public.tenant_group_chat_read(uuid, text, text, text) from public;
revoke all on function public.tenant_group_chat_send(uuid, text, text, text, text) from public;
grant execute on function public.tenant_portal_login(text, text) to anon, authenticated;
grant execute on function public.tenant_group_chat_read(uuid, text, text, text) to anon, authenticated;
grant execute on function public.tenant_group_chat_send(uuid, text, text, text, text) to anon, authenticated;
