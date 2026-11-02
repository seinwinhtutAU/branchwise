"""Assistant tools for executing approved metric rules without executable code."""

from datetime import date, timedelta

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat.metric_calculator import (
    MetricRequest,
    MetricRequestError,
    calculate,
)
from app.retail.services.chat.scope import BranchScope
from app.retail.services.chat.sources import ToolSource
from app.retail.services.metric_rules import (
    get_rule as get_retail_rule,
    source_rows_for as retail_source_rows_for,
)
from app.wholesale.services.metric_rules import (
    get_rule as get_wholesale_rule,
    source_rows_for as wholesale_source_rows_for,
)

WHOLESALE_ROLES = (UserRole.WHOLESALE, UserRole.DEVELOPMENT, UserRole.ADMIN)
MAX_DAYS = 366


def _date(value: str, default: date) -> date:
    return date.fromisoformat(value) if value else default


def _window(
    date_from: str,
    date_to: str,
    context_date_from: str | None,
    context_date_to: str | None,
    default_window: str,
) -> tuple[date, date]:
    end = _date(date_to or context_date_to or "", date.today())
    default_start = (
        end.replace(day=1) if default_window == "month" else end - timedelta(days=29)
    )
    start = _date(date_from or context_date_from or "", default_start)
    if start > end:
        raise MetricRequestError("date_from must be on or before date_to.")
    if (end - start) > timedelta(days=MAX_DAYS - 1):
        raise MetricRequestError(f"Choose a period of at most {MAX_DAYS} days.")
    return start, end


def _money(value: object) -> str:
    return f"Ks {float(value or 0):,.0f}"


def _render_value(value_format: str, value: object) -> str:
    if value_format == "percent":
        return "—" if value is None else f"{float(value):.1f}%"
    if value_format == "money":
        return _money(value)
    return f"{float(value or 0):,.0f}"


def _rule_and_source(rule_id: str, user: User):
    retail_rule = get_retail_rule(rule_id)
    if retail_rule is not None:
        return retail_rule, retail_source_rows_for
    wholesale_rule = get_wholesale_rule(rule_id)
    if wholesale_rule is not None and user.role in WHOLESALE_ROLES:
        return wholesale_rule, wholesale_source_rows_for
    return None, None


def build_metric_tools(
    db: Session,
    user: User,
    scope: BranchScope,
    sources: list[ToolSource],
    context_date_from: str | None,
    context_date_to: str | None,
) -> list:
    """Return governed calculation tools available to this account."""

    @tool
    def calculate_metric(
        rule_id: str,
        date_from: str = "",
        date_to: str = "",
        group_by: list[str] | None = None,
        measures: list[str] | None = None,
        filters: dict[str, str] | None = None,
        sort_by: str = "",
        descending: bool = True,
        limit: int = 10,
        branch: str = "",
    ) -> str:
        """Execute an approved business metric rule deterministically. The assistant may
        choose only a listed rule and filter, group, select, sort and limit it; it must
        never supply a formula or code. Approved retail rules: `sales_summary`,
        `top_selling_products`, `purchase_summary`. Wholesale accounts also have
        `product_profit` (delivered revenue minus supplier-voucher product cost; products
        without a known cost are excluded). Dates use YYYY-MM-DD; each rule uses its
        documented default period."""
        rule, source_rows = _rule_and_source(rule_id, user)
        if rule is None:
            return "Unknown approved metric rule for this account."
        branch_id, error = scope.resolve(branch)
        if error:
            return error
        try:
            start, end = _window(
                date_from,
                date_to,
                context_date_from,
                context_date_to,
                rule.default_window,
            )
            calculation = calculate(
                rule,
                source_rows(db, rule_id, branch_id, start, end),
                MetricRequest(
                    group_by=tuple(group_by or ()),
                    measures=tuple(measures or ()),
                    filters=filters,
                    sort_by=sort_by,
                    descending=descending,
                    limit=limit,
                ),
            )
        except (MetricRequestError, ValueError) as exc:
            return f"Metric calculation refused: {exc}"

        sources.append(
            ToolSource(
                f"get_{rule.business}_metric",
                f"{rule.label} (rule v{rule.version})",
                branch=scope.label(branch_id),
                date_from=start.isoformat(),
                date_to=end.isoformat(),
                route=rule.route,
            )
        )
        header = f"{rule.label} — {start.isoformat()} to {end.isoformat()}"
        if not calculation.rows:
            message = f"No {rule.label.casefold()} data was found for this period."
            if calculation.excluded_group_count:
                message += (
                    f" {calculation.excluded_group_count} product group(s), covering "
                    f"{_money(calculation.incomplete_amount)} of delivered revenue, were excluded."
                )
            return f"{header}\n{message}"
        lines = [header]
        measure_map = {measure.name: measure for measure in rule.measures}
        for row in calculation.rows:
            title = " · ".join(
                str(row.get(field) or "Unspecified") for field in calculation.group_by
            )
            values = "; ".join(
                f"{measure_map[name].label} "
                f"{_render_value(measure_map[name].value_format, row.get(name))}"
                for name in calculation.measures
            )
            lines.append(f"- {title}: {values}")
        if calculation.excluded_group_count:
            lines.append(
                f"Excluded {calculation.excluded_group_count} product group(s), covering "
                f"{_money(calculation.incomplete_amount)} of delivered revenue: "
                f"{calculation.incomplete_reason}"
            )
        return "\n".join(lines)

    return [calculate_metric]
