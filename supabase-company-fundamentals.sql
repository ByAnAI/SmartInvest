-- Company fundamentals: fixed reference data. Only admins can insert/update/delete; all authenticated users can read.
-- Run this in Supabase SQL Editor, then load data with: node scripts/load-company-fundamentals.mjs

create table if not exists public.company_fundamentals (
  ticker text primary key,
  company text not null default '',
  sector text not null default '',
  location text not null default '',
  industry text not null default '',
  website text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.company_fundamentals enable row level security;

-- Anyone authenticated can read
drop policy if exists "Authenticated can read company_fundamentals" on public.company_fundamentals;
create policy "Authenticated can read company_fundamentals"
  on public.company_fundamentals for select
  to authenticated
  using (true);

-- Only admins can insert
drop policy if exists "Admins can insert company_fundamentals" on public.company_fundamentals;
create policy "Admins can insert company_fundamentals"
  on public.company_fundamentals for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
  );

-- Only admins can update
drop policy if exists "Admins can update company_fundamentals" on public.company_fundamentals;
create policy "Admins can update company_fundamentals"
  on public.company_fundamentals for update
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
  )
  with check (true);

-- Only admins can delete
drop policy if exists "Admins can delete company_fundamentals" on public.company_fundamentals;
create policy "Admins can delete company_fundamentals"
  on public.company_fundamentals for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
  );

-- Keep updated_at in sync on update
create or replace function public.company_fundamentals_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists company_fundamentals_updated_at on public.company_fundamentals;
create trigger company_fundamentals_updated_at
  before update on public.company_fundamentals
  for each row execute procedure public.company_fundamentals_updated_at();

comment on table public.company_fundamentals is 'Reference data from company_fundamentals.csv; only admins can change it.';
