# Development plan

Work proceeds phase by phase. Each phase must be verified (build passes, RLS smoke tests pass,
manual demo-account check) before the next one starts, and always waits for explicit go-ahead.

## Phase 1 — Foundation (this delivery)

- [x] Next.js + TypeScript + Tailwind scaffold (`bls/`)
- [x] Supabase client/server/proxy wiring
- [x] `profiles` table: UUID PK, unique display ID (`BLS-<prefix>-#####`), `role`, `status`
- [x] RLS: row-level (own row, or SUPER_ADMIN/ORGANIZER) + trigger-enforced column rules
      (role/status changes gated by actor role; id/display_id immutable)
- [x] Auth: email/password + Google OAuth, self-service signup restricted to STUDENT/PARENT
- [x] i18n: English + Bangla dictionaries, cookie-based switcher
- [x] One role-aware dashboard shell (SUPER_ADMIN, ORGANIZER, TEACHER, STUDENT, PARENT)
- [x] Base UI kit: Button, Input, Card, Badge, LanguageSwitcher, ProfileMenu, StatusBanner,
      Sidebar/BottomNav
- [x] Dev seed script (`npm run seed`, `SEED_ENV=development`) — 5 demo accounts
- [x] RLS smoke tests (`npm run test:rls`) — real network calls, no service-role key
- [x] Docs (this set), `.env.example`

**Explicitly out of scope for Phase 1:** students, guardians, teachers, classes, sections, subjects,
enrollment, attendance, homework, exams, results, timetable, fees, payments, receipts, notices,
events, gallery, admissions, public website content, mobile app.

## Phase 2 — Core school data model (done — awaiting verification against a live Supabase project)

- [x] `academic_years`, `classes`, `sections`, `subjects`
- [x] `students`, `guardians`, `teachers` (optional profile link, role-checked by trigger)
- [x] `student_enrollments` (keeps history), `student_guardians` (many-to-many), `teacher_assignments`
- [x] RLS: relationship-scoped reads via SECURITY DEFINER helpers; staff-only writes
- [x] Admin UI: user management (activate/suspend/role), academic setup, people, enrollment & links
- [x] Student/parent/teacher dashboards show their real class/children/assignments
- [x] Embedded-Postgres migration + RLS test (`npm test`) and live smoke tests (`npm run test:rls`)
- Not in Phase 2: editing/deleting records in the UI, photo/document uploads, bulk import, pagination

## Phase 3+ (not started; requires explicit "Start Phase 3")

Attendance → Homework → Exams/Results/Report cards → Timetable → Fees/Payments/Receipts →
Notices/Events/Gallery → Admissions/public website/CMS → React Native/Expo mobile app.

## Working rules carried into every phase

- Never regenerate a previous phase's schema; only additive, reviewed migrations.
- RLS and server-side authorization are the security boundary — the frontend is UX only.
- Keep historical/academic data (soft delete via `status`, never hard-delete rows with history).
- Update `docs/database.md`, `docs/authorization.md`, `docs/rls.md` in the same PR as any schema
  or policy change.
