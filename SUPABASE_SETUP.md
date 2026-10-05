# Supabase Setup

The app now uses Supabase Auth and the authenticated user's `rental_workspaces` row. Browser storage is used only to import old rental data once; after a successful cloud write, the old rental and local-account keys are removed. Supabase Auth keeps a browser session token so users remain signed in; passwords and rental records are not stored there.

## One-time project setup

1. In Supabase Authentication settings, enable email/password sign-in and configure the site URL and redirect URLs for your local app and deployed site. For local Vite development, allow both `http://localhost:5173/**` and `http://localhost:5175/**` because Vite may choose either port.
2. In the Supabase SQL Editor, run `supabase/schema.sql` if the rental workspace table is not already installed.
3. Run `supabase/subscription_payments.sql` in the SQL Editor. This migration adds profile/role fields used by the frontend and upgrades existing rows.
4. Run `supabase/user_hierarchy.sql` in the SQL Editor. It adds the distinct platform-admin identity, inviter tracking, Landlord/Caretaker permission checks, and shared workspace policies. If this migration was already run, rerun it to enable platform-admin read-only access to landlord portfolios; it does not grant platform admins workspace write access. Then run `supabase/subscription_plans.sql`, `supabase/subscription_payment_methods.sql`, `supabase/landlord_public_signup.sql`, and `supabase/subscription_payment_admin_queue.sql` in that order. They enable Test/Silver plans, platform-wide subscription payment methods, approval-gated public landlord registration, and protected platform account/payment queue/review functions. Rerun the last migration if payment review reports that a payment is outside the admin's private workspace; its review function authorizes platform admins via `user_roles.created_by` and workspace admins via `user_roles.owner_id`. It returns the activated subscription directly, avoiding a separate RLS-filtered read, and repairs Silver Monthly subscriptions whose exact one-year expiry was created by the older approval-function bug. Configure Paybill, Till, or bank transfer under Platform Administrator → Settings → Team access. Finally run `supabase/workspace_history_backups.sql` to enable workspace change history, daily backups, and administrator-only restore. Run `supabase/workspace_backup_delete.sql` afterward to enable administrator-only backup deletion. The migration installs and schedules `pg_cron` backups at 05:15 UTC; verify the job appears in Supabase Database → Cron Jobs.
5. In Authentication → Users, create or invite the first platform administrator account. Copy its Auth user UUID.
6. Run `supabase/promote_mohammed_admin.sql` for the configured platform administrator account. It is safe to rerun and prepares the platform-admin columns/constraint, but `subscription_payments.sql` must be installed first. For another account, set its profile `user_type` to `platform_admin`, `signup_status` to `approved`, and both its profile and `user_roles` `owner_id` values to its own Auth UUID, then set its active `user_roles.role` to `admin`.
7. Install and log in to the Supabase CLI, then deploy the protected account-invitation function from the project root:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy admin-manage-user
   ```

8. In Settings → Team access, the platform administrator can invite Landlords; each Landlord can invite Caretakers. Supabase sends the invite link; the invitee sets their password through Supabase Auth. Caretakers cannot invite users.

The app already reads its Supabase URL and publishable key from `.env`. Never add a service-role key to `.env` or frontend code. Supabase provides `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions; it remains server-side.

## Public landlord registration

Enable email/password sign-up in Supabase Authentication and configure the deployed site URL and redirect URLs before publishing `/landlord-signup`. New landlords select Test, Silver Monthly, or Silver Yearly and confirm their email if email confirmation is enabled. Registration remains inactive until the Platform Administrator approves it under Settings → Team access → Landlord registrations awaiting approval. Approval starts the one-month Test plan when selected; paid Silver subscriptions still require payment and admin verification. Rejecting a request keeps that account unable to access a workspace.

## Subscription plans

Landlords can start the Test plan once per account for one month at no cost. Silver costs KSh 500 monthly or KSh 4,500 yearly. Both include property, unit, and tenant management; rent, water, and payment tracking; invoices; the tenant portal; WhatsApp reminders; maintenance; expenses; applicant management; monthly CSV reports; and team access. Yearly Silver also includes priority support, advanced reports, and backup features. Silver payment references remain subject to manual platform-admin verification.

For the configured platform administrator account `mohammedhussein3562@gmail.com`, run `supabase/promote_mohammed_admin.sql` after both SQL migrations. The platform administrator retains the `admin` workspace role but has a distinct `platform_admin` user type; Landlords also have the `admin` role within their own workspaces, without platform-wide invite rights.

## Existing browser data and accounts

On the first successful Supabase login in a browser, if that Auth user's private workspace is empty, the app uploads the existing rental records and settings from that browser. It removes those legacy browser records only after the upload succeeds. Existing local usernames/passwords cannot be migrated into Supabase Auth; create/invite Auth accounts and assign their roles in Supabase instead.

Each Landlord owns a private rental workspace. Caretaker accounts invited by that Landlord are linked to the Landlord's `owner_id` and can load that shared workspace, while platform-created Landlords own their own workspace and are linked to the platform administrator through `created_by`.

Platform Administrators see a consolidated, read-only portfolio dashboard with all invited Landlords, their property and occupancy summaries, rent roll, tenant counts, recorded payments, and landlord-specific/property-specific overview drill-downs. The dashboard reads each Landlord's `rental_workspaces` row; the hierarchy migration grants the platform role select access only, leaving insert and update restricted to workspace members.

## M-Pesa payment review

The app inserts payment requests into `subscription_payment_requests`. Admins load pending requests and payer details through `get_admin_subscription_payment_queue()`, a protected database function scoped to the administrator's owner group or platform-created Landlords. The Settings → Team access → Subscription payments section also has Approved, Rejected, and All processed views. These views fetch a bounded page from `get_admin_subscription_payment_history()` and show the total number of matching records with pagination. Rerun `supabase/subscription_payment_admin_queue.sql` to install the history function. Approvals and rejections use the protected review function. Verify the transaction in the Paybill statement before approving; this is a manual review and does not automatically confirm receipt from M-Pesa.

## Direct Paybill rent collection (C2B)

This is separate from subscription Paybill payments. Landlords configure the rent payment method and Paybill number in Settings → Rent collection. Tenants pay rent directly to the rent Paybill and enter an account number made from the property name and unit display name (for example, `WILLOW-GARDENS-2B`). Safaricom's C2B confirmation callback resolves that readable number to the tenant's stable internal account and records the confirmed transaction in `rent_payments`; it is shown in Payments → Confirmed rent payments. The internal account ID is generated by the app and is not a National ID.

1. Get a Safaricom Daraja app authorized for C2B on the rent Paybill. Sandbox credentials/shortcode only work with Safaricom sandbox; production requires the approved production shortcode and production credentials.
2. Run `supabase/rent_c2b.sql` and then `supabase/rent_c2b_unit_paybill_reference.sql` in Supabase SQL Editor. For an existing installation, run only `supabase/rent_c2b_unit_paybill_reference.sql`.
3. Add the approved rent Paybill shortcode to the frontend `.env` as `VITE_MPESA_RENT_PAYBILL=...`, then restart Vite and rebuild/redeploy the frontend.
4. Set these secrets for Supabase Edge Functions (do not put them in frontend `.env`):

   ```powershell
   supabase secrets set MPESA_CONSUMER_KEY=YOUR_DARAJA_CONSUMER_KEY MPESA_CONSUMER_SECRET=YOUR_DARAJA_CONSUMER_SECRET MPESA_RENT_SHORTCODE=YOUR_APPROVED_RENT_SHORTCODE MPESA_C2B_CALLBACK_TOKEN=YOUR_LONG_RANDOM_CALLBACK_TOKEN MPESA_ENVIRONMENT=sandbox
   ```

   Set `MPESA_ENVIRONMENT=production` only after Safaricom enables the production Daraja app and shortcode. Use a long random callback token.

5. Deploy both functions:

   ```powershell
   supabase functions deploy mpesa-rent-c2b --no-verify-jwt
   supabase functions deploy mpesa-register-c2b
   ```

   If the Settings button reports `mpesa-register-c2b` not found, the CLI is linked to a different Supabase project or the function deployment did not succeed. Check `supabase functions list` after linking and confirm both function names are present.

6. Add `VITE_MPESA_RENT_PAYBILL=YOUR_APPROVED_RENT_SHORTCODE` to frontend `.env`, restart Vite, and rebuild/redeploy the frontend.
7. Sign into the app as Platform Administrator and open Settings → Team access → Register Safaricom callbacks. Safaricom registration requires a publicly reachable HTTPS callback URL and an eligible C2B shortcode.
8. Give each tenant the rent Paybill number and the property-and-unit account number shown on their profile/invoice. Renaming a unit updates its Paybill account number on the next workspace sync; the internal payment account remains stable. Account numbers must be unique across the configured Paybill. Once Safaricom posts a successful confirmation, the receipt, amount, date, phone, tenant, property, and unit appear in Payments → Confirmed rent payments and update the rent-due status.

Safaricom's C2B URL registration generally requires a live/production shortcode. If it rejects a sandbox shortcode, use the sandbox transaction simulator for callback testing or register only after Safaricom approves the production Paybill. Direct-to-Paybill automation is not active until the SQL is applied, functions deployed, Daraja secrets configured, and callback registration succeeds.

The registration function supplies token-protected callback URLs using a path segment (not a query string) to improve compatibility with provider URL validation. After updating the functions, redeploy both `mpesa-register-c2b` and `mpesa-rent-c2b`, then register the URLs again. The callback function continues to accept previously registered query-string URLs until Safaricom switches them over. If Safaricom still rejects registration, use the HTTP status and provider error shown in Settings to verify the credentials and shortcode belong to the same environment and that the Daraja app has C2B access. For a production shortcode that is not enabled for C2B, only Safaricom can enable the product or resolve the shortcode restriction; the sandbox simulator remains the test path.

The callback endpoint is public because Safaricom calls it; it checks the configured callback token and Paybill shortcode and uses the Supabase service-role key only on the server. Keep Edge Function logs and secrets private. Test in sandbox before switching to production. Do not reuse the subscription Paybill unless Safaricom has also configured it for rent C2B callbacks.

## Automatic rent invoice email

The invoice worker holds each rent invoice until the current rent cycle has a water-bill update. A daily run emails the landlord once while the bill is missing; after the landlord or caretaker updates it, a later run emails the invoice to the tenant's registered address. Successful sends are recorded by owner, property, unit, and due date to prevent duplicate delivery.

1. In Supabase SQL Editor, run `supabase/rent_invoice_email.sql`.
2. Verify a sending domain with Resend. From the project root, set `RESEND_API_KEY`, `INVOICE_FROM`, and a long random `INVOICE_CRON_SECRET` as Edge Function secrets. Enter real secret values directly in your terminal; do not add them to frontend `.env`:

   ```powershell
   supabase secrets set RESEND_API_KEY=YOUR_RESEND_API_KEY INVOICE_FROM="Moha Rentals <invoices@YOUR_VERIFIED_DOMAIN>" INVOICE_CRON_SECRET=YOUR_LONG_RANDOM_SECRET
   ```

3. Deploy the worker:

   ```powershell
   supabase functions deploy process-rent-invoices
   ```

4. In Supabase Dashboard → Database → Vault, add a secret named `invoice_cron_secret` with exactly the same value as `INVOICE_CRON_SECRET`.
5. In Supabase SQL Editor, run `supabase/schedule_rent_invoice_email.sql`. It schedules the worker daily at 08:00 East Africa Time using `pg_cron` and `pg_net`.
6. Test with a tenant whose rent anniversary has passed. The landlord dashboard shows a **Water bill needed** alert while the bill is stale. After an authorized landlord or caretaker updates it, the next scheduled run sends the itemized email. Confirm delivery in Resend and status in `public.rent_invoice_email_jobs`.

The app records `waterBillUpdatedAt` when the bill is edited. Older tenant records without that timestamp intentionally remain blocked until their water bill is updated for a current rent cycle. The current mail action in the invoice modal still opens the user's email app; automatic scheduled delivery is handled only by the Edge Function.
