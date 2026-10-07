-- Bright Learning School — Phase 8: admissions + public website content
-- Depends on 0001–0011. Idempotent.
--
-- Admissions is the ONLY place an anonymous visitor can write. The design is
-- insert-only and as narrow as Postgres allows:
--   * column-level GRANT INSERT: an applicant can set only the form's own fields;
--     status / review columns are not even grantable to them, so they take their defaults
--   * an INSERT policy that re-asserts status = 'SUBMITTED' and no review data
--   * no SELECT grant for anon at all: nobody can read anyone's application back
--   * CHECK constraints bound every field (length, phone/email shape, plausible birth date)
--   * staff alone can read, review and update; nobody can delete (applications are records)

do $$ begin
  create type public.application_status as enum ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED');
exception when duplicate_object then null; end $$;

create table if not exists public.admission_applications (
  id uuid primary key default gen_random_uuid(),
  -- supplied by the applicant
  applicant_name text not null check (length(btrim(applicant_name)) between 2 and 120),
  applicant_name_bn text check (applicant_name_bn is null or length(applicant_name_bn) <= 120),
  date_of_birth date not null,
  gender public.gender,
  desired_class text not null check (length(btrim(desired_class)) between 1 and 60),
  previous_school text check (previous_school is null or length(previous_school) <= 200),
  guardian_name text not null check (length(btrim(guardian_name)) between 2 and 120),
  guardian_phone text not null check (guardian_phone ~ '^[0-9+() -]{6,30}$'),
  guardian_email text check (guardian_email is null or (length(guardian_email) <= 254 and guardian_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  address text check (address is null or length(address) <= 500),
  message text check (message is null or length(message) <= 2000),
  -- controlled by the school only
  status public.application_status not null default 'SUBMITTED',
  review_notes text check (review_notes is null or length(review_notes) <= 2000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admission_applications_status_idx on public.admission_applications (status, created_at desc);

-- A plausible applicant age (1–30 years). This is a trigger, not a CHECK: it depends on today's date,
-- which is not immutable, and a CHECK that can start failing later would break dump/restore.
create or replace function public.validate_application_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.date_of_birth >= public.school_today() - interval '1 year'
     or new.date_of_birth <= public.school_today() - interval '30 years' then
    raise exception 'date of birth is not plausible for an applicant';
  end if;
  return new;
end;
$$;

drop trigger if exists admission_applications_validate on public.admission_applications;
create trigger admission_applications_validate before insert on public.admission_applications
  for each row execute function public.validate_application_insert();

create or replace function public.stamp_application_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Whoever changes the status is the reviewer, taken from the session, never from the request.
  if new.status is distinct from old.status or new.review_notes is distinct from old.review_notes then
    new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists admission_applications_review on public.admission_applications;
create trigger admission_applications_review before update on public.admission_applications
  for each row execute function public.stamp_application_review();

drop trigger if exists admission_applications_set_updated_at on public.admission_applications;
create trigger admission_applications_set_updated_at before update on public.admission_applications
  for each row execute function public.set_updated_at();

alter table public.admission_applications enable row level security;

-- Anyone (visitor or signed-in) may SUBMIT; the CHECK re-asserts the school-only columns are untouched.
drop policy if exists admissions_submit on public.admission_applications;
create policy admissions_submit on public.admission_applications
  for insert to anon, authenticated
  with check (status = 'SUBMITTED' and reviewed_by is null and reviewed_at is null and review_notes is null);

drop policy if exists admissions_staff_select on public.admission_applications;
create policy admissions_staff_select on public.admission_applications
  for select to authenticated using (public.is_staff());

drop policy if exists admissions_staff_update on public.admission_applications;
create policy admissions_staff_update on public.admission_applications
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- Column-level insert: only the form's own fields. No table-level INSERT for anyone, no DELETE for anyone.
grant insert (
  applicant_name, applicant_name_bn, date_of_birth, gender, desired_class,
  previous_school, guardian_name, guardian_phone, guardian_email, address, message
) on public.admission_applications to anon, authenticated;
grant select, update on public.admission_applications to authenticated;

-- ---------------------------------------------------------------------------
-- Website content (a deliberately small CMS: named blocks of bilingual plain text)
-- ---------------------------------------------------------------------------
create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  title_en text not null default '' check (length(title_en) <= 200),
  title_bn text not null default '' check (length(title_bn) <= 200),
  body_en text not null default '' check (length(body_en) <= 10000),
  body_bn text not null default '' check (length(body_bn) <= 10000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.stamp_site_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists site_content_stamp on public.site_content;
create trigger site_content_stamp before insert or update on public.site_content
  for each row execute function public.stamp_site_content();

alter table public.site_content enable row level security;

drop policy if exists site_content_public_read on public.site_content;
create policy site_content_public_read on public.site_content
  for select to anon, authenticated using (true);

drop policy if exists site_content_staff_insert on public.site_content;
create policy site_content_staff_insert on public.site_content
  for insert to authenticated with check (public.is_staff());
drop policy if exists site_content_staff_update on public.site_content;
create policy site_content_staff_update on public.site_content
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

grant select on public.site_content to anon;
grant select, insert, update on public.site_content to authenticated;
-- No DELETE: a block is edited, never removed, so the public pages always have something to show.

-- Starter content so a fresh install is not an empty site. Staff edit these in the dashboard.
insert into public.site_content (key, title_en, title_bn, body_en, body_bn) values
  ('home_hero', 'Bright Learning School', 'ব্রাইট লার্নিং স্কুল',
   'A caring, modern school where every child is known, challenged and encouraged to shine.',
   'এমন একটি যত্নশীল ও আধুনিক বিদ্যালয়, যেখানে প্রতিটি শিশুকে জানা হয়, এগিয়ে নেওয়া হয় এবং উজ্জ্বল হতে উৎসাহ দেওয়া হয়।'),
  ('about', 'About our school', 'আমাদের স্কুল সম্পর্কে',
   'Bright Learning School offers a balanced education in English and Bangla, with small classes and a focus on curiosity, character and community.',
   'ব্রাইট লার্নিং স্কুল ইংরেজি ও বাংলা উভয় ভাষায় সুষম শিক্ষা প্রদান করে—ছোট ক্লাস, এবং কৌতূহল, চরিত্র ও সম্প্রদায়ের প্রতি গুরুত্বসহ।'),
  ('contact', 'Contact us', 'যোগাযোগ করুন',
   'Please update this block with the school address, phone number, email and office hours.',
   'অনুগ্রহ করে এই অংশে স্কুলের ঠিকানা, ফোন নম্বর, ইমেইল ও অফিসের সময় হালনাগাদ করুন।'),
  ('admissions_intro', 'Apply for admission', 'ভর্তির আবেদন',
   'Tell us about your child and we will contact you about the next steps. Applications are reviewed by the school office.',
   'আপনার সন্তান সম্পর্কে আমাদের জানান; পরবর্তী ধাপ নিয়ে আমরা আপনার সাথে যোগাযোগ করব। আবেদনগুলো স্কুল অফিস পর্যালোচনা করে।')
on conflict (key) do nothing;
