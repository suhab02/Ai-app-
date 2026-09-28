# Bright Learning School

A bilingual (English/বাংলা) school management platform — public website, admin/organizer/teacher/
student/guardian portals, attendance, homework, exams, results, fees, and more, built phase by
phase. This repository is currently on **Phase 3: Attendance + Homework** (on top of Phase 1 foundation and Phase 2 school data model: students, guardians, teachers, classes, enrollment, user management) — see `docs/development-plan.md` for
what's built and what's next.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, RLS) · Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project's URL/keys
npm run dev
```

Apply the database migrations and seed demo accounts before logging in — see
`docs/testing.md` for the full walkthrough. Short version:

```bash
# In the Supabase SQL editor, in order:
#   supabase/migrations/0001_init.sql … 0007_homework.sql

SEED_ENV=development npm run seed   # 8 demo accounts (every role, plus a second student/parent/teacher for isolation tests)
npm run test:rls                    # RLS smoke tests
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Applies migrations to an embedded Postgres and asserts RLS isolation, plus unit tests (no Supabase needed) |
| `npm run seed` | Create demo accounts (requires `SEED_ENV=development`) |
| `npm run test:rls` | RLS smoke tests against a live Supabase project |

## Documentation

- `docs/architecture.md` — stack, directory layout, where authorization actually happens
- `docs/development-plan.md` — phase-by-phase roadmap
- `docs/database.md` — schema and migration notes
- `docs/authentication.md` — signup/login/OAuth flow
- `docs/authorization.md` — roles, status, and how privilege escalation is blocked
- `docs/rls.md` — Row Level Security policies and the migration failure they fix
- `docs/testing.md` — how to verify a Phase locally and against Supabase
- `docs/deployment.md` — Supabase + Vercel setup, including one-time manual steps

## Security notes

- Self-registration (email/password or Google) can only ever produce a `STUDENT` or `PARENT`
  account, and it always starts `PENDING`. Privileged roles (`TEACHER`, `ORGANIZER`, `SUPER_ADMIN`)
  can only be granted by an authorized admin — see `docs/authorization.md`.
- Authorization is enforced server-side at every layer (Data Access Layer + Postgres RLS +
  triggers), never trusted from the client. See `docs/architecture.md`.
- Never commit `.env.local` or any real Supabase key. `SUPABASE_SERVICE_ROLE_KEY` is server-only and
  is used by exactly one script (`scripts/seed.ts`).
