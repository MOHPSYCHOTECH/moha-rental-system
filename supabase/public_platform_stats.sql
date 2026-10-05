-- Run after user_hierarchy.sql, landlord_public_signup.sql, and rent_c2b.sql.
-- Exposes only aggregate counts and payment totals for the public homepage.
create or replace function public.get_public_platform_stats()
returns table (
  landlord_count bigint,
  tenant_count bigint,
  total_collected numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with active_landlords as (
    select profile.user_id, profile.owner_id
    from public.profiles as profile
    join public.user_roles as role on role.user_id = profile.user_id
    where profile.user_type = 'landlord'
      and coalesce(profile.signup_status, 'approved') = 'approved'
      and role.active
  ),
  landlord_workspace_owners as (
    select user_id as owner_id from active_landlords
    union
    select owner_id from active_landlords where owner_id is not null
  ),
  workspaces as (
    select workspace.owner_id, workspace.data
    from public.rental_workspaces as workspace
    join landlord_workspace_owners as owner on owner.owner_id = workspace.owner_id
  ),
  tenant_totals as (
    select
      coalesce(sum(
        case
          when jsonb_typeof(workspace.data -> 'tenants') = 'array'
            then jsonb_array_length(workspace.data -> 'tenants')
          else 0
        end
      ), 0) as tenant_count
    from workspaces as workspace
  ),
  manual_payment_totals as (
    select
      coalesce(sum(replace(payment_amount.amount_text, ',', '')::numeric), 0) as manual_total
    from workspaces as workspace
    left join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(workspace.data #> '{records,Payments}') = 'array'
          then workspace.data #> '{records,Payments}'
        else '[]'::jsonb
      end
    ) as payment_row(value) on true
    left join lateral (
      select substring(payment_row.value from '^[^0-9]*([0-9][0-9,]*(\.[0-9]+)?)') as amount_text
    ) as payment_amount on payment_amount.amount_text is not null
  ),
  confirmed_total as (
    select coalesce(sum(payment.amount), 0) as amount
    from public.rent_payments as payment
    join landlord_workspace_owners as owner on owner.owner_id = payment.owner_id
  )
  select
    (select count(*) from active_landlords),
    tenant_totals.tenant_count,
    manual_payment_totals.manual_total + confirmed_total.amount
  from tenant_totals
  cross join manual_payment_totals
  cross join confirmed_total;
$$;

revoke all on function public.get_public_platform_stats() from public, anon, authenticated;
grant execute on function public.get_public_platform_stats() to anon, authenticated;
