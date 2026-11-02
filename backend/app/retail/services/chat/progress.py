"""What the panel shows while the assistant works: one short line per step.

The words live here, in one place, so a tool cannot be added without saying what it is doing
(a test fails for a tool with no label).
"""

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

READING = "Reading your question"
WRITING = "Putting the answer together"
CHECKING = "Checking the figures against the data"
PLANNING = "Planning the steps"
WIDENING = "Looking wider"

TOOL_LABELS = {
    "list_branches": "Looking up the branches",
    "get_current_stock": "Checking stock",
    "get_data_quality_warnings": "Checking data warnings",
    "get_branch_health": "Checking branch health",
    "get_business_alerts": "Checking business alerts",
    "get_decisions_now": "Working out what needs a decision",
    "update_decision": "Updating the decision list",
    "get_alert_products": "Looking up the products behind an alert",
    "get_wholesale_buy_plan": "Working out what to buy",
    "get_wholesale_buy_plan_detail": "Working out which colours to buy",
    "get_wholesale_receiving_plan": "Checking the receiving plan",
    "get_wholesale_product_movements": "Checking product movements",
    "get_wholesale_price_options": "Comparing prices",
    "get_wholesale_collection_priorities": "Working out who to ask for money first",
    "get_cost_and_margin": "Working out cost and margin",
    "get_dashboard_summary": "Checking the dashboard summary",
    "get_revenue_summary": "Checking revenue",
    "get_customer_activity": "Checking customer activity",
    "get_inventory_health": "Checking inventory health",
    "get_reorder_list": "Checking the reorder list",
    "get_salaries": "Checking staff pay",
    "get_daily_costs": "Checking the daily costs",
    "get_zero_selling": "Checking the zero-selling log",
    "get_sales_performance": "Checking sales performance",
    "get_all_branches_summary": "Comparing the branches",
    "get_import_history": "Checking the import history",
    "get_import_health": "Checking the import health",
    "get_stock_audit": "Checking the stock audit",
    "get_wholesale_shipments": "Checking the shipments",
    "get_wholesale_receivings": "Checking the receivings",
    "get_wholesale_write_offs": "Checking the lost or short quantities",
    "get_wholesale_contacts": "Looking up contact details",
    "get_import_status": "Checking the daily imports",
    "get_app_settings": "Checking the settings",
    "get_wholesale_summary": "Checking the wholesale summary",
    "get_wholesale_health": "Checking the wholesale health score",
    "get_wholesale_revenue": "Checking wholesale revenue",
    "get_wholesale_cost": "Checking wholesale cost",
    "get_wholesale_inventory": "Checking wholesale inventory",
    "get_wholesale_customers": "Checking wholesale customers",
    "get_wholesale_price_suggestion": "Working out a selling price",
    "get_wholesale_customers_owing": "Checking what wholesale customers owe",
    "get_wholesale_suppliers_owed": "Checking what is owed to suppliers",
    "get_wholesale_next_steps": "Checking what is next in wholesale",
    "get_wholesale_record": "Looking up the order or voucher",
    "search_knowledge": "Searching the knowledge base",
    "describe_data": "Looking at the data available",
    "run_query": "Running a query",
    "calculate_metric": "Calculating",
    "show_chart": "Drawing a chart",
    "report_gap": "Noting what I couldn't answer",
}


def label_for(tool_name: str) -> str:
    return TOOL_LABELS.get(tool_name, "Working on it")


def describe_new_messages(new_messages: list[BaseMessage]) -> list[str]:
    """The status lines for messages the agent just added: each tool the model asked for, or,
    once results are back, that the answer is being written. A final answer adds none."""
    lines: list[str] = []
    for message in new_messages:
        if isinstance(message, AIMessage) and message.tool_calls:
            for call in message.tool_calls:
                line = label_for(call["name"])
                if line not in lines:
                    lines.append(line)
        elif isinstance(message, ToolMessage) and WRITING not in lines:
            lines.append(WRITING)
    return lines
