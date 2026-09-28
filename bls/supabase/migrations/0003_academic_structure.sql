-- Bright Learning School — Phase 2: academic structure
-- Depends on 0001/0002. Idempotent (safe to re-run).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.enrollment_status as enum ('ACTIVE', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.guardian_relationship as enum
    ('FATHER', 'MOTHER', 'GRANDFATHER', 'GRANDMOTHER', 'UNCLE', 'AUNT', 'SIBLING', 'LEGAL_GUARDIAN', 'OTHER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gender as enum ('MALE', 'FEMALE', 'OTHER');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Shared helper: is the caller SUPER_ADMIN or ORGANIZER?
-- SECURITY DEFINER via current_profile_role() so it is safe inside any policy.
-- ---------------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('SUPER_ADMIN', 'ORGANIZER'), false);
$$;

grant execute on function public.is_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- academic_years
-- ---------------------------------------------------------------------------
create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academic_years_dates_check check (end_date > start_date)
);

-- At most one current academic year.
create unique index if not exists academic_years_one_current_idx
  on public.academic_years (is_current) where is_current;

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  name text not null,
  name_bn text,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, name)
);
create index if not exists classes_academic_year_idx on public.classes (academic_year_id);

-- ---------------------------------------------------------------------------
-- sections
-- ---------------------------------------------------------------------------
create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete restrict,
  name text not null,
  name_bn text,
  capacity integer check (capacity is null or capacity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, name)
);
create index if not exists sections_class_idx on public.sections (class_id);

-- ---------------------------------------------------------------------------
-- subjects (year-agnostic catalog)
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_bn text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists academic_years_set_updated_at on public.academic_years;
create trigger academic_years_set_updated_at before update on public.academic_years
  for each row execute function public.set_updated_at();

drop trigger if exists classes_set_updated_at on public.classes;
create trigger classes_set_updated_at before update on public.classes
  for each row execute function public.set_updated_at();

drop trigger if exists sections_set_updated_at on public.sections;
create trigger sections_set_updated_at before update on public.sections
  for each row execute function public.set_updated_at();

drop trigger if exists subjects_set_updated_at on public.subjects;
create trigger subjects_set_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: reference data is non-sensitive (any logged-in user may read it);
-- only SUPER_ADMIN/ORGANIZER may change it. anon has no policy = no access.
-- ---------------------------------------------------------------------------
alter table public.academic_years enable row level security;
alter table public.classes enable row level security;
alter table public.sections enable row level security;
alter table public.subjects enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['academic_years', 'classes', 'sections', 'subjects'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t || '_staff_write', t);
  end loop;
end
$$;

grant select, insert, update, delete on
  public.academic_years, public.classes, public.sections, public.subjects
  to authenticated;
