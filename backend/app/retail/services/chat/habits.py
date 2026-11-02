"""What a person tends to ask the assistant about, read from what its tools looked at.

Every saved answer already lists the tools behind it (`assistant_citations`), so a person's
habit is just which kind of tool shows up most in their recent answers; nothing new is stored."""

from collections import Counter
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.timestamps import utc_now
from app.models.assistant_conversation import (
    AssistantCitation,
    AssistantConversation,
    AssistantRun,
)
from app.models.user import User
from app.retail.services.chat.data_views import WHOLESALE_VIEW_NAMES
from app.retail.services.chat.usage import _VIEW_WORD

WINDOW_DAYS = 30
# Fewer answers than this is not a habit yet.
MIN_ANSWERS = 3

TOPIC_OF_TOOL = {
    "get_retail_metric": "sales",
    # Legacy source names may remain in saved assistant citations.
    "get_sales_summary": "sales",
    "get_top_selling_products": "sales",
    "get_purchases_summary": "costs",
    "get_dashboard_summary": "sales",
    "get_revenue_summary": "sales",
    "get_customer_activity": "sales",
    "get_branch_health": "sales",
    "get_current_stock": "stock",
    "get_inventory_health": "stock",
    "get_reorder_list": "stock",
    "get_salaries": "costs",
    "get_daily_costs": "costs",
    "get_zero_selling": "sales",
    "get_sales_performance": "sales",
    "get_all_branches_summary": "sales",
    "get_import_history": "imports",
    "get_import_health": "imports",
    "get_stock_audit": "stock",
    "get_wholesale_shipments": "wholesale",
    "get_wholesale_receivings": "wholesale",
    "get_wholesale_write_offs": "wholesale",
    "get_wholesale_contacts": "wholesale",
    "get_cost_and_margin": "costs",
    "get_data_quality_warnings": "warnings",
    "get_business_alerts": "warnings",
    "get_decisions_now": "warnings",
    "update_decision": "warnings",
    "get_alert_products": "warnings",
    "get_wholesale_buy_plan": "wholesale",
    "get_wholesale_price_options": "wholesale",
    "get_wholesale_collection_priorities": "wholesale_money",
    "get_import_status": "imports",
    "get_wholesale_customers_owing": "wholesale_money",
    "get_wholesale_suppliers_owed": "wholesale_money",
    "get_wholesale_summary": "wholesale",
    "get_wholesale_health": "wholesale",
    "get_wholesale_revenue": "wholesale",
    "get_wholesale_cost": "wholesale",
    "get_wholesale_inventory": "wholesale",
    "get_wholesale_customers": "wholesale",
    "get_wholesale_next_steps": "wholesale",
    "get_wholesale_price_suggestion": "wholesale",
    "get_wholesale_record": "wholesale",
}


def topics_of(sources: list[tuple[str, dict]]) -> set[str]:
    """The topics one answer touched. Knowledge, charts and the like say nothing about habit."""
    topics: set[str] = set()
    for name, details in sources:
        if name in TOPIC_OF_TOOL:
            topics.add(TOPIC_OF_TOOL[name])
        elif name == "run_query":
            query = str(details.get("query") or "")
            topics.add(
                "wholesale"
                if WHOLESALE_VIEW_NAMES & set(_VIEW_WORD.findall(query))
                else "sales"
            )
    return topics


def frequent_topic(db: Session, user: User) -> str | None:
    since = utc_now() - timedelta(days=WINDOW_DAYS)
    rows = (
        db.query(
            AssistantCitation.run_id,
            AssistantCitation.source_name,
            AssistantCitation.details,
        )
        .join(AssistantRun, AssistantRun.id == AssistantCitation.run_id)
        .join(
            AssistantConversation,
            AssistantConversation.id == AssistantRun.conversation_id,
        )
        .filter(
            AssistantConversation.user_id == user.id, AssistantRun.created_at >= since
        )
        .all()
    )
    by_run: dict[str, list[tuple[str, dict]]] = {}
    for run_id, name, details in rows:
        by_run.setdefault(run_id, []).append((name, details or {}))
    counts: Counter[str] = Counter()
    for sources in by_run.values():
        counts.update(topics_of(sources))
    if not counts or sum(1 for s in by_run.values() if topics_of(s)) < MIN_ANSWERS:
        return None
    return counts.most_common(1)[0][0]
