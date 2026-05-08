# SmartInvest

SmartInvest is a React + TypeScript + Supabase investment research app with:

- email/password authentication (no email verification in local setup),
- admin dashboard for user management and watchlist creation,
- FastAPI + Yahoo Finance data enrichment,
- AI analysis for ticker/sector insights,
- portfolio health and risk metrics.

## Quick Start (Local)

### 1) Clone and install frontend dependencies

```bash
git clone <your-repo-url>
cd SmartInvest
npm install
```

### 2) Configure environment variables

Create `.env` from `.env.example` and fill values:

```bash
cp .env.example .env
```

Required values are documented in `.env.example`.

### 3) Start local Supabase

```bash
supabase start
```

This project is configured with email confirmations disabled locally in `supabase/config.toml`:

- `auth.email.enable_confirmations = false`

### 4) Provision/update admin account

Run this after `supabase start`:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY=\"\\(.*\\)\"/\\1/p')" \
ADMIN_EMAIL=admin@bts.com \
ADMIN_PASSWORD='abCD123!@#' \
node scripts/set-admin-user.mjs
```

### 5) Start backend Watchlist API

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 6) Start frontend

In a second terminal:

```bash
cd SmartInvest
npm run dev
```

Open the local URL shown by Vite (usually `http://localhost:3000` or `http://localhost:3001`).

## Admin and User Behavior

- Any user can sign up with email/password.
- Email verification is disabled in local Supabase config.
- Master admin email defaults to `admin@bts.com`.
- Admin can create watchlists and perform admin functions.
- Regular users can perform user functions (portfolio, AI analysis, etc.).

## Included Initialization Data (CSV)

Required CSV files are already committed in this repo:

- `backend/data/company_fundamentals.csv`
- `components/S&P500_instrument.csv`
- `components/nasdaq_list.csv`
- `components/top_20_crypto.csv`
- `components/top_30_forex.csv`

No extra spreadsheet download is required after clone.

## User Manual

See `USER_MANUAL.md` for a step-by-step guide you can share with testers.

## Hosted Deployment Checklist

For hosted testing, share this minimal checklist with testers:

1. In Supabase Dashboard, disable email confirmation:
   - Authentication -> Providers -> Email -> **Confirm email = OFF**
2. Add frontend URLs to redirect allow list:
   - Authentication -> URL Configuration -> **Redirect URLs**
3. Set hosted `.env` values:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GEMINI_API_KEY`, `VITE_WATCHLIST_API_URL`
4. Seed admin user:

```bash
SUPABASE_URL="https://<your-project-ref>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>" \
ADMIN_EMAIL="admin@bts.com" \
ADMIN_PASSWORD='abCD123!@#' \
node scripts/set-admin-user.mjs
```
