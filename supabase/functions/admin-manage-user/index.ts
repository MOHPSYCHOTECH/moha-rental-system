import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
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

  const authResponse = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!authResponse.ok) {
    const authError = await authResponse.text()
    return json({ error: `Your sign-in session could not be verified: ${authError || authResponse.statusText}` }, 401)
  }
  const callerData = await authResponse.json() as { id?: string }
  if (!callerData.id) return json({ error: 'Supabase did not return a signed-in user.' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const [callerRoleResult, callerProfileResult] = await Promise.all([
    adminClient.from('user_roles').select('role, active').eq('user_id', callerData.id).maybeSingle(),
    adminClient.from('profiles').select('user_type, owner_id').eq('user_id', callerData.id).maybeSingle(),
  ])
  if (callerRoleResult.error || callerProfileResult.error) return json({ error: callerRoleResult.error?.message ?? callerProfileResult.error?.message }, 500)
  const callerRole = callerRoleResult.data
  const callerProfile = callerProfileResult.data
  if (callerRole?.role !== 'admin' || !callerRole.active || !callerProfile) return json({ error: 'Active account administrator access is required.' }, 403)
  const isPlatformAdmin = callerProfile.user_type === 'platform_admin'
  const isLandlord = callerProfile.user_type === 'landlord'
  if (!isPlatformAdmin && !isLandlord) return json({ error: 'This account cannot manage users.' }, 403)

  let body: { action?: string; email?: string; name?: string; phone?: string; role?: string; userType?: string; userId?: string; redirectTo?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400)
  }

  if (body.action === 'invite') {
    const email = body.email?.trim().toLowerCase()
    const name = body.name?.trim()
    const userType = body.userType
    const expectedUserType = isPlatformAdmin ? 'landlord' : 'caretaker'
    const expectedRole = isPlatformAdmin ? 'admin' : 'caretaker'
    let redirectTo: string | undefined
    if (body.redirectTo) {
      try {
        const redirectUrl = new URL(body.redirectTo)
        if (redirectUrl.protocol !== 'https:' && redirectUrl.hostname !== 'localhost') {
          return json({ error: 'Invitation redirect must use HTTPS.' }, 400)
        }
        redirectTo = redirectUrl.origin
      } catch {
        return json({ error: 'Invitation redirect URL is invalid.' }, 400)
      }
    }
    if (!email || !name) return json({ error: 'A valid email and name are required.' }, 400)
    if (userType !== expectedUserType || (body.role && body.role !== expectedRole)) {
      return json({ error: isPlatformAdmin ? 'Platform administrators can invite Landlords only.' : 'Landlords can invite Caretakers only.' }, 403)
    }

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      ...(redirectTo ? { redirectTo } : {}),
    })
    if (error) return json({ error: error.message }, 400)
    if (!data.user) return json({ error: 'Supabase did not return the invited user.' }, 500)

    const workspaceOwnerId = isPlatformAdmin ? data.user.id : callerData.id
    const [profileUpdate, roleUpdate] = await Promise.all([
      adminClient.from('profiles').update({ owner_id: workspaceOwnerId, created_by: callerData.id, display_name: name, email, phone: body.phone?.trim() || null, user_type: expectedUserType, signup_status: 'approved', requested_plan: null }).eq('user_id', data.user.id),
      adminClient.from('user_roles').update({ owner_id: workspaceOwnerId, created_by: callerData.id, role: expectedRole, active: true }).eq('user_id', data.user.id),
    ])
    const updateError = profileUpdate.error ?? roleUpdate.error
    if (updateError) {
      await adminClient.auth.admin.deleteUser(data.user.id)
      return json({ error: `User invitation setup failed: ${updateError.message}` }, 500)
    }
    return json({ userId: data.user.id, email: data.user.email }, 200)
  }

  if (body.action === 'delete') {
    if (!body.userId) return json({ error: 'A user ID is required.' }, 400)
    if (body.userId === callerData.id) return json({ error: 'You cannot delete your own account.' }, 400)
    const { data: targetRole, error: targetRoleError } = await adminClient
      .from('user_roles')
      .select('owner_id, created_by')
      .eq('user_id', body.userId)
      .maybeSingle()
    if (targetRoleError) return json({ error: targetRoleError.message }, 500)
    const targetProfile = await adminClient.from('profiles').select('user_type').eq('user_id', body.userId).maybeSingle()
    if (targetProfile.error) return json({ error: targetProfile.error.message }, 500)
    if (!canManageTarget(isPlatformAdmin, callerData.id, targetRole, targetProfile.data?.user_type)) return json({ error: 'This account is outside your permitted management scope.' }, 403)
    const { error } = await adminClient.auth.admin.deleteUser(body.userId)
    if (error) return json({ error: error.message }, 400)
    return json({ deleted: true }, 200)
  }

  if (body.action === 'update-email') {
    const email = body.email?.trim().toLowerCase()
    if (!body.userId || !email) return json({ error: 'A user ID and valid email are required.' }, 400)
    const { data: targetRole, error: targetRoleError } = await adminClient
      .from('user_roles')
      .select('owner_id, created_by')
      .eq('user_id', body.userId)
      .maybeSingle()
    if (targetRoleError) return json({ error: targetRoleError.message }, 500)
    const targetProfile = await adminClient.from('profiles').select('user_type').eq('user_id', body.userId).maybeSingle()
    if (targetProfile.error) return json({ error: targetProfile.error.message }, 500)
    if (!canManageTarget(isPlatformAdmin, callerData.id, targetRole, targetProfile.data?.user_type)) return json({ error: 'This account is outside your permitted management scope.' }, 403)
    const { error } = await adminClient.auth.admin.updateUserById(body.userId, { email, email_confirm: false })
    if (error) return json({ error: error.message }, 400)
    const { error: profileError } = await adminClient.from('profiles').update({ email }).eq('user_id', body.userId)
    if (profileError) return json({ error: `Email update started, but profile update failed: ${profileError.message}` }, 500)
    return json({ email }, 200)
  }

  return json({ error: 'Unsupported action.' }, 400)
})

function canManageTarget(
  isPlatformAdmin: boolean,
  callerId: string,
  targetRole: { owner_id?: string | null; created_by?: string | null } | null,
  targetUserType: string | null | undefined,
) {
  if (isPlatformAdmin) return targetRole?.created_by === callerId && targetUserType === 'landlord'
  return targetRole?.owner_id === callerId && targetUserType === 'caretaker'
}

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
