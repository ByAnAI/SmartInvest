# Watchlist API (FastAPI)

Serves company lists (e.g. SP500) and current data from Yahoo Finance for the admin portal.

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## CSV paths

**`GET /api/lists/sp500`** loads tickers from **`backend/data/sp500.csv`** by default.

- Override: env **`SP500_INSTRUMENT_CSV`** (path relative to `backend/` or absolute).
- **`GET /api/lists/sp500/meta`** returns `{"path": "...", "count": N}` — quick check without downloading the full JSON array.

**`load_tickers()`** without a path still defaults to `backend/data/company_fundamentals.csv` for other uses; env **`CSV_PATH`** overrides that default.

## Run

```bash
uvicorn main:app --reload --port 8000
```

API base URL: `http://localhost:8000`

## Endpoints

- `GET /api/lists/sp500` – full company list from the S&P CSV; optional `?limit=N` (1–5000) for a shorter prefix
- `GET /api/financials/{ticker}` – current Yahoo Finance summary for one ticker
- `POST /api/financials/batch` – body `{"tickers": ["AAPL", "MSFT"]}`, returns current data for each (max 100)
- `GET /api/health` – health check
