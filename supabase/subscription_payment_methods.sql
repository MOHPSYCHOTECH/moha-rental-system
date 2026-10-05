-- Run after subscription_payments.sql and user_hierarchy.sql.
-- Platform-wide payment instructions are separate from landlord rent collection settings.

create table if not exists public.subscription_payment_settings (
  id boolean primary key default true check (id),
  payment_method text not null default 'paybill'
    check (payment_method in ('paybill', 'till', 'bank_transfer')),
  paybill_number text not null default '',
  till_number text not null default '',
  bank_name text not null default '',
  bank_account_name text not null default '',
  bank_account_number text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.subscription_payment_requests
  add column if not exists payment_method text not null default 'paybill'
    check (payment_method in ('paybill', 'till', 'bank_transfer'));

alter table public.subscription_payment_settings enable row level security;

revoke all on public.subscription_payment_settings from anon, authenticated;
grant select, insert, update on public.subscription_payment_settings to authenticated;

drop policy if exists "Authenticated users can read subscription payment settings" on public.subscription_payment_settings;
create policy "Authenticated users can read subscription payment settings"
  on public.subscription_payment_settings for select to authenticated
  using (true);

drop policy if exists "Platform admins can create subscription payment settings" on public.subscription_payment_settings;
create policy "Platform admins can create subscription payment settings"
  on public.subscription_payment_settings for insert to authenticated
  with check (public.is_platform_admin() and updated_by = (select auth.uid()));

drop policy if exists "Platform admins can update subscription payment settings" on public.subscription_payment_settings;
create policy "Platform admins can update subscription payment settings"
  on public.subscription_payment_settings for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin() and updated_by = (select auth.uid()));

insert into public.subscription_payment_settings (id)
values (true)
on conflict (id) do nothing;
