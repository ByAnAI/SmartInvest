from langgraph.graph import StateGraph, END
from typing import TypedDict, Dict, Any, List

# =========================
# AGENTS
# =========================
from AGENTS.market_data_agent.agent import run as market_run
from AGENTS.fundamental_agent.agent import run as fundamental_run
from AGENTS.news_agent.agent import run as news_run
from AGENTS.macro_indicator_agent.agent import run as macro_run


# =========================
# STATE (IMPORTANT FIX)
# =========================
class FinanceState(TypedDict, total=False):
    symbol: str
    market: Dict[str, Any]
    fundamentals: Dict[str, Any]
    news: List[Dict[str, Any]]
    macro: Dict[str, Any]
    output: Dict[str, Any]


# =========================
# DEBUG
# =========================
print("🚀 START FINANCE GRAPH")


# =========================
# NODES
# =========================
def market_node(state: FinanceState):
    symbol = state["symbol"]
    data = market_run(symbol)
    print("📊 MARKET:", data)
    return {"market": data}


def fundamental_node(state: FinanceState):
    symbol = state["symbol"]
    data = fundamental_run(symbol)
    print("💰 FUNDAMENTALS:", data)
    return {"fundamentals": data}


def news_node(state: FinanceState):
    symbol = state["symbol"]
    data = news_run(symbol)
    print("📰 NEWS:", data)
    return {"news": data}


def macro_node(state: FinanceState):
    data = macro_run()
    print("🌍 MACRO:", data)
    return {"macro": data}


def output_node(state: FinanceState):
    result = {
        "symbol": state["symbol"],
        "market": state.get("market"),
        "fundamentals": state.get("fundamentals"),
        "news": state.get("news"),
        "macro": state.get("macro"),
    }

    print("📦 OUTPUT BUILT")

    return {"output": result}


# =========================
# GRAPH BUILDER
# =========================
def build_graph():
    graph = StateGraph(FinanceState)

    graph.add_node("market", market_node)
    graph.add_node("fundamentals", fundamental_node)
    graph.add_node("news", news_node)
    graph.add_node("macro", macro_node)
    graph.add_node("output", output_node)

    graph.set_entry_point("market")

    graph.add_edge("market", "fundamentals")
    graph.add_edge("fundamentals", "news")
    graph.add_edge("news", "macro")
    graph.add_edge("macro", "output")
    graph.add_edge("output", END)

    return graph.compile()


# =========================
# RUN TEST (CRITICAL FIX)
# =========================
if __name__ == "__main__":
    app = build_graph()

    print("\n🚀 RUNNING GRAPH FOR AAPL...\n")

    result = app.invoke({"symbol": "AAPL"})

    print("\n📊 FINAL RESULT:\n")

    for k, v in result.items():
        print(f"\n{k}:\n{v}")