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

## Phase 2 — Core school data model (not started; requires explicit "Start Phase 2")

- `academic_years`, `classes`, `sections`, `subjects`
- `students`, `guardians`, `teachers` (profile extensions)
- `student_enrollments` (keeps enrollment history — never overwrite a student's class)
- `student_guardians` (many-to-many, `is_primary`, `can_pick_up`, `receives_notifications`)
- `teacher_assignments` (class/section/subject, `is_class_teacher`)
- User management UI for SUPER_ADMIN/ORGANIZER (activate PENDING accounts, assign roles within
  their authority, link guardians to students)

## Phase 3+ (future, order not yet fixed)

Attendance → Homework → Exams/Results/Report cards → Timetable → Fees/Payments/Receipts →
Notices/Events/Gallery → Admissions/public website/CMS → React Native/Expo mobile app.

## Working rules carried into every phase

- Never regenerate a previous phase's schema; only additive, reviewed migrations.
- RLS and server-side authorization are the security boundary — the frontend is UX only.
- Keep historical/academic data (soft delete via `status`, never hard-delete rows with history).
- Update `docs/database.md`, `docs/authorization.md`, `docs/rls.md` in the same PR as any schema
  or policy change.
