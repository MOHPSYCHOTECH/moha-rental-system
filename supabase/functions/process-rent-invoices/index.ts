import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore Deno resolves this URL import when deploying the Edge Function.
import { createClient as createSupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type DenoRuntime = {
  env: { get(name: string): string | undefined }
  serve(handler: (request: Request) => Response | Promise<Response>): void
}
type WorkspaceRow = { owner_id: string; data: { tenants?: WorkspaceTenant[] } | null }
type LandlordProfile = { user_id: string; display_name: string | null; email: string | null }
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

async function sendEmail(apiKey: string, from: string, to: string, subject: string, html: string, idempotencyKey: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${await response.text()}`)
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

  return json({ sent, waiting_for_water: waiting, errors })
})
