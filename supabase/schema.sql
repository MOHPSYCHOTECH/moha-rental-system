-- Run this in Supabase SQL Editor before starting the app.
-- One authenticated owner can access only their own rental workspace snapshot.
create table if not exists public.rental_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.rental_workspaces enable row level security;

create policy "Owners can read their rental workspace"
  on public.rental_workspaces for select to authenticated
  using (auth.uid() = owner_id);

create policy "Owners can create their rental workspace"
  on public.rental_workspaces for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "Owners can update their rental workspace"
  on public.rental_workspaces for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create or replace function public.set_rental_workspace_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rental_workspaces_updated_at
before update on public.rental_workspaces
for each row execute function public.set_rental_workspace_updated_at();
