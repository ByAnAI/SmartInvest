import os
import pandas as pd

from AGENTS.market_data_agent.agent import run as market_run
from AGENTS.fundamental_agent.agent import run as fundamental_run
from AGENTS.macro_indicator_agent.agent import run as macro_run
from AGENTS.news_agent.agent import run as news_run


OUTPUT_PATH = "/home/idris/Desktop/SmartInvest/backend/data/final_dataset.csv"


# -----------------------------
# CORE PIPELINE
# -----------------------------
def build_dataset(symbols: list):
    print("🚀 Starting full dataset builder...\n")

    macro_df = macro_run()
    macro_snapshot = macro_df.set_index("indicator")["value"].to_dict()

    all_rows = []

    for symbol in symbols:
        print(f"\n📊 Processing {symbol}")

        # 1. Market data
        market = market_run(symbol)

        # 2. Fundamentals
        fundamentals = fundamental_run(symbol)

        # 3. News + sentiment
        news = news_run(symbol)

        # -----------------------------
        # MERGE ALL DATA
        # -----------------------------
        row = {
            "symbol": symbol,

            # Market
            **safe_dict(market),

            # Fundamentals
            **safe_dict(fundamentals),

            # Macro snapshot (same for all symbols)
            "macro_snapshot": macro_snapshot,

            # News
            **safe_dict(news),
        }

        all_rows.append(row)

    df = pd.DataFrame(all_rows)

    # flatten macro snapshot (optional but recommended)
    macro_expanded = pd.json_normalize(df["macro_snapshot"])
    df = df.drop(columns=["macro_snapshot"]).join(macro_expanded)

    return df


# -----------------------------
# SAFE MERGE HELPER
# -----------------------------
def safe_dict(data):
    """
    Ensures agent output is always dict-safe
    """
    if data is None:
        return {}
    if isinstance(data, dict):
        return data
    return {}


# -----------------------------
# RUN PIPELINE
# -----------------------------
if __name__ == "__main__":

    # Example universe (replace with S&P500 later)
    symbols = ["AAPL", "MSFT", "TSLA"]

    df = build_dataset(symbols)

    print("\n📦 FINAL DATASET:")
    print(df.head())

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    print(f"\n✅ Saved to: {OUTPUT_PATH}")