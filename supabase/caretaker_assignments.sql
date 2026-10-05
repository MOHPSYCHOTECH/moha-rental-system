-- Keeps track of which caretaker is assigned to which property/unit for each landlord.

create table if not exists public.caretaker_assignments (
  id uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references auth.users(id) on delete cascade,
  caretaker_id uuid not null references auth.users(id) on delete cascade,
  property_name text not null default '',
  unit_name text not null default '',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caretaker_assignment_unique unique (landlord_id, caretaker_id, property_name, unit_name)
);

create index if not exists caretaker_assignments_landlord_idx
  on public.caretaker_assignments (landlord_id, active, property_name);

create index if not exists caretaker_assignments_caretaker_idx
  on public.caretaker_assignments (caretaker_id, active, property_name);

create or replace function public.set_caretaker_assignments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists caretaker_assignments_updated_at on public.caretaker_assignments;
create trigger caretaker_assignments_updated_at
before update on public.caretaker_assignments
for each row execute function public.set_caretaker_assignments_updated_at();

-- Example: assign a caretaker to one apartment/unit under a landlord.
-- insert into public.caretaker_assignments (landlord_id, caretaker_id, property_name, unit_name, notes)
-- values (
--   'LANDLORD_USER_ID',
--   'CARETAKER_USER_ID',
--   'Juniper Court',
--   'B2',
--   'Handles routine checks and maintenance'
-- );

-- Example: assign multiple units to the same caretaker for one landlord.
-- insert into public.caretaker_assignments (landlord_id, caretaker_id, property_name, unit_name, active)
-- values
--   ('LANDLORD_USER_ID', 'CARETAKER_USER_ID', 'Juniper Court', 'A1', true),
--   ('LANDLORD_USER_ID', 'CARETAKER_USER_ID', 'Willow Gardens', 'C5', true)
-- on conflict (landlord_id, caretaker_id, property_name, unit_name) do update
-- set active = excluded.active, notes = coalesce(public.caretaker_assignments.notes, excluded.notes);
