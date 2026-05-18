def run(insights):
    print("⚠️ Running risk agent...")

    confidence = insights["confidence"]
    trend = insights["trend"]

    # 1. Risk level
    if confidence >= 0.75:
        risk_level = "low"
    elif confidence >= 0.5:
        risk_level = "medium"
    else:
        risk_level = "high"

    # 2. Position sizing (simple rule-based)
    if risk_level == "low":
        position_size = 0.15
    elif risk_level == "medium":
        position_size = 0.10
    else:
        position_size = 0.03

    # 3. Stop loss logic (very simple)
    stop_loss = 0.02 if trend == "bullish" else 0.015

    return {
        "risk_level": risk_level,
        "position_size": position_size,
        "stop_loss": stop_loss
    }