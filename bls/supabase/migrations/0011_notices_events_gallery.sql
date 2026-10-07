-- Bright Learning School — Phase 7: notices, events, gallery, storage
-- Depends on 0001–0010. Idempotent.
--
-- This phase adds the first data that ANONYMOUS visitors can read (rows flagged
-- is_public, and published gallery albums), so every anon policy below is explicit
-- and narrow: published, public, not expired. Anon can never write anything.
--
-- Files: two buckets with deliberately different security assumptions.
--   gallery-public    public read, staff-only write, images only, 5 MB
--   student-documents PRIVATE, staff write, the student / a linked guardian read their own folder

do $$ begin
  create type public.notice_audience as enum ('ALL', 'TEACHERS', 'STUDENTS', 'PARENTS');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Audience helpers (SECURITY DEFINER; relative to auth.uid())
-- ---------------------------------------------------------------------------
-- Is the caller a member of this section: a student actively enrolled in it, a
-- guardian of such a student, or a teacher assigned to it?
create or replace function public.in_section(p_section_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    exists (
      select 1 from public.student_enrollments se
      where se.section_id = p_section_id and se.status = 'ACTIVE'
        and (public.owns_student(se.student_id) or public.is_guardian_of_student(se.student_id))
    )
    or exists (
      select 1 from public.teacher_assignments ta
      join public.teachers t on t.id = ta.teacher_id
      where ta.section_id = p_section_id and t.profile_id = auth.uid()
    );
$$;

-- Does the audience include the caller (by role), and if a section is targeted, are they in it?
-- A section-targeted STUDENTS notice reaches that section's students only, not their guardians.
create or replace function public.audience_includes_caller(p_audience public.notice_audience, p_section_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    case p_audience
      when 'ALL' then auth.uid() is not null
      when 'TEACHERS' then public.current_profile_role() = 'TEACHER'
      when 'STUDENTS' then public.current_profile_role() = 'STUDENT'
      when 'PARENTS' then public.current_profile_role() = 'PARENT'
    end
    and (p_section_id is null or public.in_section(p_section_id));
$$;

grant execute on function public.in_section(uuid), public.audience_includes_caller(public.notice_audience, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notices
-- ---------------------------------------------------------------------------
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  body text not null check (length(btrim(body)) > 0),
  audience public.notice_audience not null default 'ALL',
  section_id uuid references public.sections (id) on delete restrict,
  is_published boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  is_pinned boolean not null default false,
  -- Shown on the public website. Only whole-school notices can be public.
  is_public boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notices_public_check check (not is_public or (audience = 'ALL' and section_id is null)),
  constraint notices_expiry_check check (expires_at is null or published_at is null or expires_at > published_at)
);

create index if not exists notices_visible_idx on public.notices (is_published, published_at desc);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  audience public.notice_audience not null default 'ALL',
  is_published boolean not null default false,
  is_public boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_time_check check (ends_at is null or ends_at >= starts_at),
  constraint events_public_check check (not is_public or audience = 'ALL')
);

create index if not exists events_starts_idx on public.events (starts_at);

create or replace function public.stamp_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;

  -- Publishing stamps the time (a future published_at schedules it).
  if tg_table_name = 'notices' then
    if new.is_published and new.published_at is null then
      new.published_at := now();
    elsif not new.is_published then
      new.published_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notices_stamp on public.notices;
create trigger notices_stamp before insert or update on public.notices
  for each row execute function public.stamp_publication();
drop trigger if exists events_stamp on public.events;
create trigger events_stamp before insert or update on public.events
  for each row execute function public.stamp_publication();

drop trigger if exists notices_set_updated_at on public.notices;
create trigger notices_set_updated_at before update on public.notices
  for each row execute function public.set_updated_at();
drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gallery tables (the files themselves live in Storage)
-- ---------------------------------------------------------------------------
create table if not exists public.gallery_albums (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  title_bn text,
  description text,
  is_published boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.gallery_albums (id) on delete restrict,
  -- Server-generated "albums/<album uuid>/<photo uuid>.<ext>"; the CHECK blocks path tricks outright.
  storage_path text not null unique
    check (storage_path ~ '^albums/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'),
  caption text,
  caption_bn text,
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists gallery_photos_album_idx on public.gallery_photos (album_id, sort_order);

create or replace function public.album_is_published(p_album_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_published from public.gallery_albums where id = p_album_id), false);
$$;

create or replace function public.stamp_gallery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := case when tg_op = 'INSERT' then coalesce(auth.uid(), new.created_by) else old.created_by end;
  return new;
end;
$$;

drop trigger if exists gallery_albums_stamp on public.gallery_albums;
create trigger gallery_albums_stamp before insert or update on public.gallery_albums
  for each row execute function public.stamp_gallery();
drop trigger if exists gallery_photos_stamp on public.gallery_photos;
create trigger gallery_photos_stamp before insert or update on public.gallery_photos
  for each row execute function public.stamp_gallery();
drop trigger if exists gallery_albums_set_updated_at on public.gallery_albums;
create trigger gallery_albums_set_updated_at before update on public.gallery_albums
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notices enable row level security;
alter table public.events enable row level security;
alter table public.gallery_albums enable row level security;
alter table public.gallery_photos enable row level security;

-- notices / events: staff everything; signed-in users the published, current ones meant for them;
-- anonymous visitors ONLY published + is_public + not expired.
drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices
  for select to authenticated
  using (
    public.is_staff()
    or (
      is_published and published_at <= now() and (expires_at is null or expires_at > now())
      and public.audience_includes_caller(audience, section_id)
    )
  );
drop policy if exists notices_select_public on public.notices;
create policy notices_select_public on public.notices
  for select to anon
  using (is_published and is_public and published_at <= now() and (expires_at is null or expires_at > now()));
drop policy if exists notices_staff_write on public.notices;
create policy notices_staff_write on public.notices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using (public.is_staff() or (is_published and public.audience_includes_caller(audience, null)));
drop policy if exists events_select_public on public.events;
create policy events_select_public on public.events
  for select to anon using (is_published and is_public);
drop policy if exists events_staff_write on public.events;
create policy events_staff_write on public.events
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- gallery: published albums (and their photos) are public to everyone; staff manage.
drop policy if exists gallery_albums_select on public.gallery_albums;
create policy gallery_albums_select on public.gallery_albums
  for select to authenticated using (is_published or public.is_staff());
drop policy if exists gallery_albums_select_public on public.gallery_albums;
create policy gallery_albums_select_public on public.gallery_albums
  for select to anon using (is_published);
drop policy if exists gallery_albums_staff_write on public.gallery_albums;
create policy gallery_albums_staff_write on public.gallery_albums
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists gallery_photos_select on public.gallery_photos;
create policy gallery_photos_select on public.gallery_photos
  for select to authenticated using (public.album_is_published(album_id) or public.is_staff());
drop policy if exists gallery_photos_select_public on public.gallery_photos;
create policy gallery_photos_select_public on public.gallery_photos
  for select to anon using (public.album_is_published(album_id));
drop policy if exists gallery_photos_staff_write on public.gallery_photos;
create policy gallery_photos_staff_write on public.gallery_photos
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select on public.notices, public.events, public.gallery_albums, public.gallery_photos to anon;
grant select, insert, update, delete on public.notices, public.events, public.gallery_albums, public.gallery_photos to authenticated;
grant execute on function public.album_is_published(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage. Wrapped so the migration is a no-op on a database without Supabase Storage.
-- ---------------------------------------------------------------------------
-- The student a "student-documents" object belongs to: its first path segment, if it is a UUID.
create or replace function public.document_student_id(p_object_name text)
returns uuid language sql immutable set search_path = public as $$
  select case
    when split_part(p_object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_object_name, '/', 1)::uuid
  end;
$$;

grant execute on function public.document_student_id(text) to authenticated;

do $storage$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found; skipping bucket setup';
    return;
  end if;

  -- Public gallery: images only, 5 MB. The limits are enforced by Storage itself, in addition
  -- to the Server Action's own checks (extension, MIME, size and magic bytes).
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('gallery-public', 'gallery-public', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- Private documents: NOT public, so every read goes through the policies below (signed URLs).
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('student-documents', 'student-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do update
    set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- gallery-public: anyone may fetch an object by its public URL (that is what "public" means), but
  -- listing/writing/deleting is staff-only, and object names must match the generated pattern.
  drop policy if exists "gallery_public_staff_select" on storage.objects;
  create policy "gallery_public_staff_select" on storage.objects
    for select to authenticated using (bucket_id = 'gallery-public' and public.is_staff());

  drop policy if exists "gallery_public_staff_insert" on storage.objects;
  create policy "gallery_public_staff_insert" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'gallery-public' and public.is_staff()
      and name ~ '^albums/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    );

  drop policy if exists "gallery_public_staff_update" on storage.objects;
  create policy "gallery_public_staff_update" on storage.objects
    for update to authenticated
    using (bucket_id = 'gallery-public' and public.is_staff())
    with check (bucket_id = 'gallery-public' and public.is_staff());

  drop policy if exists "gallery_public_staff_delete" on storage.objects;
  create policy "gallery_public_staff_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'gallery-public' and public.is_staff());

  -- student-documents: staff manage everything; a student / linked guardian can READ their own folder only.
  drop policy if exists "student_documents_read" on storage.objects;
  create policy "student_documents_read" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'student-documents'
      and (
        public.is_staff()
        or public.owns_student(public.document_student_id(name))
        or public.is_guardian_of_student(public.document_student_id(name))
      )
    );

  drop policy if exists "student_documents_staff_insert" on storage.objects;
  create policy "student_documents_staff_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'student-documents' and public.is_staff() and public.document_student_id(name) is not null);

  drop policy if exists "student_documents_staff_update" on storage.objects;
  create policy "student_documents_staff_update" on storage.objects
    for update to authenticated
    using (bucket_id = 'student-documents' and public.is_staff())
    with check (bucket_id = 'student-documents' and public.is_staff() and public.document_student_id(name) is not null);

  drop policy if exists "student_documents_staff_delete" on storage.objects;
  create policy "student_documents_staff_delete" on storage.objects
    for delete to authenticated using (bucket_id = 'student-documents' and public.is_staff());
end
$storage$;
