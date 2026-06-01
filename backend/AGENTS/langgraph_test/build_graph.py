from langgraph.graph import StateGraph, END

from AGENTS.langgraph_test.finance_nodes.market import market_node
from AGENTS.langgraph_test.finance_nodes.fundamentals import fundamental_node
from AGENTS.langgraph_test.finance_nodes.news import news_node
from AGENTS.langgraph_test.finance_nodes.macro import macro_node
from AGENTS.langgraph_test.finance_nodes.output import output_node

from AGENTS.langgraph_test.finance_state import FinanceState


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
#------------------------------------------------------------------------
if __name__ == "__main__":
    app = build_graph()

    result = app.invoke({
        "symbol": "AAPL"
    })

    print("\nFINAL OUTPUT:\n")
    print(result["output"])