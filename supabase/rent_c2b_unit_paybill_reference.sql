-- Run after rent_c2b.sql to support readable property-and-unit Paybill references.
alter table public.rent_payment_accounts
  add column if not exists paybill_reference text;

create unique index if not exists rent_payment_accounts_paybill_reference_unique
  on public.rent_payment_accounts(paybill_reference)
  where paybill_reference is not null;
