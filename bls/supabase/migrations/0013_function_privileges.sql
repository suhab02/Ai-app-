-- Bright Learning School — final hardening: who may call which function
-- Depends on 0001–0012. Idempotent.
--
-- Postgres (and Supabase's default privileges) make every new function executable by everyone,
-- and Supabase exposes public-schema functions as /rest/v1/rpc/<name>. Migration 0010 closed that
-- for the three functions that mattered most; this closes it for all of them:
--   * nothing in the public schema is callable by `anon` or PUBLIC, except the single helper that an
--     anonymous gallery policy needs;
--   * signed-in users keep EXECUTE, because RLS policies and column defaults call these helpers
--     with the caller's privileges;
--   * future functions are closed by default too, so a new phase cannot reopen the hole by forgetting.
-- Trigger functions need no EXECUTE for the user whose statement fires them.

revoke execute on all functions in schema public from public, anon;

-- Only anon-facing policy that calls a function: gallery_photos_select_public (published album check).
grant execute on function public.album_is_published(uuid) to anon;

-- Signed-in users: every helper the policies and defaults use (idempotent re-grant, so this file also
-- works on databases where authenticated did not already hold default EXECUTE).
grant execute on all functions in schema public to authenticated;

-- ...except the internal ones that must never be callable through the API (see 0010).
revoke execute on function public.next_receipt_no() from authenticated;
revoke execute on function public.invoice_paid_total(uuid, uuid) from authenticated;
revoke execute on function public.generate_display_id(public.user_role) from authenticated;

-- Column defaults such as `assigned_date default school_today()` run as the inserting role, so trusted
-- tooling (the seed script, running as service_role) needs these two as well.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.school_today(), public.default_grading_scale_id() to service_role;
  end if;
end
$$;

-- New functions created by the migration role start closed.
alter default privileges in schema public revoke execute on functions from public, anon;
