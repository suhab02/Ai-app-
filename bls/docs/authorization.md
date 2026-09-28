# Authorization

## Roles

`SUPER_ADMIN`, `ORGANIZER`, `TEACHER`, `STUDENT`, `PARENT` — a Postgres enum (`user_role`), not a
string, so nothing else is representable.

## The rule this whole layer exists to enforce

> A user must never be able to choose SUPER_ADMIN, ORGANIZER, or TEACHER and instantly receive
> those privileges. Privileged access requires school/admin authorization.

Enforced in three independent places, on purpose — defeating one still leaves the others standing:

1. **The signup UI** only ever offers STUDENT/PARENT as a choice (`signup-form.tsx`).
2. **The `on_auth_user_created` trigger** re-validates the requested role server-side and silently
   downgrades anything that isn't STUDENT/PARENT to STUDENT (see `docs/authentication.md`).
3. **The `enforce_profile_update` trigger** governs every later change to `role`/`status`:
   - `SUPER_ADMIN` may set any role.
   - `ORGANIZER` may set `TEACHER`/`STUDENT`/`PARENT`, but is rejected if it tries to grant
     `SUPER_ADMIN` or `ORGANIZER` ("Organizer cannot assign SUPER_ADMIN" from the brief, generalized
     to "cannot assign either admin-tier role").
   - A user who is still `PENDING` and currently `STUDENT`/`PARENT` may switch between those two
     (onboarding correction — e.g. a Google sign-in defaulted them to STUDENT and they're actually a
     parent). This branch can never produce `TEACHER`/`ORGANIZER`/`SUPER_ADMIN`.
   - Everyone else gets `not authorized to change role`.
   - Only `SUPER_ADMIN`/`ORGANIZER` may change `status` at all.
   - The Postgres `service_role` (server-only secret key — see `.env.example`) and the `postgres`
     role (direct database credentials: SQL editor, CLI, migrations) bypass these checks, the same
     way they already bypass RLS; this is what lets `scripts/seed.ts` create TEACHER/ORGANIZER/
     SUPER_ADMIN demo accounts, and what makes the break-glass first-SUPER_ADMIN promotion in
     `docs/deployment.md` work, without either one going through an admin UI that doesn't exist yet.

## Account status

`PENDING → ACTIVE` (or `INACTIVE`/`SUSPENDED`/`ARCHIVED`) — every new account starts `PENDING`
regardless of role. A `PENDING` or `SUSPENDED` user can still log in (so they can see *why* they're
blocked) but sees a status banner instead of dashboard content beyond their own profile; see
`src/components/status-banner.tsx` and `src/app/dashboard/page.tsx`.

## Phase 2 access matrix (enforced by RLS in migrations 0003–0005)

| Data | SUPER_ADMIN / ORGANIZER | TEACHER | STUDENT | PARENT | anon |
| --- | --- | --- | --- | --- | --- |
| academic years, classes, sections, subjects | read + write | read | read | read | none |
| students | read + write | only students actively enrolled in an assigned class/section | own record | only linked children | none |
| guardians | read + write | none | own linked guardians | own record | none |
| teachers | read + write | own record | none | none | none |
| student_enrollments | read + write | those in assigned class/sections | own | linked children's | none |
| student_guardians | read + write | none | own links | own links | none |
| teacher_assignments | read + write | own | for their class/section | for their child's class/section | none |

All writes to all Phase 2 tables are SUPER_ADMIN/ORGANIZER only. The admin pages (`/dashboard/admin/*`) call
`requireStaff()` and every Server Action in `src/lib/admin/actions.ts` calls it again before validating input with Zod;
RLS is the third, independent check. Nav visibility is UX only.

## Original scope notes (Phase 2+ targets)

- **ORGANIZER**: students, guardians, teachers, classes, sections, subjects, attendance, homework,
  results, timetable, fees, payments, notices, events, gallery, website content. Cannot assign
  SUPER_ADMIN (see above) or touch security settings/audit logs.
- **TEACHER**: only their assigned classes/sections/subjects/students. Cannot see unrelated
  students, manage users, or reach admin security.
- **STUDENT**: only their own profile/attendance/homework/results/timetable/notices/events/fees.
- **PARENT**: only their linked children (many-to-many via a future `student_guardians` table);
  never another guardian's child.

Phase 2 implements the people/class relationships above; attendance, homework, results and fees (Phase 3+) will reuse the same helper functions.

## Never trust the client

Every authorization decision above is re-derived server-side (trigger, RLS policy, or the DAL in
`src/lib/auth/dal.ts`). No code path in this app reads a role or status out of a client-supplied
value and acts on it.
