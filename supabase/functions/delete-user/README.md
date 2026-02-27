# delete-user Edge Function

Allows admins to delete a user from Auth (and thus from `profiles` via CASCADE).

## Deploy

```bash
supabase functions deploy delete-user
```

## Secrets

Set in Dashboard → Project Settings → Edge Functions → Secrets (or via CLI):

- `SUPABASE_SERVICE_ROLE_KEY` — from Dashboard → API → service_role (secret). Required for `auth.admin.deleteUser`.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are usually set by default for Edge Functions.

## Behavior

- Caller must be authenticated and have `role = 'admin'` in `profiles`.
- Body: `{ "uid": "<uuid>" }`.
- Returns 404 with `{ "error": "User not found" }` if the user is not in Auth (e.g. already deleted). The app then removes the profile row so the user disappears from the admin list.

## How to test

1. **From the app (recommended)**  
   - Sign in as admin (e.g. idris.elfeghi@byanai.com).  
   - Open the Admin panel and go to the “Other users” section.  
   - Click **Delete** on a test user and confirm.  
   - You should see “User deleted.” and the user should disappear. That user can no longer sign in.

2. **Call the function directly with curl**  
   - Use **`uid`** in the body (the auth user UUID), not `user_id`.  
   - You must send the admin JWT in the header or you get 401.  
   - Get the JWT: sign in to the app as admin → DevTools → Application → Local Storage → `sb-<project>-auth-token` → copy `access_token`.  
   - Replace `YOUR_ADMIN_JWT` and `USER_UUID_TO_DELETE`, then run:

   ```bash
   curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/delete-user" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_ADMIN_JWT" \
     -d '{"uid":"USER_UUID_TO_DELETE"}'
   ```  
   - Expected: `200` and `{"success":true}`. For a non-existent user: `404` and `{"error":"User not found"}`.
