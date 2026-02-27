-- Run this in Supabase SQL Editor if you get "Could not find the function public.get_all_profiles_for_admin".
-- Requires: public.profiles table already exists (run supabase-profiles-table.sql first if needed).

create or replace function public.get_all_profiles_for_admin()
returns setof public.profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where uid = auth.uid() and role = 'admin') then
    return;
  end if;
  return query select * from public.profiles;
end;
$$;

grant execute on function public.get_all_profiles_for_admin() to authenticated;
grant execute on function public.get_all_profiles_for_admin() to service_role;
