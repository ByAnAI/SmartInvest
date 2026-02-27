-- Run in Supabase SQL Editor if your profiles table has camelCase columns and you get schema errors.
-- This renames columns to snake_case so the app (which uses snake_case) works.

alter table public.profiles rename column "displayName" to display_name;
alter table public.profiles rename column "isVerified" to is_verified;
alter table public.profiles rename column "lastLogin" to last_login;
alter table public.profiles rename column "createdAt" to created_at;
alter table public.profiles rename column "updatedAt" to updated_at;
