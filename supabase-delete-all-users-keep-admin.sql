-- ONE-TIME CLEANUP: Delete all users EXCEPT the admin so they must sign up again.
-- After this, only idris.elfeghi@byanai.com can log in. Others will need to re-register.
-- Their profiles are removed automatically (profiles.uid → auth.users(id) ON DELETE CASCADE).
--
-- If this script runs with no error but users still appear in the app:
--   The SQL Editor often cannot DELETE from auth.users (restricted permissions).
--   Use one of these instead:
--
--   A) Dashboard: Authentication → Users → delete each user except idris.elfeghi@byanai.com
--
--   B) Admin API script (recommended):
--      SUPABASE_URL=https://YOUR_PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
--      node scripts/delete-all-users-keep-admin.mjs
--      (Get service_role from Dashboard → Project Settings → API; keep it secret.)
--
-- Before running: Ensure supabase-profiles-table.sql has been run (table, RLS, trigger
-- on_auth_user_created, and get_all_profiles_for_admin RPC) so new sign-ups get a profile
-- and appear in the admin panel.
--
-- This is destructive and cannot be undone.

-- Delete all auth users except the admin (by email)
-- (May affect 0 rows if the SQL Editor role cannot delete from auth.users.)
delete from auth.users
where email is null
   or lower(trim(email)) != 'idris.elfeghi@byanai.com';
