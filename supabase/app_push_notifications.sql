-- Run after user_hierarchy.sql and tenant_group_chat.sql to enable
-- role-targeted Android push notifications sent by platform administrators.

create table if not exists public.app_push_devices (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (char_length(token) between 32 and 4096),
  app_role text not null check (app_role in ('landlord', 'caretaker', 'tenant')),
  user_id uuid references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  tenant_email text,
  created_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now(),
  constraint app_push_devices_identity_check check (
    (app_role = 'tenant' and user_id is null and owner_id is not null and tenant_email is not null)
    or (app_role in ('landlord', 'caretaker') and user_id is not null and owner_id is null and tenant_email is null)
  )
);

create index if not exists app_push_devices_role_idx on public.app_push_devices(app_role);
create index if not exists app_push_devices_user_idx on public.app_push_devices(user_id) where user_id is not null;
create index if not exists app_push_devices_owner_email_idx on public.app_push_devices(owner_id, tenant_email) where app_role = 'tenant';

alter table public.app_push_devices enable row level security;
revoke all on table public.app_push_devices from public, anon, authenticated;

create table if not exists public.app_push_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  body text not null check (char_length(body) between 1 and 500),
  recipient_roles text[] not null check (
    cardinality(recipient_roles) between 1 and 3
    and recipient_roles <@ array['landlord', 'caretaker', 'tenant']::text[]
  ),
  status text not null check (status in ('sent', 'partial', 'failed')),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists app_push_campaigns_created_idx on public.app_push_campaigns(created_at desc);

alter table public.app_push_campaigns enable row level security;
revoke all on table public.app_push_campaigns from public, anon;
revoke insert, update, delete on table public.app_push_campaigns from authenticated;
grant select on table public.app_push_campaigns to authenticated;
drop policy if exists "Platform administrators can read push campaign history" on public.app_push_campaigns;
create policy "Platform administrators can read push campaign history"
  on public.app_push_campaigns for select to authenticated
  using (public.is_platform_admin());

create or replace function public.register_my_app_push_device(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
begin
  if v_user_id is null then
    raise exception 'Sign in before registering this device.' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) not between 32 and 4096 then
    raise exception 'The push notification token is invalid.' using errcode = '22023';
  end if;

  select case profile.user_type
    when 'caretaker' then 'caretaker'
    when 'landlord' then 'landlord'
    when 'property_manager' then 'landlord'
    else null
  end
  into v_role
  from public.profiles as profile
  join public.user_roles as account_role on account_role.user_id = profile.user_id
  where profile.user_id = v_user_id
    and profile.user_type in ('landlord', 'property_manager', 'caretaker')
    and account_role.active;

  if v_role is null then
    raise exception 'This account is not an active landlord or caretaker.' using errcode = '42501';
  end if;

  insert into public.app_push_devices(token, app_role, user_id, owner_id, tenant_email, last_registered_at)
  values (p_token, v_role, v_user_id, null, null, now())
  on conflict (token) do update
    set app_role = excluded.app_role,
        user_id = excluded.user_id,
        owner_id = null,
        tenant_email = null,
        last_registered_at = now();

  return v_role;
end;
$$;

create or replace function public.register_tenant_app_push_device(p_email text, p_portal_code text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_tenant_email text;
begin
  if nullif(pg_catalog.btrim(p_email), '') is null or nullif(pg_catalog.btrim(p_portal_code), '') is null then
    raise exception 'Enter your tenant email and portal code.' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) not between 32 and 4096 then
    raise exception 'The push notification token is invalid.' using errcode = '22023';
  end if;

  select workspace.owner_id, pg_catalog.lower(pg_catalog.btrim(tenant.value->>'email'))
  into v_owner_id, v_tenant_email
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

  insert into public.app_push_devices(token, app_role, user_id, owner_id, tenant_email, last_registered_at)
  values (p_token, 'tenant', null, v_owner_id, v_tenant_email, now())
  on conflict (token) do update
    set app_role = 'tenant',
        user_id = null,
        owner_id = excluded.owner_id,
        tenant_email = excluded.tenant_email,
        last_registered_at = now();
end;
$$;

revoke all on function public.register_my_app_push_device(text) from public, anon, authenticated;
grant execute on function public.register_my_app_push_device(text) to authenticated;
revoke all on function public.register_tenant_app_push_device(text, text, text) from public, anon, authenticated;
grant execute on function public.register_tenant_app_push_device(text, text, text) to anon, authenticated;
