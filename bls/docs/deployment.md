# Deployment

## Supabase project setup (manual, one-time)

1. Create a project at supabase.com.
2. SQL editor → run `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_rls.sql`, in
   that order. Re-running either is safe (see `docs/rls.md`).
3. Authentication → Providers → enable **Google**; add your Google OAuth client ID/secret (from
   Google Cloud Console). Add redirect URLs for every environment you'll use:
   - `http://localhost:3000/auth/callback` (local dev)
   - `https://<your-vercel-domain>/auth/callback` (production)
4. Authentication → URL Configuration → set the Site URL to your production domain.
5. Project Settings → API → copy the Project URL, `anon` `public` key, and `service_role` key into
   your environment variables (never commit the service-role key).

## Vercel

1. Import the repository, set the **Root Directory** to `bls/` (this app lives in a subdirectory of
   the git repo, not at the repo root).
2. Environment variables (Project Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — only if a server-only script/route in a later phase needs it;
     nothing in Phase 1's request path uses it. Never mark it as exposed to the browser.
3. Build command / output: defaults (`next build`) are correct — nothing custom is configured.
4. Do **not** set `SEED_ENV=development` in the Vercel project. That variable exists solely to keep
   `scripts/seed.ts` from ever running against a real environment by accident; it has no other use
   and should not be present outside a local `.env.local` or a throwaway staging project.

## What's still manual after this phase

- Google OAuth client creation/config (Google Cloud Console) — not something a migration can do.
- Promoting the first real SUPER_ADMIN: every self-registered account starts as
  STUDENT/PENDING or PARENT/PENDING (see `docs/authorization.md`), so the very first admin has to be
  created by hand — run this once, directly in the Supabase SQL editor, against your own new
  account's row, using the `service_role`-equivalent SQL editor connection:

  ```sql
  update public.profiles set role = 'SUPER_ADMIN', status = 'ACTIVE' where email = 'you@example.com';
  ```

  (The SQL editor connects as the `postgres` role, which `enforce_profile_update` explicitly trusts
  — see `docs/rls.md` — precisely so this one break-glass path works. It requires direct database
  access, not the app, and is not reachable through the public API.)
