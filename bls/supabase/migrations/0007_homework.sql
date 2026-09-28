-- Bright Learning School — Phase 3: homework
-- Depends on 0001–0006. Idempotent.
--
-- Attachments and student submissions are intentionally NOT here: private files
-- need their own Storage bucket + policy pass (public gallery vs private
-- student documents must not share security assumptions).

-- Caller is a teacher assigned to exactly this (year, class, section, subject).
create or replace function public.teaches_subject(
  p_class_id uuid, p_section_id uuid, p_academic_year_id uuid, p_subject_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    join public.teachers t on t.id = ta.teacher_id
    where ta.class_id = p_class_id
      and ta.section_id = p_section_id
      and ta.academic_year_id = p_academic_year_id
      and ta.subject_id = p_subject_id
      and t.profile_id = auth.uid()
  );
$$;

grant execute on function public.teaches_subject(uuid, uuid, uuid, uuid) to authenticated;

create table if not exists public.homework (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  -- Nullable so staff can post homework on a teacher's behalf.
  teacher_id uuid references public.teachers (id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  description text,
  assigned_date date not null default public.school_today(),
  due_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homework_dates_check check (due_date >= assigned_date)
);

create index if not exists homework_section_due_idx
  on public.homework (academic_year_id, class_id, section_id, due_date);
create index if not exists homework_teacher_idx on public.homework (teacher_id);

drop trigger if exists homework_validate on public.homework;
create trigger homework_validate
  before insert or update of academic_year_id, class_id, section_id on public.homework
  for each row execute function public.validate_class_section_year();

drop trigger if exists homework_set_updated_at on public.homework;
create trigger homework_set_updated_at before update on public.homework
  for each row execute function public.set_updated_at();

alter table public.homework enable row level security;

-- read: staff, its author, any teacher of that section, enrolled students and their guardians
drop policy if exists homework_select on public.homework;
create policy homework_select on public.homework
  for select to authenticated
  using (
    public.is_staff()
    or public.owns_teacher(teacher_id)
    or public.teaches_class_section(class_id, section_id, academic_year_id)
    or public.student_in_class_section(class_id, section_id, academic_year_id)
  );

-- write: staff, or the teacher who owns the row AND is assigned that subject in that section
drop policy if exists homework_insert on public.homework;
create policy homework_insert on public.homework
  for insert to authenticated
  with check (
    public.is_staff()
    or (
      public.owns_teacher(teacher_id)
      and public.teaches_subject(class_id, section_id, academic_year_id, subject_id)
    )
  );

drop policy if exists homework_update on public.homework;
create policy homework_update on public.homework
  for update to authenticated
  using (
    public.is_staff()
    or (
      public.owns_teacher(teacher_id)
      and public.teaches_subject(class_id, section_id, academic_year_id, subject_id)
    )
  )
  with check (
    public.is_staff()
    or (
      public.owns_teacher(teacher_id)
      and public.teaches_subject(class_id, section_id, academic_year_id, subject_id)
    )
  );

drop policy if exists homework_delete on public.homework;
create policy homework_delete on public.homework
  for delete to authenticated
  using (
    public.is_staff()
    or (
      public.owns_teacher(teacher_id)
      and public.teaches_subject(class_id, section_id, academic_year_id, subject_id)
    )
  );

grant select, insert, update, delete on public.homework to authenticated;
