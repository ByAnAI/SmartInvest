# Use password reset (and Google sign-in) on localhost instead of Netlify

If the reset link in the email still opens **https://smartinvet.netlify.app** instead of **http://localhost:3000**, Supabase is ignoring our redirect URL because it is not in the allow list.

## Do this in Supabase (required)

1. Open **[Supabase Dashboard](https://supabase.com/dashboard)** → your project.
2. Go to **Authentication** → **URL Configuration**.
3. Under **Redirect URLs**, add:
   - `http://localhost:3000`
   - `http://localhost:3001` (if you use that port)
   - `http://127.0.0.1:3000`
4. Click **Save**.

Optional for testing: set **Site URL** to `http://localhost:3000` so Supabase prefers localhost. You can change it back later for production.

## Then request a new reset email

1. Open your app at **http://localhost:3000** (run `npm run dev`).
2. Click **Sign In** → **Forgot Password?**.
3. Enter your email and click **Send Recovery Link**.
4. Use the **new** email you receive. Old emails still contain the previous redirect (Netlify).

The link in the new email will open **http://localhost:3000** as long as that URL is in Redirect URLs.
