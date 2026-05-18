import yfinance as yf


import os
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY")

BASE_URL = "https://www.alphavantage.co/query"


def run(symbol: str):
    print(f"📰 Fetching Alpha Vantage news for {symbol}")

    try:
        params = {
            "function": "NEWS_SENTIMENT",
            "tickers": symbol,
            "apikey": API_KEY,
            "limit": 50
        }

        response = requests.get(BASE_URL, params=params)
        data = response.json()

        if "feed" not in data:
            print("❌ No news returned:", data)
            return []

        results = []

        for item in data["feed"]:
            results.append({
                "title": item.get("title"),
                "source": item.get("source"),
                "url": item.get("url"),
                "time": item.get("time_published"),
                "sentiment": item.get("overall_sentiment_score"),
                "sentiment_label": item.get("overall_sentiment_label"),
            })

        return results

    except Exception as e:
        print(f"❌ Error fetching news: {e}")
        return []


if __name__ == "__main__":
    news = run("AAPL")

    print("\n📊 NEWS RESULTS:\n")

    for i, n in enumerate(news[:10], 1):
        print(f"{i}. {n['title']}")
        print(f"   📰 {n['source']}")
        print(f"   ⭐ Sentiment: {n['sentiment_label']} ({n['sentiment']})")
        print(f"   🔗 {n['url']}\n")

'''
def run(symbol: str):
    print(f"📰 Fetching news for {symbol}")

    ticker = yf.Ticker(symbol)

    try:
        news = ticker.news

        if not news:
            print("⚠️ No news found")
            return []

        results = []

      
        for item in news[:10]:
            title = item.get("title") or item.get("content", {}).get("title")
            source = item.get("publisher") or item.get("content", {}).get("provider", {}).get("displayName")
            url = item.get("link") or item.get("content", {}).get("clickThroughUrl", {}).get("url")

            if not title:
                continue

            results.append({
            "title": title,
            "source": source or "Unknown",
            "url": url or "No URL"
    })






        return results

    except Exception as e:
        print(f"❌ Error fetching news: {e}")
        return []


if __name__ == "__main__":
    data = run("AAPL")

    print("\n📊 NEWS RESULTS:\n")
    for i, n in enumerate(data, 1):
        print(f"{i}. {n['title']}")
        print(f"   📰 {n['source']}")
        print(f"   🔗 {n['url']}\n")
'''