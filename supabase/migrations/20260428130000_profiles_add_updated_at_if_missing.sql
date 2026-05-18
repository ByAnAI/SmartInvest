-- Older `profiles` tables may lack `updated_at`, which PostgREST then omits from the schema cache.
-- Safe to run once; no-op if the column already exists.
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now();
