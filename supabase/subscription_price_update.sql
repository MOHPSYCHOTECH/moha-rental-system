-- Run after subscription_plans.sql to allow the updated Silver plan prices.
-- Old prices remain accepted so existing pending requests and subscriptions
-- can still be reviewed without changing their recorded amounts.

alter table public.subscription_payment_requests
  drop constraint if exists subscription_payment_amount_matches_plan;
alter table public.subscription_payment_requests
  add constraint subscription_payment_amount_matches_plan
  check (
    (plan = 'monthly' and amount = 200) or
    (plan = 'yearly' and amount = 2000) or
    (plan = 'silver_monthly' and amount in (500, 1350)) or
    (plan = 'silver_yearly' and amount in (4500, 13500))
  );

alter table public.subscriptions
  drop constraint if exists subscriptions_amount_check;
alter table public.subscriptions
  add constraint subscriptions_amount_check
  check (amount in (0, 200, 500, 1350, 2000, 4500, 13500));
