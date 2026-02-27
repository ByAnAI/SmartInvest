-- Run this ENTIRE script in Supabase SQL Editor (Dashboard → SQL Editor).
-- Only admin can create/update the watchlist; all authenticated users can read it.
-- You can run it more than once (it is idempotent).

-- 1) Create the table
create table if not exists public.daily_watchlist (
  id uuid primary key default gen_random_uuid(),
  watchlist_date date not null unique default (current_date at time zone 'utc')::date,
  symbols text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 2) Unique index for upsert by date
create unique index if not exists daily_watchlist_date_idx on public.daily_watchlist (watchlist_date);

-- 3) Enable RLS
alter table public.daily_watchlist enable row level security;

-- 4) Drop existing policies so this script can be re-run safely
drop policy if exists "Authenticated can read daily watchlist" on public.daily_watchlist;
drop policy if exists "Authenticated can insert daily watchlist" on public.daily_watchlist;
drop policy if exists "Authenticated can update daily watchlist" on public.daily_watchlist;
drop policy if exists "Admins can insert daily watchlist" on public.daily_watchlist;
drop policy if exists "Admins can update daily watchlist" on public.daily_watchlist;

-- 5) All authenticated users can read (view only)
create policy "Authenticated can read daily watchlist"
  on public.daily_watchlist for select
  to authenticated
  using (true);

-- 6) Only admins can insert
create policy "Admins can insert daily watchlist"
  on public.daily_watchlist for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
  );

-- 7) Only admins can update
create policy "Admins can update daily watchlist"
  on public.daily_watchlist for update
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
  )
  with check (true);
