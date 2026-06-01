from concurrent.futures import ThreadPoolExecutor
import pandas as pd

from AGENTS.orchestrator.run_graph import run_pipeline
from AGENTS.orchestrator.dataset_builder import build_dataset

OUTPUT_PATH = "/home/idris/Desktop/SmartInvest/backend/data/fin_data.csv"


# -----------------------------
# PARALLEL EXECUTION
# -----------------------------
def run_parallel(symbols, max_workers=5):
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(run_pipeline, symbols))
    return results


# -----------------------------
# MAIN
# -----------------------------
if __name__ == "__main__":

    tickers = ["AAPL", "MSFT", "TSLA"]

    print("\n🚀 Running parallel pipeline...\n")

    # STEP 1: run LangGraph per symbol (PARALLEL)
    results = run_parallel(tickers)

    # STEP 2: build dataset from results
    df = build_dataset(results)

    print("\n📊 FINAL DATAFRAME:\n")
    print(df.head())

    # STEP 3: save
    df.to_csv(OUTPUT_PATH, index=False)

    print(f"\n✅ Saved to: {OUTPUT_PATH}")