def run_pipeline(limit=10):
    print("🚀 Starting full pipeline...")

    # 1. Get universe
    tickers = get_sp500_universe(limit=limit)

    results = []

    # 2. Loop tickers
    for t in tickers:
        symbol = t["ticker"]

        print(f"📊 Processing {symbol}")

        fundamentals = get_fundamentals(symbol)

        merged = {
            "ticker": symbol,
            "company": t["company"],
            "sector": t["sector"],
            "location": t["location"],
            "industry": t["industry"],
            "website": t["website"],

            # fundamentals
            "eps": fundamentals.get("eps"),
            "profit_margins": fundamentals.get("profit_margins"),
        }

        results.append(merged)

    # 3. Convert to DataFrame
    df = pd.DataFrame(results)

    print("\n✅ FINAL DATAFRAME:\n")
    print(df)

    return df

if __name__ == "__main__":
    run_pipeline(limit=10)