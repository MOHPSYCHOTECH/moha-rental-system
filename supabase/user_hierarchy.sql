-- Run after schema.sql and subscription_payments.sql.
-- Separates platform administrators from landlord workspace administrators.

alter table public.profiles
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.user_roles
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check
  check (user_type in ('platform_admin', 'landlord', 'property_manager', 'caretaker'));

-- Existing landlord accounts become owners of their own workspaces while retaining inviter history.
update public.profiles
set created_by = owner_id, owner_id = user_id
where user_type = 'landlord'
  and owner_id is not null
  and owner_id <> user_id;

update public.user_roles as roles
set owner_id = profiles.owner_id,
    created_by = coalesce(roles.created_by, profiles.created_by)
from public.profiles
where profiles.user_id = roles.user_id
  and profiles.user_type = 'landlord'
  and roles.owner_id is distinct from profiles.owner_id;

create index if not exists profiles_created_by_idx on public.profiles(created_by);
create index if not exists user_roles_created_by_idx on public.user_roles(created_by);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.user_roles as role on role.user_id = profile.user_id
    where profile.user_id = (select auth.uid())
      and profile.user_type = 'platform_admin'
      and role.role = 'admin'
      and role.active
  );
$$;

create or replace function public.can_access_rental_workspace(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.user_roles as role on role.user_id = profile.user_id
    where profile.user_id = (select auth.uid())
      and role.active
      and profile.owner_id = p_owner_id
      and role.owner_id = p_owner_id
  );
$$;

create or replace function public.can_read_rental_workspace(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or public.can_access_rental_workspace(p_owner_id);
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (owner_id = (select auth.uid()) and public.is_subscription_admin())
    or public.is_platform_admin()
  );

drop policy if exists "Users can read own role" on public.user_roles;
create policy "Users can read own role"
  on public.user_roles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (owner_id = (select auth.uid()) and public.is_subscription_admin())
    or public.is_platform_admin()
  );

drop policy if exists "Owners can read their rental workspace" on public.rental_workspaces;
drop policy if exists "Workspace members can read rental workspace" on public.rental_workspaces;
create policy "Workspace members can read rental workspace"
  on public.rental_workspaces for select to authenticated
  using (public.can_read_rental_workspace(owner_id));

drop policy if exists "Owners can create their rental workspace" on public.rental_workspaces;
drop policy if exists "Workspace members can create rental workspace" on public.rental_workspaces;
create policy "Workspace members can create rental workspace"
  on public.rental_workspaces for insert to authenticated
  with check (public.can_access_rental_workspace(owner_id));

drop policy if exists "Owners can update their rental workspace" on public.rental_workspaces;
drop policy if exists "Workspace members can update rental workspace" on public.rental_workspaces;
create policy "Workspace members can update rental workspace"
  on public.rental_workspaces for update to authenticated
  using (public.can_access_rental_workspace(owner_id))
  with check (public.can_access_rental_workspace(owner_id));

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
declare
  v_caller_id uuid := (select auth.uid());
  v_caller_type text;
  v_target_owner uuid;
  v_target_created_by uuid;
  v_target_type text;
begin
  if v_caller_id is null or not public.is_subscription_admin() then
    raise exception 'Active administrator access is required.' using errcode = '42501';
  end if;
  if p_user_id = v_caller_id then
    raise exception 'You cannot edit your own managed account.' using errcode = '22023';
  end if;

  select user_type into v_caller_type from public.profiles where user_id = v_caller_id;
  select role.owner_id, role.created_by, profile.user_type
  into v_target_owner, v_target_created_by, v_target_type
  from public.user_roles as role
  join public.profiles as profile on profile.user_id = role.user_id
  where role.user_id = p_user_id;

  if not found then
    raise exception 'Active target account not found.' using errcode = 'P0002';
  end if;

  if v_caller_type = 'platform_admin' then
    if v_target_created_by is distinct from v_caller_id or v_target_type is distinct from 'landlord' or p_user_type is distinct from 'landlord' or p_role is distinct from 'admin' then
      raise exception 'Platform administrators can manage only their invited Landlords.' using errcode = '42501';
    end if;
  elsif v_caller_type = 'landlord' then
    if v_target_owner is distinct from v_caller_id or v_target_type is distinct from 'caretaker' or p_user_type is distinct from 'caretaker' or p_role is distinct from 'caretaker' then
      raise exception 'Landlords can manage only their own Caretakers.' using errcode = '42501';
    end if;
  else
    raise exception 'This account cannot manage users.' using errcode = '42501';
  end if;

  update public.user_roles set role = p_role, active = p_active where user_id = p_user_id;
  update public.profiles set display_name = p_display_name, phone = nullif(p_phone, '') where user_id = p_user_id;
end;
$$;

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
      plan = excluded.plan, status = 'active', starts_on = excluded.starts_on,
      expires_on = excluded.expires_on, amount = excluded.amount,
      source_payment_request_id = excluded.source_payment_request_id, updated_at = now();
  end if;

  update public.subscription_payment_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(), reviewed_by = (select auth.uid())
  where id = v_request.id
  returning * into v_request;
  return v_request;
end;
$$;

-- Repair Silver Monthly periods previously stored with a one-year expiry.
update public.subscriptions as subscription
set expires_on = (subscription.starts_on + interval '1 month')::date,
    updated_at = now()
from public.subscription_payment_requests as request
where request.id = subscription.source_payment_request_id
  and request.plan = 'silver_monthly'
  and request.amount in (500, 1350)
  and subscription.plan = 'silver_monthly'
  and subscription.expires_on = (subscription.starts_on + interval '1 year')::date;

drop policy if exists "Admins can read all payment requests" on public.subscription_payment_requests;
drop policy if exists "Admins can read managed payment requests" on public.subscription_payment_requests;
create policy "Admins can read managed payment requests"
  on public.subscription_payment_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.user_roles as role
      where role.user_id = subscription_payment_requests.user_id
        and (
          (role.owner_id = (select auth.uid()) and public.is_subscription_admin())
          or (role.created_by = (select auth.uid()) and public.is_platform_admin())
        )
    )
  );

drop policy if exists "Admins can read all subscriptions" on public.subscriptions;
drop policy if exists "Admins can read managed subscriptions" on public.subscriptions;
create policy "Admins can read managed subscriptions"
  on public.subscriptions for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.user_roles as role
      where role.user_id = subscriptions.user_id
        and (
          (role.owner_id = (select auth.uid()) and public.is_subscription_admin())
          or (role.created_by = (select auth.uid()) and public.is_platform_admin())
        )
    )
  );

do $$
begin
  if to_regclass('public.rent_payment_accounts') is not null then
    execute 'drop policy if exists "Owners can read their rent account references" on public.rent_payment_accounts';
    execute 'drop policy if exists "Workspace members can read rent account references" on public.rent_payment_accounts';
    execute 'create policy "Workspace members can read rent account references" on public.rent_payment_accounts for select to authenticated using (public.can_read_rental_workspace(owner_id))';
    execute 'drop policy if exists "Owners can create their rent account references" on public.rent_payment_accounts';
    execute 'drop policy if exists "Workspace members can create rent account references" on public.rent_payment_accounts';
    execute 'create policy "Workspace members can create rent account references" on public.rent_payment_accounts for insert to authenticated with check (public.can_access_rental_workspace(owner_id))';
    execute 'drop policy if exists "Owners can update their rent account references" on public.rent_payment_accounts';
    execute 'drop policy if exists "Workspace members can update rent account references" on public.rent_payment_accounts';
    execute 'create policy "Workspace members can update rent account references" on public.rent_payment_accounts for update to authenticated using (public.can_access_rental_workspace(owner_id)) with check (public.can_access_rental_workspace(owner_id))';
  end if;
  if to_regclass('public.rent_payments') is not null then
    execute 'drop policy if exists "Owners can read rent payments in their workspace" on public.rent_payments';
    execute 'drop policy if exists "Workspace members can read rent payments" on public.rent_payments';
    execute 'create policy "Workspace members can read rent payments" on public.rent_payments for select to authenticated using (public.can_read_rental_workspace(owner_id))';
  end if;
end;
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;
revoke all on function public.can_access_rental_workspace(uuid) from public, anon;
grant execute on function public.can_access_rental_workspace(uuid) to authenticated;
revoke all on function public.can_read_rental_workspace(uuid) from public, anon;
grant execute on function public.can_read_rental_workspace(uuid) to authenticated;
revoke all on function public.admin_update_user_access(uuid, text, boolean, text, text, text) from public, anon;
grant execute on function public.admin_update_user_access(uuid, text, boolean, text, text, text) to authenticated;
revoke all on function public.review_subscription_payment(uuid, boolean) from public, anon;
grant execute on function public.review_subscription_payment(uuid, boolean) to authenticated;