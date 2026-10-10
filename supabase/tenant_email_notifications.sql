-- Run after schema.sql, subscription_payments.sql, user_hierarchy.sql,
-- rent_c2b.sql, tenant_maintenance.sql, and tenant_notices.sql.
-- Email events are queued in the database and delivered by the scheduled Resend worker.

create table if not exists public.tenant_email_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'rent_reminder', 'payment_receipt',
    'maintenance_submitted', 'maintenance_status',
    'notice_submitted', 'notice_status'
  )),
  idempotency_key text not null unique,
  tenant_email text not null,
  tenant_name text not null,
  property_name text not null,
  unit_name text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_email_jobs
  drop constraint if exists tenant_email_jobs_status_check;
alter table public.tenant_email_jobs
  add constraint tenant_email_jobs_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled'));

create index if not exists tenant_email_jobs_pending_idx
  on public.tenant_email_jobs(next_attempt_at, created_at)
  where status in ('pending', 'sending');

alter table public.tenant_email_jobs enable row level security;
revoke all on public.tenant_email_jobs from anon, authenticated;
grant all on public.tenant_email_jobs to service_role;

create or replace function public.set_tenant_email_jobs_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists tenant_email_jobs_updated_at on public.tenant_email_jobs;
create trigger tenant_email_jobs_updated_at
before update on public.tenant_email_jobs
for each row execute function public.set_tenant_email_jobs_updated_at();

create or replace function public.enqueue_tenant_maintenance_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_payload jsonb;
  v_idempotency_key text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'maintenance_submitted';
    v_payload := pg_catalog.jsonb_build_object(
      'issue_type', new.issue_type,
      'description', new.description,
      'priority', new.priority,
      'status', new.status
    );
    v_idempotency_key := 'maintenance-submitted:' || new.id::text;
  elsif old.status is distinct from new.status
    and new.status in ('approved', 'rejected', 'completed') then
    v_event_type := 'maintenance_status';
    v_payload := pg_catalog.jsonb_build_object(
      'issue_type', new.issue_type,
      'description', new.description,
      'priority', new.priority,
      'status', new.status,
      'final_cost', new.final_cost,
      'tenant_responsible', new.tenant_responsible
    );
    v_idempotency_key := 'maintenance-status:' || new.id::text || ':' || new.status;
  else
    return new;
  end if;

  if new.tenant_email is null or pg_catalog.btrim(new.tenant_email) = '' then
    return new;
  end if;
  insert into public.tenant_email_jobs(
    owner_id, event_type, idempotency_key, tenant_email, tenant_name,
    property_name, unit_name, payload
  )
  values (
    new.owner_id, v_event_type, v_idempotency_key,
    pg_catalog.lower(pg_catalog.btrim(new.tenant_email)), new.tenant_name,
    new.property_name, new.unit_name, v_payload
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists tenant_maintenance_email_events on public.tenant_maintenance_requests;
create trigger tenant_maintenance_email_events
after insert or update on public.tenant_maintenance_requests
for each row execute function public.enqueue_tenant_maintenance_email();

create or replace function public.enqueue_tenant_notice_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_payload jsonb;
  v_idempotency_key text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'notice_submitted';
    v_payload := pg_catalog.jsonb_build_object(
      'intended_move_out_date', new.intended_move_out_date,
      'reason', new.reason,
      'status', new.status
    );
    v_idempotency_key := 'notice-submitted:' || new.id::text;
  elsif old.status is distinct from new.status
    and new.status in ('approved', 'rejected') then
    v_event_type := 'notice_status';
    v_payload := pg_catalog.jsonb_build_object(
      'intended_move_out_date', new.intended_move_out_date,
      'reason', new.reason,
      'status', new.status
    );
    v_idempotency_key := 'notice-status:' || new.id::text || ':' || new.status;
  else
    return new;
  end if;

  if new.tenant_email is null or pg_catalog.btrim(new.tenant_email) = '' then
    return new;
  end if;
  insert into public.tenant_email_jobs(
    owner_id, event_type, idempotency_key, tenant_email, tenant_name,
    property_name, unit_name, payload
  )
  values (
    new.owner_id, v_event_type, v_idempotency_key,
    pg_catalog.lower(pg_catalog.btrim(new.tenant_email)), new.tenant_name,
    new.property_name, new.unit_name, v_payload
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists tenant_notice_email_events on public.tenant_notices;
create trigger tenant_notice_email_events
after insert or update on public.tenant_notices
for each row execute function public.enqueue_tenant_notice_email();

create or replace function public.enqueue_direct_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_email text;
begin
  select pg_catalog.lower(pg_catalog.btrim(tenant.value->>'email'))
  into v_tenant_email
  from public.rental_workspaces workspace
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(workspace.data->'tenants') = 'array'
      then workspace.data->'tenants' else '[]'::jsonb end
  ) as tenant(value)
  where workspace.owner_id = new.owner_id
    and tenant.value->>'property' = new.property_name
    and (
      coalesce(tenant.value->>'unitDisplayName', tenant.value->>'unit') = new.unit_name
      or tenant.value->>'unit' = new.unit_name
    )
  limit 1;

  if v_tenant_email is not null and v_tenant_email <> '' then
    insert into public.tenant_email_jobs(
      owner_id, event_type, idempotency_key, tenant_email, tenant_name,
      property_name, unit_name, payload
    )
    values (
      new.owner_id, 'payment_receipt', 'paybill-receipt:' || new.mpesa_receipt,
      v_tenant_email, new.tenant_name, new.property_name, new.unit_name,
      pg_catalog.jsonb_build_object(
        'amount', new.amount,
        'date', new.transacted_at,
        'method', 'M-Pesa Paybill',
        'reference', new.mpesa_receipt
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists rent_payment_email_receipt on public.rent_payments;
create trigger rent_payment_email_receipt
after insert on public.rent_payments
for each row execute function public.enqueue_direct_payment_receipt();

create or replace function public.enqueue_manual_payment_receipts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row text;
  v_parts text[];
  v_property text;
  v_unit text;
  v_tenant_name text;
  v_tenant_email text;
  v_amount_text text;
begin
  for v_row in
    select payment_row.value
    from pg_catalog.jsonb_array_elements_text(
      case when pg_catalog.jsonb_typeof(new.data->'records'->'Payments') = 'array'
        then new.data->'records'->'Payments' else '[]'::jsonb end
    ) as payment_row(value)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(
        case when pg_catalog.jsonb_typeof(old.data->'records'->'Payments') = 'array'
          then old.data->'records'->'Payments' else '[]'::jsonb end
      ) as old_payment(value)
      where old_payment.value = payment_row.value
    )
  loop
    v_parts := pg_catalog.string_to_array(v_row, ' · ');
    if pg_catalog.array_length(v_parts, 1) < 8 then
      continue;
    end if;
    v_property := pg_catalog.btrim(v_parts[4]);
    v_unit := pg_catalog.regexp_replace(pg_catalog.btrim(v_parts[3]), '^House[[:space:]]*', '', 'i');
    v_tenant_name := pg_catalog.btrim(v_parts[2]);
    v_amount_text := pg_catalog.regexp_replace(v_parts[1], '[^0-9.]', '', 'g');
    if v_amount_text !~ '^[0-9]+([.][0-9]+)?$' then
      continue;
    end if;

    select pg_catalog.lower(pg_catalog.btrim(tenant.value->>'email')),
      coalesce(tenant.value->>'name', v_tenant_name)
    into v_tenant_email, v_tenant_name
    from public.rental_workspaces workspace
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(workspace.data->'tenants') = 'array'
        then workspace.data->'tenants' else '[]'::jsonb end
    ) as tenant(value)
    where workspace.owner_id = new.owner_id
      and tenant.value->>'property' = v_property
      and tenant.value->>'name' = v_tenant_name
      and (
        coalesce(tenant.value->>'unitDisplayName', tenant.value->>'unit') = v_unit
        or tenant.value->>'unit' = v_unit
      )
    limit 1;

    if v_tenant_email is not null and v_tenant_email <> '' then
      insert into public.tenant_email_jobs(
        owner_id, event_type, idempotency_key, tenant_email, tenant_name,
        property_name, unit_name, payload
      )
      values (
        new.owner_id,
        'payment_receipt',
        'manual-receipt:' || new.owner_id::text || ':' || pg_catalog.md5(v_row),
        v_tenant_email,
        v_tenant_name,
        v_property,
        v_unit,
        pg_catalog.jsonb_build_object(
          'amount', v_amount_text::numeric,
          'date', v_parts[5],
          'method', v_parts[6],
          'reference', v_parts[7],
          'period', v_parts[8]
        )
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists rental_workspace_manual_payment_receipts on public.rental_workspaces;
create trigger rental_workspace_manual_payment_receipts
after update of data on public.rental_workspaces
for each row
when (
  old.data->'records'->'Payments' is distinct from new.data->'records'->'Payments'
)
execute function public.enqueue_manual_payment_receipts();
