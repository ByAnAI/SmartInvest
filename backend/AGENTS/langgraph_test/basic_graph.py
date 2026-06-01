from langgraph.graph import StateGraph, END
from typing import TypedDict


# 1. Define state
class State(TypedDict):
    value: int


# 2. Node functions
def start_node(state):
    print("▶ start node")
    state["value"] = 1
    return state


def increment_node(state):
    print("➕ increment node")
    state["value"] += 10
    return state


def end_node(state):
    print("🏁 end node")
    return state


# 3. Build graph
def build_graph():
    graph = StateGraph(State)

    graph.add_node("start", start_node)
    graph.add_node("increment", increment_node)
    graph.add_node("end", end_node)

    graph.set_entry_point("start")

    graph.add_edge("start", "increment")
    graph.add_edge("increment", "end")
    graph.add_edge("end", END)

    return graph.compile()


# 4. Run
if __name__ == "__main__":
    app = build_graph()

    result = app.invoke({"value": 0})

    print("\nFINAL RESULT:", result)