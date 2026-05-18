-- Run this ENTIRE script in Supabase SQL Editor (Dashboard → SQL Editor).
-- Shared bulletin: all authenticated users can read and create posts.
-- Authors can delete their own posts; master admin email or profiles.role = 'admin' can delete any.
-- Safe to run more than once.

create table if not exists public.news_board_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  author_uid uuid not null references auth.users(id) on delete cascade,
  author_email text not null default '',
  author_display_name text,
  created_at timestamptz not null default now()
);

create index if not exists news_board_posts_created_at_idx
  on public.news_board_posts (created_at desc);

alter table public.news_board_posts enable row level security;

drop policy if exists "authenticated read news board" on public.news_board_posts;
drop policy if exists "authenticated insert news board" on public.news_board_posts;
drop policy if exists "author or admin delete news board" on public.news_board_posts;

create policy "authenticated read news board"
  on public.news_board_posts for select
  to authenticated
  using (true);

create policy "authenticated insert news board"
  on public.news_board_posts for insert
  to authenticated
  with check (auth.uid() = author_uid);

create policy "author or admin delete news board"
  on public.news_board_posts for delete
  to authenticated
  using (
    auth.uid() = author_uid
    or coalesce(lower(auth.jwt() ->> 'email'), '') = 'admin@bts.com'
    or exists (
      select 1 from public.profiles p
      where p.uid = auth.uid() and p.role = 'admin'
    )
  );
