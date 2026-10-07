-- Run after landlord_public_signup.sql.
-- Unreviewed public landlord signups are approved after 30 minutes.
-- The scheduled job checks every minute, so approval occurs at about 30-31 minutes.

create extension if not exists pg_cron;

create or replace function public.auto_approve_expired_landlord_signups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform_admin_id uuid;
  v_request record;
  v_approved_count integer := 0;
begin
  select profile.user_id
  into v_platform_admin_id
  from public.profiles as profile
  join public.user_roles as role on role.user_id = profile.user_id
  where profile.user_type = 'platform_admin'
    and role.role = 'admin'
    and role.active
  order by profile.user_id
  limit 1;

  if v_platform_admin_id is null then
    raise exception 'Cannot auto-approve landlord signups: no active Platform Administrator account exists.';
  end if;

  for v_request in
    select request.user_id, request.requested_plan
    from public.landlord_signup_requests as request
    join public.profiles as profile on profile.user_id = request.user_id
    join public.user_roles as role on role.user_id = profile.user_id
    where request.status = 'pending'
      and request.submitted_at <= now() - interval '30 minutes'
      and profile.user_type = 'landlord'
      and profile.signup_status = 'pending'
      and profile.created_by is null
      and role.role = 'admin'
      and not role.active
    order by request.submitted_at, request.user_id
    for update of request, profile, role skip locked
  loop
    update public.profiles
    set signup_status = 'approved',
        requested_plan = v_request.requested_plan,
        created_by = v_platform_admin_id,
        owner_id = v_request.user_id
    where user_id = v_request.user_id;

    update public.user_roles
    set role = 'admin',
        active = true,
        owner_id = v_request.user_id,
        created_by = v_platform_admin_id
    where user_id = v_request.user_id;

    update public.landlord_signup_requests
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = null
    where user_id = v_request.user_id
      and status = 'pending';

    if v_request.requested_plan = 'test' then
      insert into public.subscriptions (
        user_id, plan, status, starts_on, expires_on, amount, source_payment_request_id, updated_at
      ) values (
        v_request.user_id, 'test', 'trial', current_date,
        (current_date + interval '1 month')::date, 0, null, now()
      )
      on conflict (user_id) do nothing;
    end if;

    v_approved_count := v_approved_count + 1;
  end loop;

  return v_approved_count;
end;
$$;

revoke all on function public.auto_approve_expired_landlord_signups() from public, anon, authenticated;
grant execute on function public.auto_approve_expired_landlord_signups() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'auto-approve-landlord-signups';

select cron.schedule(
  'auto-approve-landlord-signups',
  '* * * * *',
  'select public.auto_approve_expired_landlord_signups();'
);
