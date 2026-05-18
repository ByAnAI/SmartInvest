import os
import pandas as pd
from dotenv import load_dotenv
from fredapi import Fred
from datetime import datetime, timezone
# Add date + UTC timestamp
now_utc = datetime.now(timezone.utc)


load_dotenv()

fred = Fred(api_key=os.getenv("FRED_API_KEY"))

INDICATORS = [
    ("GDP", "GDP"),
    ("INDPRO", "Industrial Production"),
    ("RSAFS", "Retail Sales"),

    ("UNRATE", "Unemployment Rate"),
    ("PAYEMS", "Non-Farm Payrolls"),
    ("ICSA", "Jobless Claims"),
    ("CIVPART", "Labor Participation Rate"),

    ("CPIAUCSL", "CPI"),
    ("PPIACO", "PPI"),

    ("FEDFUNDS", "Fed Funds Rate"),
    ("DGS10", "10Y Treasury Yield"),
    ("DGS2", "2Y Treasury Yield"),

    #("NAPM", "ISM Manufacturing Index (Legacy)"),
    #("NAPMNMI", "ISM Services PMI"),

    ("DTWEXBGS", "USD Index"),
    ("BAMLH0A0HYM2", "High Yield Credit Spread"),
    ("WALCL", "Fed Balance Sheet"),
    ("M2SL", "Money Supply"),
]
#--------------------------------------------
MACRO_PATH = "/home/idris/Desktop/SmartInvest/backend/data/macro_daily.csv"

MACRO_PATH_EXL = "/home/idris/Desktop/SmartInvest/backend/data/macro_daily.xlsx"
#--------------------------------------------------------------
def fetch_indicator(series_code, name):
    try:
        series = fred.get_series(series_code)

        if series is None or len(series) == 0:
            return None

        return {
            "indicator": name,
            "value": float(series.iloc[-1]),
            "indicator_date": pd.to_datetime(series.index[-1]).date().isoformat()
        }

    except Exception as e:
        print(f"❌ Error fetching {name}: {e}")
        return None
#----------------------------------------------------------------------
def save_macro_snapshot(macro_df):
    """
    Converts macro indicator df → single row snapshot with date
    and appends to historical file
    """

    if macro_df is None or macro_df.empty:
        print("⚠️ No macro data to save")
        return

    # Convert to dict: {indicator: value}
    snapshot = macro_df.set_index("indicator")["value"].to_dict()

    # Add dat_
    #snapshot["date"] = datetime.now().date()
    snapshot["collection_date"] = now_utc.date()
    snapshot["utc_time"] = now_utc.isoformat()

    new_row = pd.DataFrame([snapshot])

    # Ensure directory exists
    os.makedirs(os.path.dirname(MACRO_PATH), exist_ok=True)

    # Append or create
    if os.path.exists(MACRO_PATH):
        existing = pd.read_csv(MACRO_PATH)

        # Avoid duplicate same-day entries
        if str(snapshot["collection_date"]) in existing["collection_date"].astype(str).values:
            print("📅 Macro already saved for today")
            return

        updated = pd.concat([existing, new_row], ignore_index=True)
    else:
        updated = new_row

    updated.to_csv(MACRO_PATH, index=False)

    print(f"✅ Macro snapshot saved → {MACRO_PATH}")

#--------------------------------------------

def fetch(series, name):
    try:
        data = fred.get_series(series)

        if data is None or len(data) == 0:
            print(f"⚠️ Missing: {name}")
            return None

        return {
            "indicator": name,
            "value": float(data.dropna().iloc[-1]),
            "date": data.dropna().index[-1]
        }

    except Exception as e:
        print(f"❌ Error fetching {name}: {e}")
        return None


def run():
    print("🌍 Fetching Macro Indicators...\n")

    results = []

    for code, name in INDICATORS:
        res = fetch(code, name)
        if res:
            results.append(res)

    df = pd.DataFrame(results)

    # Yield curve
    try:
        y10 = df[df["indicator"] == "10Y Treasury Yield"]["value"].values[0]
        y2 = df[df["indicator"] == "2Y Treasury Yield"]["value"].values[0]

        df.loc[len(df)] = {
            "indicator": "Yield Curve (10Y-2Y)",
            "value": y10 - y2,
            "date": datetime.now()
        }
    except Exception:
        pass

    now_utc = datetime.now(timezone.utc)

# Add columns
    df["collection_date"] = now_utc.date()              # e.g. 2026-05-18
    df["collection_utc"] = now_utc.isoformat() 

    save_macro_snapshot(df)
    df.to_csv(MACRO_PATH, index=False)
    df.to_excel(MACRO_PATH_EXL, index=False, engine="openpyxl")

 

 





    return df


if __name__ == "__main__":
    df = run()
    print(df)