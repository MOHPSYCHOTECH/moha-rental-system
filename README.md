# Moha Rental Management System

Rental management frontend built with React, TypeScript, and Vite. Supabase provides authentication and cloud workspace storage.

## Production hosting on Netlify

Connect the `rental-management` project directory to Netlify. The included `netlify.toml` sets the build command to `npm run build`, publishes `dist/`, and rewrites app routes to `index.html` so direct links such as `/tenant` and `/landlord-signup` load correctly. If Netlify asks for build settings, use that command and publish directory, and leave the base directory blank when this directory is the repository root.

Add these environment variables in Site configuration → Environment variables for the production deploy context:
- `VITE_SUPABASE_URL`: your Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: your Supabase publishable key.
- `VITE_MPESA_RENT_PAYBILL`: optional; required only for direct rent Paybill integration.

After changing environment variables, trigger a new deploy. In Supabase Authentication → URL Configuration, set the Netlify domain as the Site URL and add it to Redirect URLs.

## Production hosting on Vercel

1. Push this project to a private GitHub repository and import it into Vercel.
2. Use the Vite framework preset, build command `npm run build`, and output directory `dist`.
3. Add these environment variables in Vercel Project Settings → Environment Variables for Production and Preview deployments:
   - `VITE_SUPABASE_URL`: your Supabase project URL.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: your Supabase publishable key.
   - `VITE_MPESA_RENT_PAYBILL`: optional; required only for direct rent Paybill integration.
4. Deploy. The existing `vercel.json` rewrite supports direct navigation to app routes.
5. In Supabase Authentication → URL Configuration, set the deployed domain as the Site URL and add it to Redirect URLs. Add preview domains if you use them.
6. Complete the database and Edge Function setup in [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the features you intend to enable.

Values prefixed with `VITE_` are included in the browser build. The Supabase publishable key is intended for frontend use; never add a Supabase service-role key or other server secret to frontend environment variables or this repository. Keep server secrets in Supabase Edge Function secrets.

## Local development

```sh
npm ci
```

Copy `.env.example` to `.env`, replace the example values with your Supabase project values, then run:

```sh
npm run dev
```

In PowerShell, use `Copy-Item .env.example .env` to copy the environment template.

## Production build check

```sh
npm ci
npm run build
npm run preview
```

The build output is written to `dist/`. `.env` files and build output are excluded from version control.
