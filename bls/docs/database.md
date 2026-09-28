# Database

## Migrations

Plain SQL files under `supabase/migrations/`, applied in filename order:

- `0001_init.sql` — extensions, enum types (`user_role`, `account_status`), the `profiles` table,
  the `display_id_counters` table, `generate_display_id()`, the generic `set_updated_at()` trigger.
- `0002_rls.sql` — `current_profile_role()` helper, the `on_auth_user_created` auth trigger, the
  `enforce_profile_update` column-protection trigger, RLS policies, and table grants.

Every statement in both files is idempotent (`IF NOT EXISTS`, `DO` blocks catching
`duplicate_object`, `CREATE OR REPLACE`, `DROP ... IF EXISTS` before `CREATE`). Re-running either
file after a partial failure finishes the job instead of erroring on "already exists" — see
`docs/rls.md` for why that mattered here.

**Apply order matters**: `0001` must fully succeed before `0002` runs (`0002`'s trigger and
policies reference the `profiles` table and `user_role`/`account_status` types from `0001`).

## Schema (Phase 1)

### `profiles`

One row per `auth.users` row (FK `id → auth.users.id`, `on delete cascade`).

| Column          | Type            | Notes                                                        |
| --------------- | --------------- | -------------------------------------------------------------|
| `id`             | `uuid` PK        | Same value as `auth.users.id`. The only relational key.      |
| `display_id`     | `text` unique    | `BLS-<A\|O\|T\|S\|G>-00001`. Display only, never a join key.  |
| `role`           | `user_role`      | `SUPER_ADMIN \| ORGANIZER \| TEACHER \| STUDENT \| PARENT`    |
| `status`         | `account_status` | `PENDING \| ACTIVE \| INACTIVE \| SUSPENDED \| ARCHIVED`      |
| `full_name`, `full_name_bn`, `email`, `phone`, `avatar_url` | `text` | |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` auto-maintained by trigger |

### `display_id_counters`

Internal only (no client access — see `docs/rls.md`). One row per role, incremented atomically by
`generate_display_id(role)` to hand out `BLS-<prefix>-00001`, `...-00002`, etc. Prefixes:
`SUPER_ADMIN → A`, `ORGANIZER → O`, `TEACHER → T`, `STUDENT → S`, `PARENT → G`.

## Design choices worth knowing

- **UUID PK + separate display ID**: `profiles.id` is what every future foreign key
  (`student_enrollments.student_id`, etc.) points to. `display_id` is human-facing only and is
  never used to join tables — exactly as the project brief requires.
- **No hard deletes**: there is no DELETE policy on `profiles` and no delete grant. Deactivating an
  account means setting `status = 'ARCHIVED'` (or `SUSPENDED`/`INACTIVE`), which preserves history
  for any future table that references the profile.
- **Enums over free text**: `role` and `status` are Postgres enums, not strings, so an invalid value
  is a database-level error, not a bug waiting to happen in application code.

## Regenerating TypeScript types

`src/lib/supabase/types.ts` is currently hand-written to mirror the SQL above. Once the Supabase CLI
is linked to a real project, replace it with the generated output instead of maintaining it by hand:

```bash
supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
```
