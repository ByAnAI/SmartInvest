-- Align watchlist writes with app admin logic: profiles.role = 'admin' OR master admin email JWT.

drop policy if exists "Admins can insert daily watchlist" on public.daily_watchlist;
drop policy if exists "Admins can update daily watchlist" on public.daily_watchlist;

create policy "Admins can insert daily watchlist"
  on public.daily_watchlist for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  );

create policy "Admins can update daily watchlist"
  on public.daily_watchlist for update
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  )
  with check (true);

drop policy if exists "Admins can insert daily watchlist items" on public.daily_watchlist_items;
drop policy if exists "Admins can update daily watchlist items" on public.daily_watchlist_items;
drop policy if exists "Admins can delete daily watchlist items" on public.daily_watchlist_items;

create policy "Admins can insert daily watchlist items"
  on public.daily_watchlist_items for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  );

create policy "Admins can update daily watchlist items"
  on public.daily_watchlist_items for update
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  )
  with check (true);

create policy "Admins can delete daily watchlist items"
  on public.daily_watchlist_items for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  );
