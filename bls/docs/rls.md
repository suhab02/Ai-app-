# Row Level Security

## Why the migration is split, and why every statement is idempotent

The task that produced this phase inherited a known failure mode from an earlier attempt: running a
migration in the Supabase SQL editor, getting "Backend error, retry your query", and the `profiles`
table never showing up in Table Editor. The SQL editor runs a whole pasted script as one transaction;
if any statement errors, **everything in that script rolls back**, including tables that appeared to
create successfully earlier in the same script. The likely causes, all guarded against here:

- **Non-idempotent `CREATE TYPE`**: Postgres has no `CREATE TYPE IF NOT EXISTS`. If `0001_init.sql`
  is re-run after a partial failure (or pasted twice), `CREATE TYPE user_role AS ENUM (...)` throws
  `type "user_role" already exists`, aborting the whole script before `profiles` is reached — even
  though the type creation was actually fine. **Fix**: both enum types are wrapped in `DO $$ ...
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;` blocks.
- **Non-idempotent `CREATE TRIGGER`**: same problem, one statement later. **Fix**: `CREATE OR
  REPLACE TRIGGER` (Postgres 14+, which Supabase runs) or `DROP TRIGGER IF EXISTS` immediately
  before `CREATE TRIGGER`.
- **Non-idempotent policies**: Postgres has no `CREATE POLICY IF NOT EXISTS` either. **Fix**: `DROP
  POLICY IF EXISTS` before every `CREATE POLICY`.
- **Missing extension**: `gen_random_uuid()` requires `pgcrypto`. Supabase projects have it enabled
  by default, but the migration declares it explicitly (`CREATE EXTENSION IF NOT EXISTS pgcrypto`)
  so it isn't relying on that default silently.
- **Migration ordering**: `0002_rls.sql` references `public.profiles` and `public.user_role`, both
  created in `0001_init.sql`. Running `0002` before `0001` finishes fails loudly and correctly — the
  fix is applying them in order, not making `0002` defensive about `0001` not having run.

Net effect: pasting either file into the SQL editor twice in a row, or resuming after a failure
partway through, now finishes cleanly instead of leaving the database in a half-built state.

## Policies (Phase 1: `profiles`; Phase 2 below)

| Table | RLS | Policies |
| --- | --- | --- |
| `profiles` | enabled | `profiles_select` (own row, or SUPER_ADMIN/ORGANIZER); `profiles_update` (same row-level scope). No INSERT policy, no DELETE policy. |
| `display_id_counters` | enabled | none — invisible and unwritable to `anon`/`authenticated`. |

**No INSERT policy on `profiles` is deliberate.** The only way a row is created is the
`on_auth_user_created` trigger, which runs `SECURITY DEFINER` as the table owner and therefore
isn't subject to RLS at all. A client calling `supabase.from("profiles").insert(...)` directly gets
rejected — there is no policy that would allow it.

**No DELETE policy is deliberate.** Accounts are archived (`status = 'ARCHIVED'`), never deleted —
see `docs/database.md`.

**Column-level protection** (which row-level RLS cannot express on its own) is layered on top with
the `enforce_profile_update` `BEFORE UPDATE` trigger: it's what actually stops a user from writing
their own `role`/`status`/`display_id`/`id` outside the narrow cases described in
`docs/authorization.md`. RLS says *which rows* you can touch; the trigger says *which columns* you
can change on them.

## Phase 2 policies and the helper-function pattern

Every Phase 2 table has RLS enabled. Reads are relationship-scoped; writes are `is_staff()` only (policy
`<table>_staff_write`, `for all`). The relationship checks live in `SECURITY DEFINER` helpers
(`owns_student`, `is_guardian_of_student`, `teaches_class_section`, `teaches_student`, `student_in_class_section`,
`guardian_linked_to_caller_student`, …), never as inline `EXISTS` subqueries inside policies. Reason: an inline
`EXISTS` on another RLS-protected table runs that table's policies too, and `students` ↔ `student_enrollments` ↔
`teacher_assignments` reference each other — the helpers bypass RLS for the lookup, so there is no policy
recursion and each rule reads as one line.

## Phase 3 policies

`attendance_records`: SELECT = staff / `teaches_class_section` / `owns_student` / `is_guardian_of_student`; INSERT and UPDATE =
staff / `teaches_class_section`; DELETE = staff. `homework`: SELECT = staff / author / `teaches_class_section` /
`student_in_class_section`; INSERT/UPDATE/DELETE = staff, or `owns_teacher(teacher_id)` **and** `teaches_subject(...)`.
All reuse the Phase 2 SECURITY DEFINER helpers (plus the new `teaches_subject`).

**Why triggers as well as policies:** RLS can say *who* may write a row but not that the row is *coherent*. The
`validate_attendance` trigger rejects a student who isn't enrolled in the section, future dates, identity-column edits and a
forged `marked_by`; `validate_class_section_year` (Phase 2) guards homework's year/class/section.

**Upserts:** the app saves a roster with `upsert(..., { onConflict: "student_id,attendance_date" })`, i.e. `INSERT ... ON
CONFLICT DO UPDATE`. That path runs the INSERT trigger, then the INSERT policy, then the UPDATE trigger and policy, so it has
its own tests in `tests/migrations.test.ts` (new day, existing day, wrong-section student, moving a row to a foreign section).

## `current_profile_role()` and recursion

Any policy on `profiles` that needs to know the caller's role can't just `SELECT role FROM profiles
WHERE id = auth.uid()` inline — that query would itself be subject to the very policy being
evaluated. `current_profile_role()` is `SECURITY DEFINER` specifically to break that cycle: it reads
the row directly, bypassing RLS, and returns just the role. This is the standard, documented
Supabase pattern for role-lookup helpers used inside RLS expressions.

## How to verify RLS is actually working

**No Supabase project needed:** `npm test` (`tests/migrations.test.ts`) boots an embedded Postgres (PGlite) with stubbed
`auth.uid()`/roles, applies every migration **twice** (idempotency), then asserts the isolation rules — parent A vs B,
student A vs B, assigned vs unassigned teacher, write lockouts, integrity constraints, and Phase 1 regressions.

**Against a real project:**

```bash
SEED_ENV=development npm run seed   # creates 5 demo accounts, one per role
npm run test:rls                    # tests/rls-smoke.test.ts — real anon-key network calls
```

The smoke tests cover the isolation guarantees the project brief calls mandatory, scoped to what
Phase 1 has:

- Logged-out requests get nothing from `profiles`.
- A STUDENT can read their own row, not a TEACHER's.
- A STUDENT cannot update another user's row.
- A STUDENT cannot self-promote to TEACHER.
- A TEACHER cannot read another user's profile (no implicit admin powers).
- An ORGANIZER cannot grant SUPER_ADMIN.
- An ORGANIZER can suspend/reactivate a STUDENT account (status change, not role change).
- A SUPER_ADMIN can read every profile.

The Phase 2 block in the same file adds: parent A sees only their child (not B's), student A can't see student B, a teacher
sees only assigned-class students, an unassigned teacher sees none, teacher/student/parent writes are rejected, anon sees nothing.
