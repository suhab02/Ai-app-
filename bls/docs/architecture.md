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
    app/                    App Router routes
      page.tsx               public landing page
      (auth)/login/          email+password / Google login
      (auth)/signup/         self-service signup (STUDENT/PARENT only)
      auth/callback/route.ts OAuth code exchange
      dashboard/              protected, role-aware shell
    components/
      ui/                    Button, Input, Card, Badge — generic, no domain logic
      auth/                  login/signup forms, Google button
      dashboard/             Sidebar, BottomNav
      profile-menu.tsx, status-banner.tsx, language-switcher.tsx
    lib/
      supabase/              client.ts (browser), server.ts (SSR), env.ts, types.ts
      auth/                  dal.ts (Data Access Layer), actions.ts, schemas.ts
      i18n/                  dictionaries, provider, locale cookie
      utils/
    proxy.ts                 optimistic session refresh + redirect (was middleware.ts)
  supabase/
    migrations/               0001_init.sql, 0002_rls.sql
    seed/                     (reserved for SQL fixtures; the seed script itself is scripts/seed.ts)
  scripts/seed.ts             creates 5 demo accounts (one per role)
  tests/rls-smoke.test.ts     cross-role RLS isolation tests (real network calls)
  docs/                       this folder
```

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

## Scope of this phase

Phase 1 ships: project scaffold, the `profiles` table, roles/status, display IDs, RLS, email/password
+ Google auth, a locale switcher (English/Bangla), and one role-aware dashboard shell per role. It
deliberately does **not** ship students/teachers/guardians/classes tables, attendance, homework,
results, fees, etc. — that's Phase 2 onward, per `docs/development-plan.md`.
