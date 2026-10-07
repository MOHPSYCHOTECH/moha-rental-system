# Supabase Setup

The app now uses Supabase Auth and the authenticated user's `rental_workspaces` row. Browser storage is used only to import old rental data once; after a successful cloud write, the old rental and local-account keys are removed. Supabase Auth keeps a browser session token so users remain signed in; passwords and rental records are not stored there.

## One-time project setup

1. In Supabase Authentication settings, enable email/password sign-in and configure the site URL and redirect URLs for your local app and deployed site. For local Vite development, allow both `http://localhost:5173/**` and `http://localhost:5175/**` because Vite may choose either port.
2. In the Supabase SQL Editor, run `supabase/schema.sql` if the rental workspace table is not already installed.
3. Run `supabase/subscription_payments.sql` in the SQL Editor. This migration adds profile/role fields used by the frontend and upgrades existing rows.
4. Run `supabase/user_hierarchy.sql` in the SQL Editor. It adds the distinct platform-admin identity, inviter tracking, Landlord/Caretaker permission checks, and shared workspace policies. If this migration was already run, rerun it to enable platform-admin read-only access to landlord portfolios; it does not grant platform admins workspace write access. Then run `supabase/subscription_plans.sql`, `supabase/subscription_payment_methods.sql`, `supabase/landlord_public_signup.sql`, `supabase/auto_approve_landlord_signups.sql`, and `supabase/subscription_payment_admin_queue.sql` in that order. They enable Test/Silver plans, platform-wide subscription payment methods, approval-gated public landlord registration, automatic workspace approval after 30 minutes, and protected platform account/payment queue/review functions. The automatic approval job uses `pg_cron`, runs every minute, and may approve at approximately 30-31 minutes after signup. Verify `auto-approve-landlord-signups` appears in Supabase Database → Cron Jobs. If `pg_cron` is unavailable or disabled for the project, enable the `pg_cron` extension in Database → Extensions and rerun `auto_approve_landlord_signups.sql`. Rerun the last migration if payment review reports that a payment is outside the admin's private workspace; its review function authorizes platform admins via `user_roles.created_by` and workspace admins via `user_roles.owner_id`. It returns the activated subscription directly, avoiding a separate RLS-filtered read, and repairs Silver Monthly subscriptions whose exact one-year expiry was created by the older approval-function bug. Configure Paybill, Till, or bank transfer under Platform Administrator → Settings → Team access. Finally run `supabase/workspace_history_backups.sql` to enable workspace change history, daily backups, and administrator-only restore. Run `supabase/workspace_backup_delete.sql` afterward to enable administrator-only backup deletion. The migration installs and schedules `pg_cron` backups at 05:15 UTC; verify the job appears in Supabase Database → Cron Jobs.
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

Enable email/password sign-up in Supabase Authentication and configure the deployed site URL and redirect URLs before publishing `/landlord-signup`. New landlords select Test, Silver Monthly, or Silver Yearly and confirm their email if email confirmation is enabled. A Platform Administrator may approve or reject a request under Settings → Team access → Landlord registrations awaiting approval. If no decision is made, `auto_approve_landlord_signups.sql` automatically approves workspace access after 30 minutes (the scheduled check runs every minute). A Test request starts the one-month trial when approved; automatic approval does not activate a paid Silver subscription, which still requires payment and administrator verification. Rejecting a request before the 30-minute deadline keeps that account unable to access a workspace.

## Public homepage totals

Run `supabase/public_platform_stats.sql` in the Supabase SQL Editor after `supabase/user_hierarchy.sql`, `supabase/landlord_public_signup.sql`, and `supabase/rent_c2b.sql`. The homepage calls `get_public_platform_stats()` when it opens and animates the returned figures from zero. The function returns only aggregate totals: approved active Landlord accounts, tenant entries in their workspace listings, and recorded manual plus Safaricom-confirmed rent payments. It does not return tenant names, landlord identities, or transaction details. If the SQL function has not been installed or cannot be reached, the homepage shows that the totals are unavailable instead of displaying fabricated values.

## Subscription plans

Landlords can start the Test plan once per account for one month at no cost. Silver costs KSh 1,350 monthly or KSh 13,500 yearly (a KSh 2,700 saving compared with twelve monthly payments). Both include property, unit, and tenant management; rent, water, and payment tracking; invoices; the tenant portal; WhatsApp reminders; maintenance; expenses; applicant management; monthly CSV reports; and team access. Yearly Silver also includes priority support, advanced reports, and backup features. Silver payment references remain subject to manual platform-admin verification. Apply `supabase/subscription_price_update.sql` in the Supabase SQL Editor to enable the new amounts while preserving existing pending requests and subscriptions.

For the configured platform administrator account `mohammedhussein3562@gmail.com`, run `supabase/promote_mohammed_admin.sql` after both SQL migrations. The platform administrator retains the `admin` workspace role but has a distinct `platform_admin` user type; Landlords also have the `admin` role within their own workspaces, without platform-wide invite rights.

## Existing browser data and accounts

On the first successful Supabase login in a browser, if that Auth user's private workspace is empty, the app uploads the existing rental records and settings from that browser. It removes those legacy browser records only after the upload succeeds. Existing local usernames/passwords cannot be migrated into Supabase Auth; create/invite Auth accounts and assign their roles in Supabase instead.

Each Landlord owns a private rental workspace. Caretaker accounts invited by that Landlord are linked to the Landlord's `owner_id` and can load that shared workspace, while platform-created Landlords own their own workspace and are linked to the platform administrator through `created_by`.

Platform Administrators see a consolidated, read-only portfolio dashboard with all invited Landlords, their property and occupancy summaries, rent roll, tenant counts, recorded payments, and landlord-specific/property-specific overview drill-downs. The dashboard reads each Landlord's `rental_workspaces` row; the hierarchy migration grants the platform role select access only, leaving insert and update restricted to workspace members.

## M-Pesa payment review

The app inserts payment requests into `subscription_payment_requests`. Admins load pending requests and payer details through `get_admin_subscription_payment_queue()`, a protected database function scoped to the administrator's owner group or platform-created Landlords. The Settings → Team access → Subscription payments section also has Approved, Rejected, and All processed views. These views fetch a bounded page from `get_admin_subscription_payment_history()` and show the total number of matching records with pagination. Rerun `supabase/subscription_payment_admin_queue.sql` to install the history function. Approvals and rejections use the protected review function. Verify the transaction in the Paybill statement before approving; this is a manual review and does not automatically confirm receipt from M-Pesa.

## Direct Paybill rent collection (C2B)

This is separate from subscription Paybill payments. In Settings → Rent collection, a Landlord can use their own Paybill/till/bank details for tenant instructions or opt in to the shared Moha Paybill. C2B automatically confirms incoming tenant payments only for the shared Moha Paybill. The Platform Administrator then sends each landlord payout manually and approves the completed transfer from the portfolio dashboard. Payments to a landlord's separate Paybill, till, or bank account must be reconciled manually unless that provider has its own integration. For the shared Paybill, tenants use the stable account reference shown in their tenant profile, invoice, and payment reminders. The account reference is generated by the app; it is not a National ID. A confirmed C2B payment is recorded in `rent_payments` and shown in Payments → Confirmed rent payments.

The landlord app loads confirmed payments on sign-in, listens for payment and payout changes, and periodically refreshes while open. If the list reports an error, follow the displayed Supabase error; verify `rent_c2b.sql`, `rent_c2b_unit_paybill_reference.sql`, and `user_hierarchy.sql` have been run, then check the `rent-callback` Edge Function logs for rejected or failed callbacks. A payment to a separate landlord Paybill will not appear in this automatic list.

1. Get a Safaricom Daraja app authorized for C2B on the rent Paybill. Sandbox credentials/shortcode only work with Safaricom sandbox; production requires the approved production shortcode and production credentials.
2. For a new C2B installation, run `supabase/rent_c2b.sql` and then `supabase/rent_c2b_unit_paybill_reference.sql` in Supabase SQL Editor. For an existing C2B installation, run `supabase/rent_c2b_unit_paybill_reference.sql`.
3. Add the shared rent Paybill shortcode to frontend `.env` as `VITE_MPESA_RENT_PAYBILL=...`, then restart Vite and rebuild/redeploy the frontend. Do not use a subscription-only shortcode unless Safaricom enables it for rent C2B.
4. Set these C2B secrets for Supabase Edge Functions (never put secrets in frontend `.env`):

   ```powershell
   supabase secrets set MPESA_CONSUMER_KEY=YOUR_DARAJA_CONSUMER_KEY MPESA_CONSUMER_SECRET=YOUR_DARAJA_CONSUMER_SECRET MPESA_RENT_SHORTCODE=YOUR_APPROVED_RENT_SHORTCODE MPESA_C2B_CALLBACK_TOKEN=YOUR_LONG_RANDOM_CALLBACK_TOKEN MPESA_ENVIRONMENT=sandbox
   ```

   Use `sandbox` while testing and change `MPESA_ENVIRONMENT` to `production` only after Safaricom approves the production app and shortcode.

5. Deploy the callback and C2B registration functions:

   ```powershell
   supabase functions deploy rent-callback --no-verify-jwt
   supabase functions deploy mpesa-register-c2b
   ```

   Redeploy `rent-callback` promptly to stop the previously deployed function from initiating automatic B2C payouts. After the new callback is deployed, `MPESA_B2C_*` secrets are no longer used and can be removed from Supabase Edge Function Secrets. Review any prior queued/processing/timeout B2C payout in the Safaricom portal before manually paying it.

6. Sign in as a Landlord administrator, choose **Use Moha Paybill (manual landlord payouts)**, save the setting, then use **Register callbacks** once for the shared Paybill. Callback registration requires an eligible C2B shortcode. If setup reports that `mpesa-register-c2b` was not found, check the linked Supabase project and `supabase functions list`.

7. Install the payout tracking table. For a new setup, run `supabase/rent_payouts.sql` and then `supabase/manual_rent_payouts.sql`. If the previous automatic-payout setup already created `rent_payouts`, run `supabase/manual_rent_payouts.sql` only. It preserves completed legacy payouts and marks old uncertain B2C requests for administrator review.

8. After a tenant payment is confirmed, its landlord payment appears in **Landlord payout approvals** on the Platform Administrator's portfolio dashboard. Send the landlord their funds using M-Pesa, bank transfer, or another agreed method, then click **Approve payout**, enter the transfer date and reference, and confirm that the transfer has already been sent. Approved transfers remain listed under **Approved landlord payments** on the same dashboard, with pagination for the history. The app prevents a second payout record for a payment already marked paid. The landlord can see the recorded settlement status/reference next to the confirmed rent payment.

The registration function supplies token-protected C2B callback URLs using path segments: `/functions/v1/rent-callback/<C2B-token>/confirmation` and `/functions/v1/rent-callback/<C2B-token>/validation`. Do not configure B2C credentials or B2C callbacks; landlord payouts are manual. If Safaricom rejects C2B registration, verify the environment, shortcode, and C2B product approval; sandbox callback URL registration may be restricted, so test with the sandbox simulator when needed.

The callback endpoint is public because Safaricom calls it; it checks the configured callback token and Paybill shortcode and uses the Supabase service-role key only on the server. Keep Edge Function logs and secrets private. Test in sandbox before switching to production. Do not reuse the subscription Paybill unless Safaricom has also configured it for rent C2B callbacks.

## Metered water bills

When adding a property, enter its shared water price per unit in KSh; it can also be changed later from the property's **Edit** action. The rate is stored on the property and shared by every tenant in that apartment, while each landlord's property/workspace has its own rate. In the tenant list, choose **Read meter** to enter the previous meter reading and current meter reading. The app calculates `(current − previous) × apartment unit price` and uses that amount as the tenant's water bill on their invoice. Invoices include both readings, the consumed units, the unit price, and the calculated water charge when readings are available. On the first reading, enter the meter's previous baseline. After saving, that tenant's current reading becomes their next previous reading, and the apartment rate is prefilled. Changing the rate applies to future meter readings and does not recalculate water bills already recorded. This information is stored in the existing `rental_workspaces` data and requires no additional SQL migration.

## Tenant reminders

The landlord dashboard's rent reminder queue uses SMS by default: selecting **SMS** opens a prefilled draft in the landlord's messaging app, and the landlord reviews and taps **Send**. It uses the tenant's saved phone number and does not require an email service or SMS gateway. WhatsApp remains available as an alternative. This is a manual draft, not an automatically sent message.

The scheduled invoice-email workflow below is separate from rent reminders. It continues to send itemized invoices by email through Resend when configured; it is optional and is not needed for SMS reminders.

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
