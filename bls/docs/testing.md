# Testing

## Local checks (no live Supabase project needed)

```bash
npm run lint        # eslint (next/core-web-vitals + next/typescript)
npm run typecheck   # tsc --noEmit
npm run build       # next build (catches most SSR/RSC mistakes too)
```

## Against a real Supabase project

1. Create a project, then apply the migrations in order — either paste each file into the SQL
   editor, or `supabase db push` if you have the CLI linked. **Order matters**: `0001_init.sql`
   before `0002_rls.sql` (see `docs/rls.md`).
2. In the Supabase dashboard, enable the Google provider under Authentication → Providers, and add
   your app's `/auth/callback` URL (both local and deployed) to the redirect allow-list.
3. Copy `.env.example` to `.env.local` and fill in the project URL, anon key, and service-role key.
4. `SEED_ENV=development npm run seed` — creates five demo accounts:

   | Role | Email | Password |
   | --- | --- | --- |
   | SUPER_ADMIN | `admin@brightlearning.test` | `Passw0rd!23` |
   | ORGANIZER | `organizer@brightlearning.test` | `Passw0rd!23` |
   | TEACHER | `teacher@brightlearning.test` | `Passw0rd!23` |
   | STUDENT | `student@brightlearning.test` | `Passw0rd!23` |
   | PARENT | `parent@brightlearning.test` | `Passw0rd!23` |

   These are seed-only, non-production credentials by design — see the `SEED_ENV` guard in
   `scripts/seed.ts`, which refuses to run without it.
5. `npm run test:rls` — the RLS smoke tests in `tests/rls-smoke.test.ts` (see `docs/rls.md` for what
   they check).
6. Manual pass: `npm run dev`, log in as each demo account, confirm:
   - The dashboard shows the right role badge and the right set of module cards
     (`src/app/dashboard/page.tsx`'s `ROLE_MODULES`).
   - Signing up a brand-new account only ever offers Student/Guardian, and the new account shows a
     "pending review" banner until an admin activates it.
   - The language switcher toggles every visible string between English and Bangla, immediately.

## What "Phase 1 passes" means

- `npm run build` succeeds.
- All demo accounts can log in and land on a dashboard scoped to their role.
- `npm run test:rls` passes against the live project.
- No table, policy, or trigger requires a manual dashboard click that isn't documented in
  `docs/deployment.md`.
