-- Run this in Supabase SQL Editor (Dashboard → SQL Editor) if the portfolios table does not exist.
-- This ensures each user's portfolio persists after logout and is scoped by user_id.

create table if not exists public.portfolios (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  shares numeric not null default 1,
  avg_cost numeric not null default 0,
  primary key (user_id, symbol)
);

-- Allow authenticated users to read/insert/update/delete only their own rows
alter table public.portfolios enable row level security;

create policy "Users can read own portfolio"
  on public.portfolios for select
  using (auth.uid() = user_id);

create policy "Users can insert own portfolio"
  on public.portfolios for insert
  with check (auth.uid() = user_id);

create policy "Users can update own portfolio"
  on public.portfolios for update
  using (auth.uid() = user_id);

create policy "Users can delete own portfolio"
  on public.portfolios for delete
  using (auth.uid() = user_id);

-- Optional: support both column names (avg_cost in DB, app uses avgCost via mapping)
comment on column public.portfolios.avg_cost is 'Average cost per share; app may send as avgCost';
