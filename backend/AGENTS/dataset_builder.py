import os
import pandas as pd

from AGENTS.market_data_agent.agent import run as market_run
from AGENTS.fundamental_agent.agent import run as fundamental_run
from AGENTS.macro_indicator_agent.agent import run as macro_run
from AGENTS.news_agent.agent import run as news_run


OUTPUT_PATH = "/home/idris/Desktop/SmartInvest/backend/data/final_dataset.csv"


# -----------------------------
# SAFE MERGE
# -----------------------------
def safe_dict(data):
    if data is None:
        return {}
    if isinstance(data, dict):
        return data
    return {}


# -----------------------------
# CORE BUILDER
# -----------------------------
def build_dataset(symbols: list):
    print("🚀 Starting dataset builder...\n")

    # ======================
    # 1. MACRO (ONCE DAILY)
    # ======================
    print("🌍 Fetching macro indicators...")
    macro_df = macro_run()

    macro_snapshot = {
        row["indicator"]: row["value"]
        for _, row in macro_df.iterrows()
    }

    all_rows = []

    # ======================
    # 2. PER SYMBOL
    # ======================
    for symbol in symbols:
        print(f"\n📊 Processing {symbol}")

        market = market_run(symbol)
        fundamentals = fundamental_run(symbol)
        news = news_run(symbol)

        row = {
            "symbol": symbol,

            # Market
            **safe_dict(market),

            # Fundamentals
            **safe_dict(fundamentals),

            # Macro (shared snapshot)
            **macro_snapshot,

            # News
            **safe_dict(news),
        }

        all_rows.append(row)

    df = pd.DataFrame(all_rows)

    return df


# -----------------------------
# RUN
# -----------------------------
if __name__ == "__main__":

    symbols = ["AAPL", "MSFT", "TSLA"]

    df = build_dataset(symbols)

    print("\n📦 FINAL DATASET PREVIEW:\n")
    print(df.head())

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    print(f"\n✅ Saved to: {OUTPUT_PATH}")