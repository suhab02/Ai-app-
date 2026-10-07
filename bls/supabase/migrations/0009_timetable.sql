-- Bright Learning School — Phase 5: timetable
-- Depends on 0001–0008. Idempotent.
--
-- weekday: 0 = Sunday … 6 = Saturday (the same numbering as JS getUTCDay()).
-- The school week is data: a day simply has entries or it doesn't.

create table if not exists public.timetable_periods (
  id uuid primary key default gen_random_uuid(),
  period_no smallint not null unique check (period_no > 0),
  label text not null check (length(btrim(label)) > 0),
  start_time time not null,
  end_time time not null,
  -- Recess / assembly slots: shown on the grid but never given a lesson.
  is_break boolean not null default false,
  created_at timestamptz not null default now(),
  constraint timetable_periods_time_check check (end_time > start_time)
);

create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  weekday smallint not null check (weekday between 0 and 6),
  period_id uuid not null references public.timetable_periods (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  -- Nullable: a lesson can be scheduled before a teacher is confirmed.
  teacher_id uuid references public.teachers (id) on delete set null,
  room text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A section has one lesson per slot…
  unique (section_id, weekday, period_id)
);

-- …and a teacher can't be in two places at once, across every section.
create unique index if not exists timetable_entries_teacher_clash_idx
  on public.timetable_entries (academic_year_id, teacher_id, weekday, period_id)
  where teacher_id is not null;

create index if not exists timetable_entries_section_idx
  on public.timetable_entries (academic_year_id, class_id, section_id);

-- ---------------------------------------------------------------------------
-- Coherence: no lessons in break slots; a named teacher must actually be
-- assigned that subject in that section (teacher_assignments is the source of truth).
-- ---------------------------------------------------------------------------
create or replace function public.validate_timetable_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.timetable_periods where id = new.period_id and is_break) then
    raise exception 'a break period cannot have a lesson';
  end if;

  if new.teacher_id is not null and not exists (
    select 1 from public.teacher_assignments ta
    where ta.teacher_id = new.teacher_id
      and ta.academic_year_id = new.academic_year_id
      and ta.class_id = new.class_id
      and ta.section_id = new.section_id
      and ta.subject_id = new.subject_id
  ) then
    raise exception 'that teacher is not assigned this subject in this section';
  end if;

  return new;
end;
$$;

drop trigger if exists timetable_entries_validate_scope on public.timetable_entries;
create trigger timetable_entries_validate_scope
  before insert or update of academic_year_id, class_id, section_id on public.timetable_entries
  for each row execute function public.validate_class_section_year();

drop trigger if exists timetable_entries_validate on public.timetable_entries;
create trigger timetable_entries_validate
  before insert or update on public.timetable_entries
  for each row execute function public.validate_timetable_entry();

drop trigger if exists timetable_entries_set_updated_at on public.timetable_entries;
create trigger timetable_entries_set_updated_at before update on public.timetable_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: periods are reference data; entries are readable by staff, the teacher
-- named on them, any teacher of that section, and students/guardians of it.
-- Only staff write.
-- ---------------------------------------------------------------------------
alter table public.timetable_periods enable row level security;
alter table public.timetable_entries enable row level security;

drop policy if exists timetable_periods_select on public.timetable_periods;
create policy timetable_periods_select on public.timetable_periods for select to authenticated using (true);
drop policy if exists timetable_periods_staff_write on public.timetable_periods;
create policy timetable_periods_staff_write on public.timetable_periods
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists timetable_entries_select on public.timetable_entries;
create policy timetable_entries_select on public.timetable_entries
  for select to authenticated
  using (
    public.is_staff()
    or public.owns_teacher(teacher_id)
    or public.teaches_class_section(class_id, section_id, academic_year_id)
    or public.student_in_class_section(class_id, section_id, academic_year_id)
  );

drop policy if exists timetable_entries_staff_write on public.timetable_entries;
create policy timetable_entries_staff_write on public.timetable_entries
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.timetable_periods, public.timetable_entries to authenticated;
