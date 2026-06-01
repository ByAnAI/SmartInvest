# AGENTS/market_data_agent/agent.py

import yfinance as yf


def fetch_market_data(symbol):
    try:
        ticker = yf.Ticker(symbol)
        data = ticker.history(period="1d")

        if data.empty:
            return {"symbol": symbol, "error": "No data"}

        latest = data.iloc[-1]

        return {
            "symbol": symbol,
            "price": float(latest["Close"]),
            "volume": int(latest["Volume"]),
            "date": latest.name.date()
        }

    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


def run(symbols):
    """
    Accepts:
    - single symbol: "AAPL"
    - list: ["AAPL", "MSFT"]
    """

    if isinstance(symbols, str):
        symbols = [symbols]

    results = []
    for symbol in symbols:
        results.append(fetch_market_data(symbol))

    return results


if __name__ == "__main__":
    print(run(["AAPL", "MSFT"]))

    