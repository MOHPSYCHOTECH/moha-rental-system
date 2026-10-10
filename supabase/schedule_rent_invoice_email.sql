-- Run after adding a Supabase Vault secret named invoice_cron_secret.
-- Polls invoice and tenant-notification email queues every 15 minutes.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname in ('process-rent-invoices-daily', 'process-tenant-emails');

select cron.schedule(
  'process-tenant-emails',
  '*/15 * * * *',
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
