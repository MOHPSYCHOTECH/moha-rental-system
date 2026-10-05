# Hosting the web app

The app is a static Vite single-page application. Deploy it to any static host that supports SPA rewrites; `public/_redirects` covers Netlify-compatible hosts and `vercel.json` covers Vercel.

## Build settings

- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`
- Node.js: 20.19+ or 22.12+

For another static host, configure unknown application routes to return `/index.html` with HTTP 200. This is needed for direct visits to `/tenant` and `/portal`.

## Hosting environment variables

Configure these variables in the host's build environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_MPESA_RENT_PAYBILL`

These are Vite build-time values; rebuild and redeploy after changing them. The publishable key is intended for browser use. Never expose `SUPABASE_SERVICE_ROLE_KEY`, Daraja consumer secrets, or the M-Pesa callback token in frontend environment variables.

## Supabase Auth URLs

After the first deployment, copy the site's HTTPS origin, such as `https://your-app.example.com`, then open Supabase Dashboard → Authentication → URL Configuration:

1. Set **Site URL** to the production origin.
2. Add the production origin to **Redirect URLs** (for example, `https://your-app.example.com/**`).
3. Keep `http://localhost:5173/**` and `http://localhost:5175/**` as additional URLs for local development, if required.

Staff invitations now redirect to the origin currently serving the app, and password recovery does the same. Supabase must allow that origin in **Redirect URLs**. The invitation page consumes the Supabase invite token and lets the invited staff member set a password.

## Supabase backend

The static host only serves the frontend. Keep the Supabase database and Edge Functions in the linked Supabase project. Use [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for schema and function setup. After applying `supabase/user_hierarchy.sql`, redeploy the hierarchy-enforcing account function:

```powershell
npx supabase functions deploy admin-manage-user
```

Test the deployed invite link before inviting the wider team. Configure/register Safaricom callbacks only after the app is public on HTTPS and the approved Paybill and production Daraja credentials are ready.