-- Run this in Supabase SQL Editor after schema.sql.
-- Subscription access is activated only after an authenticated admin reviews a payment.
-- The payer's National ID is used as the Paybill account reference and is not stored here.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  phone text,
  user_type text not null default 'landlord',
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  role text not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Upgrade installations that ran an earlier version of this file.
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists user_type text not null default 'landlord';
alter table public.user_roles add column if not exists active boolean not null default true;
alter table public.user_roles add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.user_roles alter column role set default 'viewer';
alter table public.user_roles drop constraint if exists user_roles_role_check;
update public.user_roles set role = 'viewer' where role = 'user';
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('admin', 'manager', 'caretaker', 'accountant', 'viewer'));
alter table public.profiles drop constraint if exists profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check
  check (user_type in ('platform_admin', 'landlord', 'property_manager', 'caretaker'));
update public.profiles set owner_id = user_id where owner_id is null;
update public.user_roles set owner_id = user_id where owner_id is null;
create index if not exists profiles_owner_id_idx on public.profiles(owner_id);
create index if not exists user_roles_owner_id_idx on public.user_roles(owner_id);

create table if not exists public.subscription_payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'yearly')),
  amount integer not null,
  mpesa_code text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  constraint subscription_payment_amount_matches_plan check (
    (plan = 'monthly' and amount = 200) or
    (plan = 'yearly' and amount = 2000)
  ),
  constraint subscription_payment_code_length check (
    char_length(btrim(mpesa_code)) between 6 and 32
  ),
  constraint subscription_payment_review_fields check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null) or
    (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);

create unique index if not exists subscription_payment_code_unique
  on public.subscription_payment_requests (upper(btrim(mpesa_code)));

create unique index if not exists one_pending_subscription_request_per_user
  on public.subscription_payment_requests (user_id)
  where status = 'pending';

create index if not exists subscription_payment_requests_user_submitted_idx
  on public.subscription_payment_requests (user_id, submitted_at desc);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('monthly', 'yearly')),
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  starts_on date not null,
  expires_on date not null check (expires_on > starts_on),
  amount integer not null check (amount in (200, 2000)),
  source_payment_request_id uuid not null unique references public.subscription_payment_requests(id),
  updated_at timestamptz not null default now()
);

-- New Supabase Auth users get a profile and a non-admin role. Promote the owner manually below.
create or replace function public.handle_new_subscription_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, owner_id, display_name, email)
  values (
    new.id,
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.email
  )
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, owner_id, role)
  values (new.id, new.id, 'viewer')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_subscription_profile on auth.users;
create trigger on_auth_user_created_subscription_profile
after insert on auth.users
for each row execute function public.handle_new_subscription_user();

-- Backfill Supabase Auth users that already exist. Existing roles are preserved.
insert into public.profiles (user_id, owner_id, display_name, email)
select
  id,
  id,
  coalesce(
    nullif(btrim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(email, ''), '@', 1)
  ),
  email
from auth.users
on conflict (user_id) do update set email = coalesce(public.profiles.email, excluded.email);

insert into public.user_roles (user_id, owner_id, role)
select id, id, 'viewer'
from auth.users
on conflict (user_id) do nothing;

create or replace function public.is_subscription_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = 'admin'
      and active
  );
$$;

create or replace function public.admin_update_user_access(
  p_user_id uuid,
  p_role text,
  p_active boolean,
  p_display_name text,
  p_phone text,
  p_user_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_subscription_admin() then
    raise exception 'Only administrators can update user access.'
      using errcode = '42501';
  end if;

  if p_role not in ('admin', 'manager', 'caretaker', 'accountant', 'viewer')
     or p_user_type not in ('landlord', 'property_manager', 'caretaker') then
    raise exception 'Invalid role or user type.'
      using errcode = '22023';
  end if;

  if p_user_id = (select auth.uid()) and (not p_active or p_role <> 'admin') then
    raise exception 'Administrators cannot disable or demote their own account.'
      using errcode = '22023';
  end if;

  if p_user_id <> (select auth.uid()) and not exists (
    select 1 from public.user_roles
    where user_id = p_user_id and owner_id = (select auth.uid())
  ) then
    raise exception 'The user does not belong to your private workspace.'
      using errcode = '42501';
  end if;

  update public.user_roles
  set role = p_role, active = p_active
  where user_id = p_user_id;

  if not found then
    raise exception 'Supabase Auth user not found.' using errcode = 'P0002';
  end if;

  update public.profiles
  set display_name = p_display_name, phone = p_phone, user_type = p_user_type
  where user_id = p_user_id;
end;
$$;

-- This function is the only client-callable path for approving/rejecting a request.
-- It records the review and, on approval, starts or extends the user's subscription.
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
    raise exception 'Only subscription administrators can review payments.'
      using errcode = '42501';
  end if;

  if p_approve is null then
    raise exception 'A review decision is required.'
      using errcode = '22023';
  end if;

  select *
  into v_request
  from public.subscription_payment_requests
  where id = p_request_id
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending payment request not found.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = v_request.user_id and owner_id = (select auth.uid())
  ) then
    raise exception 'This payment is outside your private workspace.'
      using errcode = '42501';
  end if;

  if p_approve then
    select greatest(current_date, subscriptions.expires_on)
    into v_start_date
    from public.subscriptions
    where subscriptions.user_id = v_request.user_id;

    v_start_date := coalesce(v_start_date, current_date);
    v_expires_on := case
      when v_request.plan = 'monthly' then (v_start_date + interval '1 month')::date
      else (v_start_date + interval '1 year')::date
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

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.subscription_payment_requests enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (owner_id = (select auth.uid()) and public.is_subscription_admin())
  );

drop policy if exists "Users can update own profile name" on public.profiles;
create policy "Users can update own profile name"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can read own role" on public.user_roles;
create policy "Users can read own role"
  on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (owner_id = (select auth.uid()) and public.is_subscription_admin())
  );

drop policy if exists "Users can read own payment requests" on public.subscription_payment_requests;
create policy "Users can read own payment requests"
  on public.subscription_payment_requests for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Admins can read all payment requests" on public.subscription_payment_requests;
create policy "Admins can read all payment requests"
  on public.subscription_payment_requests for select to authenticated
  using (
    exists (
      select 1 from public.user_roles as caller_role
      where caller_role.user_id = (select auth.uid())
        and caller_role.role = 'admin'
        and caller_role.active
    )
    and exists (
      select 1 from public.user_roles as request_owner
      where request_owner.user_id = subscription_payment_requests.user_id
        and request_owner.owner_id = (select auth.uid())
    )
  );

drop policy if exists "Users can submit own pending payment requests" on public.subscription_payment_requests;
create policy "Users can submit own pending payment requests"
  on public.subscription_payment_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
  );

drop policy if exists "Users can read own subscription" on public.subscriptions;
create policy "Users can read own subscription"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Admins can read all subscriptions" on public.subscriptions;
create policy "Admins can read all subscriptions"
  on public.subscriptions for select to authenticated
  using (
    exists (
      select 1 from public.user_roles as caller_role
      where caller_role.user_id = (select auth.uid())
        and caller_role.role = 'admin'
        and caller_role.active
    )
    and exists (
      select 1 from public.user_roles as subscription_owner
      where subscription_owner.user_id = subscriptions.user_id
        and subscription_owner.owner_id = (select auth.uid())
    )
  );

-- No client UPDATE/DELETE grants are given for roles, payment requests, or subscriptions.
grant usage on schema public to authenticated;
revoke all on public.profiles, public.user_roles, public.subscription_payment_requests, public.subscriptions from anon, authenticated;
grant select on public.profiles, public.user_roles to authenticated;
grant update (display_name, phone) on public.profiles to authenticated;
grant select, insert on public.subscription_payment_requests to authenticated;
grant select on public.subscriptions to authenticated;

revoke all on function public.is_subscription_admin() from public, anon;
grant execute on function public.is_subscription_admin() to authenticated;
revoke all on function public.review_subscription_payment(uuid, boolean) from public, anon;
grant execute on function public.review_subscription_payment(uuid, boolean) to authenticated;
revoke all on function public.admin_update_user_access(uuid, text, boolean, text, text, text) from public, anon;
grant execute on function public.admin_update_user_access(uuid, text, boolean, text, text, text) to authenticated;

-- Run supabase/user_hierarchy.sql next, then promote the platform account using
-- supabase/promote_mohammed_admin.sql or the platform_admin SQL instructions in SUPABASE_SETUP.md.
