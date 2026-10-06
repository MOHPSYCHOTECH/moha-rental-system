-- Run after subscription_payments.sql and user_hierarchy.sql.
-- Keeps old subscription rows compatible while enabling Test and Silver plans.

alter table public.subscription_payment_requests
  drop constraint if exists subscription_payment_requests_plan_check;
alter table public.subscription_payment_requests
  drop constraint if exists subscription_payment_amount_matches_plan;
alter table public.subscription_payment_requests
  add constraint subscription_payment_requests_plan_check
    check (plan in ('monthly', 'yearly', 'silver_monthly', 'silver_yearly'));
alter table public.subscription_payment_requests
  add constraint subscription_payment_amount_matches_plan
    check (
      (plan = 'monthly' and amount = 200) or
      (plan = 'yearly' and amount = 2000) or
      (plan = 'silver_monthly' and amount in (500, 1350)) or
      (plan = 'silver_yearly' and amount in (4500, 13500))
    );

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;
alter table public.subscriptions
  drop constraint if exists subscriptions_amount_check;
alter table public.subscriptions
  add constraint subscriptions_plan_check
    check (plan in ('monthly', 'yearly', 'test', 'silver_monthly', 'silver_yearly'));
alter table public.subscriptions
  add constraint subscriptions_status_check
    check (status in ('active', 'trial', 'expired', 'cancelled'));
alter table public.subscriptions
  add constraint subscriptions_amount_check
    check (amount in (0, 200, 500, 1350, 2000, 4500, 13500));
alter table public.subscriptions
  alter column source_payment_request_id drop not null;

create or replace function public.review_subscription_payment(
  p_request_id uuid,
  p_approve boolean
)
returns public.subscription_payment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.subscription_payment_requests%rowtype;
  v_start_date date;
  v_expires_on date;
begin
  if (select auth.uid()) is null or not public.is_subscription_admin() then
    raise exception 'Only subscription administrators can review payments.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'A review decision is required.' using errcode = '22023';
  end if;

  select * into v_request
  from public.subscription_payment_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found then
    raise exception 'Pending payment request not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = v_request.user_id
      and (
        role.owner_id = (select auth.uid())
        or (public.is_platform_admin() and role.created_by = (select auth.uid()))
      )
  ) then
    raise exception 'This payment is outside your permitted account scope.' using errcode = '42501';
  end if;

  if p_approve then
    select greatest(current_date, subscriptions.expires_on)
    into v_start_date
    from public.subscriptions
    where subscriptions.user_id = v_request.user_id;
    v_start_date := coalesce(v_start_date, current_date);
    v_expires_on := case
      when v_request.plan in ('yearly', 'silver_yearly') then (v_start_date + interval '1 year')::date
      else (v_start_date + interval '1 month')::date
    end;

    insert into public.subscriptions (
      user_id, plan, status, starts_on, expires_on, amount, source_payment_request_id, updated_at
    ) values (
      v_request.user_id, v_request.plan, 'active', v_start_date, v_expires_on,
      v_request.amount, v_request.id, now()
    )
    on conflict (user_id) do update set
      plan = excluded.plan,
      status = 'active',
      starts_on = excluded.starts_on,
      expires_on = excluded.expires_on,
      amount = excluded.amount,
      source_payment_request_id = excluded.source_payment_request_id,
      updated_at = now();
  end if;

  update public.subscription_payment_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.activate_test_subscription()
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_user_type text;
  v_active boolean;
  v_subscription public.subscriptions%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  select profile.user_type, role.active
  into v_user_type, v_active
  from public.profiles as profile
  join public.user_roles as role on role.user_id = profile.user_id
  where profile.user_id = v_user_id;

  if v_user_type is distinct from 'landlord' or v_active is distinct from true then
    raise exception 'Only active Landlord accounts can start the Test plan.' using errcode = '42501';
  end if;

  if exists (select 1 from public.subscriptions where user_id = v_user_id) then
    raise exception 'The one-month Test plan can only be used once per account.' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.subscription_payment_requests
    where user_id = v_user_id and status = 'pending'
  ) then
    raise exception 'A pending payment request must be reviewed before starting a Test plan.' using errcode = '55000';
  end if;

  insert into public.subscriptions (
    user_id, plan, status, starts_on, expires_on, amount, source_payment_request_id, updated_at
  ) values (
    v_user_id, 'test', 'trial', current_date,
    (current_date + interval '1 month')::date, 0, null, now()
  )
  returning * into v_subscription;

  return v_subscription;
end;
$$;

revoke all on function public.activate_test_subscription() from public, anon;
grant execute on function public.activate_test_subscription() to authenticated;
revoke all on function public.review_subscription_payment(uuid, boolean) from public, anon;
grant execute on function public.review_subscription_payment(uuid, boolean) to authenticated;
