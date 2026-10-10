create table if not exists public.portfolio_listings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  description text not null,
  technologies text[] not null default '{}',
  highlights text[] not null default '{}',
  image_url text not null default '',
  project_url text not null default '',
  sort_order integer not null default 0 check (sort_order >= 0),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_listings_public_order_idx
  on public.portfolio_listings (sort_order, created_at)
  where published;

create or replace function public.set_portfolio_listings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portfolio_listings_updated_at on public.portfolio_listings;
create trigger portfolio_listings_updated_at
before update on public.portfolio_listings
for each row execute function public.set_portfolio_listings_updated_at();

alter table public.portfolio_listings enable row level security;

drop policy if exists "Public can read published portfolio listings" on public.portfolio_listings;
drop policy if exists "Anyone can read published portfolio listings" on public.portfolio_listings;
drop policy if exists "Authenticated users can read portfolio listings" on public.portfolio_listings;
create policy "Anyone can read published portfolio listings"
  on public.portfolio_listings
  for select
  to anon
  using (published);

create policy "Authenticated users can read portfolio listings"
  on public.portfolio_listings
  for select
  to authenticated
  using (published or (select public.is_platform_admin()));

drop policy if exists "Platform admins manage portfolio listings" on public.portfolio_listings;
create policy "Platform admins manage portfolio listings"
  on public.portfolio_listings
  for all
  to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

grant select on public.portfolio_listings to anon, authenticated;
grant insert, update, delete on public.portfolio_listings to authenticated;

insert into public.portfolio_listings
  (id, title, category, description, technologies, highlights, image_url, project_url, sort_order, published)
values
  (
    '2f39f585-69c4-4ab6-ad52-a2ea3a0a90f1',
    'Vyro Rental Management System',
    'Web Application',
    'A rental-management application for landlords, administrators, caretakers, and tenants. It brings property and tenant records, rent tracking, water-meter billing, invoices, and tenant statements into one workspace.',
    array['React.js', 'Supabase'],
    array['Property, unit, tenant, and caretaker management', 'Manual and confirmed rent payment tracking', 'Metered water-bill calculations and itemized invoices', 'Tenant portal, payment records, and CSV exports'],
    '',
    'https://app.vyrosocial.com',
    1,
    true
  ),
  (
    '2f39f585-69c4-4ab6-ad52-a2ea3a0a90f2',
    'VyroSocial',
    'Social Networking Platform',
    'A social networking platform that brings community connections together with house hunting, Airbnb and hotel bookings, and a marketplace.',
    array['React.js', 'JavaScript', 'CSS'],
    array['Social networking and community connections', 'House hunting', 'Airbnb and hotel bookings', 'Marketplace'],
    '',
    'https://vyrosocial.com',
    2,
    true
  ),
  (
    '2f39f585-69c4-4ab6-ad52-a2ea3a0a90f3',
    'Shopping254',
    'E-commerce Platform',
    'Shopping254 is an online store for browsing products across categories like phones, electronics, clothing, shoes, and home essentials. Shoppers can search for products, explore categories, and add items to their cart.',
    array['CSS', 'JavaScript', 'React.js'],
    array[]::text[],
    '',
    'https://shopping254.com',
    3,
    true
  )
on conflict (id) do nothing;
