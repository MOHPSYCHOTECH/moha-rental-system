-- Run after subscription_payments.sql, subscription_plans.sql,
-- subscription_payment_methods.sql, and user_hierarchy.sql.
-- Stores one email per landlord subscription expiry.

create table if not exists public.landlord_subscription_expiry_email_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_on date not null,
  plan text not null,
  landlord_name text not null,
  landlord_email text not null,
  payment_method text not null check (payment_method in ('paybill', 'till', 'bank_transfer')),
  paybill_number text not null default '',
  till_number text not null default '',
  bank_name text not null default '',
  bank_account_name text not null default '',
  bank_account_number text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint landlord_subscription_expiry_email_unique unique (user_id, expires_on)
);

create index if not exists landlord_subscription_expiry_email_pending_idx
  on public.landlord_subscription_expiry_email_jobs(next_attempt_at, created_at)
  where status in ('pending', 'sending');

alter table public.landlord_subscription_expiry_email_jobs enable row level security;
revoke all on public.landlord_subscription_expiry_email_jobs from anon, authenticated;
grant all on public.landlord_subscription_expiry_email_jobs to service_role;

create or replace function public.set_landlord_subscription_expiry_email_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists landlord_subscription_expiry_email_updated_at
  on public.landlord_subscription_expiry_email_jobs;
create trigger landlord_subscription_expiry_email_updated_at
before update on public.landlord_subscription_expiry_email_jobs
for each row execute function public.set_landlord_subscription_expiry_email_updated_at();
