-- Bright Learning School — Phase 2: people (students, guardians, teachers)
-- Depends on 0001–0003. Idempotent.
--
-- profile_id is NULLABLE on purpose: staff can create a school record before
-- the person has a login, then link an account later. That keeps the
-- service-role key out of the web request path entirely.

-- ---------------------------------------------------------------------------
-- Guard: a linked profile must have the matching role.
-- Usage: trigger ... execute function public.enforce_profile_role('STUDENT')
-- ---------------------------------------------------------------------------
create or replace function public.enforce_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected public.user_role := tg_argv[0]::public.user_role;
  v_actual public.user_role;
begin
  if new.profile_id is null then
    return new;
  end if;

  select role into v_actual from public.profiles where id = new.profile_id;

  if v_actual is null then
    raise exception 'profile % does not exist', new.profile_id;
  end if;

  if v_actual <> v_expected then
    raise exception 'profile % has role %, expected %', new.profile_id, v_actual, v_expected;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  admission_number text not null unique,
  full_name text not null,
  full_name_bn text,
  photo_url text,
  date_of_birth date,
  gender public.gender,
  blood_group text,
  nationality text,
  phone text,
  address text,
  admission_date date not null default current_date,
  previous_school text,
  emergency_contact_name text,
  emergency_contact_phone text,
  medical_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- guardians
-- ---------------------------------------------------------------------------
create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null,
  full_name_bn text,
  photo_url text,
  phone text,
  email text,
  address text,
  occupation text,
  workplace text,
  is_emergency_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- teachers
-- ---------------------------------------------------------------------------
create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles (id) on delete set null,
  full_name text not null,
  full_name_bn text,
  photo_url text,
  email text,
  phone text,
  joining_date date,
  designation text,
  department text,
  qualifications text,
  experience_years integer check (experience_years is null or experience_years >= 0),
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists students_enforce_role on public.students;
create trigger students_enforce_role before insert or update of profile_id on public.students
  for each row execute function public.enforce_profile_role('STUDENT');

drop trigger if exists guardians_enforce_role on public.guardians;
create trigger guardians_enforce_role before insert or update of profile_id on public.guardians
  for each row execute function public.enforce_profile_role('PARENT');

drop trigger if exists teachers_enforce_role on public.teachers;
create trigger teachers_enforce_role before insert or update of profile_id on public.teachers
  for each row execute function public.enforce_profile_role('TEACHER');

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at before update on public.students
  for each row execute function public.set_updated_at();

drop trigger if exists guardians_set_updated_at on public.guardians;
create trigger guardians_set_updated_at before update on public.guardians
  for each row execute function public.set_updated_at();

drop trigger if exists teachers_set_updated_at on public.teachers;
create trigger teachers_set_updated_at before update on public.teachers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ownership helpers (SECURITY DEFINER: bypass RLS to avoid policy recursion)
-- ---------------------------------------------------------------------------
create or replace function public.owns_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students where id = p_student_id and profile_id = auth.uid());
$$;

create or replace function public.owns_guardian(p_guardian_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guardians where id = p_guardian_id and profile_id = auth.uid());
$$;

create or replace function public.owns_teacher(p_teacher_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teachers where id = p_teacher_id and profile_id = auth.uid());
$$;

grant execute on function
  public.owns_student(uuid), public.owns_guardian(uuid), public.owns_teacher(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS enabled here; SELECT policies for students/guardians depend on the
-- relationship helpers and are created in 0005_relationships.sql. Until then
-- (and for any role without a matching policy) access is denied by default.
-- ---------------------------------------------------------------------------
alter table public.students enable row level security;
alter table public.guardians enable row level security;
alter table public.teachers enable row level security;

drop policy if exists teachers_select on public.teachers;
create policy teachers_select on public.teachers
  for select to authenticated
  using (public.is_staff() or profile_id = auth.uid());

drop policy if exists students_staff_write on public.students;
create policy students_staff_write on public.students
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists guardians_staff_write on public.guardians;
create policy guardians_staff_write on public.guardians
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists teachers_staff_write on public.teachers;
create policy teachers_staff_write on public.teachers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.students, public.guardians, public.teachers to authenticated;
