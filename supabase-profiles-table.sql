-- Run this in Supabase SQL Editor (Dashboard → SQL Editor).
-- Creates the profiles table so the app can store user metadata and the admin panel can list users.
--
-- If you see NO USERS in the admin panel, it's usually because:
-- 1. The profiles table doesn't exist yet → run this entire script.
-- 2. RLS is blocking reads: only "read own profile" exists, so you only see yourself. Add the
--    "Admins can read all profiles" policy (see section 4 below).
-- 3. No rows in profiles: sign in once so initializeUser creates your profile; the trigger
--    below will also create profiles for new sign-ups.
--
-- If the table already exists with different column names, you may only need to add the RLS policies.

-- 1) Create profiles table (matches app: uid, email, displayName, status, role, etc.)
create table if not exists public.profiles (
  uid uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  "displayName" text not null default 'Investor',
  status text not null default 'active' check (status in ('active', 'disabled')),
  role text not null default 'user' check (role in ('user', 'admin')),
  "isVerified" boolean not null default false,
  "lastLogin" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
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
  insert into public.profiles (uid, email, "displayName", status, role, "isVerified", "lastLogin", "createdAt", "updatedAt")
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
