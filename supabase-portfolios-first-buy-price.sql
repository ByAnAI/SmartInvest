-- Immutable per-share price at first vault purchase (separate from blended avg_cost).
-- Run once in Supabase SQL Editor if portfolios already exists.

alter table public.portfolios
  add column if not exists first_buy_price numeric;

update public.portfolios
set first_buy_price = avg_cost
where first_buy_price is null;

comment on column public.portfolios.first_buy_price is 'Per-share price at first purchase; unchanged when adding shares (avg_cost blends).';
