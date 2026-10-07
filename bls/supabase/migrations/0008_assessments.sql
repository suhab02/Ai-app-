-- Bright Learning School — Phase 4: exams, assessments, results
-- Depends on 0001–0007. Idempotent (safe to re-run).
--
-- Key rules:
--  * Grading is DATA (grading_scales + bands), never hard-coded in the app.
--  * Students/guardians see marks only for PUBLISHED assessments, and only
--    their own / their child's row. Classmates never see each other's marks.
--  * Once published, only staff can change an assessment or its marks.

-- ---------------------------------------------------------------------------
-- Grading scales
-- ---------------------------------------------------------------------------
create table if not exists public.grading_scales (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists grading_scales_one_default_idx
  on public.grading_scales (is_default) where is_default;

-- A band applies to every percentage >= min_score and below the next band's
-- min_score, so bands cannot overlap or leave gaps by construction.
create table if not exists public.grading_scale_bands (
  id uuid primary key default gen_random_uuid(),
  scale_id uuid not null references public.grading_scales (id) on delete cascade,
  letter text not null,
  min_score numeric(5, 2) not null check (min_score >= 0 and min_score <= 100),
  grade_point numeric(3, 2) not null check (grade_point >= 0),
  is_pass boolean not null default true,
  unique (scale_id, min_score),
  unique (scale_id, letter)
);

-- Bangladesh default. The brief fixes the letter ranges; the grade points are
-- the usual Bangladeshi GPA values (assumption — edit the rows to change them).
insert into public.grading_scales (name, is_default) values ('Bangladesh (default)', true)
on conflict (name) do nothing;

insert into public.grading_scale_bands (scale_id, letter, min_score, grade_point, is_pass)
select s.id, b.letter, b.min_score, b.grade_point, b.is_pass
from public.grading_scales s
cross join (values
  ('A+', 80.00, 5.00, true),
  ('A',  70.00, 4.00, true),
  ('A-', 60.00, 3.50, true),
  ('B',  50.00, 3.00, true),
  ('C',  40.00, 2.00, true),
  ('D',  33.00, 1.00, true),
  ('F',   0.00, 0.00, false)
) as b(letter, min_score, grade_point, is_pass)
where s.name = 'Bangladesh (default)'
on conflict do nothing;

create or replace function public.default_grading_scale_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.grading_scales where is_default limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Enum + assessments
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.assessment_kind as enum
    ('CLASS_TEST', 'QUIZ', 'MONTHLY', 'TERM', 'ANNUAL', 'ASSIGNMENT', 'PRACTICAL', 'CUSTOM');
exception when duplicate_object then null; end $$;

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,
  class_id uuid not null references public.classes (id) on delete restrict,
  section_id uuid not null references public.sections (id) on delete restrict,
  subject_id uuid not null references public.subjects (id) on delete restrict,
  kind public.assessment_kind not null,
  name text not null check (length(btrim(name)) > 0),
  term text not null check (length(btrim(term)) > 0),
  max_marks numeric(6, 2) not null check (max_marks > 0),
  grading_scale_id uuid not null default public.default_grading_scale_id()
    references public.grading_scales (id) on delete restrict,
  assessment_date date not null default public.school_today(),
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessments_section_idx
  on public.assessments (academic_year_id, class_id, section_id, subject_id);

create table if not exists public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete restrict,
  student_id uuid not null references public.students (id) on delete restrict,
  marks_obtained numeric(6, 2),
  is_absent boolean not null default false,
  remarks text,
  entered_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id),
  -- Absent = no marks; otherwise marks are required and non-negative.
  constraint assessment_results_marks_check check (
    (is_absent and marks_obtained is null)
    or (not is_absent and marks_obtained is not null and marks_obtained >= 0)
  )
);

create index if not exists assessment_results_student_idx on public.assessment_results (student_id);

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: avoid policy recursion, same pattern as Phase 2/3)
-- ---------------------------------------------------------------------------
create or replace function public.can_grade_assessment(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assessments a
    where a.id = p_assessment_id
      and (public.is_staff()
           or public.teaches_subject(a.class_id, a.section_id, a.academic_year_id, a.subject_id))
  );
$$;

create or replace function public.assessment_is_published(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_published from public.assessments where id = p_assessment_id), false);
$$;

grant execute on function
  public.default_grading_scale_id(), public.can_grade_assessment(uuid), public.assessment_is_published(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- auth.uid() is null for service_role / direct SQL (trusted tooling); those skip the
-- "published => staff only" lock, exactly like the profiles trigger in 0002.
create or replace function public.validate_assessment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trusted boolean := auth.uid() is null;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.is_published then
      new.published_at := coalesce(new.published_at, now());
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.is_published and not v_trusted and not public.is_staff() then
      raise exception 'a published assessment can only be deleted by staff';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.is_published and not v_trusted and not public.is_staff() then
    raise exception 'a published assessment can only be changed by staff';
  end if;

  if new.academic_year_id is distinct from old.academic_year_id
     or new.class_id is distinct from old.class_id
     or new.section_id is distinct from old.section_id
     or new.subject_id is distinct from old.subject_id then
    if exists (select 1 from public.assessment_results where assessment_id = old.id) then
      raise exception 'cannot move an assessment that already has results';
    end if;
  end if;

  if new.max_marks < old.max_marks
     and exists (select 1 from public.assessment_results where assessment_id = old.id and marks_obtained > new.max_marks) then
    raise exception 'max_marks cannot be lowered below marks already entered';
  end if;

  if new.is_published and not old.is_published then
    new.published_at := now();
  elsif not new.is_published and old.is_published then
    new.published_at := null;
  end if;

  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists assessments_validate on public.assessments;
create trigger assessments_validate
  before insert or update or delete on public.assessments
  for each row execute function public.validate_assessment();

drop trigger if exists assessments_validate_scope on public.assessments;
create trigger assessments_validate_scope
  before insert or update of academic_year_id, class_id, section_id on public.assessments
  for each row execute function public.validate_class_section_year();

drop trigger if exists assessments_set_updated_at on public.assessments;
create trigger assessments_set_updated_at before update on public.assessments
  for each row execute function public.set_updated_at();

create or replace function public.validate_assessment_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.assessments%rowtype;
  v_trusted boolean := auth.uid() is null;
  v_assessment_id uuid := case when tg_op = 'DELETE' then old.assessment_id else new.assessment_id end;
begin
  select * into a from public.assessments where id = v_assessment_id;

  -- Published results are frozen for everyone except staff.
  if a.is_published and not v_trusted and not public.is_staff() then
    raise exception 'results of a published assessment can only be changed by staff';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.assessment_id is distinct from old.assessment_id or new.student_id is distinct from old.student_id then
      raise exception 'assessment and student cannot be changed on a result';
    end if;
  else
    if not exists (
      select 1 from public.student_enrollments se
      where se.student_id = new.student_id
        and se.academic_year_id = a.academic_year_id
        and se.class_id = a.class_id
        and se.section_id = a.section_id
        and se.status = 'ACTIVE'
    ) then
      raise exception 'student % is not actively enrolled in this assessment''s section', new.student_id;
    end if;
  end if;

  if new.marks_obtained is not null and new.marks_obtained > a.max_marks then
    raise exception 'marks % exceed the maximum of %', new.marks_obtained, a.max_marks;
  end if;

  new.entered_by := coalesce(auth.uid(), new.entered_by);
  return new;
end;
$$;

drop trigger if exists assessment_results_validate on public.assessment_results;
create trigger assessment_results_validate
  before insert or update or delete on public.assessment_results
  for each row execute function public.validate_assessment_result();

drop trigger if exists assessment_results_set_updated_at on public.assessment_results;
create trigger assessment_results_set_updated_at before update on public.assessment_results
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.grading_scales enable row level security;
alter table public.grading_scale_bands enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_results enable row level security;

drop policy if exists grading_scales_select on public.grading_scales;
create policy grading_scales_select on public.grading_scales for select to authenticated using (true);
drop policy if exists grading_scales_staff_write on public.grading_scales;
create policy grading_scales_staff_write on public.grading_scales
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists grading_scale_bands_select on public.grading_scale_bands;
create policy grading_scale_bands_select on public.grading_scale_bands for select to authenticated using (true);
drop policy if exists grading_scale_bands_staff_write on public.grading_scale_bands;
create policy grading_scale_bands_staff_write on public.grading_scale_bands
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- assessments: staff; the teacher of that subject+section; enrolled students and
-- their guardians ONLY once published.
drop policy if exists assessments_select on public.assessments;
create policy assessments_select on public.assessments
  for select to authenticated
  using (
    public.is_staff()
    or public.teaches_subject(class_id, section_id, academic_year_id, subject_id)
    or (is_published and public.student_in_class_section(class_id, section_id, academic_year_id))
  );

drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments
  for insert to authenticated
  with check (
    public.is_staff()
    or public.teaches_subject(class_id, section_id, academic_year_id, subject_id)
  );

drop policy if exists assessments_update on public.assessments;
create policy assessments_update on public.assessments
  for update to authenticated
  using (public.is_staff() or public.teaches_subject(class_id, section_id, academic_year_id, subject_id))
  with check (public.is_staff() or public.teaches_subject(class_id, section_id, academic_year_id, subject_id));

drop policy if exists assessments_delete on public.assessments;
create policy assessments_delete on public.assessments
  for delete to authenticated
  using (public.is_staff() or public.teaches_subject(class_id, section_id, academic_year_id, subject_id));

-- results: staff; the teacher who can grade it; the student / a linked guardian
-- for their OWN row, and only when the assessment is published.
drop policy if exists assessment_results_select on public.assessment_results;
create policy assessment_results_select on public.assessment_results
  for select to authenticated
  using (
    public.can_grade_assessment(assessment_id)
    or (
      public.assessment_is_published(assessment_id)
      and (public.owns_student(student_id) or public.is_guardian_of_student(student_id))
    )
  );

drop policy if exists assessment_results_insert on public.assessment_results;
create policy assessment_results_insert on public.assessment_results
  for insert to authenticated with check (public.can_grade_assessment(assessment_id));

drop policy if exists assessment_results_update on public.assessment_results;
create policy assessment_results_update on public.assessment_results
  for update to authenticated
  using (public.can_grade_assessment(assessment_id))
  with check (public.can_grade_assessment(assessment_id));

drop policy if exists assessment_results_delete on public.assessment_results;
create policy assessment_results_delete on public.assessment_results
  for delete to authenticated using (public.can_grade_assessment(assessment_id));

grant select, insert, update, delete on
  public.grading_scales, public.grading_scale_bands, public.assessments, public.assessment_results
  to authenticated;
