-- Run after schema.sql and subscription_payments.sql.
-- Direct Paybill C2B rent-payment reconciliation.
-- The app maps readable property/unit Paybill references to stable internal account references.

create table if not exists public.rent_payment_accounts (
  account_reference text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  tenant_key text not null,
  tenant_name text not null,
  property_name text not null,
  unit_name text not null,
  paybill_reference text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rent_account_reference_format check (account_reference ~ '^R[0-9A-F]{12}$')
);

create index if not exists rent_payment_accounts_owner_idx
  on public.rent_payment_accounts(owner_id);
create unique index if not exists rent_payment_accounts_paybill_reference_unique
  on public.rent_payment_accounts(paybill_reference)
  where paybill_reference is not null;

create table if not exists public.rent_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_reference text not null references public.rent_payment_accounts(account_reference),
  mpesa_receipt text not null unique,
  amount numeric(12, 2) not null check (amount > 0),
  transacted_at timestamptz not null,
  phone text,
  tenant_name text not null,
  property_name text not null,
  unit_name text not null,
  raw_callback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists rent_payments_owner_date_idx
  on public.rent_payments(owner_id, transacted_at desc);
create index if not exists rent_payments_account_date_idx
  on public.rent_payments(account_reference, transacted_at desc);

alter table public.rent_payment_accounts enable row level security;
alter table public.rent_payments enable row level security;

drop policy if exists "Owners can read their rent account references" on public.rent_payment_accounts;
create policy "Owners can read their rent account references"
  on public.rent_payment_accounts for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Owners can create their rent account references" on public.rent_payment_accounts;
create policy "Owners can create their rent account references"
  on public.rent_payment_accounts for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Owners can update their rent account references" on public.rent_payment_accounts;
create policy "Owners can update their rent account references"
  on public.rent_payment_accounts for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Owners can read rent payments in their workspace" on public.rent_payments;
create policy "Owners can read rent payments in their workspace"
  on public.rent_payments for select to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, update on public.rent_payment_accounts to authenticated;
grant select on public.rent_payments to authenticated;
revoke all on public.rent_payment_accounts, public.rent_payments from anon;
