# Database

## Migrations

Plain SQL files under `supabase/migrations/`, applied in filename order:

- `0001_init.sql` — extensions, enum types (`user_role`, `account_status`), the `profiles` table,
  the `display_id_counters` table, `generate_display_id()`, the generic `set_updated_at()` trigger.
- `0002_rls.sql` — `current_profile_role()` helper, the `on_auth_user_created` auth trigger, the
  `enforce_profile_update` column-protection trigger, RLS policies, and table grants.

Every statement in every file is idempotent (`IF NOT EXISTS`, `DO` blocks catching
`duplicate_object`, `CREATE OR REPLACE`, `DROP ... IF EXISTS` before `CREATE`). Re-running any
file after a partial failure finishes the job instead of erroring on "already exists" — see
`docs/rls.md` for why that mattered here.

- `0003_academic_structure.sql` — enums (`enrollment_status`, `guardian_relationship`, `gender`), `is_staff()`,
  `academic_years`, `classes`, `sections`, `subjects`, RLS, grants.
- `0004_people.sql` — `students`, `guardians`, `teachers`, the `enforce_profile_role()` trigger, `owns_*()` helpers.
- `0005_relationships.sql` — `student_enrollments`, `student_guardians`, `teacher_assignments`, class/section/year
  consistency trigger, relationship helpers, and the relationship-scoped SELECT policies.

**Apply order matters**: run `0001` → `0005` in order; each depends on the previous ones.

## Schema (Phase 1)

### `profiles`

One row per `auth.users` row (FK `id → auth.users.id`, `on delete cascade`).

| Column          | Type            | Notes                                                        |
| --------------- | --------------- | -------------------------------------------------------------|
| `id`             | `uuid` PK        | Same value as `auth.users.id`. The only relational key.      |
| `display_id`     | `text` unique    | `BLS-<A\|O\|T\|S\|G>-00001`. Display only, never a join key.  |
| `role`           | `user_role`      | `SUPER_ADMIN \| ORGANIZER \| TEACHER \| STUDENT \| PARENT`    |
| `status`         | `account_status` | `PENDING \| ACTIVE \| INACTIVE \| SUSPENDED \| ARCHIVED`      |
| `full_name`, `full_name_bn`, `email`, `phone`, `avatar_url` | `text` | |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` auto-maintained by trigger |

### `display_id_counters`

Internal only (no client access — see `docs/rls.md`). One row per role, incremented atomically by
`generate_display_id(role)` to hand out `BLS-<prefix>-00001`, `...-00002`, etc. Prefixes:
`SUPER_ADMIN → A`, `ORGANIZER → O`, `TEACHER → T`, `STUDENT → S`, `PARENT → G`.

## Schema (Phase 2)

| Table | Key columns / constraints |
| --- | --- |
| `academic_years` | `name` unique; partial unique index → at most one `is_current`; `end_date > start_date` |
| `classes` | FK `academic_year_id`; unique `(academic_year_id, name)` |
| `sections` | FK `class_id`; unique `(class_id, name)`; optional `capacity` |
| `subjects` | `code` unique (year-agnostic catalog) |
| `students` | own UUID PK; nullable unique `profile_id`; `admission_number` unique; bilingual name, DOB, gender, contact, emergency contact, `medical_notes` |
| `guardians` | nullable unique `profile_id`; bilingual name, contact, occupation, workplace |
| `teachers` | nullable unique `profile_id`; bilingual name, designation, department, qualifications, experience |
| `student_enrollments` | history table (never overwrite a class); partial unique: one `ACTIVE` per (student, year); unique active roll per (year, class, section) |
| `student_guardians` | many-to-many; `relationship`, `is_primary` (one per student), `can_pick_up`, `receives_notifications` |
| `teacher_assignments` | (teacher, year, class, section, subject); `is_class_teacher` (one per class/section/year) |

`validate_class_section_year()` rejects an enrollment/assignment whose class isn't in that academic year or whose
section isn't in that class.

**Why `profile_id` is nullable:** staff can create a student/guardian/teacher record before the person has a login,
then link an account by email. This keeps the service-role key out of the web request path. When set, the
`enforce_profile_role()` trigger requires the profile's role to be STUDENT / PARENT / TEACHER respectively.

## Design choices worth knowing

- **UUID PK + separate display ID**: `profiles.id` is what every future foreign key
  (`student_enrollments.student_id`, etc.) points to. `display_id` is human-facing only and is
  never used to join tables — exactly as the project brief requires.
- **No hard deletes**: there is no DELETE policy on `profiles` and no delete grant. Deactivating an
  account means setting `status = 'ARCHIVED'` (or `SUSPENDED`/`INACTIVE`), which preserves history
  for any future table that references the profile.
- **Enums over free text**: `role` and `status` are Postgres enums, not strings, so an invalid value
  is a database-level error, not a bug waiting to happen in application code.

## Regenerating TypeScript types

`src/lib/supabase/types.ts` is currently hand-written (row shapes must be `type` aliases, not `interface`s, or supabase-js resolves them to `never`) to mirror the SQL above. Once the Supabase CLI
is linked to a real project, replace it with the generated output instead of maintaining it by hand:

```bash
supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```
