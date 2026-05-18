-- New users get email_confirmed_at set immediately so they can sign in without clicking a confirmation link.
-- Local: applied on `supabase db reset` / fresh start. Hosted: run in SQL Editor only if your project allows triggers on auth.users,
-- or instead use Dashboard → Authentication → Providers → Email → Confirm email = OFF.

CREATE OR REPLACE FUNCTION public.smartinvest_auto_confirm_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL AND NEW.email IS NOT NULL THEN
    NEW.email_confirmed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS smartinvest_auto_confirm_email ON auth.users;

CREATE TRIGGER smartinvest_auto_confirm_email
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.smartinvest_auto_confirm_email();
