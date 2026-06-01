import yfinance as yf

# ---------------------------
# SAFE PRICE
# ---------------------------
def get_price(ticker):
    try:
        price = ticker.info.get("currentPrice")
        if price:
            return price

        hist = ticker.history(period="1d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])

        return None

    except Exception:
        return None


# ---------------------------
# SAFE LOOKUP (FIXED)
# ---------------------------
def safe_get(df, key):
    try:
        if df is None or df.empty:
            return None

        if key not in df.index:
            return None

        row = df.loc[key]

        # handle both Series/DataFrame cases
        if hasattr(row, "iloc"):
            return float(row.iloc[0])

        return float(row)

    except Exception:
        return None


# ---------------------------
# CASHFLOW FIXED
# ---------------------------
def safe_cashflow(cf):
    try:
        if cf is None or cf.empty:
            return None

        candidates = [
            "Operating Cash Flow",
            "Total Cash From Operating Activities",
            "Cash Flow From Operating Activities"
        ]

        for key in candidates:
            if key in cf.index:
                row = cf.loc[key]
                if hasattr(row, "iloc"):
                    return float(row.iloc[0])

        return None

    except Exception:
        return None


# ---------------------------
# MAIN RUN
# ---------------------------
def run(symbol: str):
    print(f"📊 Fetching fundamentals for {symbol}")

    ticker = yf.Ticker(symbol)

    info = ticker.info or {}
    financials = ticker.financials
    cashflow = ticker.cashflow
    balance_sheet = ticker.balance_sheet

    data = {
        "symbol": symbol,

        # price
        "current_price": get_price(ticker),

        # income statement
        "revenue": safe_get(financials, "Total Revenue"),
        "net_income": safe_get(financials, "Net Income"),

        # valuation
        "eps": info.get("trailingEps"),
        "profit_margins": info.get("profitMargins"),

        # cash flow
        "operating_cash_flow": safe_cashflow(cashflow),

        # balance sheet
        "total_debt": safe_get(balance_sheet, "Total Debt"),
    }

    return data


# ---------------------------
# TEST
# ---------------------------
if __name__ == "__main__":
    result = run("AAPL")
    print("\n🎯 Result:")
    print(result)