-- Run after subscription_payments.sql, user_hierarchy.sql, and subscription_plans.sql.
-- Returns pending payment requests with their account details in one authorized query.

create or replace function public.get_admin_subscription_payment_queue()
returns table (
  request_id uuid,
  user_id uuid,
  plan text,
  amount integer,
  mpesa_code text,
  payment_method text,
  status text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  profile_name text,
  profile_email text,
  profile_phone text,
  user_type text,
  account_role text,
  account_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
begin
  if v_caller_id is null or not public.is_subscription_admin() then
    raise exception 'Only subscription administrators can read payment requests.' using errcode = '42501';
  end if;

  return query
  select
    request.id,
    request.user_id,
    request.plan,
    request.amount,
    request.mpesa_code,
    request.payment_method,
    request.status,
    request.submitted_at,
    request.reviewed_at,
    profile.display_name,
    profile.email,
    profile.phone,
    profile.user_type,
    role.role,
    role.active
  from public.subscription_payment_requests as request
  join public.profiles as profile on profile.user_id = request.user_id
  join public.user_roles as role on role.user_id = request.user_id
  where request.status = 'pending'
    and (
      role.owner_id = v_caller_id
      or (public.is_platform_admin() and role.created_by = v_caller_id)
    )
  order by request.submitted_at desc;
end;
$$;

revoke all on function public.get_admin_subscription_payment_queue() from public, anon;
grant execute on function public.get_admin_subscription_payment_queue() to authenticated;

create index if not exists subscription_payment_requests_status_submitted_idx
  on public.subscription_payment_requests (status, submitted_at desc);

-- Return reviewed payment requests as a bounded page so administrators can
-- inspect approved and rejected payments without loading the entire table.
create or replace function public.get_admin_subscription_payment_history(
  p_status text default 'approved',
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_total_count bigint;
  v_requests jsonb;
begin
  if v_caller_id is null or not public.is_subscription_admin() then
    raise exception 'Only subscription administrators can read payment history.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('approved', 'rejected', 'all') then
    raise exception 'Payment history status must be approved, rejected, or all.' using errcode = '22023';
  end if;
  if p_page is null or p_page < 1 then
    raise exception 'Payment history page must be a positive integer.' using errcode = '22023';
  end if;
  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise exception 'Payment history page size must be between 1 and 100.' using errcode = '22023';
  end if;

  with filtered_requests as (
    select
      request.id as request_id,
      request.user_id,
      request.plan,
      request.amount,
      request.mpesa_code,
      request.payment_method,
      request.status,
      request.submitted_at,
      request.reviewed_at,
      profile.display_name as profile_name,
      profile.email as profile_email,
      profile.phone as profile_phone,
      profile.user_type,
      role.role as account_role,
      role.active as account_active
    from public.subscription_payment_requests as request
    join public.profiles as profile on profile.user_id = request.user_id
    join public.user_roles as role on role.user_id = request.user_id
    where request.status in ('approved', 'rejected')
      and (p_status = 'all' or request.status = p_status)
      and (
        role.owner_id = v_caller_id
        or (public.is_platform_admin() and role.created_by = v_caller_id)
      )
  ),
  page_requests as (
    select *
    from filtered_requests
    order by submitted_at desc, request_id desc
    limit p_page_size
    offset (p_page::bigint - 1) * p_page_size
  )
  select
    (select count(*) from filtered_requests),
    coalesce(
      (select jsonb_agg(to_jsonb(page_requests) order by submitted_at desc, request_id desc)
       from page_requests),
      '[]'::jsonb
    )
  into v_total_count, v_requests;

  return jsonb_build_object('total_count', v_total_count, 'requests', v_requests);
end;
$$;

revoke all on function public.get_admin_subscription_payment_history(text, integer, integer) from public, anon;
grant execute on function public.get_admin_subscription_payment_history(text, integer, integer) to authenticated;

-- Read the platform directory in one policy-checked query so a stale profiles
-- or user_roles RLS policy cannot silently truncate the dashboard directory.
create or replace function public.get_platform_admin_accounts()
returns table (
  user_id uuid,
  display_name text,
  email text,
  phone text,
  user_type text,
  owner_id uuid,
  signup_status text,
  requested_plan text,
  account_role text,
  account_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_platform_admin() then
    raise exception 'Only the Platform Administrator can read the platform account directory.' using errcode = '42501';
  end if;

  return query
  select profile.user_id, profile.display_name, profile.email, profile.phone,
         profile.user_type, profile.owner_id, profile.signup_status, profile.requested_plan,
         role.role, role.active
  from public.profiles as profile
  join public.user_roles as role on role.user_id = profile.user_id
  where profile.user_type in ('landlord', 'caretaker')
  order by profile.display_name;
end;
$$;

revoke all on function public.get_platform_admin_accounts() from public, anon;
grant execute on function public.get_platform_admin_accounts() to authenticated;

-- Replace the older private-workspace-only review function. Platform admins
-- manage invited Landlords through created_by; Landlords manage their own team
-- through owner_id.
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
  v_caller_id uuid := (select auth.uid());
  v_request public.subscription_payment_requests%rowtype;
  v_start_date date;
  v_expires_on date;
begin
  if v_caller_id is null or not public.is_subscription_admin() then
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
      role.owner_id = v_caller_id
        or (public.is_platform_admin() and role.created_by = v_caller_id)
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
      reviewed_by = v_caller_id
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.review_subscription_payment(uuid, boolean) from public, anon;
grant execute on function public.review_subscription_payment(uuid, boolean) to authenticated;

-- Return the activated subscription from the protected review transaction so
-- the admin UI does not need a separate RLS-filtered table read.
create or replace function public.review_admin_subscription_payment(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_request public.subscription_payment_requests%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_start_date date;
  v_expires_on date;
begin
  if v_caller_id is null or not public.is_subscription_admin() then
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
        role.owner_id = v_caller_id
        or (public.is_platform_admin() and role.created_by = v_caller_id)
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
      updated_at = now()
    returning * into v_subscription;
  end if;

  update public.subscription_payment_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = v_caller_id
  where id = v_request.id
  returning * into v_request;

  return jsonb_build_object(
    'payment_request', to_jsonb(v_request),
    'subscription', case when p_approve then to_jsonb(v_subscription) else null end
  );
end;
$$;

revoke all on function public.review_admin_subscription_payment(uuid, boolean) from public, anon;
grant execute on function public.review_admin_subscription_payment(uuid, boolean) to authenticated;

-- Repair Silver Monthly subscriptions issued by the older approval function,
-- which treated every non-legacy-monthly plan as yearly.
update public.subscriptions as subscription
set expires_on = (subscription.starts_on + interval '1 month')::date,
    updated_at = now()
from public.subscription_payment_requests as request
where request.id = subscription.source_payment_request_id
  and request.plan = 'silver_monthly'
  and request.amount in (500, 1350)
  and subscription.plan = 'silver_monthly'
  and subscription.expires_on = (subscription.starts_on + interval '1 year')::date;
