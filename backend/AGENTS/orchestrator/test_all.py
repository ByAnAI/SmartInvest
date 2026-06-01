import os
from AGENTS.macro_indicator_agent.agent import run as macro_run
from AGENTS.market_data_agent.agent import run as market_run
from AGENTS.fundamental_agent.agent import run as fundamental_run
from AGENTS.news_agent.agent import run as news_run


def test_all(symbol="AAPL"):
    print("\n🚀 TESTING ALL AGENTS\n")

    # =========================
    # 1. MACRO (GLOBAL ONCE)
    # =========================
    print("\n🌍 Macro Indicators...")
    macro = macro_run()
    print("✔ Macro OK")

    # =========================
    # 2. MARKET DATA
    # =========================
    print(f"\n📊 Market Data for {symbol}...")
    market = market_run(symbol)
    print(market)

    # =========================
    # 3. FUNDAMENTALS
    # =========================
    print(f"\n💰 Fundamentals for {symbol}...")
    fundamentals = fundamental_run(symbol)
    print(fundamentals)

    # =========================
    # 4. NEWS + SENTIMENT
    # =========================
    print(f"\n📰 News for {symbol}...")
    news = news_run(symbol)

    if isinstance(news, list) and len(news) > 0:
        for i, n in enumerate(news[:5], 1):
            print(f"{i}. {n.get('title')}")
            print(f"   📰 {n.get('source')}")
            print(f"   ⭐ {n.get('sentiment')}")
    else:
        print("No news returned")

    # =========================
    # SUMMARY
    # =========================
    print("\n✅ ALL AGENTS TEST COMPLETED")


if __name__ == "__main__":
    test_all("AAPL")