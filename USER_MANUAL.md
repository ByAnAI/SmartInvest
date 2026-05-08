# SmartInvest User Manual

## Purpose

This guide helps a tester run SmartInvest locally, sign in, and verify admin/user workflows.

## Prerequisites

- Node.js 20+
- Python 3.10+ (3.12 recommended)
- Supabase CLI
- Git

## 1) Clone and Install

```bash
git clone <your-repo-url>
cd SmartInvest
npm install
```

## 2) Configure `.env`

Create `.env` and populate keys from your private email/package:

```bash
cp .env.example .env
```

At minimum, set the Supabase and Gemini values in `.env.example`.

## 3) Start Supabase (Local Stack)

```bash
supabase start
```

This project is already configured for email/password sign-in without email verification in local mode (`supabase/config.toml`):

- `auth.email.enable_confirmations = false`

## 4) Create/Update Admin Account

Run once after Supabase starts:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY=\"\\(.*\\)\"/\\1/p')" \
ADMIN_EMAIL=admin@bts.com \
ADMIN_PASSWORD='abCD123!@#' \
node scripts/set-admin-user.mjs
```

## 5) Start Watchlist Backend API

Open terminal A:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Keep this terminal running.

## 6) Start Frontend

Open terminal B:

```bash
cd SmartInvest
npm run dev
```

Open the Vite URL shown in terminal output.

## 7) Login and Role Testing

### Admin login

- Email: `admin@bts.com`
- Password: `abCD123!@#`

Expected:

- Admin can open Admin Dashboard.
- Admin can create watchlist.
- Admin can manage users.

### Regular user login

- Sign up using any new email/password.
- No email confirmation should be required in local setup.
- User gets user features only (no admin controls).

## 8) Create Watchlist (Admin)

1. Log in as admin.
2. Open Admin Dashboard.
3. Click watchlist creation action.
4. Wait for completion.

If you see `Cannot reach the Watchlist API at http://localhost:8000`, ensure backend terminal A is still running.

## 9) Data Files Included in Repo

These initialization files are already committed:

- `backend/data/company_fundamentals.csv`
- `components/S&P500_instrument.csv`
- `components/nasdaq_list.csv`
- `components/top_20_crypto.csv`
- `components/top_30_forex.csv`

No extra CSV download is required.

## 10) Hosted Supabase Note (Important)

If testing against hosted Supabase (not local), disable email confirmation in Supabase Dashboard:

1. Authentication -> Providers -> Email
2. Turn OFF "Confirm email"
3. Save

Then run `scripts/set-admin-user.mjs` using hosted `SUPABASE_URL` and hosted service role key.

## 11) Hosted Deployment Checklist (For Tester Email)

Use this exact checklist when testers run against a hosted Supabase project:

1. **Supabase Project Settings**
   - Authentication -> Providers -> Email -> turn OFF **Confirm email**
   - Authentication -> URL Configuration -> add your frontend URLs to **Redirect URLs**
     - Example: `https://your-frontend-domain.com`
     - Example: `http://localhost:3000` (if testers also run local frontend)
2. **Frontend Environment**
   - In `.env`, set:
     - `VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co`
     - `VITE_SUPABASE_ANON_KEY=<your-anon-key>`
     - `VITE_GEMINI_API_KEY=<your-gemini-key>`
     - `VITE_WATCHLIST_API_URL=<your-backend-url>`
3. **Seed Admin User (hosted)**
   - Run from project root:

```bash
SUPABASE_URL="https://<your-project-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>" \
ADMIN_EMAIL="admin@bts.com" \
ADMIN_PASSWORD='abCD123!@#' \
node scripts/set-admin-user.mjs
```

4. **Verification**
   - Admin can log in with `admin@bts.com` and create watchlists.
   - New users can sign up and log in with email/password without email verification.
