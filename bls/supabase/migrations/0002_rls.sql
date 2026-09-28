-- Bright Learning School — Phase 1 authorization layer
-- Depends on 0001_init.sql. Also safe to re-run: functions use
-- CREATE OR REPLACE, policies are dropped-then-recreated, triggers use
-- CREATE OR REPLACE TRIGGER.

-- ---------------------------------------------------------------------------
-- Helper: current caller's role, bypassing RLS recursion
-- ---------------------------------------------------------------------------
-- Reading public.profiles from inside a policy defined ON public.profiles
-- would normally re-trigger the same policy (infinite recursion) or simply
-- see no rows once RLS is enabled. Making this SECURITY DEFINER lets it look
-- up the row directly, which is the standard, documented Supabase pattern
-- for role-lookup helpers used inside RLS expressions.
create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_profile_role() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Auth profile-creation flow
-- ---------------------------------------------------------------------------
-- Fires for every new row in auth.users, i.e. every email/password signup
-- and every first-time Google OAuth login. It is the ONLY way a profiles row
-- is ever created (no INSERT policy is granted to anon/authenticated below),
-- so the security rule "self-registration must never grant a privileged
-- role" is enforced in exactly one place.
--
-- requested_role is read from the signup form's auth metadata and is
-- restricted to STUDENT/PARENT. Any other value (including a client trying
-- to smuggle in 'SUPER_ADMIN', 'ORGANIZER', or 'TEACHER', and the Google
-- OAuth flow, which never sends this field) silently falls back to STUDENT.
-- Every new account starts life as PENDING regardless of role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_role text := new.raw_user_meta_data ->> 'requested_role';
  v_role public.user_role;
begin
  if v_requested_role in ('STUDENT', 'PARENT') then
    v_role := v_requested_role::public.user_role;
  else
    v_role := 'STUDENT';
  end if;

  insert into public.profiles (id, display_id, role, status, full_name, full_name_bn, email)
  values (
    new.id,
    public.generate_display_id(v_role),
    v_role,
    'PENDING',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'full_name_bn',
    new.email
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Column-level protection on profiles
-- ---------------------------------------------------------------------------
-- Postgres RLS is row-level only; it cannot say "you may update this row but
-- not this column". This trigger adds that missing column-level guard on top
-- of the row-level policies below.
create or replace function public.enforce_profile_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_actor_role public.user_role;
begin
  if new.id is distinct from old.id then
    raise exception 'profiles.id is immutable';
  end if;

  if new.display_id is distinct from old.display_id then
    raise exception 'profiles.display_id is immutable';
  end if;

  -- 'service_role' is only reachable with the secret service-role key
  -- (never shipped to a browser — see docs/rls.md, .env.example); 'postgres'
  -- is only reachable with direct database credentials (SQL editor, CLI,
  -- migrations), never through the public PostgREST API. Both already
  -- bypass RLS entirely (bypassrls / table ownership); without this check a
  -- BEFORE trigger (unlike RLS) would still fire and block them too —
  -- including the one-time break-glass SUPER_ADMIN promotion in
  -- docs/deployment.md and scripts/seed.ts creating TEACHER/ORGANIZER/
  -- SUPER_ADMIN demo accounts. id/display_id stay immutable even here.
  if current_user in ('service_role', 'postgres') then
    return new;
  end if;

  v_actor_role := public.current_profile_role();

  if new.role is distinct from old.role then
    if v_actor_role = 'SUPER_ADMIN' then
      -- SUPER_ADMIN may assign any role.
      null;
    elsif v_actor_role = 'ORGANIZER' and new.role not in ('SUPER_ADMIN', 'ORGANIZER') then
      -- ORGANIZER may assign TEACHER/STUDENT/PARENT but can never grant
      -- SUPER_ADMIN or ORGANIZER itself.
      null;
    elsif old.status = 'PENDING' and old.role in ('STUDENT', 'PARENT') and new.role in ('STUDENT', 'PARENT') then
      -- One-time self-service correction while still pending review, e.g. a
      -- Google sign-in that defaulted to STUDENT switching to PARENT before
      -- an admin looks at the account. Can never reach TEACHER/ORGANIZER/
      -- SUPER_ADMIN through this branch.
      null;
    else
      raise exception 'not authorized to change role';
    end if;
  end if;

  if new.status is distinct from old.status then
    if v_actor_role not in ('SUPER_ADMIN', 'ORGANIZER') then
      raise exception 'only an administrator can change account status';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_enforce_update on public.profiles;
create trigger profiles_enforce_update
  before update on public.profiles
  for each row
  execute function public.enforce_profile_update();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.display_id_counters enable row level security;

-- profiles: a user always sees their own row; SUPER_ADMIN/ORGANIZER see all.
-- No policy exists for anon, so logged-out requests see nothing.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.current_profile_role() in ('SUPER_ADMIN', 'ORGANIZER')
  );

-- profiles: same row-level scope for updates; enforce_profile_update above
-- adds the column-level rules (role/status/display_id/id).
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  to authenticated
  using (
    id = auth.uid()
    or public.current_profile_role() in ('SUPER_ADMIN', 'ORGANIZER')
  )
  with check (
    id = auth.uid()
    or public.current_profile_role() in ('SUPER_ADMIN', 'ORGANIZER')
  );

-- No INSERT policy: the only supported way to create a profile is the
-- on_auth_user_created trigger (SECURITY DEFINER, runs as the table owner).
-- No DELETE policy: accounts are archived (status = 'ARCHIVED'), never
-- deleted, so history and foreign keys from later phases stay intact.

-- display_id_counters has no policies at all: it is invisible and
-- unwritable to anon/authenticated. Only generate_display_id() (SECURITY
-- DEFINER, owned by the same role that owns the table) can touch it.

-- ---------------------------------------------------------------------------
-- Table-level grants
-- ---------------------------------------------------------------------------
-- RLS narrows what a GRANT allows; it cannot widen it. These grants give
-- authenticated users the baseline SELECT/UPDATE that the policies above
-- then restrict to specific rows and (via the trigger) specific columns.
-- No INSERT/DELETE grant is given — those are impossible for anon/
-- authenticated regardless of RLS, by design.
grant usage on schema public to authenticated, anon;
grant select, update on public.profiles to authenticated;
