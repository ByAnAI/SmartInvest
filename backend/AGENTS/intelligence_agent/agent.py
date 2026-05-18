def run(market_data):
    print("🧠 Running intelligence agent...")

    price = market_data["price"]

    trend = "bullish" if price > 140 else "bearish"

    return {
        "trend": trend,
        "confidence": 0.7
    }