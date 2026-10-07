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
- [x] Dev seed script (`npm run seed`, `SEED_ENV=development`) — 8 demo accounts (5 in Phase 1, three more added later)
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

## Phase 3 — Attendance + Homework (done — awaiting verification against a live Supabase project)

- [x] Daily attendance (PRESENT/ABSENT/LATE/EXCUSED/LEAVE): teacher roster (section + date), student/parent summary, calendar and history
- [x] Homework: teachers post for their assigned (section, subject); students/parents see their section's items with overdue/due-today/upcoming
- [x] RLS + integrity triggers (enrollment match, no future dates, immutable identity, session-derived `marked_by`)
- [x] Embedded-Postgres tests incl. the upsert path; live smoke tests; `attendanceSummary` unit tests
- Not in Phase 3: homework attachments and student submissions (need a private Storage bucket + policies), per-period/per-subject attendance, attendance reports/export, absence notifications to guardians, editing homework in the UI

## Phase 4 — Exams, results, report cards (done — awaiting verification against a live Supabase project)

- [x] Configurable grading scales (Bangladesh default seeded); assessments of every kind in the brief; per-student results
- [x] Marks hidden from students/guardians until published; frozen for teachers after publishing; classmates never see each other
- [x] Teacher UI: create assessment, enter marks (absent supported), publish; student/parent results by term
- [x] Printable report card (per subject %, letter, GP, overall GPA, pass/fail), grading logic unit-tested
- Not in Phase 4: ranking/positions, weighted terms, comment/remark entry in the UI, PDF files (use print-to-PDF), editing the grading scale in the UI (edit rows)

## Phase 5 — Timetable (done — awaiting verification against a live Supabase project)

- [x] Configurable periods (incl. breaks), weekly lessons per section, optional teacher/room
- [x] Database-enforced: one lesson per slot, no teacher double-booking, teacher must hold the subject in that section, no lessons in breaks
- [x] Staff editor; teacher "my lessons"; student/parent grid for their child's section; grid builder unit-tested
- Not in Phase 5: drag-and-drop editing, substitution/cover teachers, exam timetables, calendar export

## Phase 6 — Fees, payments, receipts (done — awaiting verification against a live Supabase project)

- [x] Fee types, per-student and whole-section invoices, voiding; payments with all eight methods and five statuses
- [x] Ledger integrity in the database: no overpayment (row-locked), immutable amounts, no deletes, refunds keep history, server-generated receipt numbers
- [x] Bilingual printable receipt per the brief (large ৳ amount, "Payment Received Successfully"); student/parent fee views
- [x] Internal functions no longer callable through the API (also fixes Phase 1's `generate_display_id`)
- Not in Phase 6: live payment-gateway integration, server-rendered PDF files (print-to-PDF instead), fee discounts/waivers/late fees, SMS/email receipts

## Phase 7 — Notices, events, gallery (done — awaiting verification against a live Supabase project)

- [x] Audience-targeted notices (everyone / teachers / students / guardians, optionally one section), scheduling, expiry, pinning; events
- [x] First anonymous-readable data (`is_public` rows, published albums) with narrow explicit policies; anon can never write
- [x] Gallery in a PUBLIC bucket (staff-only write, images only, 5 MB, byte-sniffed validation, random server-chosen names)
- [x] PRIVATE `student-documents` bucket with policies and tests (staff all; student / linked guardian read own folder)
- Not in Phase 7: UI to upload/view student documents, notice read-receipts, push/SMS delivery, image resizing/thumbnails

## Phase 8 — Admissions, public website, CMS (done — awaiting verification against a live Supabase project)

- [x] Public site (no login): home, about, admissions form, news & events, gallery, contact — English/Bangla, mobile-first
- [x] Anonymous, insert-only admission applications (column-level grant + policy + CHECKs + honeypot); staff review queue with notes
- [x] Small plain-text CMS for the public pages, editable in both languages
- Not in Phase 8: CAPTCHA / edge rate limiting (recommended before launch), accepted-application → student conversion, applicant status lookup, rich-text editing, SEO sitemap

## Final hardening (migration 0013 + catalog invariants)

- [x] No public function is callable by anonymous visitors except `album_is_published`; future functions start closed
- [x] Catalog tests: every public table has RLS; anon table/column privileges are an exact allowlist; ledger/records are never deletable

## What is deliberately NOT built (the honest backlog)

- **Mobile app** (React Native / Expo) — separate project; the database already enforces every rule it would need.
- **Online payment gateways**, **email/SMS/push delivery**, **server-rendered PDFs** (print-to-PDF is used), **CAPTCHA/rate limiting** for the public form.
- UI to **edit/delete** most records after creation (create + status changes exist), **bulk import**, **pagination** on long lists, photo upload for people.
- **Student documents** upload/download UI (bucket and policies exist and are tested), **homework attachments and submissions**.
- Academic extras: per-period attendance, ranking/positions, weighted terms, fee discounts/late fees, substitute teachers, applicant→student conversion.
- A **second review of the SQL by a person** who did not write it, and a run of the whole suite against a real Supabase project, are the recommended acceptance steps.

## Working rules carried into every phase

- Never regenerate a previous phase's schema; only additive, reviewed migrations.
- RLS and server-side authorization are the security boundary — the frontend is UX only.
- Keep historical/academic data (soft delete via `status`, never hard-delete rows with history).
- Update `docs/database.md`, `docs/authorization.md`, `docs/rls.md` in the same PR as any schema
  or policy change.
