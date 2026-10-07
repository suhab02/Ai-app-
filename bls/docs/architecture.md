# Architecture

## Stack

- **Next.js 16** (App Router, `src/` layout) — see `AGENTS.md` / `node_modules/next/dist/docs` for
  what changed vs. older Next.js: `middleware.ts` is gone, replaced by `src/proxy.ts` exporting a
  `proxy` function.
- **TypeScript**, strict mode.
- **Tailwind CSS v4** — CSS-first config in `src/app/globals.css` (`@theme` block), no
  `tailwind.config.js`.
- **Supabase** — Postgres, Auth (email/password + Google OAuth), Row Level Security.
- **Vercel** (deployment target — see `docs/deployment.md`).

## Directory layout

```
bls/
  src/
    app/                         App Router routes
      (public)/                   the public website — no login: / , about, admissions, events, gallery, contact
      (auth)/login, signup        email+password / Google; self-service signup is STUDENT/PARENT only
      auth/callback/route.ts      OAuth code exchange
      dashboard/                  protected, role-aware portal
        attendance, homework, results (+ [id], report/[studentId]), timetable, fees (+ receipt/[paymentId]), notices, gallery
        admin/                    staff only: users, academic, people, relationships, admissions, website
    components/
      ui/                         Button, Input, Select, Card, Badge — generic, no domain logic
      admin/ attendance/ results/ timetable/ public/ school/ dashboard/ auth/   feature components
      profile-menu, status-banner, language-switcher, print-button
    lib/
      supabase/                   client.ts (browser), server.ts (SSR), env.ts, types.ts (hand-written Row types)
      auth/                       dal.ts (Data Access Layer: verifySession, requireRole, requireStaff), actions, schemas
      server-actions.ts           shared Server Action plumbing: runStaff (guard → Zod → one DB op), fields, friendly errors
      school/                     date (Asia/Dhaka), labels, resolve (section → class+year), assignment-options, section-subject
      <module>/                   attendance, homework, results, timetable, fees, notices, gallery, admissions, site, admin:
                                  actions.ts ("use server") plus pure, unit-tested logic (summary, grading, report-card, grid, money, upload)
      i18n/                       dictionaries (en, bn), provider, locale cookie
    proxy.ts                      optimistic session refresh + redirect (was middleware.ts)
  supabase/migrations/            0001 … 0013, plain idempotent SQL
  scripts/seed.ts                 8 demo accounts + sample data for every module (SEED_ENV=development, service role)
  tests/
    migrations.test.ts            applies every migration twice to embedded Postgres, then ~340 isolation/integrity assertions
    *.test.ts                     unit tests for the pure logic
    rls-smoke.test.ts             the same guarantees against a live Supabase project (needs env; not run by `npm test`)
  docs/                           this folder
```

## Module map

| Module | Tables (migration) | Who writes | Notes |
| --- | --- | --- | --- |
| Identity | `profiles` (0001–0002) | admins; self only for contact fields | role/status changes gated by trigger |
| School structure | years, classes, sections, subjects, students, guardians, teachers, enrollments, links, assignments (0003–0005) | staff | enrollment history kept |
| Attendance | `attendance_records` (0006) | staff, the section's teachers | daily, 5 statuses |
| Homework | `homework` (0007) | staff, the subject's teacher | |
| Results | `grading_scales`, `assessments`, `assessment_results` (0008) | staff, the subject's teacher | hidden until published; frozen after |
| Timetable | `timetable_periods`, `timetable_entries` (0009) | staff | teacher clash prevented in the database |
| Fees | `fee_types`, `invoices`, `payments` (0010) | staff | a ledger: no overpay, no delete, server receipt numbers |
| Notices / events / gallery | `notices`, `events`, `gallery_*` + 2 Storage buckets (0011) | staff | first anonymous-readable data |
| Admissions / website | `admission_applications`, `site_content` (0012) | public submits; staff review/edit | only public write path |
| Function privileges | (0013) | — | anon may call exactly one function |

## Request flow and where authorization actually happens

1. **`src/proxy.ts`** runs on every request. It refreshes the Supabase session cookie and does one
   *optimistic* check: no session + `/dashboard/*` → redirect to `/login`. It never queries the
   database. This is a UX shortcut only — see the Next.js docs' explicit warning that Proxy "should
   not be used as a full session management or authorization solution."
2. **`src/lib/auth/dal.ts`** (Data Access Layer) is the real gate. Every Server Component /
   Server Action / Route Handler that needs to know who's calling goes through `verifySession()` or
   `getCurrentProfile()`, which verify the JWT (`supabase.auth.getClaims()`) and load the profile row
   through the same Postgres connection RLS applies to.
3. **Postgres RLS** (`supabase/migrations/0002_rls.sql`) is the last and most important layer: even
   if application code had a bug, a direct REST/SQL call from a browser's dev tools still can't read
   or write rows it isn't allowed to. See `docs/rls.md`.

Nothing in this app trusts a role value sent from the client. The client can *request* a role at
signup (STUDENT/PARENT only); the database decides what it actually gets.

## Why `proxy.ts` and not `middleware.ts`

The installed Next.js version (16.3.6) deprecated `middleware.ts` in favor of `proxy.ts` (same
runtime, renamed file/export — see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
Functionality is identical; only the name changed.

## What is not here

The React Native / Expo mobile app is a separate project; it can use the same Supabase backend because every rule lives in the database (RLS,
triggers), not in this web app. Payment-gateway integration, server-rendered PDFs, CAPTCHA and the other deferred items are listed in
`docs/development-plan.md`.
