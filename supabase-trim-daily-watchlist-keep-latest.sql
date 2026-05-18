-- Run once in Supabase Dashboard → SQL Editor (runs as postgres; bypasses RLS).
-- Deletes every row in public.daily_watchlist except the newest snapshot by created_at.
-- Rows in public.daily_watchlist_items referencing removed watchlists are removed via ON DELETE CASCADE.

WITH keeper AS (
  SELECT id
  FROM public.daily_watchlist
  ORDER BY created_at DESC NULLS LAST, id DESC
  LIMIT 1
)
DELETE FROM public.daily_watchlist dw
WHERE NOT EXISTS (SELECT 1 FROM keeper k WHERE k.id = dw.id);

-- Sanity: optional counts after run
-- SELECT count(*) FROM public.daily_watchlist;
-- SELECT count(*) FROM public.daily_watchlist_items;
