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

## Phase 4 policies

`assessments`: SELECT = staff / `teaches_subject` / (`is_published` AND `student_in_class_section`); INSERT/UPDATE/DELETE = staff or
`teaches_subject`. `assessment_results`: SELECT = `can_grade_assessment` OR (`assessment_is_published` AND (`owns_student` OR
`is_guardian_of_student`)); writes = `can_grade_assessment`. Two new SECURITY DEFINER helpers (`can_grade_assessment`,
`assessment_is_published`) keep the policies one line each. The "published ⇒ frozen" rule lives in triggers because RLS cannot express
"you may update this row only while it is a draft".

## Phase 5 policies

`timetable_entries` SELECT = staff / `owns_teacher` / `teaches_class_section` / `student_in_class_section`; all writes staff-only. The
double-booking guarantee is a partial unique index (not a policy), so it holds for every writer including service_role.

## Phase 6: ledger triggers and function privileges

Policies are simple (staff, owner, linked guardian). The safety is in triggers (`validate_invoice`, `validate_payment`) — see
`docs/database.md`. **Function privileges matter too:** Postgres (and Supabase's default privileges) make new functions executable by
everyone, so `next_receipt_no()` would otherwise be callable by an anonymous visitor through `/rest/v1/rpc/…` and could burn receipt numbers.
Migration 0010 revokes EXECUTE from `public, anon, authenticated` on `next_receipt_no`, `invoice_paid_total` and — closing the same hole
from Phase 1 — `generate_display_id`. Triggers still work because they run as their `SECURITY DEFINER` owner. The embedded-Postgres test
asserts that `anon` and a student get "permission denied" for all three.

## Phase 7: the first anonymous access, and Storage

Anon policies are separate `to anon` policies, each ending in the narrowest predicate (`is_published AND is_public AND not expired`), and
`anon` gets `SELECT` grants only on those four tables. The migration adds no INSERT/UPDATE/DELETE for anon anywhere. The embedded-Postgres
tests assert that anon sees exactly the one public notice, the one public event and the published album — and nothing else.

Storage policies live on `storage.objects`: `gallery-public` is staff-only to write and the object name must match the generated pattern
(blocking `../` tricks and other extensions); `student-documents` is readable only by staff, the student, or a linked guardian, keyed on the
folder name (`document_student_id()` safely parses it). The test harness stubs `storage.buckets/objects` so these policies are executed,
not just read. The migration is a no-op (with a NOTICE) on a database without Supabase Storage.

## Phase 8: the only public write

`admission_applications` is insert-only for `anon` and `authenticated`: a column-level `GRANT INSERT (...)` limited to the form's fields, a
`WITH CHECK (status = 'SUBMITTED' AND reviewer fields null)` policy, **no SELECT grant** for `anon` (so an applicant — or an attacker — can never
read applications back; the app inserts without `.select()` for that reason), no DELETE for anyone, and staff-only select/update. Bot defence
is layered outside the database: a honeypot field in the form. **Not included, recommended before launch:** a CAPTCHA (e.g. Cloudflare Turnstile)
and an edge rate limit — a database cannot tell one anonymous caller from another, and a global per-hour cap would just let a bot lock real
applicants out.

Website content is plain text, rendered as text (React escapes it) — never HTML or Markdown — so an editor cannot inject script into the public site.

## Final hardening (0013) and the catalog invariants

Every `SECURITY DEFINER` helper is, by Postgres default, executable by everyone and therefore reachable as `/rest/v1/rpc/<name>`. Migration 0013
revokes EXECUTE on **all** public functions from `anon`/PUBLIC, re-grants it to signed-in users (policies and column defaults call these as the caller),
keeps `album_is_published` for anon (the public gallery policy needs it), keeps the three internal functions closed to everyone, and changes the default
privileges so a function added in a later migration starts closed.

Two things stop this from rotting. `tests/migrations.test.ts` ends with assertions that inspect the **catalog** rather than behaviour:
every public table has RLS on; `anon` holds exactly five table `SELECT`s and one column-limited `INSERT`; the only function `anon` can execute is
`album_is_published`; nobody can `DELETE` from the ledger, applications, site content or profiles. And those tests were verified to fail when the revoke
is removed (35 functions became anonymously callable).

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
SEED_ENV=development npm run seed   # creates 8 demo accounts and sample data for every module
npm run test:rls                    # tests/rls-smoke.test.ts — real anon-key network calls
```

The smoke tests cover the isolation guarantees the project brief calls mandatory. For `profiles`:

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
