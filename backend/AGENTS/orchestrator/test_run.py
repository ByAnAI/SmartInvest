from AGENTS.dataset_builder import build_dataset

def run_test():
    print("\n🧪 ORCHESTRATOR TEST RUN\n")

    # small universe for testing
    tickers = ["AAPL", "MSFT", "TSLA"]

    df = build_dataset(tickers)

    print("\n📊 OUTPUT PREVIEW:\n")
    print(df.head())

    print("\n📐 SHAPE:", df.shape)

    # basic validation checks
    assert not df.empty, "Dataset is empty"
    assert "symbol" in df.columns, "Missing symbol column"

    print("\n✅ Orchestrator test PASSED")


if __name__ == "__main__":
    run_test()