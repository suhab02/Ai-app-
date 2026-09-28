-- Bright Learning School — Phase 3: attendance
-- Depends on 0001–0005. Idempotent (safe to re-run).
--
-- Daily attendance: one row per student per date. The class/section/year are
-- copied from the student's ACTIVE enrollment at marking time so the record
-- keeps its context if the student later changes section, and so RLS can scope
-- teachers by section without joining through enrollments.

do $$ begin
  create type public.attendance_status as enum ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEAVE');
exception when duplicate_object then null; end $$;

-- "Today" for the school. The server runs in UTC, but a teacher marking
-- attendance at 7am in Dhaka is already on the next UTC-date's calendar day
-- boundary (UTC+6), so a plain current_date would wrongly reject "today".
create or replace function public.school_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Dhaka')::date;
$$;

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  attendance_date date not null,
  status public.attendance_status not null,
  note text,
  marked_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, attendance_date)
);

create index if not exists attendance_section_date_idx
  on public.attendance_records (academic_year_id, class_id, section_id, attendance_date);
create index if not exists attendance_student_date_idx
  on public.attendance_records (student_id, attendance_date);

-- ---------------------------------------------------------------------------
-- Integrity + provenance. Runs for every writer, including staff.
--  * the student must have an ACTIVE enrollment in that year/class/section
--  * no marking the future
--  * identity columns are immutable after insert (only status/note may change)
--  * marked_by is taken from the session, never from the client
-- ---------------------------------------------------------------------------
create or replace function public.validate_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.student_id is distinct from old.student_id
       or new.attendance_date is distinct from old.attendance_date
       or new.academic_year_id is distinct from old.academic_year_id
       or new.class_id is distinct from old.class_id
       or new.section_id is distinct from old.section_id then
      raise exception 'only status and note can be changed on an attendance record';
    end if;
  else
    if not exists (
      select 1 from public.student_enrollments se
      where se.student_id = new.student_id
        and se.academic_year_id = new.academic_year_id
        and se.class_id = new.class_id
        and se.section_id = new.section_id
        and se.status = 'ACTIVE'
    ) then
      raise exception 'student % has no active enrollment in that class/section', new.student_id;
    end if;

    if new.attendance_date > public.school_today() then
      raise exception 'attendance cannot be marked for a future date (%)', new.attendance_date;
    end if;
  end if;

  -- auth.uid() is null for service_role / direct SQL; keep whatever was given then.
  new.marked_by := coalesce(auth.uid(), new.marked_by);
  return new;
end;
$$;

drop trigger if exists attendance_validate on public.attendance_records;
create trigger attendance_validate
  before insert or update on public.attendance_records
  for each row execute function public.validate_attendance();

drop trigger if exists attendance_set_updated_at on public.attendance_records;
create trigger attendance_set_updated_at before update on public.attendance_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--   read : staff, a teacher of that section, the student, a linked guardian
--   write: staff, or a teacher of that section (insert/update only)
--   delete: staff only
-- ---------------------------------------------------------------------------
alter table public.attendance_records enable row level security;

drop policy if exists attendance_select on public.attendance_records;
create policy attendance_select on public.attendance_records
  for select to authenticated
  using (
    public.is_staff()
    or public.teaches_class_section(class_id, section_id, academic_year_id)
    or public.owns_student(student_id)
    or public.is_guardian_of_student(student_id)
  );

drop policy if exists attendance_insert on public.attendance_records;
create policy attendance_insert on public.attendance_records
  for insert to authenticated
  with check (
    public.is_staff()
    or public.teaches_class_section(class_id, section_id, academic_year_id)
  );

drop policy if exists attendance_update on public.attendance_records;
create policy attendance_update on public.attendance_records
  for update to authenticated
  using (
    public.is_staff()
    or public.teaches_class_section(class_id, section_id, academic_year_id)
  )
  with check (
    public.is_staff()
    or public.teaches_class_section(class_id, section_id, academic_year_id)
  );

drop policy if exists attendance_delete on public.attendance_records;
create policy attendance_delete on public.attendance_records
  for delete to authenticated
  using (public.is_staff());

grant select, insert, update, delete on public.attendance_records to authenticated;
grant execute on function public.school_today() to authenticated;
