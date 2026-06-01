"""
News Agent (Alpha Vantage)
"""

from news_sentiment import run  # OR replace with real implementation if needed


def run_agent(symbol: str):
    return run(symbol)


if __name__ == "__main__":
    import sys

    sym = sys.argv[1].upper() if len(sys.argv) > 1 else "AAPL"

    print(f"📰 Fetching news for {sym}\n")

    news = run_agent(sym)

    if not news:
        print("No articles returned.")
        exit(0)

    for i, n in enumerate(news[:10], 1):
        print(f"{i}. {n.get('title')}")
        print(f"   📰 {n.get('source')}")
        print(f"   ⭐ {n.get('sentiment_label')} ({n.get('sentiment')})")
        print(f"   🔗 {n.get('url')}\n")