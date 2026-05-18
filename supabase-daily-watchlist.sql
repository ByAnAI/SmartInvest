-- Run this ENTIRE script in Supabase SQL Editor (Dashboard → SQL Editor).
-- Only admin can create/update the watchlist; all authenticated users can read it.
-- You can run it more than once (it is idempotent).

-- 1) Create the table
create table if not exists public.daily_watchlist (
  id uuid primary key default gen_random_uuid(),
  watchlist_date date not null default (current_date at time zone 'utc')::date,
  symbols text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 2) Allow multiple watchlists per day (keep history by timestamp)
drop index if exists daily_watchlist_date_idx;
alter table if exists public.daily_watchlist
  drop constraint if exists daily_watchlist_watchlist_date_key;

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

-- 6) Only admins can insert (matches App.tsx: master email OR profiles.role = admin)
create policy "Admins can insert daily watchlist"
  on public.daily_watchlist for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  );

-- 7) Only admins can update
create policy "Admins can update daily watchlist"
  on public.daily_watchlist for update
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
  )
  with check (true);

-- 8) Snapshot rows for fast read in AI Analysis (saved data, no live fetch needed)
create table if not exists public.daily_watchlist_items (
  watchlist_id uuid not null references public.daily_watchlist(id) on delete cascade,
  watchlist_date date not null,
  symbol text not null,
  company text,
  sector text,
  industry text,
  location text,
  current_price numeric,
  total_assets numeric,
  total_liabilities numeric,
  total_revenue numeric,
  net_income numeric,
  operating_cash_flow numeric,
  free_cash_flow numeric,
  iv_dcf numeric,
  iv_ri numeric,
  iv_multiples numeric,
  iv_quality_score numeric,
  iv_ensemble numeric,
  iv_upside_pct numeric,
  torchlight_score numeric,
  torchlight_rank_factors text,
  torchlight_momentum numeric,
  torchlight_valuation_edge numeric,
  torchlight_quality numeric,
  torchlight_growth numeric,
  torchlight_sentiment numeric,
  torchlight_macro_fit numeric,
  torchlight_execution_feasibility numeric,
  torchlight_risk_adjusted_alpha numeric,
  torchlight_capital_efficiency numeric,
  torchlight_analyst_drift numeric,
  ctr_total_return numeric,
  ctr_price_return numeric,
  ctr_cash_return numeric,
  ctr_annualized numeric,
  torchlight_ctr_score numeric,
  risk_daily_return_mean numeric,
  risk_volatility_daily numeric,
  risk_volatility_annual numeric,
  risk_sharpe numeric,
  risk_sortino numeric,
  risk_max_drawdown numeric,
  risk_var_95_hist numeric,
  risk_var_99_hist numeric,
  risk_var_95_param numeric,
  risk_var_99_param numeric,
  risk_cvar_95 numeric,
  risk_beta numeric,
  risk_summary_score numeric,
  created_at timestamptz not null default now(),
  primary key (watchlist_id, symbol)
);

-- Ensure new metric columns exist on already-created tables.
alter table if exists public.daily_watchlist_items add column if not exists torchlight_score numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_rank_factors text;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_momentum numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_valuation_edge numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_quality numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_growth numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_sentiment numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_macro_fit numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_execution_feasibility numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_risk_adjusted_alpha numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_capital_efficiency numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_analyst_drift numeric;
alter table if exists public.daily_watchlist_items add column if not exists ctr_total_return numeric;
alter table if exists public.daily_watchlist_items add column if not exists ctr_price_return numeric;
alter table if exists public.daily_watchlist_items add column if not exists ctr_cash_return numeric;
alter table if exists public.daily_watchlist_items add column if not exists ctr_annualized numeric;
alter table if exists public.daily_watchlist_items add column if not exists torchlight_ctr_score numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_daily_return_mean numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_volatility_daily numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_volatility_annual numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_sharpe numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_sortino numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_max_drawdown numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_var_95_hist numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_var_99_hist numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_var_95_param numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_var_99_param numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_cvar_95 numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_beta numeric;
alter table if exists public.daily_watchlist_items add column if not exists risk_summary_score numeric;

-- Backward-compatible migration for existing deployments:
alter table if exists public.daily_watchlist_items
  add column if not exists watchlist_id uuid;

update public.daily_watchlist_items dwi
set watchlist_id = dw.id
from public.daily_watchlist dw
where dwi.watchlist_id is null
  and dwi.watchlist_date = dw.watchlist_date;

delete from public.daily_watchlist_items where watchlist_id is null;
alter table if exists public.daily_watchlist_items
  alter column watchlist_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_watchlist_items_watchlist_id_fkey'
  ) then
    alter table public.daily_watchlist_items
      add constraint daily_watchlist_items_watchlist_id_fkey
      foreign key (watchlist_id) references public.daily_watchlist(id) on delete cascade;
  end if;
end$$;

alter table if exists public.daily_watchlist_items
  drop constraint if exists daily_watchlist_items_pkey;
alter table if exists public.daily_watchlist_items
  add constraint daily_watchlist_items_pkey primary key (watchlist_id, symbol);

alter table public.daily_watchlist_items enable row level security;

drop policy if exists "Authenticated can read daily watchlist items" on public.daily_watchlist_items;
drop policy if exists "Admins can insert daily watchlist items" on public.daily_watchlist_items;
drop policy if exists "Admins can update daily watchlist items" on public.daily_watchlist_items;
drop policy if exists "Admins can delete daily watchlist items" on public.daily_watchlist_items;

create policy "Authenticated can read daily watchlist items"
  on public.daily_watchlist_items for select
  to authenticated
  using (true);

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
