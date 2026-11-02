"""The "what needs a decision now" list: Business Alerts and the wholesale to-do lists put in one order.

Nothing here works anything out. A retail alert already carries its own title, reason and action (see
`early_warning.py`); the wholesale rows are the Today page's own lists (`wholesale/services/next_steps.py`).
This module only turns them into decisions and puts them in a fixed, explainable order, so the assistant can
say what to decide first and why, without inventing advice.

The order, most important first:
  1. a Critical retail alert about the business (e.g. a best seller is out of stock)
  2. wholesale customers waiting for products nothing covers, and orders ready to deliver
  3. a Warning retail alert about the business
  4. wholesale money to collect and to pay
  5. wholesale products to move or count, and what is still coming
  6. heads-up notes (Normal alerts: higher demand coming)
  7. data problems to fix, which come last because they are housekeeping, not a business decision
"""

from dataclasses import dataclass

MAX_DECISIONS = 8
MAX_NORMAL_PER_BRANCH = 1
LISTED = 3

TIER_NAMES = {
    1: "Critical",
    2: "Customers waiting",
    3: "Warning",
    4: "Money",
    5: "Stock to handle",
    6: "Heads-up",
    7: "Data to fix",
}


@dataclass(frozen=True)
class Decision:
    tier: int
    title: str
    why: str
    action: str
    where: str
    # Which part of the business it is about ("retail:<branch id>" or "wholesale") and a name that stays the same
    # from one day to the next, so the same thing can be followed (see decision_followups.py).
    scope: str = ""
    key: str = ""
    # Filled in once it is remembered: the number to quote ("#12") and how many days it has been open.
    ref: int | None = None
    days_open: int = 0


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _facts(alert: dict, limit: int = 2) -> str:
    facts = [f"{f['label']}: {f['value']}" for f in (alert.get("facts") or [])[:limit]]
    return f" ({'; '.join(facts)})" if facts else ""


def retail_decisions(branch_id: str, branch_name: str, alerts: list[dict]) -> list[Decision]:
    """One decision per alert, tiered by how serious it is and whether it is about the business or the data."""
    found: list[Decision] = []
    normals = 0
    for alert in alerts:
        if alert["dimension"] == "data_quality":
            tier = 7
        elif alert["severity"] == "critical":
            tier = 1
        elif alert["severity"] == "warning":
            tier = 3
        else:
            normals += 1
            if normals > MAX_NORMAL_PER_BRANCH:
                continue
            tier = 6
        found.append(
            Decision(
                tier=tier,
                title=f"{branch_name}: {alert['title']}",
                why=f"{alert['summary']}{_facts(alert)}",
                action=alert["recommended_action"],
                where="Business Alerts",
                scope=f"retail:{branch_id}",
                key=f"alert:{alert['id']}",
            )
        )
    return found


def wholesale_decisions(steps) -> list[Decision]:
    """The Today lists as decisions. `steps` is a `NextSteps`."""
    found: list[Decision] = []

    if steps.short:
        rows = sorted(steps.short, key=lambda r: r["short_sets"], reverse=True)
        biggest = "; ".join(f"{r['stock_code']} {r['product']} short by {r['short_sets']} sets" for r in rows[:LISTED])
        found.append(
            Decision(
                2,
                "Wholesale: customers are waiting for products that nothing covers",
                f"{len(rows)} product(s) are owed to customers and neither the warehouses nor what is on its way will "
                f"cover them. Biggest: {biggest}.",
                "Decide what to buy from the supplier and raise a voucher for it.",
                "Suppliers, What to buy",
                scope="wholesale",
                key="short",
            )
        )
    if steps.deliver:
        rows = sorted(steps.deliver, key=lambda r: r["ready_sets"], reverse=True)
        biggest = "; ".join(f"{r['order_no']} {r['customer']} ({r['ready_sets']} sets)" for r in rows[:LISTED])
        found.append(
            Decision(
                2,
                f"Wholesale: {len(rows)} order(s) are ready to deliver",
                f"The stock is allocated and waiting in a warehouse. Biggest: {biggest}.",
                "Deliver them and record the delivery.",
                "Today, Deliver",
                scope="wholesale",
                key="deliver",
            )
        )
    if steps.collect:
        rows = sorted(steps.collect, key=lambda r: r["left_to_collect"], reverse=True)
        total = sum(r["left_to_collect"] for r in rows)
        biggest = "; ".join(f"{r['customer']} {_ks(r['left_to_collect'])}" for r in rows[:LISTED])
        found.append(
            Decision(
                4,
                f"Wholesale: {_ks(total)} is left to collect from customers",
                f"{len(rows)} order(s) are not fully paid. Biggest: {biggest}.",
                "Decide who to ask for payment first, starting with the largest.",
                "Today, Money, Collect",
                scope="wholesale",
                key="collect",
            )
        )
    if steps.pay:
        rows = sorted(steps.pay, key=lambda r: r["left_to_pay"], reverse=True)
        total = sum(r["left_to_pay"] for r in rows)
        biggest = "; ".join(f"{r['supplier']} {_ks(r['left_to_pay'])}" for r in rows[:LISTED])
        found.append(
            Decision(
                4,
                f"Wholesale: {_ks(total)} is left to pay to suppliers",
                f"{len(rows)} voucher(s) are not fully paid. Biggest: {biggest}.",
                "Decide which supplier to pay first.",
                "Today, Money, Pay",
                scope="wholesale",
                key="pay",
            )
        )
    handle = len(steps.to_move) + len(steps.to_count)
    if handle:
        parts = []
        if steps.to_move:
            parts.append(f"{len(steps.to_move)} voucher(s) have products counted at a gate that is not a warehouse")
        if steps.to_count:
            parts.append(f"{len(steps.to_count)} move(s) have not been counted at the warehouse yet")
        found.append(
            Decision(
                5,
                "Wholesale: products are waiting to be moved or counted",
                "; ".join(parts) + ". Until then they are not stock you can promise.",
                "Move the products to a warehouse, and count what arrived.",
                "Today, Receive",
                scope="wholesale",
                key="handle",
            )
        )
    if steps.coming and not found:
        found.append(
            Decision(
                5,
                f"Wholesale: {len(steps.coming)} voucher(s) still have products to receive",
                "Nothing else needs a decision, but these are still on the way.",
                "Check the carriers if one is late.",
                "Today, Receive",
                scope="wholesale",
                key="coming",
            )
        )
    return found


def gather(db, user, names: dict[str, str], branch_id: str | None, named_branch: bool, overview) -> tuple[list[Decision], list[str]]:
    """Every decision the account may see, and the scopes that were looked at (so only those are followed up).
    `overview(branch_id)` gives a retail branch's Overview; wholesale is left out when one retail branch was named."""
    from app.models.user import UserRole

    found: list[Decision] = []
    scopes: list[str] = []
    if user.role != UserRole.WHOLESALE:
        for current in [branch_id] if branch_id else list(names):
            data = overview(current)
            found += retail_decisions(current, data["branch_name"], data["alerts"])
            scopes.append(f"retail:{current}")
    if user.role in (UserRole.WHOLESALE, UserRole.DEVELOPMENT, UserRole.ADMIN) and not (named_branch and branch_id):
        from app.wholesale.services.next_steps import next_steps

        found += wholesale_decisions(next_steps(db, user.branch_id))
        scopes.append("wholesale")
    return found, scopes


def rank(decisions: list[Decision]) -> list[Decision]:
    """Stable: inside a tier the order they arrived in is kept (alerts are already Critical first)."""
    return sorted(decisions, key=lambda d: d.tier)


def _age(item: Decision) -> str:
    return f", open for {item.days_open} day(s)" if item.days_open >= 1 else ""


def render(decisions: list[Decision], limit: int = MAX_DECISIONS, cleared=(), snoozed: int = 0, dismissed: int = 0) -> str:
    lines: list[str] = []
    if cleared:
        lines.append("Cleared since last time (the app no longer raises them):")
        lines += [f"- #{row.id} {row.title} (cleared {row.resolved_on})" for row in cleared[:LISTED]]
        lines.append("")
    if not decisions:
        lines.append("Nothing needs a decision right now.")
    else:
        shown = decisions[:limit]
        lines.append(f"What needs a decision now ({len(decisions)} item(s), most important first):")
        for number, item in enumerate(shown, 1):
            ref = f" #{item.ref}" if item.ref is not None else ""
            lines.append(f"{number}. [{TIER_NAMES[item.tier]}]{ref} {item.title}{_age(item)}")
            lines.append(f"   Why: {item.why}")
            lines.append(f"   What to do: {item.action}")
            lines.append(f"   Where: {item.where}")
        if len(decisions) > limit:
            lines.append(f"...and {len(decisions) - limit} more, less important.")
    hidden = []
    if snoozed:
        hidden.append(f"{snoozed} snoozed")
    if dismissed:
        hidden.append(f"{dismissed} marked as not being done")
    if hidden:
        lines.append(f"Not listed: {', '.join(hidden)}.")
    lines.append(
        "Order: Critical business problems first, then customers waiting or ready to deliver, then Warnings, then money "
        "to collect and pay, then stock to move or count, then heads-up notes, then data to fix (housekeeping); inside "
        "each group the ones open longest come first. A decision counts as cleared when the app's own alert or to-do "
        "list stops raising it. These are suggestions from the app's own alerts and to-do lists; nothing in the business "
        "was changed. To hide one for a while, or to say it will not be done, use its number."
    )
    return "\n".join(lines)
