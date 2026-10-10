-- Run after tenant_email_notifications.sql and landlord_public_signup.sql.
-- All welcome messages use the private queue delivered by process-rent-invoices.

alter table public.tenant_email_jobs
  drop constraint if exists tenant_email_jobs_event_type_check;
alter table public.tenant_email_jobs
  add constraint tenant_email_jobs_event_type_check
  check (event_type in (
    'rent_reminder', 'payment_receipt',
    'maintenance_submitted', 'maintenance_status',
    'notice_submitted', 'notice_status', 'account_welcome'
  ));

create or replace function public.enqueue_new_tenant_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_tenants jsonb := case
    when pg_catalog.jsonb_typeof(new.data->'tenants') = 'array' then new.data->'tenants'
    else '[]'::jsonb
  end;
  v_old_tenants jsonb := '[]'::jsonb;
  v_tenant jsonb;
  v_email text;
  v_identity text;
  v_workspace_name text := coalesce(
    nullif(pg_catalog.btrim(new.data->'settings'->>'workspaceName'), ''),
    'your rental workspace'
  );
begin
  if tg_op = 'UPDATE' then
    v_old_tenants := case
      when pg_catalog.jsonb_typeof(old.data->'tenants') = 'array' then old.data->'tenants'
      else '[]'::jsonb
    end;
  end if;

  for v_tenant in
    select tenant.value
    from pg_catalog.jsonb_array_elements(v_new_tenants) as tenant(value)
  loop
    v_email := pg_catalog.lower(pg_catalog.btrim(v_tenant->>'email'));
    if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      continue;
    end if;

    v_identity := coalesce(
      nullif(pg_catalog.btrim(v_tenant->>'portalCode'), ''),
      v_email || '|' || coalesce(v_tenant->>'property', '') || '|' || coalesce(v_tenant->>'unit', '')
    );

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_old_tenants) as previous(value)
      where coalesce(
        nullif(pg_catalog.btrim(previous.value->>'portalCode'), ''),
        pg_catalog.lower(pg_catalog.btrim(previous.value->>'email')) || '|'
          || coalesce(previous.value->>'property', '') || '|'
          || coalesce(previous.value->>'unit', '')
      ) = v_identity
    ) then
      continue;
    end if;

    insert into public.tenant_email_jobs(
      owner_id, event_type, idempotency_key, tenant_email, tenant_name,
      property_name, unit_name, payload
    )
    values (
      new.owner_id,
      'account_welcome',
      'tenant-welcome:' || new.owner_id::text || ':' || pg_catalog.md5(v_identity),
      v_email,
      coalesce(nullif(pg_catalog.btrim(v_tenant->>'name'), ''), 'Tenant'),
      coalesce(v_tenant->>'property', ''),
      coalesce(v_tenant->>'unitDisplayName', v_tenant->>'unit', ''),
      pg_catalog.jsonb_build_object(
        'account_type', 'tenant',
        'workspace_name', v_workspace_name,
        'portal_code', coalesce(v_tenant->>'portalCode', '')
      )
    )
    on conflict (idempotency_key) do nothing;
  end loop;
  return new;
end;
$$;

revoke all on function public.enqueue_new_tenant_welcome_email() from public, anon, authenticated;

drop trigger if exists rental_workspace_tenant_welcome_insert on public.rental_workspaces;
create trigger rental_workspace_tenant_welcome_insert
after insert on public.rental_workspaces
for each row execute function public.enqueue_new_tenant_welcome_email();

drop trigger if exists rental_workspace_tenant_welcome_update on public.rental_workspaces;
create trigger rental_workspace_tenant_welcome_update
after update of data on public.rental_workspaces
for each row
when (old.data->'tenants' is distinct from new.data->'tenants')
execute function public.enqueue_new_tenant_welcome_email();

create or replace function public.enqueue_approved_landlord_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_email text;
begin
  select
    coalesce(nullif(pg_catalog.btrim(profile.display_name), ''), new.full_name),
    coalesce(nullif(pg_catalog.lower(pg_catalog.btrim(profile.email)), ''), pg_catalog.lower(pg_catalog.btrim(new.email)))
  into v_name, v_email
  from public.profiles as profile
  where profile.user_id = new.user_id;

  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return new;
  end if;

  insert into public.tenant_email_jobs(
    owner_id, event_type, idempotency_key, tenant_email, tenant_name,
    property_name, unit_name, payload
  )
  values (
    new.user_id,
    'account_welcome',
    'landlord-welcome:' || new.user_id::text,
    v_email,
    coalesce(v_name, 'Landlord'),
    coalesce(v_name, 'Landlord workspace'),
    'landlord',
    pg_catalog.jsonb_build_object('account_type', 'landlord', 'workspace_name', coalesce(v_name, 'Landlord workspace'))
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

revoke all on function public.enqueue_approved_landlord_welcome_email() from public, anon, authenticated;

drop trigger if exists landlord_signup_approved_welcome_email on public.landlord_signup_requests;
create trigger landlord_signup_approved_welcome_email
after update on public.landlord_signup_requests
for each row
when (old.status = 'pending' and new.status = 'approved')
execute function public.enqueue_approved_landlord_welcome_email();