import yfinance as yf


def get_price(ticker):
    try:
        price = ticker.info.get("currentPrice")
        if price:
            return price

        return ticker.history(period="1d")["Close"].iloc[-1]
    except Exception:
        return None

def safe_cashflow(cf):
    try:
        if cf is None or cf.empty:
            return None

        possible_keys = [
            "Operating Cash Flow",
            "Total Cash From Operating Activities",
            "Cash Flow From Operating Activities"
        ]

        for key in possible_keys:
            if key in cf.index:
                row = cf.loc[key]

                # sometimes multiple columns exist → take latest column
                if hasattr(row, "iloc"):
                    return row.iloc[0]

        return None

    except Exception as e:
        print("cashflow error:", e)
        return None

def run(symbol: str):
    print(f"📊 Fetching fundamentals for {symbol}")

    ticker = yf.Ticker(symbol)

    info = ticker.info

    financials = ticker.financials
    cashflow = ticker.cashflow
    balance_sheet = ticker.balance_sheet

    data = {
        "symbol": symbol,
        "current_price": get_price(symbol),
        # 💰 Income statement
        "revenue": _safe_get(financials, "Total Revenue"),
        "net_income": _safe_get(financials, "Net Income"),

        # 📈 valuation metrics
        "eps": info.get("trailingEps"),
        "profit_margins": info.get("profitMargins"),

        # 💵 cash flow
        "operating_cash_flow": safe_cashflow(cashflow),

        # 🏦 debt
        "total_debt": _safe_get(balance_sheet, "Total Debt"),

        
    }

    return data


def _safe_get(df, row_name):
    try:
        return df.loc[row_name].iloc[0]
    except Exception:
        print("wrong")
        return None
    
if __name__ == "__main__":
    
    result = run("AAPL")
    print("🎯 Result:")
    print(result)