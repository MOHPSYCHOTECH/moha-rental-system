import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const allowedRoles = new Set(['landlord', 'caretaker', 'tenant'])
type AppRole = 'landlord' | 'caretaker' | 'tenant'
type DeviceRow = { token: string; app_role: AppRole; user_id: string | null; owner_id: string | null; tenant_email: string | null }
type FirebaseServiceAccount = { project_id?: string; client_email?: string; private_key?: string }
type WorkspaceRow = { owner_id: string; data: { tenants?: unknown } | null }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function createFirebaseAccessToken(serviceAccount: Required<FirebaseServiceAccount>) {
  const now = Math.floor(Date.now() / 1000)
  const encodedHeader = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const encodedClaims = encodeBase64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsignedToken = `${encodedHeader}.${encodedClaims}`
  const encodedKey = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')
  const keyBytes = Uint8Array.from(atob(encodedKey), character => character.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsignedToken))
  let signatureBinary = ''
  for (const byte of new Uint8Array(signature)) signatureBinary += String.fromCharCode(byte)
  const assertion = `${unsignedToken}.${btoa(signatureBinary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const result = await response.json() as { access_token?: string; error_description?: string; error?: string }
  if (!response.ok || !result.access_token) {
    throw new Error(`Firebase authentication failed: ${result.error_description ?? result.error ?? response.statusText}`)
  }
  return result.access_token
}

async function loadAllDevices(adminClient: ReturnType<typeof createClient>, roles: AppRole[]) {
  const devices: DeviceRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await adminClient
      .from('app_push_devices')
      .select('token, app_role, user_id, owner_id, tenant_email')
      .in('app_role', roles)
      .range(offset, offset + 499)
    if (error) throw new Error(`Push device registrations could not be loaded: ${error.message}`)
    devices.push(...(data as DeviceRow[]))
    if (data.length < 500) break
  }
  return devices
}

async function findEligibleDevices(adminClient: ReturnType<typeof createClient>, devices: DeviceRow[]) {
  const staffDevices = devices.filter(device => device.app_role !== 'tenant' && device.user_id)
  const eligibleUserIds = new Set<string>()
  for (let offset = 0; offset < staffDevices.length; offset += 500) {
    const ids = [...new Set(staffDevices.slice(offset, offset + 500).map(device => device.user_id).filter((id): id is string => Boolean(id)))]
    if (!ids.length) continue
    const { data, error } = await adminClient
      .from('profiles')
      .select('user_id, user_type')
      .in('user_id', ids)
    if (error) throw new Error(`Active app accounts could not be checked: ${error.message}`)
    const { data: activeRoles, error: rolesError } = await adminClient
      .from('user_roles')
      .select('user_id')
      .in('user_id', ids)
      .eq('active', true)
    if (rolesError) throw new Error(`Active app roles could not be checked: ${rolesError.message}`)
    const activeIds = new Set(activeRoles.map(row => row.user_id))
    for (const profile of data) {
      if (activeIds.has(profile.user_id)
        && ((profile.user_type === 'landlord' || profile.user_type === 'property_manager')
          || profile.user_type === 'caretaker')) {
        eligibleUserIds.add(profile.user_id)
      }
    }
  }

  const tenantDevices = devices.filter(device => device.app_role === 'tenant' && device.owner_id && device.tenant_email)
  const ownerIds = [...new Set(tenantDevices.map(device => device.owner_id).filter((id): id is string => Boolean(id)))]
  const activeTenantEmails = new Set<string>()
  for (let offset = 0; offset < ownerIds.length; offset += 500) {
    const batch = ownerIds.slice(offset, offset + 500)
    const { data, error } = await adminClient
      .from('rental_workspaces')
      .select('owner_id, data')
      .in('owner_id', batch)
    if (error) throw new Error(`Active tenant accounts could not be checked: ${error.message}`)
    for (const workspace of data as WorkspaceRow[]) {
      const tenants = Array.isArray(workspace.data?.tenants) ? workspace.data.tenants : []
      for (const value of tenants) {
        if (typeof value !== 'object' || value === null || !('email' in value)) continue
        const tenant = value as { email?: unknown; status?: unknown }
        if (typeof tenant.email !== 'string' || !tenant.email.trim()) continue
        if (typeof tenant.status === 'string' && ['inactive', 'ended', 'archived'].includes(tenant.status.trim().toLowerCase())) continue
        activeTenantEmails.add(`${workspace.owner_id}:${tenant.email.trim().toLowerCase()}`)
      }
    }
  }

  return devices.filter(device => device.app_role === 'tenant'
    ? Boolean(device.owner_id && device.tenant_email && activeTenantEmails.has(`${device.owner_id}:${device.tenant_email.toLowerCase()}`))
    : Boolean(device.user_id && eligibleUserIds.has(device.user_id)))
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: 'The function is missing Supabase configuration or an authenticated session.' }, 500)
  }
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!accessToken) return json({ error: 'A valid sign-in session is required.' }, 401)

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { data: callerResult, error: callerError } = await callerClient.auth.getUser(accessToken)
  if (callerError || !callerResult.user) return json({ error: 'Your sign-in session could not be verified.' }, 401)
  const { data: platformAdmin, error: permissionError } = await callerClient.rpc('is_platform_admin')
  if (permissionError) return json({ error: `Administrator access could not be checked: ${permissionError.message}` }, 500)
  if (platformAdmin !== true) return json({ error: 'Only an active Platform Administrator can send app notifications.' }, 403)

  let body: { title?: unknown; message?: unknown; roles?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const roles = Array.isArray(body.roles) ? [...new Set(body.roles)] : []
  if (!title || title.length > 100) return json({ error: 'Notification title must be between 1 and 100 characters.' }, 400)
  if (!message || message.length > 500) return json({ error: 'Notification message must be between 1 and 500 characters.' }, 400)
  if (!roles.length || roles.some(role => typeof role !== 'string' || !allowedRoles.has(role))) {
    return json({ error: 'Choose one or more valid recipient roles.' }, 400)
  }

  const serviceAccountValue = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
  if (!serviceAccountValue) return json({ error: 'Push delivery is not configured. Add the Firebase service account secret to Supabase.' }, 503)
  let serviceAccount: FirebaseServiceAccount
  try {
    serviceAccount = JSON.parse(serviceAccountValue) as FirebaseServiceAccount
  } catch {
    return json({ error: 'The Firebase service account secret is not valid JSON.' }, 503)
  }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    return json({ error: 'The Firebase service account secret is missing project_id, client_email, or private_key.' }, 503)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  try {
    const registeredDevices = await loadAllDevices(adminClient, roles as AppRole[])
    const devices = await findEligibleDevices(adminClient, registeredDevices)
    if (!devices.length) return json({ error: 'No active app devices are registered for the selected roles yet. Ask recipients to install the latest APK, sign in, and allow notifications.' }, 409)

    const account = serviceAccount as Required<FirebaseServiceAccount>
    const firebaseAccessToken = await createFirebaseAccessToken(account)
    let sentCount = 0
    let failedCount = 0
    const invalidTokens: string[] = []
    for (let offset = 0; offset < devices.length; offset += 500) {
      const batch = devices.slice(offset, offset + 500)
      const results = await Promise.all(batch.map(async device => {
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${firebaseAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: device.token,
              notification: { title, body: message },
              android: { priority: 'HIGH', notification: { channel_id: 'vyro_updates' } },
            },
          }),
        })
        const result = await response.json() as { name?: string; error?: { status?: string; message?: string } }
        if (response.ok && result.name) return { sent: true, invalid: false }
        return {
          sent: false,
          invalid: result.error?.status === 'UNREGISTERED',
        }
      }))
      for (let index = 0; index < results.length; index += 1) {
        if (results[index].sent) sentCount += 1
        else {
          failedCount += 1
          if (results[index].invalid) invalidTokens.push(batch[index].token)
        }
      }
    }
    if (invalidTokens.length) {
      const { error } = await adminClient.from('app_push_devices').delete().in('token', invalidTokens)
      if (error) console.error('Invalid push device tokens could not be removed:', error.message)
    }

    const campaignStatus = sentCount === 0 ? 'failed' : failedCount === 0 ? 'sent' : 'partial'
    const { error: logError } = await adminClient.from('app_push_campaigns').insert({
      title,
      body: message,
      recipient_roles: roles,
      status: campaignStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      created_by: callerResult.user.id,
    })
    if (logError) {
      return json({ error: `Push delivery finished (${sentCount} sent, ${failedCount} failed), but the campaign could not be saved: ${logError.message}` }, 500)
    }
    return json({ sent: sentCount, failed: failedCount, status: campaignStatus })
  } catch (error) {
    console.error('App push notification failed:', error)
    return json({ error: error instanceof Error ? error.message : 'App push notification could not be sent.' }, 500)
  }
})
