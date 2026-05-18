import pandas as pd

from AGENTS.macro_indicator_agent.agent import run as macro_run
from AGENTS.market_data_agent.agent import run as market_run
from AGENTS.fundamental_agent.agent import run as fundamental_run
from AGENTS.news_agent.agent import run as news_run
output_path = "/home/idris/Desktop/SmartInvest/backend/data/fin_data.csv"

def run_pipeline(tickers):
    print("\n🚀 STARTING FULL ORCHESTRATION PIPELINE\n")

    # =========================
    # STEP 1: MACRO (ONCE)
    # =========================
    print("🌍 Running Macro Indicators...\n")
    macro = macro_run()

    results = []

    # =========================
    # STEP 2: PER TICKER PIPELINE
    # =========================
    for symbol in tickers:
        print(f"\n================ {symbol} ================\n")

        # Market data
        print("📊 Market Data...")
        market = market_run(symbol)

        # Fundamental data
        print("💰 Fundamentals...")
        fundamentals = fundamental_run(symbol)

        # News + sentiment
        print("📰 News + Sentiment...")
        news = news_run(symbol)

        results.append({
            "symbol": symbol,
            "market": market,
            "fundamentals": fundamentals,
            "news": news,
            "macro": macro
        })

    return results


def to_dataframe(results):
    rows = []

    for r in results:
        f = r["fundamentals"]
        m = r["market"]
        n = r["news"]

        rows.append({
            "symbol": r["symbol"],

            # market
            "price": m.get("price") if isinstance(m, dict) else None,

            # fundamentals
            "revenue": f.get("revenue"),
            "net_income": f.get("net_income"),
            "eps": f.get("eps"),
            "profit_margins": f.get("profit_margins"),
            "cash_flow": f.get("operating_cash_flow"),
            "debt": f.get("total_debt"),

            # news sentiment (avg)
            "news_sentiment_avg": sum([x.get("sentiment", 0) for x in n]) / max(len(n), 1),
            "news_count": len(n)
        })

    return pd.DataFrame(rows)


if __name__ == "__main__":
    tickers = ["AAPL", "MSFT", "TSLA"]

    results = run_pipeline(tickers)

    df = to_dataframe(results)

    print("\n📊 FINAL DATAFRAME:\n")
    print(df)

    df.to_csv(output_path , index=False)