 import pandas as pd

CSV_PATH = "/home/idris/Desktop/SmartInvest/backend/data/sp500.csv"


def get_sp500_universe(limit=None):
    """
    Loads tickers from local S&P500 CSV file.
    Expected column: 'Symbol' or 'symbol'
    """

    df = pd.read_csv(CSV_PATH)

    # normalize column name
    if "Symbol" in df.columns:
        tickers = df["Symbol"].tolist()
    elif "symbol" in df.columns:
        tickers = df["symbol"].tolist()
    else:
        raise ValueError("CSV must contain 'Symbol' or 'symbol' column")

    # clean tickers
    tickers = [t.strip() for t in tickers if isinstance(t, str)]

    if limit:
        return tickers[:limit]

    return tickers