# Bright Learning School

A bilingual (English / বাংলা), mobile-first school management platform: a public website, and role-based portals for
administrators, teachers, students and guardians.

**Status:** all planned web modules are built (Phases 1–8). They are verified locally — build, lint, types, and an embedded-Postgres
test-suite that exercises every migration and access rule — but **not yet run against a live Supabase project**. See
[`docs/testing.md`](docs/testing.md) for the acceptance steps and [`docs/development-plan.md`](docs/development-plan.md) for what is deliberately not built.

## What it does

| Area | Highlights |
| --- | --- |
| Public website | Home, about, news & events, gallery, contact, admission application form; plain-text CMS editable in both languages |
| Accounts | Email/password and Google sign-in; self-registration can only ever create a pending Student/Guardian account; privileged roles are granted by admins |
| School setup | Academic years, classes, sections, subjects; students, guardians, teachers; enrollment history; guardian ↔ child links; teacher assignments |
| Attendance | Teacher roster (5 statuses) → student/parent summary, percentage, calendar and history |
| Homework | Posted by the subject's teacher; students/parents see overdue / due today / upcoming |
| Results | Configurable grading scale (Bangladesh default); marks hidden until published; printable report card with GPA |
| Timetable | Weekly grid per section; a teacher cannot be double-booked |
| Fees | Invoices (per student or whole section), payments in 8 methods, refunds, bilingual printable receipts |
| Notices & events | Targeted to everyone / teachers / students / guardians / one section; scheduling, expiry, pinning, public flag |
| Gallery | Public bucket (staff upload, validated images only) and a separate private bucket for student documents |

Roles: `SUPER_ADMIN`, `ORGANIZER`, `TEACHER`, `STUDENT`, `PARENT`. School-friendly IDs (`BLS-S-00001`, …) are display-only; UUIDs are the keys.

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · Supabase (Postgres, Auth, Storage, RLS) · Vercel

## Getting started

```bash
npm install
cp .env.example .env.local        # fill in your Supabase project's URL and keys
npm run dev
```

1. In the Supabase SQL editor run `supabase/migrations/0001_init.sql` … `0013_function_privileges.sql`, in order (each is safe to re-run).
2. `SEED_ENV=development npm run seed` — 8 demo accounts (every role) plus sample data for every module. **Development projects only.**
3. `npm run test:rls` — the access rules, checked against your real project.

Full walkthrough, demo logins and a manual checklist: [`docs/testing.md`](docs/testing.md). Production setup: [`docs/deployment.md`](docs/deployment.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` | **No Supabase needed.** Applies every migration twice to an embedded Postgres, then asserts the isolation and integrity rules, plus unit tests |
| `npm run seed` | Demo accounts + sample data (requires `SEED_ENV=development` and the service-role key) |
| `npm run test:rls` | The same guarantees against a live Supabase project |

## How security works (short version)

- **The database is the boundary.** Row Level Security, triggers and column-level grants enforce every rule; the web app's checks are a second layer and a UX
  convenience. A request that skips the UI and talks to the API directly gets the same answers.
- **Self-registration can't grant privilege.** A trigger on `auth.users` accepts only STUDENT/PARENT and starts every account as PENDING; role and status changes are
  gated by another trigger.
- **Relationship-scoped reads.** A parent sees only their linked children; a teacher only their assigned sections; a student only themselves — and classmates'
  marks are never visible.
- **Ledgers are append-only.** Payments can't be deleted or edited (amount, invoice, receipt number), can't overpay an invoice (row-locked), and receipt
  numbers come from the database.
- **Public access is minimal and explicit.** Anonymous visitors can read only published/public rows and can write one thing: an admission application, via
  column-limited insert. They can call exactly one database function.
- **No secrets in the client.** The service-role key is used by the seed script only and never by the running app.

Details: [`docs/rls.md`](docs/rls.md), [`docs/authorization.md`](docs/authorization.md), [`docs/authentication.md`](docs/authentication.md).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — layout, request flow, module map
- [`docs/database.md`](docs/database.md) — schema and migrations
- [`docs/authentication.md`](docs/authentication.md) · [`docs/authorization.md`](docs/authorization.md) · [`docs/rls.md`](docs/rls.md)
- [`docs/testing.md`](docs/testing.md) · [`docs/deployment.md`](docs/deployment.md) · [`docs/development-plan.md`](docs/development-plan.md)

> This project uses a version of Next.js newer than most documentation: `middleware.ts` is `proxy.ts`, and `AGENTS.md` points at the bundled docs in
> `node_modules/next/dist/docs/`.
