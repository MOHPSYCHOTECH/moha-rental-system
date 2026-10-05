/// <reference path="../deno-editor.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'POST required.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY')?.trim()
  const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET')?.trim()
  const shortcode = Deno.env.get('MPESA_RENT_SHORTCODE')?.trim()
  const callbackToken = Deno.env.get('MPESA_C2B_CALLBACK_TOKEN')?.trim()
  const configuredEnvironment = Deno.env.get('MPESA_ENVIRONMENT')?.trim().toLowerCase() || 'sandbox'
  const authorization = request.headers.get('Authorization')

  if (configuredEnvironment !== 'sandbox' && configuredEnvironment !== 'production') {
    return json({ error: 'MPESA_ENVIRONMENT must be exactly sandbox or production.' }, 500)
  }

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    const missingSupabaseSecrets = [
      !supabaseUrl && 'SUPABASE_URL',
      !anonKey && 'SUPABASE_ANON_KEY',
      !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    ].filter((name): name is string => Boolean(name))
    return json({ error: `Missing Supabase Edge Function secrets: ${missingSupabaseSecrets.join(', ')}.` }, 500)
  }
  if (!consumerKey || !consumerSecret || !shortcode || !callbackToken) {
    const missingMpesaSecrets = [
    !consumerKey && 'MPESA_CONSUMER_KEY',
    !consumerSecret && 'MPESA_CONSUMER_SECRET',
    !shortcode && 'MPESA_RENT_SHORTCODE',
    !callbackToken && 'MPESA_C2B_CALLBACK_TOKEN',
    ].filter((name): name is string => Boolean(name))
    return json({ error: `Missing M-Pesa Edge Function secrets: ${missingMpesaSecrets.join(', ')}. Add them in Supabase Dashboard → Edge Functions → Secrets, then retry.` }, 500)
  }
  if (!authorization) {
    return json({ error: 'No authenticated session was sent. Call this function from the app while signed in as an active Platform Administrator; the Edge Functions Test panel does not provide the required admin session.' }, 401)
  }
  if (!/^\d+$/.test(shortcode)) {
    return json({ error: 'MPESA_RENT_SHORTCODE must contain only the approved Paybill shortcode digits.' }, 500)
  }

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await callerClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Sign in is required.' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: role, error: roleError } = await adminClient.from('user_roles').select('role, active').eq('user_id', authData.user.id).maybeSingle()
  if (roleError) return json({ error: roleError.message }, 500)
  if (role?.role !== 'admin' || !role.active) return json({ error: 'Active administrator access is required.' }, 403)

  const host = configuredEnvironment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
  const credentials = btoa(`${consumerKey}:${consumerSecret}`)
  const authResponse = await fetch(`${host}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  const authBody = await authResponse.json().catch(() => ({}))
  if (!authResponse.ok || !authBody.access_token) {
    console.error('Daraja OAuth failed:', { environment: configuredEnvironment, status: authResponse.status, error: authBody.error, error_description: authBody.error_description })
    return json({ error: `Safaricom OAuth failed for ${configuredEnvironment}. Verify the Daraja consumer key and secret belong to an app for this same environment.` }, 502)
  }

  const callbackBase = new URL(`/functions/v1/rent-callback/${encodeURIComponent(callbackToken)}`, `${supabaseUrl.replace(/\/+$/, '')}/`).toString()
  const registerResponse = await fetch(`${host}/mpesa/c2b/v1/registerurl`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authBody.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ShortCode: shortcode,
      ResponseType: 'Completed',
      ConfirmationURL: `${callbackBase}/confirmation`,
      ValidationURL: `${callbackBase}/validation`,
    }),
  })
  const registerResponseText = await registerResponse.text()
  let registerBody: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(registerResponseText)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) registerBody = parsed as Record<string, unknown>
  } catch {
    // Preserve non-JSON gateway responses for the diagnostic below.
  }
  if (!registerResponse.ok || String(registerBody.ResponseCode ?? '') !== '0') {
    const providerMessage = String(registerBody.errorMessage || registerBody.ResponseDescription || registerBody.error || registerResponseText.slice(0, 500) || 'Safaricom rejected C2B callback registration.')
    console.error('Daraja C2B URL registration failed:', { environment: configuredEnvironment, status: registerResponse.status, responseCode: registerBody.ResponseCode, responseDescription: providerMessage })
    const tokenRejected = /invalid access token|access token/i.test(providerMessage)
    const error = tokenRejected
      ? `Safaricom rejected the fresh ${configuredEnvironment} access token. Confirm the Daraja consumer key and secret are from the same ${configuredEnvironment} app, and that the app has the C2B product enabled. Then update the Supabase Edge Function secrets and retry.`
      : `Safaricom C2B registration failed (${configuredEnvironment}, HTTP ${registerResponse.status}${registerBody.ResponseCode ? `, code ${registerBody.ResponseCode}` : ''}): ${providerMessage}`
    return json({ error, providerCode: registerBody.ResponseCode ?? null }, 502)
  }

  return json({ message: registerBody.ResponseDescription || 'C2B callback URLs registered.', responseCode: registerBody.ResponseCode }, 200)
})

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
