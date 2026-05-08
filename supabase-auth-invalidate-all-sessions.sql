-- Sign everyone out (refresh tokens). Does NOT remove or “clear” passwords.
-- Run in Supabase Dashboard → SQL Editor if you want all devices to re-authenticate.
-- Optional companion to scripts/bulk-password-recovery.mjs (password reset links).

DELETE FROM auth.sessions;
