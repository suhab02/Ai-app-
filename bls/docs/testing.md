# Testing

## Local checks (no live Supabase project needed)

```bash
npm run lint        # eslint (next/core-web-vitals + next/typescript)
npm run typecheck   # tsc --noEmit
npm run build       # next build (catches most SSR/RSC mistakes too)
```

## Migration + RLS tests (no Supabase needed)

```bash
npm test            # embedded Postgres (migrations twice + isolation) and attendance-summary unit tests
```

## Against a real Supabase project

1. Create a project, then apply the migrations (`0001`…`0012`) in order — either paste each file into the SQL
   editor, or `supabase db push` if you have the CLI linked. **Order matters**: `0001_init.sql`
   before `0002_rls.sql` (see `docs/rls.md`).
2. In the Supabase dashboard, enable the Google provider under Authentication → Providers, and add
   your app's `/auth/callback` URL (both local and deployed) to the redirect allow-list.
3. Copy `.env.example` to `.env.local` and fill in the project URL, anon key, and service-role key.
4. `SEED_ENV=development npm run seed` — creates eight demo accounts:

   | Role | Email | Password |
   | --- | --- | --- |
   | SUPER_ADMIN | `admin@brightlearning.test` | `Passw0rd!23` |
   | ORGANIZER | `organizer@brightlearning.test` | `Passw0rd!23` |
   | TEACHER | `teacher@brightlearning.test` | `Passw0rd!23` |
   | STUDENT | `student@brightlearning.test` | `Passw0rd!23` |
   | PARENT | `parent@brightlearning.test` | `Passw0rd!23` |
   | STUDENT (2nd) | `student2@brightlearning.test` | `Passw0rd!23` |
   | PARENT (2nd) | `parent2@brightlearning.test` | `Passw0rd!23` |
   | TEACHER (2nd, unassigned) | `teacher2@brightlearning.test` | `Passw0rd!23` |

   The seed also creates 5 days of attendance for both students and two homework items for 5-A (`schoolDate()` = Asia/Dhaka).

   It also creates 2025-2026 / Class 5 (sections A, B) / 4 subjects; Tanvir is in 5-A (parent Shirin), Rafi in 5-B
   (parent Kamal), teacher Nusrat teaches 5-A only. Re-running the seed is safe (upserts).

   These are seed-only, non-production credentials by design — see the `SEED_ENV` guard in
   `scripts/seed.ts`, which refuses to run without it.
5. `npm run test:rls` — the RLS smoke tests in `tests/rls-smoke.test.ts` (see `docs/rls.md` for what
   they check).
6. Manual pass: `npm run dev`, log in as each demo account, confirm:
   - The dashboard shows the right role badge and the right set of module cards
     (`src/app/dashboard/page.tsx`'s `ROLE_MODULES`).
   - Signing up a brand-new account only ever offers Student/Guardian, and the new account shows a
     "pending review" banner until an admin activates it.
   - Admin/Organizer: `/dashboard/admin/users` activates a PENDING signup; an Organizer's role dropdown never offers
     Super Admin/Organizer; academic/people/enrollment pages create and link records.
   - Student sees only their class; parent sees only their child; teacher sees only 5-A and its students.
   - Teacher (`teacher@`): Attendance → pick 5-A → mark → Save; 5-B is not offered. Homework → only 5-A Mathematics / English can be posted.
   - Student/parent: Attendance shows summary cards, a month calendar and history; Homework shows 5-A items (student2/parent2 see none).
   - Try editing the URL: `?section=<5-B id>` as the teacher shows no roster; students cannot load a roster.
   - Results: student/parent see Class Test 1 (Math 42/50, English 38/50) and a printable report card; the draft Monthly Exam is hidden.
     As the teacher, open Results → the draft exam → Publish; then try editing marks (rejected) — staff can still correct them.
   - Report card: Results → "Report card" → Print / save as PDF (sidebar and header are hidden in print).
   - Timetable: staff pick 5-A and see the seeded week; adding a lesson with a teacher not assigned that subject, or double-booking
     a teacher, shows the database's error. Student/parent see 5-A's grid; student2/parent2 (5-B) see none; the teacher sees "My lessons".
   - Fees: staff create a fee type/invoice, record a payment (try over-paying: refused), refund one (row stays, balance frees up). Parent/student see
     only their invoices; open a receipt → bilingual layout with ৳ amount; Print / save as PDF. A teacher has no Fees entry.
   - Notices: staff post a section-only notice (5-A) — parent/student of 5-A see it, 5-B does not; a students-only notice is hidden from parents.
     Mark one "show on the public website" (Phase 8 page) — logged-out visitors can read only those.
   - Gallery (`/dashboard/gallery`, staff): create an album, upload a JPG/PNG/WebP (a renamed .exe or a >5 MB file is refused), publish it.
   - Public site (log out, open `/`): hero, latest public news, upcoming public events and gallery photos; switch language. Submit `/admissions`
     with a bad phone number (refused) and a good one (thank-you). As staff, `/dashboard/admin/admissions` shows it; change its status.
     `/dashboard/admin/website` edits the home/about/contact/admissions text in English and Bangla.
   - The language switcher toggles every visible string between English and Bangla, immediately.

## What "Phase 1 passes" means

- `npm run build` succeeds.
- All demo accounts can log in and land on a dashboard scoped to their role.
- `npm run test:rls` passes against the live project.
- No table, policy, or trigger requires a manual dashboard click that isn't documented in
  `docs/deployment.md`.
