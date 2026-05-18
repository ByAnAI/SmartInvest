# AGENTS/market_data_agent/agent.py
from data_loader import load_tickers, sp500_instrument_csv_path

def get_sp500_universe(limit=10):
    csv_path = sp500_instrument_csv_path()
    return load_tickers(csv_path=csv_path, limit=limit)


def fetch_market_data(symbol):
    return {
        "symbol": symbol,
        "price": 150,
        "volume": 100000
    }


def run(symbol):
    """
    Market Data Agent entry point
    """
    return fetch_market_data(symbol)
