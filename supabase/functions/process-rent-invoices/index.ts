// @ts-ignore Deno resolves this URL import when deploying the Edge Function.
import { createClient as createSupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DenoRuntime = {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}
type WorkspaceRow = { owner_id: string; data: { tenants?: WorkspaceTenant[]; records?: { Payments?: string[] }; settings?: { rentReminderEnabled?: boolean } } | null }
type LandlordProfile = { user_id: string; display_name: string | null; email: string | null }
type TenantEmailJob = { id: string; owner_id: string; event_type: string; idempotency_key: string; tenant_email: string; tenant_name: string; property_name: string; unit_name: string; payload: Record<string, unknown>; status: string; attempts: number }
type ExpiredSubscription = { user_id: string; plan: string; status: string; expires_on: string }
type SubscriptionPaymentSettings = { payment_method: 'paybill' | 'till' | 'bank_transfer'; paybill_number: string; till_number: string; bank_name: string; bank_account_name: string; bank_account_number: string }
type ExpiryEmailJob = { id: string; user_id: string; expires_on: string; plan: string; landlord_name: string; landlord_email: string; payment_method: SubscriptionPaymentSettings['payment_method']; paybill_number: string; till_number: string; bank_name: string; bank_account_name: string; bank_account_number: string; status: string; attempts: number }
const denoRuntime = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-invoice-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type WorkspaceTenant = {
  name?: string
  email?: string
  property?: string
  unit?: string
  rent?: string
  waterBill?: string
  waterBillUpdatedAt?: string
  movedIn?: string
}

type RentCycle = { dueDate: string; periodStart: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

function amount(value: string | undefined) {
  return Number(String(value ?? '').replace(/[^0-9.]/g, '')) || 0
}

function dateAtMonthOffset(anchor: Date, offset: number) {
  const targetMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1))
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(anchor.getUTCDate(), lastDay)))
}

function rentCycle(movedIn?: string): RentCycle | null {
  if (!movedIn || !/^\d{4}-\d{2}-\d{2}$/.test(movedIn)) return null
  const [year, month, day] = movedIn.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day))
  const today = new Date()
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  let monthOffset = (todayDate.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + todayDate.getUTCMonth() - anchor.getUTCMonth()
  if (monthOffset < 1) return null
  if (dateAtMonthOffset(anchor, monthOffset) > todayDate) monthOffset -= 1
  if (monthOffset < 1) return null
  return {
    dueDate: dateAtMonthOffset(anchor, monthOffset).toISOString().slice(0, 10),
    periodStart: dateAtMonthOffset(anchor, monthOffset - 1).toISOString().slice(0, 10),
  }
}

function nextRentDueDate(movedIn?: string): string | null {
  if (!movedIn || !/^\d{4}-\d{2}-\d{2}$/.test(movedIn)) return null
  const [year, month, day] = movedIn.split('-').map(Number)
  const anchor = new Date(Date.UTC(year, month - 1, day))
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  let monthOffset = (today.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + today.getUTCMonth() - anchor.getUTCMonth()
  if (monthOffset < 1) monthOffset = 1
  if (dateAtMonthOffset(anchor, monthOffset) < today) monthOffset += 1
  return dateAtMonthOffset(anchor, monthOffset).toISOString().slice(0, 10)
}

async function tenantHasPaidForDueMonth(admin: ReturnType<typeof createSupabaseClient>, workspace: WorkspaceRow, tenant: WorkspaceTenant, dueDate: string) {
  const dueMonth = new Date(`${dueDate}T00:00:00Z`).toLocaleString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const manualPaymentExists = (workspace.data?.records?.Payments ?? []).some(row => {
    const fields = row.split(' · ')
    const property = fields[3] ?? ''
    const unit = (fields[2] ?? '').replace(/^House\s*/i, '')
    const period = fields[7] ?? ''
    return property === tenant.property
      && (unit === tenant.unit || row.includes(tenant.unit ?? ''))
      && (period === dueMonth || period === '')
  })
  if (manualPaymentExists) return true
  const [year, month] = dueDate.split('-').map(Number)
  const monthStart = new Date(Date.UTC(year, month - 1, 1)).toISOString()
  const nextMonthStart = new Date(Date.UTC(year, month, 1)).toISOString()
  const { data: payment, error } = await admin.from('rent_payments')
    .select('id')
    .eq('owner_id', workspace.owner_id)
    .eq('property_name', tenant.property)
    .eq('unit_name', tenant.unit)
    .gte('transacted_at', monthStart)
    .lt('transacted_at', nextMonthStart)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Could not check payment status for ${tenant.property}, Unit ${tenant.unit}: ${error.message}`)
  return Boolean(payment)
}

function emailTemplate(job: TenantEmailJob) {
  const tenant = escapeHtml(job.tenant_name)
  const property = escapeHtml(job.property_name)
  const unit = escapeHtml(job.unit_name)
  const payload = job.payload ?? {}
  const status = escapeHtml(String(payload.status ?? ''))
  const details = `<p><strong>Property:</strong> ${property}<br><strong>Unit:</strong> ${unit}</p>`
  const wrap = (title: string, body: string) => `<main style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#17211d"><p style="color:#39765f;font-weight:bold">MOHA RENTAL MANAGEMENT</p><h1 style="font-size:23px">${title}</h1><p>Hello ${tenant},</p>${body}<p style="margin-top:28px;color:#627168;font-size:12px">This is an automated message from your property management team.</p></main>`

  switch (job.event_type) {
    case 'rent_reminder': {
      const dueDate = escapeHtml(String(payload.due_date ?? ''))
      const total = Number(payload.rent_amount ?? 0) + Number(payload.water_bill_amount ?? 0)
      return {
        subject: `Rent reminder · ${property}, Unit ${unit} · due ${dueDate}`,
        html: wrap('Rent payment reminder', `${details}<p>Your rent payment of <strong>KSh ${Number(payload.rent_amount ?? 0).toLocaleString()}</strong>${Number(payload.water_bill_amount ?? 0) > 0 ? ` plus water charges of <strong>KSh ${Number(payload.water_bill_amount).toLocaleString()}</strong>` : ''} is due on <strong>${dueDate}</strong>.</p><p><strong>Total due: KSh ${total.toLocaleString()}</strong></p><p>Please use the payment instructions provided by your landlord. Contact them if you have already paid or need help.</p>`),
      }
    }
    case 'payment_receipt':
      return {
        subject: `Rent payment received · ${property}, Unit ${unit}`,
        html: wrap('Payment receipt', `${details}<p>We have recorded your payment of <strong>KSh ${Number(payload.amount ?? 0).toLocaleString()}</strong>.</p><p><strong>Date:</strong> ${escapeHtml(String(payload.date ?? ''))}<br><strong>Method:</strong> ${escapeHtml(String(payload.method ?? ''))}<br><strong>Reference:</strong> ${escapeHtml(String(payload.reference ?? ''))}${payload.period ? `<br><strong>Period:</strong> ${escapeHtml(String(payload.period))}` : ''}</p>`),
      }
    case 'maintenance_submitted':
      return {
        subject: `Maintenance request received · ${property}, Unit ${unit}`,
        html: wrap('Maintenance request received', `${details}<p>Your <strong>${escapeHtml(String(payload.issue_type ?? 'maintenance'))}</strong> request has been sent to your landlord and is awaiting review.</p><p>${escapeHtml(String(payload.description ?? ''))}</p><p>Priority: ${escapeHtml(String(payload.priority ?? ''))}</p>`),
      }
    case 'maintenance_status':
      return {
        subject: `Maintenance request ${status} · ${property}, Unit ${unit}`,
        html: wrap('Maintenance request update', `${details}<p>Your <strong>${escapeHtml(String(payload.issue_type ?? 'maintenance'))}</strong> request is now <strong>${status}</strong>.</p><p>${escapeHtml(String(payload.description ?? ''))}</p>${status === 'completed' ? `<p>Final cost recorded: <strong>KSh ${Number(payload.final_cost ?? 0).toLocaleString()}</strong>.</p>` : ''}`),
      }
    case 'notice_submitted':
    case 'notice_status':
      return {
        subject: `Move-out notice ${job.event_type === 'notice_submitted' ? 'received' : status} · ${property}, Unit ${unit}`,
        html: wrap(job.event_type === 'notice_submitted' ? 'Move-out notice received' : 'Move-out notice update', `${details}<p>Your move-out date is <strong>${escapeHtml(String(payload.intended_move_out_date ?? ''))}</strong>.</p><p>Your notice is ${job.event_type === 'notice_submitted' ? 'awaiting landlord review' : `<strong>${status}</strong>`}.</p>${payload.reason ? `<p>Reason: ${escapeHtml(String(payload.reason))}</p>` : ''}`),
      }
    default:
      throw new Error(`Unsupported tenant email event: ${job.event_type}`)
  }
}

async function sendEmail(apiKey: string, from: string, to: string, subject: string, html: string, idempotencyKey: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`)
}

async function queueRentReminders(admin: ReturnType<typeof createSupabaseClient>, workspaces: WorkspaceRow[]) {
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  let queued = 0
  for (const workspace of workspaces) {
    if (workspace.data?.settings?.rentReminderEnabled === false) continue
    const tenants = Array.isArray(workspace.data?.tenants) ? workspace.data.tenants : []
    for (const tenant of tenants) {
      const email = tenant.email?.trim().toLowerCase()
      if (!tenant.name || !tenant.property || !tenant.unit || !email) continue
      const dueDate = nextRentDueDate(tenant.movedIn)
      if (!dueDate) continue
      const dueUtc = new Date(`${dueDate}T00:00:00Z`).getTime()
      const daysUntilDue = Math.round((dueUtc - todayUtc) / 86_400_000)
      if (daysUntilDue !== 3 && daysUntilDue !== 0) continue
      if (await tenantHasPaidForDueMonth(admin, workspace, tenant, dueDate)) continue

      const event = daysUntilDue === 3 ? 'three-day' : 'due-day'
      const key = `rent-reminder:${workspace.owner_id}:${tenant.property}:${tenant.unit}:${dueDate}:${event}`
      const { data: inserted, error } = await admin.from('tenant_email_jobs').upsert({
        owner_id: workspace.owner_id,
        event_type: 'rent_reminder',
        idempotency_key: key,
        tenant_email: email,
        tenant_name: tenant.name,
        property_name: tenant.property,
        unit_name: tenant.unit,
        payload: {
          due_date: dueDate,
          rent_amount: amount(tenant.rent),
          water_bill_amount: amount(tenant.waterBill),
        },
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id').maybeSingle()
      if (error) throw new Error(`Could not queue rent reminder for ${tenant.property}, Unit ${tenant.unit}: ${error.message}`)
      if (inserted) queued += 1
    }
  }
  return queued
}

async function deliverTenantEmailJobs(admin: ReturnType<typeof createSupabaseClient>, apiKey: string, sender: string) {
  const now = new Date()
  const { data: dueJobs, error: loadError } = await admin.from('tenant_email_jobs')
    .select('id, owner_id, event_type, idempotency_key, tenant_email, tenant_name, property_name, unit_name, payload, status, attempts')
    .in('status', ['pending', 'sending'])
    .lte('next_attempt_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(100)
  if (loadError) throw new Error(`Could not load tenant email jobs: ${loadError.message}`)
  let sent = 0
  let errors = 0

  for (const rawJob of dueJobs ?? []) {
    const job = rawJob as TenantEmailJob
    const nextAttempts = job.attempts + 1
    const { data: claimed, error: claimError } = await admin.from('tenant_email_jobs')
      .update({ status: 'sending', attempts: nextAttempts, next_attempt_at: new Date(now.getTime() + 15 * 60_000).toISOString(), last_error: null })
      .eq('id', job.id)
      .eq('status', job.status)
      .lte('next_attempt_at', now.toISOString())
      .select('id')
      .maybeSingle()
    if (claimError) {
      errors += 1
      continue
    }
    if (!claimed) continue

    try {
      if (job.event_type === 'rent_reminder') {
        const { data: currentWorkspace, error: workspaceError } = await admin
          .from('rental_workspaces')
          .select('owner_id, data')
          .eq('owner_id', job.owner_id)
          .maybeSingle()
        if (workspaceError) throw new Error(`Could not refresh the tenant before sending a rent reminder: ${workspaceError.message}`)
        const workspace = currentWorkspace as WorkspaceRow | null
        const dueDate = String(job.payload.due_date ?? '')
        const tenant = workspace?.data?.tenants?.find(item =>
          item.name === job.tenant_name && item.property === job.property_name && item.unit === job.unit_name,
        )
        const paymentRecorded = workspace && tenant && dueDate
          ? await tenantHasPaidForDueMonth(admin, workspace, tenant, dueDate)
          : false
        if (!workspace || !tenant || !dueDate || workspace.data?.settings?.rentReminderEnabled === false || paymentRecorded) {
          const { error } = await admin.from('tenant_email_jobs')
            .update({ status: 'cancelled', sent_at: new Date().toISOString(), last_error: 'Rent reminder no longer needed before delivery.' })
            .eq('id', job.id)
          if (error) throw new Error(`Could not cancel an outdated rent reminder: ${error.message}`)
          continue
        }
      }
      const message = emailTemplate(job)
      await sendEmail(apiKey, sender, job.tenant_email, message.subject, message.html, job.idempotency_key)
      const { error: updateError } = await admin.from('tenant_email_jobs')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', job.id)
      if (updateError) throw new Error(`Resend accepted the message but the job status could not be saved: ${updateError.message}`)
      sent += 1
    } catch (deliveryError) {
      errors += 1
      const message = deliveryError instanceof Error ? deliveryError.message : 'Email delivery failed.'
      const backoffMinutes = Math.min(60 * 24, 2 ** Math.min(nextAttempts, 10))
      const { error: updateError } = await admin.from('tenant_email_jobs').update({
        status: nextAttempts >= 8 ? 'failed' : 'pending',
        next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        last_error: updateErrorMessage(message),
      }).eq('id', job.id)
      if (updateError) errors += 1
    }
  }
  return { sent, errors }
}

function updateErrorMessage(message: string) {
  return message.slice(0, 2000)
}

function nairobiDate(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function hasSubscriptionPaymentDestination(settings: SubscriptionPaymentSettings) {
  if (settings.payment_method === 'paybill') return Boolean(settings.paybill_number.trim())
  if (settings.payment_method === 'till') return Boolean(settings.till_number.trim())
  return Boolean(settings.bank_name.trim() && settings.bank_account_name.trim() && settings.bank_account_number.trim())
}

function subscriptionPaymentInstructions(job: ExpiryEmailJob) {
  if (job.payment_method === 'paybill') {
    return `<li>Paybill number: <strong>${escapeHtml(job.paybill_number)}</strong></li><li>Account reference: use the National ID number used when registering.</li>`
  }
  if (job.payment_method === 'till') {
    return `<li>Buy Goods and Services (Till): <strong>${escapeHtml(job.till_number)}</strong></li><li>No account number is required.</li>`
  }
  return `<li>Bank: <strong>${escapeHtml(job.bank_name)}</strong></li><li>Account name: <strong>${escapeHtml(job.bank_account_name)}</strong></li><li>Account number: <strong>${escapeHtml(job.bank_account_number)}</strong></li>`
}

async function processExpiredLandlordSubscriptions(admin: ReturnType<typeof createSupabaseClient>, apiKey: string, sender: string) {
  const today = nairobiDate(new Date())
  const { data: expiredSubscriptions, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('user_id, plan, status, expires_on')
    .lte('expires_on', today)
    .neq('status', 'cancelled')
    .limit(5000)
  if (subscriptionError) throw new Error(`Could not load expired landlord subscriptions: ${subscriptionError.message}`)
  const subscriptions = (expiredSubscriptions ?? []) as ExpiredSubscription[]
  if (!subscriptions.length) return { queued: 0, sent: 0, errors: 0, skipped_missing_email: 0 }

  const userIds = [...new Set(subscriptions.map(subscription => subscription.user_id))]
  const [profileResult, settingsResult] = await Promise.all([
    admin.from('profiles').select('user_id, display_name, email, user_type').in('user_id', userIds),
    admin.from('subscription_payment_settings')
      .select('payment_method, paybill_number, till_number, bank_name, bank_account_name, bank_account_number')
      .eq('id', true)
      .maybeSingle(),
  ])
  if (profileResult.error) throw new Error(`Could not load landlord contact details for expired subscriptions: ${profileResult.error.message}`)
  if (settingsResult.error) throw new Error(`Could not load subscription payment instructions: ${settingsResult.error.message}`)
  if (!settingsResult.data) throw new Error('Subscription expiry emails are waiting for platform payment instructions to be configured.')

  const paymentSettings = settingsResult.data as SubscriptionPaymentSettings
  if (!hasSubscriptionPaymentDestination(paymentSettings)) {
    throw new Error(`Subscription expiry emails are waiting for a configured ${paymentSettings.payment_method.replace('_', ' ')} destination.`)
  }
  const profiles = new Map((profileResult.data ?? [])
    .filter(profile => profile.user_type === 'landlord')
    .map(profile => [profile.user_id, profile]))
  let queued = 0
  let skippedMissingEmail = 0
  for (const subscription of subscriptions) {
    const profile = profiles.get(subscription.user_id)
    if (!profile?.email?.trim()) {
      skippedMissingEmail += 1
      continue
    }
    const { data: inserted, error } = await admin.from('landlord_subscription_expiry_email_jobs')
      .upsert({
        user_id: subscription.user_id,
        expires_on: subscription.expires_on,
        plan: subscription.plan,
        landlord_name: profile.display_name?.trim() || profile.email.split('@')[0],
        landlord_email: profile.email.trim().toLowerCase(),
        ...paymentSettings,
      }, { onConflict: 'user_id,expires_on', ignoreDuplicates: true })
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`Could not queue the expired-plan email for ${profile.email}: ${error.message}`)
    if (inserted) queued += 1
  }

  const now = new Date()
  const { data: dueJobs, error: loadError } = await admin.from('landlord_subscription_expiry_email_jobs')
    .select('id, user_id, expires_on, plan, landlord_name, landlord_email, payment_method, paybill_number, till_number, bank_name, bank_account_name, bank_account_number, status, attempts')
    .in('status', ['pending', 'sending'])
    .lte('next_attempt_at', now.toISOString())
    .order('created_at', { ascending: true })
    .limit(100)
  if (loadError) throw new Error(`Could not load queued landlord expiry emails: ${loadError.message}`)

  let sent = 0
  let errors = 0
  for (const rawJob of dueJobs ?? []) {
    const job = rawJob as ExpiryEmailJob
    const attempt = job.attempts + 1
    const { data: claimed, error: claimError } = await admin.from('landlord_subscription_expiry_email_jobs')
      .update({
        status: 'sending',
        attempts: attempt,
        next_attempt_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
        last_error: null,
      })
      .eq('id', job.id)
      .eq('status', job.status)
      .lte('next_attempt_at', now.toISOString())
      .select('id')
      .maybeSingle()
    if (claimError) {
      errors += 1
      continue
    }
    if (!claimed) continue

    try {
      const { data: currentSubscription, error: currentError } = await admin.from('subscriptions')
        .select('plan, status, expires_on')
        .eq('user_id', job.user_id)
        .maybeSingle()
      if (currentError) throw new Error(`Could not verify the landlord subscription before sending: ${currentError.message}`)
      if (!currentSubscription
        || currentSubscription.status === 'cancelled'
        || currentSubscription.expires_on !== job.expires_on
        || currentSubscription.expires_on > nairobiDate(new Date())) {
        const { error } = await admin.from('landlord_subscription_expiry_email_jobs')
          .update({ status: 'cancelled', last_error: 'Subscription was renewed or is no longer expired before delivery.' })
          .eq('id', job.id)
        if (error) throw new Error(`Could not cancel an outdated subscription expiry email: ${error.message}`)
        continue
      }

      const planName = job.plan === 'test' ? 'Free Test plan' : job.plan.replaceAll('_', ' ')
      const html = `<main style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#17211d"><p style="color:#39765f;font-weight:bold">MOHA RENTAL MANAGEMENT</p><h1 style="font-size:23px">Your subscription has expired</h1><p>Hello ${escapeHtml(job.landlord_name)},</p><p>Your <strong>${escapeHtml(planName)}</strong> subscription expired on <strong>${escapeHtml(job.expires_on)}</strong>. This also applies to the one-month free Test plan.</p><p>To continue with a paid plan, choose Silver Monthly or Silver Yearly in your landlord dashboard. The current price is shown there.</p><h2 style="font-size:17px">Payment instructions</h2><ol>${subscriptionPaymentInstructions(job)}<li>Keep the payment confirmation or bank transaction reference.</li><li>Sign in, choose your subscription plan, and submit the payment reference for administrator verification.</li></ol><p>If you have already renewed, you can ignore this email.</p><p style="margin-top:28px;color:#627168;font-size:12px">Moha Rental Management</p></main>`
      await sendEmail(
        apiKey,
        sender,
        job.landlord_email,
        `Subscription expired · ${planName}`,
        html,
        `landlord-subscription-expired:${job.user_id}:${job.expires_on}`,
      )
      const { error: updateError } = await admin.from('landlord_subscription_expiry_email_jobs')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', job.id)
      if (updateError) throw new Error(`Resend accepted the subscription email but the job status could not be saved: ${updateError.message}`)
      sent += 1
    } catch (deliveryError) {
      errors += 1
      const message = deliveryError instanceof Error ? deliveryError.message : 'Subscription expiry email delivery failed.'
      const backoffMinutes = Math.min(60 * 24, 2 ** Math.min(attempt, 10))
      const { error: updateError } = await admin.from('landlord_subscription_expiry_email_jobs').update({
        status: attempt >= 8 ? 'failed' : 'pending',
        next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        last_error: updateErrorMessage(message),
      }).eq('id', job.id)
      if (updateError) errors += 1
    }
  }

  return { queued, sent, errors, skipped_missing_email: skippedMissingEmail }
}

denoRuntime.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const cronSecret = denoRuntime.env.get('INVOICE_CRON_SECRET')
  if (!cronSecret || request.headers.get('x-invoice-cron-secret') !== cronSecret) {
    return json({ error: 'Scheduled invoice authorization failed.' }, 401)
  }

  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL')
  const serviceRoleKey = denoRuntime.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = denoRuntime.env.get('RESEND_API_KEY')
  const sender = denoRuntime.env.get('INVOICE_FROM')
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !sender) {
    return json({ error: 'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, and INVOICE_FROM.' }, 500)
  }

  const admin = createSupabaseClient(supabaseUrl, serviceRoleKey)
  const { data: workspaces, error: workspaceError } = await admin
    .from('rental_workspaces')
    .select('owner_id, data')
    .limit(5000)
  if (workspaceError) return json({ error: `Could not load rental workspaces: ${workspaceError.message}` }, 500)

  const workspaceRows = (workspaces ?? []) as WorkspaceRow[]
  let remindersQueued: number
  try {
    remindersQueued = await queueRentReminders(admin, workspaceRows)
  } catch (queueError) {
    return json({ error: queueError instanceof Error ? queueError.message : 'Could not queue rent reminder emails.' }, 500)
  }
  const ownerIds = [...new Set(workspaceRows.map(row => row.owner_id))]
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await admin.from('profiles').select('user_id, display_name, email').in('user_id', ownerIds)
    : { data: [], error: null }
  if (profilesError) return json({ error: `Could not load landlord profiles: ${profilesError.message}` }, 500)
  const landlordProfiles = (profiles ?? []) as LandlordProfile[]
  const landlords = new Map(landlordProfiles.map(profile => [profile.user_id, profile]))
  let sent = 0
  let waiting = 0
  let errors = 0

  for (const workspace of workspaceRows) {
    const landlord = landlords.get(workspace.owner_id)
    const tenants = Array.isArray(workspace.data?.tenants) ? workspace.data.tenants as WorkspaceTenant[] : []
    for (const tenant of tenants) {
      if (!tenant.property || !tenant.unit || !tenant.name) continue
      const cycle = rentCycle(tenant.movedIn)
      if (!cycle) continue

      const key = {
        owner_id: workspace.owner_id,
        property_name: tenant.property,
        unit_name: tenant.unit,
        due_date: cycle.dueDate,
      }
      const { data: existing, error: existingError } = await admin
        .from('rent_invoice_email_jobs')
        .select('id, status, landlord_alerted_at, sent_at, last_error, updated_at')
        .match(key)
        .maybeSingle()
      if (existingError) {
        errors += 1
        continue
      }
      if (existing?.status === 'sent' || existing?.status === 'superseded') continue
      if (existing?.status === 'sending' && Date.now() - new Date(existing.updated_at).getTime() < 15 * 60 * 1000) continue

      const waterUpdatedAt = tenant.waterBillUpdatedAt ? new Date(tenant.waterBillUpdatedAt) : null
      const periodStartTime = new Date(`${cycle.periodStart}T00:00:00Z`).getTime()
      let waterBillAlreadyUsed = false
      if (tenant.waterBillUpdatedAt) {
        const { data: usedBill, error: usedBillError } = await admin.from('rent_invoice_email_jobs')
          .select('id')
          .eq('owner_id', workspace.owner_id)
          .eq('property_name', tenant.property)
          .eq('unit_name', tenant.unit)
          .eq('water_bill_updated_at', tenant.waterBillUpdatedAt)
          .eq('status', 'sent')
          .limit(1)
          .maybeSingle()
        if (usedBillError) {
          errors += 1
          continue
        }
        waterBillAlreadyUsed = Boolean(usedBill)
      }
      const waterReady = Boolean(waterUpdatedAt && !Number.isNaN(waterUpdatedAt.getTime()) && waterUpdatedAt.getTime() >= periodStartTime && !waterBillAlreadyUsed)
      const tenantEmail = tenant.email?.trim().toLowerCase() ?? ''
      const rentAmount = amount(tenant.rent)
      const waterBillAmount = amount(tenant.waterBill)
      const jobBase = {
        ...key,
        tenant_name: tenant.name,
        tenant_email: tenantEmail,
        rent_amount: rentAmount,
        water_bill_amount: waterBillAmount,
        water_bill_updated_at: waterReady ? tenant.waterBillUpdatedAt : null,
        status: waterReady ? 'ready' : 'waiting_for_water',
        last_error: null,
      }

      let jobId = existing?.id
      if (jobId) {
        const { error } = await admin.from('rent_invoice_email_jobs').update(jobBase).eq('id', jobId)
        if (error) {
          errors += 1
          continue
        }
      } else {
        const { data: inserted, error } = await admin.from('rent_invoice_email_jobs').insert(jobBase).select('id').single()
        if (error) {
          errors += 1
          continue
        }
        jobId = inserted.id
      }

      if (!waterReady) {
        waiting += 1
        if (landlord?.email && !existing?.landlord_alerted_at) {
          try {
            const tenantLabel = `${tenant.name} · ${tenant.property}, Unit ${tenant.unit}`
            await sendEmail(
              resendApiKey,
              sender,
              landlord.email,
              `Invoice waiting for water bill: ${tenant.property} ${tenant.unit}`,
              `<p>Hello ${escapeHtml(landlord.display_name || 'Landlord')},</p><p>Rent for <strong>${escapeHtml(tenantLabel)}</strong> is due on ${escapeHtml(cycle.dueDate)}, but this cycle's water bill has not been updated.</p><p>Update the tenant's water bill in Moha Rental Management to release the invoice for email delivery.</p>`,
              `landlord-water-alert-${jobId}`,
            )
            await admin.from('rent_invoice_email_jobs').update({ landlord_alerted_at: new Date().toISOString() }).eq('id', jobId)
          } catch (error) {
            errors += 1
            await admin.from('rent_invoice_email_jobs').update({ last_error: error instanceof Error ? error.message : 'Landlord alert delivery failed.' }).eq('id', jobId)
          }
        }
        continue
      }

      if (!tenantEmail) {
        errors += 1
        await admin.from('rent_invoice_email_jobs').update({ last_error: 'Tenant profile has no email address.' }).eq('id', jobId)
        if (landlord?.email && !existing?.landlord_alerted_at) {
          try {
            await sendEmail(resendApiKey, sender, landlord.email, 'Tenant invoice needs an email address', `<p>${escapeHtml(tenant.name)} at ${escapeHtml(tenant.property)}, Unit ${escapeHtml(tenant.unit)} is due, but no tenant email address is registered.</p>`, `landlord-missing-email-${jobId}`)
            await admin.from('rent_invoice_email_jobs').update({ landlord_alerted_at: new Date().toISOString() }).eq('id', jobId)
          } catch {
            // The job retains the error so a later run can retry.
          }
        }
        continue
      }

      const { data: claimed, error: claimError } = await admin.from('rent_invoice_email_jobs')
        .update({ status: 'sending', last_error: null })
        .eq('id', jobId)
        .eq('status', 'ready')
        .is('sent_at', null)
        .select('id')
        .maybeSingle()
      if (claimError || !claimed) continue

      const total = rentAmount + waterBillAmount
      try {
        await sendEmail(
          resendApiKey,
          sender,
          tenantEmail,
          `Rent invoice ${tenant.property} · Unit ${tenant.unit} · due ${cycle.dueDate}`,
          `<main style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17211d"><h1>${escapeHtml(landlord?.display_name || 'Rental office')}</h1><p>Rent invoice for ${escapeHtml(tenant.name)}</p><p><strong>Property:</strong> ${escapeHtml(tenant.property)}<br><strong>Unit:</strong> ${escapeHtml(tenant.unit)}<br><strong>Due date:</strong> ${escapeHtml(cycle.dueDate)}</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:10px;border-bottom:1px solid #ddd">Monthly rent</td><td style="padding:10px;text-align:right;border-bottom:1px solid #ddd">KSh ${rentAmount.toLocaleString()}</td></tr><tr><td style="padding:10px;border-bottom:1px solid #ddd">Water bill</td><td style="padding:10px;text-align:right;border-bottom:1px solid #ddd">KSh ${waterBillAmount.toLocaleString()}</td></tr><tr><th style="padding:12px;text-align:left">Total due</th><th style="padding:12px;text-align:right">KSh ${total.toLocaleString()}</th></tr></table><p>Please contact the property manager if you have questions about this invoice.</p></main>`,
          `tenant-rent-invoice-${jobId}`,
        )
        await admin.from('rent_invoice_email_jobs').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).eq('id', jobId)
        sent += 1
      } catch (error) {
        errors += 1
        await admin.from('rent_invoice_email_jobs').update({ status: 'ready', last_error: error instanceof Error ? error.message : 'Invoice email delivery failed.' }).eq('id', jobId)
      }
    }
  }

  let notificationResult: { sent: number; errors: number }
  try {
    notificationResult = await deliverTenantEmailJobs(admin, resendApiKey, sender)
  } catch (queueError) {
    return json({
      sent,
      waiting_for_water: waiting,
      errors: errors + 1,
      tenant_notifications: { queued: remindersQueued, error: queueError instanceof Error ? queueError.message : 'Could not process tenant notification emails.' },
    }, 500)
  }
  let subscriptionExpiryResult: { queued: number; sent: number; errors: number; skipped_missing_email: number }
  try {
    subscriptionExpiryResult = await processExpiredLandlordSubscriptions(admin, resendApiKey, sender)
  } catch (expiryError) {
    return json({
      sent: sent + notificationResult.sent,
      invoices_sent: sent,
      waiting_for_water: waiting,
      errors: errors + notificationResult.errors + 1,
      tenant_notifications: { queued: remindersQueued, sent: notificationResult.sent, errors: notificationResult.errors },
      landlord_subscription_expiry: { error: expiryError instanceof Error ? expiryError.message : 'Could not process landlord subscription expiry emails.' },
    }, 500)
  }
  return json({
    sent: sent + notificationResult.sent + subscriptionExpiryResult.sent,
    invoices_sent: sent,
    waiting_for_water: waiting,
    errors: errors + notificationResult.errors + subscriptionExpiryResult.errors,
    tenant_notifications: { queued: remindersQueued, sent: notificationResult.sent, errors: notificationResult.errors },
    landlord_subscription_expiry: subscriptionExpiryResult,
  })
})
