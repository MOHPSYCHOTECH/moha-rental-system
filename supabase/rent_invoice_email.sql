-- Automatic monthly rent invoice delivery state.
-- Run in Supabase SQL Editor before deploying process-rent-invoices.

create table if not exists public.rent_invoice_email_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  property_name text not null,
  unit_name text not null,
  due_date date not null,
  tenant_name text not null,
  tenant_email text not null default '',
  rent_amount numeric(12, 2) not null default 0,
  water_bill_amount numeric(12, 2) not null default 0,
  water_bill_updated_at timestamptz,
  status text not null default 'waiting_for_water'
    check (status in ('waiting_for_water', 'ready', 'sending', 'sent', 'superseded')),
  landlord_alerted_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rent_invoice_email_job_cycle_unique unique (owner_id, property_name, unit_name, due_date)
);

create index if not exists rent_invoice_email_jobs_owner_status_idx
  on public.rent_invoice_email_jobs (owner_id, status, due_date);

alter table public.rent_invoice_email_jobs enable row level security;
revoke all on public.rent_invoice_email_jobs from anon, authenticated;
grant all on public.rent_invoice_email_jobs to service_role;

create or replace function public.set_rent_invoice_email_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rent_invoice_email_jobs_updated_at on public.rent_invoice_email_jobs;
create trigger rent_invoice_email_jobs_updated_at
before update on public.rent_invoice_email_jobs
for each row execute function public.set_rent_invoice_email_jobs_updated_at();
