# Deployment

## Supabase project setup (manual, one-time)

1. Create a project at supabase.com.
2. SQL editor → run every file in `supabase/migrations/` **in filename order, `0001` through `0013`**. Re-running any of them is
   safe (see `docs/rls.md`). `0011` also creates the two Storage buckets (`gallery-public`, `student-documents`) and their policies — you
   do not need to create buckets by hand. Afterwards, Storage should show both, with `student-documents` marked *private*.
3. Authentication → Providers → enable **Google**; add your Google OAuth client ID/secret (from
   Google Cloud Console). Add redirect URLs for every environment you'll use:
   - `http://localhost:3000/auth/callback` (local dev)
   - `https://<your-vercel-domain>/auth/callback` (production)
4. Authentication → URL Configuration → set the Site URL to your production domain.
5. Project Settings → API → copy the Project URL, `anon` `public` key, and `service_role` key into
   your environment variables (never commit the service-role key).
6. Authentication → Attack Protection: turn on CAPTCHA (see "Before you launch") and review the rate limits.

## Vercel

1. Import the repository, set the **Root Directory** to `bls/` (this app lives in a subdirectory of
   the git repo, not at the repo root).
2. Environment variables (Project Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — **not needed by the running app at all**; only `scripts/seed.ts` uses it, locally. Leave it out of Vercel.
3. Build command / output: defaults (`next build`) are correct. `next.config.ts` raises the Server Action body limit to 6 MB (gallery
   images are up to 5 MB); the upload action still enforces 5 MB itself.
4. Do **not** set `SEED_ENV=development` in the Vercel project. That variable exists solely to keep
   `scripts/seed.ts` from ever running against a real environment by accident.
5. The seed script creates accounts with a known password (`docs/testing.md`). Run it only against a development/staging project, never production.

## What's still manual

- Google OAuth client creation/config (Google Cloud Console) — not something a migration can do.
- Promoting the first real SUPER_ADMIN: every self-registered account starts as
  STUDENT/PENDING or PARENT/PENDING (see `docs/authorization.md`), so the very first admin has to be
  created by hand — run this once, directly in the Supabase SQL editor, against your own new
  account's row:

  ```sql
  update public.profiles set role = 'SUPER_ADMIN', status = 'ACTIVE' where email = 'you@example.com';
  ```

  (The SQL editor connects as the `postgres` role, which `enforce_profile_update` explicitly trusts
  — see `docs/rls.md` — precisely so this one break-glass path works. It requires direct database
  access, not the app, and is not reachable through the public API.)
- Editing the starter website text (Dashboard → Website), the grading-scale grade points if the school uses different ones
  (`grading_scale_bands`), the school's contact details, and the academic structure (Dashboard → Academic).

## Before you launch (recommended, not built)

| Item | Why |
| --- | --- |
| **CAPTCHA on the admission form** (e.g. Cloudflare Turnstile) and an edge rate limit (Vercel / Cloudflare) | The admission form is the only public write. The database already limits *what* a visitor can write, but cannot tell one anonymous caller from another, so volume control has to live at the edge. A global per-hour cap in SQL would just let a bot lock real applicants out. |
| **Payment gateway** (bKash / Nagad / Rocket / card) | Phase 6 *records* payments staff collect. Taking money online needs merchant credentials and a webhook route that inserts `PENDING → PAID` rows through the same ledger triggers. |
| **Email/SMS delivery** | Receipts, notices and absence alerts are shown in the app only. |
| **Backups & point-in-time recovery** | Turn on in Supabase (paid plans). This system holds minors' records and fee ledgers. |
| **Custom SMTP** for Supabase Auth emails | The built-in sender is heavily rate-limited and not for production. |
| **Run `npm run test:rls` against the real project** | The embedded-Postgres tests prove the SQL; this proves your project's actual configuration. |
| **Privacy review** | Student `medical_notes`, DOB, addresses and guardian contacts are personal data of children; confirm retention and consent rules with the school/lawyer. |
