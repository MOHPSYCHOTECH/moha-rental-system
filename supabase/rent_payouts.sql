-- Run after rent_c2b.sql and user_hierarchy.sql.
-- Landlord settlements are recorded manually by a Platform Administrator.

create table if not exists public.rent_payouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mpesa_receipt text not null unique
    references public.rent_payments(mpesa_receipt) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'needs_review')),
  payment_method text
    check (payment_method in ('mpesa', 'bank_transfer', 'cash')),
  payout_reference text,
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists rent_payouts_owner_requested_idx
  on public.rent_payouts(owner_id, requested_at desc);

alter table public.rent_payouts enable row level security;

drop policy if exists "Owners can read their rent payout records" on public.rent_payouts;
create policy "Workspace members can read rent payout records"
  on public.rent_payouts for select to authenticated
  using (public.can_read_rental_workspace(owner_id));

revoke all on public.rent_payouts from anon;
revoke insert, update, delete on public.rent_payouts from authenticated;
grant select on public.rent_payouts to authenticated;
grant all on public.rent_payouts to service_role;
