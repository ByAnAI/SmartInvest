-- Run this in Supabase SQL Editor if you get "Could not find the function public.get_all_profiles_for_admin",
-- or if the admin user list is empty for delegated admins (role = 'admin' in profiles but not admin@bts.com).
-- Requires: public.profiles table already exists (run supabase-profiles-table.sql first if needed).
-- Must match: supabase/migrations/20260428120000_profiles_admin_rls_and_rpc.sql

create or replace function public.get_all_profiles_for_admin()
returns setof public.profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  ) then
    return;
  end if;
  return query select * from public.profiles;
end;
$$;

grant execute on function public.get_all_profiles_for_admin() to authenticated;
grant execute on function public.get_all_profiles_for_admin() to service_role;
