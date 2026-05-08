-- Admin RLS using ONLY public.profiles.role = 'admin' (no auth.jwt() email).
-- In many Supabase setups auth.jwt() ->> 'email' is NULL in Postgres, so previous policies never matched.

create or replace function public.smartinvest_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where uid = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.smartinvest_is_admin() to authenticated;

create or replace function public.get_all_profiles_for_admin()
returns setof public.profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Inline check (same as smartinvest_is_admin): avoid calling INVOKER fn from DEFINER.
  if not exists (
    select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin'
  ) then
    return;
  end if;
  return query select * from public.profiles;
end;
$$;

grant execute on function public.get_all_profiles_for_admin() to authenticated;
grant execute on function public.get_all_profiles_for_admin() to service_role;

-- profiles
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select
  using (public.smartinvest_is_admin());

drop policy if exists "Admins can update any profile" on public.profiles;
create policy "Admins can update any profile"
  on public.profiles for update
  using (public.smartinvest_is_admin())
  with check (true);

drop policy if exists "Admins can delete any profile" on public.profiles;
create policy "Admins can delete any profile"
  on public.profiles for delete
  using (public.smartinvest_is_admin());

-- daily_watchlist + daily_watchlist_items (skip missing tables)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'daily_watchlist'
  ) then
    execute 'drop policy if exists "Admins can insert daily watchlist" on public.daily_watchlist';
    execute 'drop policy if exists "Admins can update daily watchlist" on public.daily_watchlist';

    execute $p$
      create policy "Admins can insert daily watchlist"
        on public.daily_watchlist for insert
        to authenticated
        with check (public.smartinvest_is_admin());
    $p$;

    execute $p$
      create policy "Admins can update daily watchlist"
        on public.daily_watchlist for update
        to authenticated
        using (public.smartinvest_is_admin())
        with check (true);
    $p$;
  end if;
end$$;

-- daily_watchlist_items (skip if table missing — migration order may vary)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'daily_watchlist_items'
  ) then
    execute 'drop policy if exists "Admins can insert daily watchlist items" on public.daily_watchlist_items';
    execute 'drop policy if exists "Admins can update daily watchlist items" on public.daily_watchlist_items';
    execute 'drop policy if exists "Admins can delete daily watchlist items" on public.daily_watchlist_items';

    execute $p$
      create policy "Admins can insert daily watchlist items"
        on public.daily_watchlist_items for insert
        to authenticated
        with check (public.smartinvest_is_admin());
    $p$;

    execute $p$
      create policy "Admins can update daily watchlist items"
        on public.daily_watchlist_items for update
        to authenticated
        using (public.smartinvest_is_admin())
        with check (true);
    $p$;

    execute $p$
      create policy "Admins can delete daily watchlist items"
        on public.daily_watchlist_items for delete
        to authenticated
        using (public.smartinvest_is_admin());
    $p$;
  end if;
end$$;
