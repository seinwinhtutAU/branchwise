"""Read-only LangGraph tools for the retail chatbot.

Each tool queries the same SQLAlchemy models the rest of the backend uses, scoped to
the caller's branch (or every branch, for admin) exactly like every other router —
see the module docstring in agent.py for why that scoping matters here specifically.

Every tool also records a `ToolSource` (what it looked at, and the page behind it) in the
list `build_tools` is given, so the answer's sources come from the tools, not the model.
"""

from datetime import date, timedelta

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.retail.models.product import Product
from app.retail.models.stock_level import StockLevel
from app.models.user import User
from app.retail.services.chat.business_tools import build_business_tools
from app.retail.services.chat.knowledge_search import build_knowledge_tools
from app.retail.services.chat.metric_tools import build_metric_tools
from app.retail.services.chat.query_tools import build_query_tools
from app.retail.services.chat.scope import BranchScope
from app.retail.services.chat.sources import ToolSource
from app.retail.services.data_quality import build_warning_sections
from app.retail.services.stock import latest_stock_query

MAX_STOCK_ROWS = 30
MAX_WARNING_ROWS_PER_SECTION = 10


def build_tools(
    db: Session,
    user: User,
    context_branch_id: str | None = None,
    context_date_from: str | None = None,
    context_date_to: str | None = None,
    sources: list[ToolSource] | None = None,
) -> list:
    """Binds every tool to this request's db session + caller via closure, so
    branch-scoping happens here rather than the model needing to pass db/user
    arguments it has no business knowing about. Each tool appends what it looked at to
    `sources`."""
    used_sources: list[ToolSource] = sources if sources is not None else []
    scope = BranchScope(db, user, context_branch_id)
    resolve_branch = scope.resolve
    branch_label = scope.label
    names = scope.names

    @tool
    def list_branches() -> str:
        """The retail branches (id and name) this account can ask about. Call it when a
        question names a branch loosely or compares branches."""
        if user.branch_id is not None:
            return f"{branch_label(user.branch_id)} ({user.branch_id}) — your assigned branch."
        known = names()
        if not known:
            return "No branches found."
        return "\n".join(f"{name} ({branch_id})" for branch_id, name in known.items())

    @tool
    def get_current_stock(
        search: str = "", low_stock_max_qty: float | None = None, branch: str = ""
    ) -> str:
        """Current on-hand stock (each branch's latest inventory count). `search`
        filters by a stock code/description substring; `low_stock_max_qty` caps results
        to items at or below that quantity (use it for "what's low on stock"-type
        questions). `branch` is a branch name; empty uses the conversation's branch,
        else all. Returns at most 30 rows, sorted lowest quantity first."""
        branch_id, error = resolve_branch(branch)
        if error:
            return error
        query = latest_stock_query(db, branch_id)
        if search:
            like = f"%{search}%"
            query = query.filter(
                Product.stock_code.ilike(like) | Product.description.ilike(like)
            )
        if low_stock_max_qty is not None:
            query = query.filter(StockLevel.on_hand_qty <= low_stock_max_qty)
        matching = query.count()
        rows = query.order_by(StockLevel.on_hand_qty.asc()).limit(MAX_STOCK_ROWS).all()
        used_sources.append(
            ToolSource(
                "get_current_stock",
                "Current inventory",
                branch=branch_label(branch_id),
                as_of=max(stock.snapshot_at for stock, _, _ in rows).date().isoformat()
                if rows
                else None,
                route="inventory",
            )
        )
        if not rows:
            return "No matching inventory found."
        lines = [
            f"{product.stock_code} — {product.description} "
            f"({branch.name if branch else 'no branch'}): on hand {stock.on_hand_qty}, "
            f"as of {stock.snapshot_at.isoformat()}"
            for stock, product, branch in rows
        ]
        if matching > len(rows):
            lines.append(
                f"(CUT OFF: showing {len(rows)} of {matching} matching products, lowest stock "
                "first. This is NOT the whole list — use run_query for anything that needs all of it.)"
            )
        return "\n".join(lines)

    @tool
    def get_data_quality_warnings(days: int = 1, branch: str = "") -> str:
        """Summarize current data-quality warnings — bad numbers on sale/inventory/
        purchase rows, stock codes missing an inventory record, and daily stock
        reconciliation mismatches — for the last N days (default 1, max 365). `branch`
        is a branch name; empty uses the conversation's branch, else all. Use this
        whenever asked to explain warnings or data problems."""
        branch_id, error = resolve_branch(branch)
        if error:
            return error
        capped_days = max(1, min(days, 365))
        warning_user = user
        if branch_id != user.branch_id:
            # The service only reads branch_id from this small object. Avoid mutating
            # the authenticated SQLAlchemy model just to scope one read-only request.
            from types import SimpleNamespace

            warning_user = SimpleNamespace(branch_id=branch_id)
        sections = build_warning_sections(db, warning_user, capped_days, capped_days)
        used_sources.append(
            ToolSource(
                "get_data_quality_warnings",
                "Data-quality warnings",
                branch=branch_label(branch_id),
                date_from=(date.today() - timedelta(days=capped_days - 1)).isoformat(),
                date_to=date.today().isoformat(),
                route="warnings",
            )
        )
        lines = []
        for section in sections:
            rows = section["rows"]
            if not rows:
                continue
            lines.append(f"## {section['title']} ({len(rows)})")
            for row in rows[:MAX_WARNING_ROWS_PER_SECTION]:
                field_str = ", ".join(
                    f"{f['label']}={f['value']}" for f in row["fields"]
                )
                lines.append(f"- {row['note']} [{field_str}]")
            if len(rows) > MAX_WARNING_ROWS_PER_SECTION:
                lines.append(f"...and {len(rows) - MAX_WARNING_ROWS_PER_SECTION} more.")
        return "\n".join(lines) if lines else "No data-quality warnings right now."

    return [
        list_branches,
        get_current_stock,
        get_data_quality_warnings,
        *build_business_tools(db, user, scope, used_sources),
        *build_knowledge_tools(db, used_sources),
        *build_metric_tools(
            db, user, scope, used_sources, context_date_from, context_date_to
        ),
        *build_query_tools(db, user, scope, used_sources),
    ]
