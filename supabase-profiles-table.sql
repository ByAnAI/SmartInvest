-- Run this ENTIRE script in Supabase SQL Editor (Dashboard → SQL Editor).
-- Creates the profiles table and an RPC so admins always see all users in the admin panel.
--
-- If you still see NO USERS: run this full script (including section 9). Section 9 adds
-- get_all_profiles_for_admin() so the app can list all users for admins regardless of RLS.

-- 1) Create profiles table (snake_case - run this if your table has different columns)
create table if not exists public.profiles (
  uid uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default 'Investor',
  status text not null default 'active' check (status in ('active', 'disabled')),
  role text not null default 'user' check (role in ('user', 'admin')),
  is_verified boolean not null default false,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  watchlist text[] default '{}'
);

-- 2) Enable RLS
alter table public.profiles enable row level security;

-- 3) Everyone can read their own profile (so login and admin check work)
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = uid);

-- 4) Admins can read ALL profiles (so the admin panel user list works)
create policy "Admins can read all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.uid = auth.uid() and p.role = 'admin'
    )
  );

-- 5) Allow insert so new sign-ups can create their profile (app does this in initializeUser)
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = uid);

-- 6) Users can update their own profile; admins can update any profile
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = uid)
  with check (auth.uid() = uid);

create policy "Admins can update any profile"
  on public.profiles for update
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
  )
  with check (true);

-- 7) Admins can delete any profile (for "remove user" in admin panel)
create policy "Admins can delete any profile"
  on public.profiles for delete
  using (
    exists (select 1 from public.profiles p where p.uid = auth.uid() and p.role = 'admin')
  );

-- 8) Optional: trigger to create a profile when a new user signs up (so they appear in the list immediately)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (uid, email, display_name, status, role, is_verified, last_login, created_at, updated_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1), 'Investor'),
    'active',
    case when new.email = 'idris.elfeghi@byanai.com' then 'admin' else 'user' end,
    coalesce((new.raw_user_meta_data->>'email_verified')::boolean, false),
    now(),
    now(),
    now()
  )
  on conflict (uid) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 9) RPC so admins always get the full user list (bypasses RLS for this read)
create or replace function public.get_all_profiles_for_admin()
returns setof public.profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where uid = auth.uid() and role = 'admin') then
    return;
  end if;
  return query select * from public.profiles;
end;
$$;

grant execute on function public.get_all_profiles_for_admin() to authenticated;
grant execute on function public.get_all_profiles_for_admin() to service_role;
