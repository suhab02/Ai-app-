-- Bright Learning School — Phase 1 foundation schema
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / DO-block guards /
-- CREATE OR REPLACE) so a partial failure never leaves the database in a state
-- where re-running this file errors out instead of finishing the job.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- gen_random_uuid() lives in pgcrypto on the Postgres versions Supabase runs.
-- Supabase projects have this enabled by default, but we declare it explicitly
-- so the migration also works on a bare Postgres database.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
-- Postgres has no "CREATE TYPE IF NOT EXISTS", so we guard manually. Without
-- this guard, re-running the migration after a partial failure throws
-- "type already exists" and aborts the whole script before the profiles
-- table is ever created — this is the most likely cause of a migration that
-- reports an error yet leaves some objects behind.
do $$
begin
  create type public.user_role as enum (
    'SUPER_ADMIN',
    'ORGANIZER',
    'TEACHER',
    'STUDENT',
    'PARENT'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.account_status as enum (
    'PENDING',
    'ACTIVE',
    'INACTIVE',
    'SUSPENDED',
    'ARCHIVED'
  );
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------
-- Display-ID sequencing
-- ---------------------------------------------------------------------------
-- Human-friendly IDs (BLS-A-00001, BLS-T-00001, ...) are display-only and are
-- NEVER used as a relational key. The UUID primary key on profiles.id is the
-- only key foreign keys reference. One counter row per role keeps numbering
-- independent per prefix.
create table if not exists public.display_id_counters (
  role public.user_role primary key,
  prefix text not null,
  next_value integer not null default 1
);

insert into public.display_id_counters (role, prefix)
values
  ('SUPER_ADMIN', 'A'),
  ('ORGANIZER', 'O'),
  ('TEACHER', 'T'),
  ('STUDENT', 'S'),
  ('PARENT', 'G')
on conflict (role) do nothing;

-- generate_display_id() is SECURITY DEFINER so it can atomically increment the
-- shared counter (via SELECT ... FOR UPDATE) regardless of the caller's RLS
-- visibility into display_id_counters. search_path is pinned to prevent a
-- search-path hijack from redirecting the unqualified table reference.
create or replace function public.generate_display_id(p_role public.user_role)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next integer;
begin
  update public.display_id_counters
  set next_value = next_value + 1
  where role = p_role
  returning prefix, next_value - 1 into v_prefix, v_next;

  if v_prefix is null then
    raise exception 'No display-id counter configured for role %', p_role;
  end if;

  return format('BLS-%s-%s', v_prefix, lpad(v_next::text, 5, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- One row per auth.users row. id is both the primary key and the FK to
-- auth.users, so a profile can never exist without a matching auth identity.
-- display_id is a separate unique column — never used as a join key.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_id text not null unique,
  role public.user_role not null default 'STUDENT',
  status public.account_status not null default 'PENDING',
  full_name text,
  full_name_bn text,
  email text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (status);

create or replace trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

comment on table public.profiles is
  'One row per authenticated user. Role/status changes are authorization-sensitive and are locked down further in 0002_rls.sql.';
comment on column public.profiles.display_id is
  'Human-facing school ID (e.g. BLS-T-00001). Display only — never a relational key.';
comment on column public.profiles.status is
  'PENDING accounts have no portal access beyond viewing their own pending status until an admin activates them.';
