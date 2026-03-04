# Watchlist API (FastAPI)

Serves company lists (e.g. SP500) and current data from Yahoo Finance for the admin portal.

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## CSV path

The SP500 list is read from a CSV with columns: `Ticker`, `Company`, `Sector`, `Location`, `Industry`, `Website`.

- Default path: `backend/data/company_fundamentals.csv`
- Override: set env `CSV_PATH` to your file, e.g.  
  `export CSV_PATH=/home/idris/Desktop/signaling_system/data/company_fundamentals.csv`

Copy or symlink your CSV to `backend/data/`, or run with `CSV_PATH` set.

## Run

```bash
uvicorn main:app --reload --port 8000
```

API base URL: `http://localhost:8000`

## Endpoints

- `GET /api/lists/sp500?limit=100` – company list (tickers + metadata), optional limit for short list
- `GET /api/financials/{ticker}` – current Yahoo Finance summary for one ticker
- `POST /api/financials/batch` – body `{"tickers": ["AAPL", "MSFT"]}`, returns current data for each (max 50)
- `GET /api/health` – health check
