-- Run after subscription_payments.sql in Supabase SQL Editor.
-- Safe to rerun. This also prepares the columns and user type constraint needed by user_hierarchy.sql.
alter table public.profiles
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.user_roles
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.profiles drop constraint if exists profiles_user_type_check;
alter table public.profiles add constraint profiles_user_type_check
  check (user_type in ('platform_admin', 'landlord', 'property_manager', 'caretaker'));

do $$
declare
  v_user_id uuid;
  v_email text;
  v_display_name text;
begin
  select id, email,
         coalesce(nullif(raw_user_meta_data ->> 'full_name', ''), nullif(raw_user_meta_data ->> 'name', ''), split_part(email, '@', 1))
  into v_user_id, v_email, v_display_name
  from auth.users
  where lower(email) = lower('mohammedhussein3562@gmail.com');

  if v_user_id is null then
    raise exception 'No Supabase Auth account found for mohammedhussein3562@gmail.com. Create or invite this user in Authentication > Users, confirm the email address, then rerun this SQL.';
  end if;

  insert into public.profiles (user_id, owner_id, created_by, display_name, email, user_type, signup_status, requested_plan)
  values (v_user_id, v_user_id, null, v_display_name, v_email, 'platform_admin', 'approved', null)
  on conflict (user_id) do update
    set owner_id = excluded.owner_id,
        created_by = null,
        user_type = 'platform_admin',
        signup_status = 'approved',
        requested_plan = null;

  insert into public.user_roles (user_id, owner_id, created_by, role, active)
  values (v_user_id, v_user_id, null, 'admin', true)
  on conflict (user_id) do update
    set owner_id = excluded.owner_id,
        created_by = null,
        role = 'admin',
        active = true;
end;
$$;
