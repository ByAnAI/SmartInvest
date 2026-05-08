-- Run in Supabase SQL Editor: store first acquisition time per vault position (for P/L history).
-- Safe to run once; idempotent.

alter table public.portfolios
  add column if not exists opened_at timestamptz;

update public.portfolios
set opened_at = coalesce(opened_at, now())
where opened_at is null;

alter table public.portfolios
  alter column opened_at set default now();

comment on column public.portfolios.opened_at is 'UTC timestamp of the **most recent** vault purchase (`addStock`); updated on every buy.';
