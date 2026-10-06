-- Run after rent_payouts.sql and user_hierarchy.sql.
-- Replaces automatic B2C payout tracking with administrator-recorded settlements.

alter table public.rent_payouts
  add column if not exists phone text,
  add column if not exists payment_method text,
  add column if not exists payout_reference text,
  add column if not exists paid_by uuid references auth.users(id) on delete set null,
  add column if not exists paid_at timestamptz;

alter table public.rent_payouts alter column phone drop not null;
alter table public.rent_payouts drop constraint if exists rent_payouts_payment_method_check;

do $$
declare
  status_constraint record;
begin
  for status_constraint in
    select constraint_row.conname
    from pg_constraint as constraint_row
    join pg_attribute as column_info
      on column_info.attrelid = constraint_row.conrelid
     and column_info.attnum = any(constraint_row.conkey)
    where constraint_row.conrelid = 'public.rent_payouts'::regclass
      and constraint_row.contype = 'c'
      and column_info.attname = 'status'
  loop
    execute format('alter table public.rent_payouts drop constraint %I', status_constraint.conname);
  end loop;
end;
$$;

-- Preserve completed B2C settlements as paid records; uncertain requests need
-- manual reconciliation before an administrator records another transfer.
update public.rent_payouts as payout
set status = case
      when status in ('completed', 'paid') then 'paid'
      when status in ('processing', 'timeout') then 'needs_review'
      else 'pending'
    end,
    payment_method = case when status in ('completed', 'paid') then coalesce(payment_method, 'mpesa') else payment_method end,
    payout_reference = coalesce(payout_reference, to_jsonb(payout)->>'transaction_receipt'),
    paid_at = case
      when status in ('completed', 'paid') then coalesce(paid_at, nullif(to_jsonb(payout)->>'completed_at', '')::timestamptz)
      else paid_at
    end;

alter table public.rent_payouts
  add constraint rent_payouts_status_check
  check (status in ('pending', 'paid', 'needs_review'));
alter table public.rent_payouts
  add constraint rent_payouts_payment_method_check
  check (payment_method is null or payment_method in ('mpesa', 'bank_transfer', 'cash'));

drop policy if exists "Owners can read their rent payout records" on public.rent_payouts;
drop policy if exists "Workspace members can read rent payout records" on public.rent_payouts;
create policy "Workspace members can read rent payout records"
  on public.rent_payouts for select to authenticated
  using (public.can_read_rental_workspace(owner_id));

revoke all on public.rent_payouts from anon;
revoke insert, update, delete on public.rent_payouts from authenticated;
grant select on public.rent_payouts to authenticated;
grant all on public.rent_payouts to service_role;

create or replace function public.record_manual_rent_payout(
  p_owner_id uuid,
  p_mpesa_receipt text,
  p_payment_method text,
  p_payout_reference text,
  p_paid_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := (select auth.uid());
  v_amount numeric(12, 2);
  v_workspace_data jsonb;
  v_payout_id uuid;
begin
  if v_admin_id is null or not public.is_platform_admin() then
    raise exception 'Only an active Platform Administrator can record landlord payouts.'
      using errcode = '42501';
  end if;
  if p_payment_method is null or p_payment_method not in ('mpesa', 'bank_transfer', 'cash') then
    raise exception 'Choose a valid landlord payout method.';
  end if;
  if p_paid_at is null or p_paid_at > now() then
    raise exception 'Enter a valid payout date that is not in the future.';
  end if;
  if p_payment_method in ('mpesa', 'bank_transfer') and nullif(btrim(p_payout_reference), '') is null then
    raise exception 'A transaction reference is required for M-Pesa and bank transfer payouts.';
  end if;

  select workspace.data
  into v_workspace_data
  from public.rental_workspaces as workspace
  where workspace.owner_id = p_owner_id;

  if not found or v_workspace_data #>> '{settings,rentCollectionMode}' is distinct from 'moha_paybill' then
    raise exception 'This landlord is not using the shared Moha Paybill.';
  end if;

  select payment.amount
  into v_amount
  from public.rent_payments as payment
  where payment.owner_id = p_owner_id
    and payment.mpesa_receipt = upper(btrim(p_mpesa_receipt));

  if not found then
    raise exception 'The confirmed tenant rent payment could not be found for this landlord.';
  end if;

  insert into public.rent_payouts (
    owner_id,
    mpesa_receipt,
    amount,
    phone,
    status,
    payment_method,
    payout_reference,
    paid_by,
    paid_at,
    completed_at
  )
  values (
    p_owner_id,
    upper(btrim(p_mpesa_receipt)),
    v_amount,
    null,
    'paid',
    p_payment_method,
    nullif(btrim(p_payout_reference), ''),
    v_admin_id,
    p_paid_at,
    p_paid_at
  )
  on conflict (mpesa_receipt) do update
    set status = 'paid',
        payment_method = excluded.payment_method,
        payout_reference = excluded.payout_reference,
        paid_by = excluded.paid_by,
        paid_at = excluded.paid_at,
        completed_at = excluded.completed_at
    where public.rent_payouts.owner_id = excluded.owner_id
      and public.rent_payouts.status <> 'paid'
  returning id into v_payout_id;

  if v_payout_id is null then
    raise exception 'This rent payment is already marked as paid to the landlord.';
  end if;

  return v_payout_id;
end;
$$;

revoke all on function public.record_manual_rent_payout(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.record_manual_rent_payout(uuid, text, text, text, timestamptz) to authenticated;
