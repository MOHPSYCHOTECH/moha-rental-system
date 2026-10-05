/// <reference path="../deno-editor.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type C2BCallback = {
  TransactionType?: string
  TransID?: string
  TransTime?: string
  TransAmount?: string | number
  BusinessShortCode?: string | number
  BillRefNumber?: string
  MSISDN?: string | number
  FirstName?: string
  MiddleName?: string
  LastName?: string
  [key: string]: unknown
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ResultCode: 1, ResultDesc: 'POST required.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const expectedToken = Deno.env.get('MPESA_C2B_CALLBACK_TOKEN')?.trim()
  const expectedShortcode = Deno.env.get('MPESA_RENT_SHORTCODE')?.trim()
  const url = new URL(request.url)
  const callbackMatch = url.pathname.match(/\/(?:callback\/)?([^/]+)\/(validation|confirmation)$/)
  let pathToken: string | null = null
  try {
    pathToken = callbackMatch ? decodeURIComponent(callbackMatch[1]) : null
  } catch {
    return json({ ResultCode: 1, ResultDesc: 'Not found.' }, 404)
  }
  const callbackType = callbackMatch?.[2] ?? (url.pathname.endsWith('/validation') ? 'validation' : url.pathname.endsWith('/confirmation') ? 'confirmation' : null)
  const suppliedToken = pathToken ?? url.searchParams.get('token')

  if (!supabaseUrl || !serviceRoleKey || !expectedToken || !expectedShortcode) {
    console.error('Missing C2B function secrets.')
    return json({ ResultCode: 1, ResultDesc: 'Callback is not configured.' }, 500)
  }
  if (!callbackType || suppliedToken !== expectedToken) return json({ ResultCode: 1, ResultDesc: 'Not found.' }, 404)

  let callback: C2BCallback
  try {
    callback = await request.json() as C2BCallback
  } catch {
    return json({ ResultCode: 1, ResultDesc: 'Invalid JSON.' }, 400)
  }

  const shortcode = String(callback.BusinessShortCode ?? '').trim()
  const accountReference = String(callback.BillRefNumber ?? '').trim().toUpperCase()
  if (shortcode !== expectedShortcode || !accountReference) {
    return callbackType === 'validation'
      ? json({ ResultCode: 1, ResultDesc: 'Invalid Paybill or account reference.' }, 200)
      : json({ ResultCode: 1, ResultDesc: 'Invalid callback.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: paybillAccount, error: paybillAccountError } = await admin
    .from('rent_payment_accounts')
    .select('account_reference, owner_id, tenant_name, property_name, unit_name, active')
    .eq('paybill_reference', accountReference)
    .maybeSingle()

  if (paybillAccountError) {
    console.error('Could not resolve Paybill account number:', paybillAccountError.message)
    return json({ ResultCode: 1, ResultDesc: 'Could not validate account reference.' }, 500)
  }
  let account = paybillAccount
  if (!account) {
    const { data: legacyAccount, error: legacyAccountError } = await admin
      .from('rent_payment_accounts')
      .select('account_reference, owner_id, tenant_name, property_name, unit_name, active')
      .eq('account_reference', accountReference)
      .maybeSingle()
    if (legacyAccountError) {
      console.error('Could not resolve legacy rent account reference:', legacyAccountError.message)
      return json({ ResultCode: 1, ResultDesc: 'Could not validate account reference.' }, 500)
    }
    account = legacyAccount
  }
  if (!account?.active) {
    return callbackType === 'validation'
      ? json({ ResultCode: 1, ResultDesc: 'Unknown or inactive rental account.' }, 200)
      : json({ ResultCode: 1, ResultDesc: 'Unknown rental account.' }, 400)
  }

  if (callbackType === 'validation') {
    return json({ ResultCode: 0, ResultDesc: 'Accepted.' }, 200)
  }

  const receipt = String(callback.TransID ?? '').trim().toUpperCase()
  const amount = Number(callback.TransAmount)
  const transactionTime = String(callback.TransTime ?? '')
  const transactedAt = parseMpesaTimestamp(transactionTime)
  if (!receipt || !Number.isFinite(amount) || amount <= 0 || !transactedAt) {
    return json({ ResultCode: 1, ResultDesc: 'Missing or invalid transaction details.' }, 400)
  }

  const { error: insertError } = await admin.from('rent_payments').upsert({
    owner_id: account.owner_id,
    account_reference: account.account_reference,
    mpesa_receipt: receipt,
    amount,
    transacted_at: transactedAt,
    phone: callback.MSISDN ? String(callback.MSISDN) : null,
    tenant_name: account.tenant_name,
    property_name: account.property_name,
    unit_name: account.unit_name,
    raw_callback: callback,
  }, { onConflict: 'mpesa_receipt', ignoreDuplicates: true })

  if (insertError) {
    console.error('Could not save rent payment:', insertError.message)
    return json({ ResultCode: 1, ResultDesc: 'Could not save payment.' }, 500)
  }

  return json({ ResultCode: 0, ResultDesc: 'Confirmation received.' }, 200)
})

function parseMpesaTimestamp(value: string) {
  if (!/^\d{14}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6)) - 1
  const day = Number(value.slice(6, 8))
  const hour = Number(value.slice(8, 10))
  const minute = Number(value.slice(10, 12))
  const second = Number(value.slice(12, 14))
  const localWallTime = new Date(Date.UTC(year, month, day, hour, minute, second))
  if (localWallTime.getUTCFullYear() !== year || localWallTime.getUTCMonth() !== month || localWallTime.getUTCDate() !== day || localWallTime.getUTCHours() !== hour || localWallTime.getUTCMinutes() !== minute || localWallTime.getUTCSeconds() !== second) return null
  return new Date(localWallTime.getTime() - 3 * 60 * 60 * 1000).toISOString()
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
