from AGENTS.market_data_agent.agent import run
from data_loader import load_tickers, sp500_instrument_csv_path


def test_market_agent():
    print("\n🚀 Running Market Data Agent...\n")
    print("👀 Loading S&P500 tickers...")

    csv_path = sp500_instrument_csv_path()
    tickers = load_tickers(csv_path=csv_path, limit=10)

    print(f"✅ Loaded {len(tickers)} tickers")

    for ticker in tickers:
        print(ticker)

    #results = run(tickers)

    #for r in results:
    #    print("📊\n", r,"\n")
    #return(results)

if __name__ == "__main__":
    tickers=test_market_agent()
#/home/idris/Desktop/SmartInvest/backend/AGENTS/market_data_agent/test_data_loader.py