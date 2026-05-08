-- Align profiles admin policies and get_all_profiles_for_admin() with App.tsx / watchlist RLS:
-- admin = public.profiles.role = 'admin' OR master email in JWT (admin@bts.com).
-- Without this, delegated admins (role in DB, non-master email) cannot list or manage users;
-- master account can also get an empty RPC result if JWT email claim is missing but profile.role slipped to 'user'.

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

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  );

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  )
  with check (true);

drop policy if exists "Admins can delete any profile" on public.profiles;
create policy "Admins can delete any profile"
  on public.profiles for delete
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  );
