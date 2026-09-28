# Authentication

Supabase Auth, two providers:

- **Email/password** — `src/lib/auth/actions.ts` (`signup`, `login`, `logout`), validated with Zod
  (`src/lib/auth/schemas.ts`) before ever reaching Supabase.
- **Google OAuth** — `src/components/auth/google-button.tsx` kicks off
  `supabase.auth.signInWithOAuth({ provider: "google" })` from the browser (it needs
  `window.location.origin` for the redirect, so this one is a Client Component, not a Server
  Action). `src/app/auth/callback/route.ts` exchanges the returned code for a session.

## What happens on signup, step by step

1. User submits the signup form with a requested role of **STUDENT or PARENT only** (the form
   doesn't offer any other option — see `src/components/auth/signup-form.tsx`) — or arrives via
   Google, which sends no role at all.
2. `supabase.auth.signUp()` / the OAuth flow creates a row in `auth.users`, with
   `requested_role` (if any) stashed in `raw_user_meta_data`.
3. The `on_auth_user_created` trigger (`supabase/migrations/0002_rls.sql`) fires **inside the
   database**, reads `requested_role`, accepts it only if it's exactly `STUDENT` or `PARENT`, and
   otherwise defaults to `STUDENT`. It creates the `profiles` row with `status = 'PENDING'`.
4. The user can log in immediately, but sees a "pending review" banner
   (`src/components/status-banner.tsx`) until a SUPER_ADMIN or ORGANIZER changes their status to
   `ACTIVE`.

**Why the trigger, not application code:** a Server Action can be skipped by anyone calling the
Supabase REST/GraphQL API directly with a valid anon key (which is public by design). A database
trigger on `auth.users` cannot be skipped — it fires no matter which client created the row.

## Session verification

- `src/proxy.ts` — optimistic only. Reads the session cookie, does a fast redirect for obviously
  logged-out requests hitting `/dashboard/*`. Runs on every request, so it deliberately never
  queries the database.
- `src/lib/auth/dal.ts` — the real check. `verifySession()` calls
  `supabase.auth.getClaims()`, which verifies the JWT rather than trusting whatever's in the
  cookie. `getCurrentProfile()` builds on it to load the caller's own profile row (itself subject
  to RLS). Every dashboard route goes through this file, not through `proxy.ts`.

`getClaims()` was chosen over the older `getSession()` per Supabase's own guidance (see
`node_modules/@supabase/ssr/README.md` and `node_modules/@supabase/auth-js`): `getSession()` reads
an unverified value out of storage, while `getClaims()`/`getUser()` verify it.

## Demo accounts

`npm run seed` (with `SEED_ENV=development`) creates one account per role — see
`docs/testing.md`. Passwords are dev-only and documented there deliberately; they are not secrets.
