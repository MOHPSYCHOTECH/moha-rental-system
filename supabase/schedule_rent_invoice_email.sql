-- Run after adding a Supabase Vault secret named invoice_cron_secret.
-- Schedules the invoice worker daily at 05:00 UTC (08:00 East Africa Time).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'process-rent-invoices-daily';

select cron.schedule(
  'process-rent-invoices-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://hrhtocsaecuginzizjbf.supabase.co/functions/v1/process-rent-invoices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-invoice-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'invoice_cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
