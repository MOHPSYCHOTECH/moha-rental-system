-- Run after subscription_payments.sql, user_hierarchy.sql, and subscription_plans.sql.
-- Public Auth signups get a durable queue row and stay inactive until approved.

alter table public.profiles
  add column if not exists signup_status text not null default 'approved';
alter table public.profiles
  add column if not exists requested_plan text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_signup_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_signup_status_check
      check (signup_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_requested_plan_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_requested_plan_check
      check (requested_plan is null or requested_plan in ('test', 'silver_monthly', 'silver_yearly'));
  end if;
end;
$$;

create table if not exists public.landlord_signup_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  requested_plan text not null default 'test'
    check (requested_plan in ('test', 'silver_monthly', 'silver_yearly')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create index if not exists landlord_signup_requests_status_submitted_idx
  on public.landlord_signup_requests(status, submitted_at desc);

alter table public.landlord_signup_requests enable row level security;
revoke all on public.landlord_signup_requests from anon, authenticated;
grant select on public.landlord_signup_requests to authenticated;

drop policy if exists "Platform admins can read landlord signup requests" on public.landlord_signup_requests;
create policy "Platform admins can read landlord signup requests"
  on public.landlord_signup_requests for select to authenticated
  using (public.is_platform_admin());

-- Recover public applicants who registered before this migration was installed.
update public.profiles as profile
set signup_status = 'pending',
    requested_plan = case
      when auth_user.raw_user_meta_data ->> 'requested_plan' in ('test', 'silver_monthly', 'silver_yearly')
        then auth_user.raw_user_meta_data ->> 'requested_plan'
      else 'test'
    end,
    user_type = 'landlord',
    owner_id = profile.user_id
from auth.users as auth_user
where auth_user.id = profile.user_id
  and auth_user.invited_at is null
  and auth_user.raw_user_meta_data ->> 'public_landlord_signup' = 'true'
  and profile.created_by is null
  and profile.signup_status = 'approved';

insert into public.profiles (
  user_id, owner_id, display_name, email, phone, user_type, signup_status, requested_plan
)
select
  auth_user.id,
  auth_user.id,
  coalesce(
    nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(auth_user.email, ''), '@', 1)
  ),
  auth_user.email,
  nullif(btrim(auth_user.raw_user_meta_data ->> 'phone'), ''),
  'landlord',
  'pending',
  case
    when auth_user.raw_user_meta_data ->> 'requested_plan' in ('test', 'silver_monthly', 'silver_yearly')
      then auth_user.raw_user_meta_data ->> 'requested_plan'
    else 'test'
  end
from auth.users as auth_user
where auth_user.invited_at is null
  and auth_user.raw_user_meta_data ->> 'public_landlord_signup' = 'true'
on conflict (user_id) do nothing;

update public.user_roles as role
set role = 'admin', active = false, owner_id = profile.user_id, created_by = null
from public.profiles as profile
join auth.users as auth_user on auth_user.id = profile.user_id
where role.user_id = profile.user_id
  and profile.user_type = 'landlord'
  and profile.signup_status = 'pending'
  and profile.created_by is null
  and auth_user.invited_at is null
  and auth_user.raw_user_meta_data ->> 'public_landlord_signup' = 'true';

insert into public.landlord_signup_requests (user_id, full_name, email, phone, requested_plan, status)
select
  profile.user_id,
  coalesce(nullif(profile.display_name, ''), profile.email, 'Landlord'),
  coalesce(profile.email, auth_user.email),
  profile.phone,
  coalesce(profile.requested_plan, 'test'),
  'pending'
from public.profiles as profile
join auth.users as auth_user on auth_user.id = profile.user_id
where profile.user_type = 'landlord'
  and profile.signup_status = 'pending'
  and profile.created_by is null
  and auth_user.invited_at is null
on conflict (user_id) do nothing;

insert into public.user_roles (user_id, owner_id, created_by, role, active)
select profile.user_id, profile.user_id, null, 'admin', false
from public.profiles as profile
where profile.user_type = 'landlord'
  and profile.signup_status = 'pending'
  and profile.created_by is null
on conflict (user_id) do update
set owner_id = excluded.owner_id,
    created_by = null,
    role = 'admin',
    active = false;

create or replace function public.handle_new_subscription_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_signup boolean := new.invited_at is null;
  v_requested_plan text := new.raw_user_meta_data ->> 'requested_plan';
begin
  if v_requested_plan is null or v_requested_plan not in ('test', 'silver_monthly', 'silver_yearly') then
    v_requested_plan := 'test';
  end if;

  insert into public.profiles (
    user_id, owner_id, display_name, email, phone, user_type, signup_status, requested_plan
  ) values (
    new.id,
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    'landlord',
    case when v_public_signup then 'pending' else 'approved' end,
    case when v_public_signup then v_requested_plan else null end
  )
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, owner_id, role, active)
  values (
    new.id,
    new.id,
    case when v_public_signup then 'admin' else 'viewer' end,
    not v_public_signup
  )
  on conflict (user_id) do nothing;

  if v_public_signup then
    insert into public.landlord_signup_requests (
      user_id, full_name, email, phone, requested_plan, status
    ) values (
      new.id,
      coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
      coalesce(new.email, ''),
      nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
      v_requested_plan,
      'pending'
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.approve_public_landlord_signup(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_request public.landlord_signup_requests%rowtype;
  v_requested_plan text;
  v_subscription public.subscriptions%rowtype;
begin
  if v_caller_id is null or not public.is_platform_admin() then
    raise exception 'Only the Platform Administrator can approve landlord registrations.' using errcode = '42501';
  end if;

  select request.*
  into v_request
  from public.landlord_signup_requests as request
  join public.profiles as profile on profile.user_id = request.user_id
  join public.user_roles as role on role.user_id = profile.user_id
  where request.user_id = p_user_id
    and request.status = 'pending'
    and profile.user_type = 'landlord'
    and profile.signup_status = 'pending'
    and profile.created_by is null
    and role.role = 'admin'
    and not role.active
  for update of request, profile, role;

  if not found then
    raise exception 'Pending public Landlord registration not found.' using errcode = 'P0002';
  end if;
  v_requested_plan := v_request.requested_plan;

  update public.profiles
  set signup_status = 'approved',
      requested_plan = v_requested_plan,
      created_by = v_caller_id,
      owner_id = p_user_id
  where user_id = p_user_id;

  update public.user_roles
  set role = 'admin', active = true, owner_id = p_user_id, created_by = v_caller_id
  where user_id = p_user_id;

  update public.landlord_signup_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = v_caller_id
  where user_id = p_user_id;

  if v_requested_plan = 'test' then
    insert into public.subscriptions (
      user_id, plan, status, starts_on, expires_on, amount, source_payment_request_id, updated_at
    ) values (
      p_user_id, 'test', 'trial', current_date,
      (current_date + interval '1 month')::date, 0, null, now()
    )
    returning * into v_subscription;
  end if;

  return jsonb_build_object(
    'requested_plan', v_requested_plan,
    'subscription', case when v_subscription.user_id is null then null else to_jsonb(v_subscription) end
  );
end;
$$;

create or replace function public.reject_public_landlord_signup(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
begin
  if v_caller_id is null or not public.is_platform_admin() then
    raise exception 'Only the Platform Administrator can reject landlord registrations.' using errcode = '42501';
  end if;

  update public.profiles
  set signup_status = 'rejected'
  where user_id = p_user_id
    and user_type = 'landlord'
    and signup_status = 'pending'
    and created_by is null;

  if not found then
    raise exception 'Pending public Landlord registration not found.' using errcode = 'P0002';
  end if;

  update public.landlord_signup_requests
  set status = 'rejected', reviewed_at = now(), reviewed_by = v_caller_id
  where user_id = p_user_id and status = 'pending';
end;
$$;

revoke all on function public.approve_public_landlord_signup(uuid) from public, anon;
grant execute on function public.approve_public_landlord_signup(uuid) to authenticated;
revoke all on function public.reject_public_landlord_signup(uuid) from public, anon;
grant execute on function public.reject_public_landlord_signup(uuid) to authenticated;
