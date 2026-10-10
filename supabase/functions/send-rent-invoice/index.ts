import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type InvoiceRequest = {
  recipient?: string
  tenantName?: string
  propertyName?: string
  unitName?: string
  invoiceNumber?: string
  attachment?: { filename?: string; content?: string }
}

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const sender = Deno.env.get('INVOICE_FROM')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey || !sender) {
    return json({ error: 'Set the Supabase secrets and verified Resend sender before deploying this function.' }, 500)
  }
  if (!authorization) return json({ error: 'A signed-in workspace account is required.' }, 401)

  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return json({ error: 'A valid sign-in session is required.' }, 401)

  const authResponse = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  })
  if (!authResponse.ok) return json({ error: 'Your sign-in session could not be verified.' }, 401)
  const caller = await authResponse.json() as { id?: string }
  if (!caller.id) return json({ error: 'Supabase did not return a signed-in user.' }, 401)

  let body: InvoiceRequest
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }
  const recipient = body.recipient?.trim().toLowerCase() ?? ''
  const tenantName = body.tenantName?.trim() ?? ''
  const propertyName = body.propertyName?.trim() ?? ''
  const unitName = body.unitName?.trim() ?? ''
  const invoiceNumber = body.invoiceNumber?.trim() ?? ''
  const filename = body.attachment?.filename?.replace(/[^a-zA-Z0-9._-]/g, '-') ?? ''
  const content = body.attachment?.content ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !tenantName || !propertyName || !unitName || !invoiceNumber) {
    return json({ error: 'A valid recipient and complete tenant/invoice details are required.' }, 400)
  }
  if (!filename.toLowerCase().endsWith('.pdf') || !/^[A-Za-z0-9+/]+={0,2}$/.test(content) || content.length > 6_990_507) {
    return json({ error: 'The invoice attachment must be a valid PDF smaller than 5 MB.' }, 400)
  }
  try {
    if (!atob(content).startsWith('%PDF-')) return json({ error: 'The invoice attachment is not a valid PDF.' }, 400)
  } catch {
    return json({ error: 'The invoice attachment is not valid base64 PDF data.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const [profileResult, roleResult] = await Promise.all([
    admin.from('profiles').select('user_type, owner_id').eq('user_id', caller.id).maybeSingle(),
    admin.from('user_roles').select('active, owner_id').eq('user_id', caller.id).maybeSingle(),
  ])
  if (profileResult.error || roleResult.error) {
    return json({ error: profileResult.error?.message ?? roleResult.error?.message }, 500)
  }
  const profile = profileResult.data
  const role = roleResult.data
  const ownerId = profile?.user_type === 'landlord' ? caller.id : profile?.owner_id
  if (!profile || !role?.active || !ownerId || (profile.user_type !== 'landlord' && role.owner_id !== ownerId)) {
    return json({ error: 'Active access to a landlord workspace is required to send invoices.' }, 403)
  }

  const { data: workspace, error: workspaceError } = await admin.from('rental_workspaces')
    .select('data')
    .eq('owner_id', ownerId)
    .maybeSingle()
  if (workspaceError) return json({ error: `Could not verify the tenant workspace: ${workspaceError.message}` }, 500)
  const tenants = Array.isArray(workspace?.data?.tenants) ? workspace.data.tenants as Array<{
    name?: string
    property?: string
    unit?: string
    unitDisplayName?: string
  }> : []
  const tenantExists = tenants.some(tenant =>
    tenant.name === tenantName
    && tenant.property === propertyName
    && (tenant.unitDisplayName === unitName || tenant.unit === unitName),
  )
  if (!tenantExists) return json({ error: 'The invoice tenant was not found in your workspace.' }, 403)

  const subject = `Rent invoice ${invoiceNumber} · ${propertyName}, Unit ${unitName}`
  const html = `<main style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#17211d"><p style="color:#39765f;font-weight:bold">MOHA RENTAL MANAGEMENT</p><h1 style="font-size:23px">Your rent invoice</h1><p>Hello ${escapeHtml(tenantName)},</p><p>Please find invoice <strong>${escapeHtml(invoiceNumber)}</strong> attached as a PDF for ${escapeHtml(propertyName)}, Unit ${escapeHtml(unitName)}.</p><p>Contact your property manager if you have questions about this invoice.</p><p style="margin-top:28px;color:#627168;font-size:12px">Sent by your property management team.</p></main>`
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `rent-invoice:${ownerId}:${invoiceNumber}`.slice(0, 256),
    },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject,
      html,
      attachments: [{ filename, content }],
    }),
  })
  if (!resendResponse.ok) {
    const errorText = await resendResponse.text()
    return json({ error: `Resend rejected the invoice email (${resendResponse.status}): ${errorText}` }, 502)
  }

  return json({ sent: true, recipient })
})
