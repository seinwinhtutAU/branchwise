"""Which customers to ask for money first.

The rule is simple and stated in the answer: money that has waited more than 30 days comes first (the longer it
waits, the harder it is to collect), the customer with the most of it first; then everyone else, the largest
balance first. It reads the open orders the Dashboard's Revenue tab reads and works nothing else out.
"""

from datetime import date

from sqlalchemy.orm import Session

from app.wholesale.services.dashboard import _normal_customer, _order_total, _paid_on, open_orders

OVERDUE_DAYS = 30


def collection_priorities(db: Session, branch_id: str | None, today: date | None = None) -> list[dict]:
    """Every customer with money left to collect, in the order to ask them: overdue first, then by balance."""
    today = today or date.today()
    owing: dict[str, dict] = {}
    for order in open_orders(db, branch_id):
        balance = _order_total(order) - _paid_on(order)
        if balance <= 0:
            continue
        age = max(0, (today - order.order_date).days)
        name = order.customer_name.strip()
        item = owing.setdefault(
            _normal_customer(name),
            {"name": name, "left": 0.0, "overdue": 0.0, "order_count": 0, "oldest_days": 0},
        )
        item["left"] += balance
        item["order_count"] += 1
        item["oldest_days"] = max(item["oldest_days"], age)
        if age > OVERDUE_DAYS:
            item["overdue"] += balance
    return sorted(
        owing.values(),
        key=lambda row: (row["overdue"] <= 0, -row["overdue"], -row["left"], row["name"].lower()),
    )
