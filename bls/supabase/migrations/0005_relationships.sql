-- Bright Learning School — Phase 2: relationships
-- Depends on 0001–0004. Idempotent.
--
-- student_enrollments keeps history (never overwrite a student's class).
-- student_guardians is many-to-many. teacher_assignments links a teacher to
-- (year, class, section, subject).
--
-- Every read policy below calls a SECURITY DEFINER helper instead of an inline
-- EXISTS on another RLS-protected table, which would make students <->
-- student_enrollments <-> teacher_assignments policies evaluate each other.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  roll_number text,
  status public.enrollment_status not null default 'ACTIVE',
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_enrollments_dates_check check (end_date is null or end_date >= start_date)
);

-- One ACTIVE enrollment per student per academic year.
create unique index if not exists student_enrollments_one_active_idx
  on public.student_enrollments (student_id, academic_year_id) where status = 'ACTIVE';

-- Roll numbers are unique among active enrollments of a class/section/year.
create unique index if not exists student_enrollments_roll_idx
  on public.student_enrollments (academic_year_id, class_id, section_id, roll_number)
  where status = 'ACTIVE' and roll_number is not null;

create index if not exists student_enrollments_student_idx on public.student_enrollments (student_id);
create index if not exists student_enrollments_class_section_idx
  on public.student_enrollments (academic_year_id, class_id, section_id);

create table if not exists public.student_guardians (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  relationship public.guardian_relationship not null,
  is_primary boolean not null default false,
  can_pick_up boolean not null default true,
  receives_notifications boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, guardian_id)
);

-- At most one primary guardian per student.
create unique index if not exists student_guardians_one_primary_idx
  on public.student_guardians (student_id) where is_primary;
create index if not exists student_guardians_guardian_idx on public.student_guardians (guardian_id);

create table if not exists public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  is_class_teacher boolean not null default false,
  created_at timestamptz not null default now(),
  unique (teacher_id, academic_year_id, class_id, section_id, subject_id)
);

-- At most one class teacher per class/section/year.
create unique index if not exists teacher_assignments_one_class_teacher_idx
  on public.teacher_assignments (academic_year_id, class_id, section_id) where is_class_teacher;
create index if not exists teacher_assignments_class_section_idx
  on public.teacher_assignments (academic_year_id, class_id, section_id);

-- ---------------------------------------------------------------------------
-- Consistency: class must belong to the year, section to the class.
-- ---------------------------------------------------------------------------
create or replace function public.validate_class_section_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.classes where id = new.class_id and academic_year_id = new.academic_year_id
  ) then
    raise exception 'class % does not belong to academic year %', new.class_id, new.academic_year_id;
  end if;

  if not exists (
    select 1 from public.sections where id = new.section_id and class_id = new.class_id
  ) then
    raise exception 'section % does not belong to class %', new.section_id, new.class_id;
  end if;

  return new;
end;
$$;

drop trigger if exists student_enrollments_validate on public.student_enrollments;
create trigger student_enrollments_validate
  before insert or update of academic_year_id, class_id, section_id on public.student_enrollments
  for each row execute function public.validate_class_section_year();

drop trigger if exists teacher_assignments_validate on public.teacher_assignments;
create trigger teacher_assignments_validate
  before insert or update of academic_year_id, class_id, section_id on public.teacher_assignments
  for each row execute function public.validate_class_section_year();

drop trigger if exists student_enrollments_set_updated_at on public.student_enrollments;
create trigger student_enrollments_set_updated_at before update on public.student_enrollments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Relationship helpers (SECURITY DEFINER, all relative to auth.uid())
-- ---------------------------------------------------------------------------
create or replace function public.is_guardian_of_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.student_guardians sg
    join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = p_student_id and g.profile_id = auth.uid()
  );
$$;

create or replace function public.teaches_class_section(p_class_id uuid, p_section_id uuid, p_academic_year_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    join public.teachers t on t.id = ta.teacher_id
    where ta.class_id = p_class_id
      and ta.section_id = p_section_id
      and ta.academic_year_id = p_academic_year_id
      and t.profile_id = auth.uid()
  );
$$;

create or replace function public.teaches_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.student_enrollments se
    where se.student_id = p_student_id
      and se.status = 'ACTIVE'
      and public.teaches_class_section(se.class_id, se.section_id, se.academic_year_id)
  );
$$;

-- Caller is (or is a guardian of) a student actively enrolled in this class/section/year.
create or replace function public.student_in_class_section(p_class_id uuid, p_section_id uuid, p_academic_year_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.student_enrollments se
    where se.class_id = p_class_id
      and se.section_id = p_section_id
      and se.academic_year_id = p_academic_year_id
      and se.status = 'ACTIVE'
      and (public.owns_student(se.student_id) or public.is_guardian_of_student(se.student_id))
  );
$$;

-- Caller is a student linked to this guardian.
create or replace function public.guardian_linked_to_caller_student(p_guardian_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.student_guardians sg
    where sg.guardian_id = p_guardian_id and public.owns_student(sg.student_id)
  );
$$;

grant execute on function
  public.is_guardian_of_student(uuid),
  public.teaches_class_section(uuid, uuid, uuid),
  public.teaches_student(uuid),
  public.student_in_class_section(uuid, uuid, uuid),
  public.guardian_linked_to_caller_student(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.student_enrollments enable row level security;
alter table public.student_guardians enable row level security;
alter table public.teacher_assignments enable row level security;

-- students: staff, the student, a linked guardian, or an assigned teacher.
drop policy if exists students_select on public.students;
create policy students_select on public.students
  for select to authenticated
  using (
    public.is_staff()
    or profile_id = auth.uid()
    or public.is_guardian_of_student(id)
    or public.teaches_student(id)
  );

-- guardians: staff, the guardian, or a student linked to them.
drop policy if exists guardians_select on public.guardians;
create policy guardians_select on public.guardians
  for select to authenticated
  using (
    public.is_staff()
    or profile_id = auth.uid()
    or public.guardian_linked_to_caller_student(id)
  );

drop policy if exists student_enrollments_select on public.student_enrollments;
create policy student_enrollments_select on public.student_enrollments
  for select to authenticated
  using (
    public.is_staff()
    or public.owns_student(student_id)
    or public.is_guardian_of_student(student_id)
    or public.teaches_class_section(class_id, section_id, academic_year_id)
  );

drop policy if exists student_guardians_select on public.student_guardians;
create policy student_guardians_select on public.student_guardians
  for select to authenticated
  using (
    public.is_staff()
    or public.owns_student(student_id)
    or public.owns_guardian(guardian_id)
  );

drop policy if exists teacher_assignments_select on public.teacher_assignments;
create policy teacher_assignments_select on public.teacher_assignments
  for select to authenticated
  using (
    public.is_staff()
    or public.owns_teacher(teacher_id)
    or public.student_in_class_section(class_id, section_id, academic_year_id)
  );

-- Writes: SUPER_ADMIN / ORGANIZER only, on every relationship table.
drop policy if exists student_enrollments_staff_write on public.student_enrollments;
create policy student_enrollments_staff_write on public.student_enrollments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists student_guardians_staff_write on public.student_guardians;
create policy student_guardians_staff_write on public.student_guardians
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists teacher_assignments_staff_write on public.teacher_assignments;
create policy teacher_assignments_staff_write on public.teacher_assignments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on
  public.student_enrollments, public.student_guardians, public.teacher_assignments
  to authenticated;
