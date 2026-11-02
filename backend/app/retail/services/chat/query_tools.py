"""The assistant's way of answering a question no prepared tool covers: look at the views,
write one SELECT, run it read-only.

Three layers keep that safe, none of them the prompt: `sql_guard` accepts only a plain SELECT
over the views (and the database runs the regenerated text); `_run_read_only` runs it in a
read-only transaction with a statement timeout and a row cap; and `data_views` filters every
view to the account's branch when it has one. The SQL and row count go into the answer's
sources so the figure can be checked.
"""

from datetime import date, datetime
from decimal import Decimal

from langchain_core.tools import tool
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.services.chat.chart_spec import build_chart, spec_json
from app.retail.services.chat.data_views import (
    WHOLESALE_VIEW_NAMES,
    describe,
    with_views,
)
from app.retail.services.chat.scope import BranchScope
from app.retail.services.chat.sources import ToolSource
from app.retail.services.chat.sql_guard import UnsafeQuery, check

MAX_ROWS = 200
STATEMENT_TIMEOUT_MS = 5000
MAX_OUTPUT_CHARS = 6000
MAX_SOURCE_SQL_CHARS = 2000
MAX_CHARTS_PER_ANSWER = 2
# Who may query the wholesale views: the same accounts the wholesale screens let in.
WHOLESALE_ROLES = (UserRole.WHOLESALE, UserRole.DEVELOPMENT, UserRole.ADMIN)


class QueryFailed(RuntimeError):
    """The database could not run an accepted query; the message is safe for the model."""


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _run_read_only(db: Session, sql: str) -> tuple[list[str], list[tuple], bool]:
    """Rows are fetched in a fresh transaction that can write nothing and is always rolled
    back. Returns (columns, rows, truncated)."""
    bind = db.get_bind()
    dialect = bind.dialect.name
    # text() would read ":name" as a bind parameter; this SQL has none, so every colon
    # (a "::" cast, a ':' inside a string) is escaped to stay literal.
    statement = text(sql.replace(":", "\\:"))
    with Session(bind=bind) as session:
        try:
            if dialect == "postgresql":
                session.execute(text("SET TRANSACTION READ ONLY"))
                session.execute(
                    text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
                )
            elif dialect == "sqlite":
                session.connection().exec_driver_sql("PRAGMA query_only = ON")
            result = session.execute(statement)
            columns = list(result.keys())
            rows = result.fetchmany(MAX_ROWS + 1)
        except SQLAlchemyError as exc:
            reason = str(getattr(exc, "orig", exc)).splitlines()[0][:200]
            if "statement timeout" in reason or "canceling statement" in reason:
                raise QueryFailed(
                    "The query took too long. Narrow the dates or aggregate more."
                ) from exc
            raise QueryFailed(reason) from exc
        finally:
            session.rollback()
            if dialect == "sqlite":
                session.connection().exec_driver_sql("PRAGMA query_only = OFF")
                session.rollback()
    truncated = len(rows) > MAX_ROWS
    return columns, rows[:MAX_ROWS], truncated


def _format(columns: list[str], rows: list[tuple], truncated: bool) -> str:
    if not rows:
        return "The query ran and returned no rows."
    lines = [" | ".join(columns)]
    lines.extend(" | ".join(_cell(value) for value in row) for row in rows)
    if truncated:
        lines.append(
            f"(cut off at {MAX_ROWS} rows — aggregate or filter to see the rest)"
        )
    output = "\n".join(lines)
    if len(output) > MAX_OUTPUT_CHARS:
        output = (
            output[:MAX_OUTPUT_CHARS]
            + "\n(output shortened — aggregate or filter more)"
        )
    return output


def build_query_tools(
    db: Session, user: User, scope: BranchScope, sources: list[ToolSource]
) -> list:
    # The rows of the latest query that worked: what `show_chart` draws. A refused or failed
    # query clears it, so a chart can never be drawn from an older, different result.
    last: dict[str, tuple[list[str], list[tuple], bool] | None] = {"result": None}
    charts_drawn = {"count": 0}

    @tool
    def describe_data() -> str:
        """The views you can query with run_query — their columns, what each means, the
        rules to follow, and worked example queries. Call it before writing a query for
        a question no other tool answers."""
        return describe(db, include_wholesale=user.role in WHOLESALE_ROLES)

    @tool
    def run_query(sql: str) -> str:
        """Run one read-only SELECT over the views from describe_data and get the rows
        back. Use it when no other tool answers the question (a custom comparison,
        a breakdown by category or weekday, ...), and also when the answer should be a chart
        (a comparison of 3 or more things, a trend, parts of a whole): show_chart draws
        the rows of this query. The answer is an ad-hoc figure: say so.
        If it fails, read the message, fix the query once, and try again."""
        try:
            guarded = check(sql, db.get_bind().dialect.name)
        except UnsafeQuery as exc:
            last["result"] = None
            return f"Query refused: {exc}"
        if (
            set(guarded.views) & WHOLESALE_VIEW_NAMES
            and user.role not in WHOLESALE_ROLES
        ):
            last["result"] = None
            return (
                "Query refused: the wholesale views aren't available to this account."
            )
        full_sql = with_views(
            db,
            guarded.sql,
            user.branch_id,
            used=set(guarded.views),
            wholesale_branch_id=user.branch_id,
        )
        try:
            columns, rows, truncated = _run_read_only(db, full_sql)
        except QueryFailed as exc:
            last["result"] = None
            return f"Query failed: {exc}"
        last["result"] = (columns, rows, truncated)
        sources.append(
            ToolSource(
                "run_query",
                "Ad-hoc query",
                branch=scope.label(user.branch_id),
                query=guarded.display_sql[:MAX_SOURCE_SQL_CHARS],
                row_count=len(rows),
            )
        )
        return _format(columns, rows, truncated)

    @tool
    def show_chart(
        kind: str, x: str, y: list[str], title: str, unit: str | None = None
    ) -> str:
        """Draw the rows of your latest run_query as a chart under the answer. Use it only when
        the question is a comparison, a trend over time, or parts of a whole, and the query
        returned at least 3 rows; for one number or two items just answer in words.
        kind: bar (ranking, few short labels), hbar (ranking with long labels), line (over
        time: dates or months in x) or share (parts of a whole, up to 6 parts).
        x is the label column and y the number column(s) from that query, spelled exactly as
        the query's columns. title is a short plain title. unit is ks (money), count, percent
        or sets; leave it out and it is guessed from the column name. The values come from the
        query rows, never from you. If it says no chart was drawn, answer in words."""
        result = last["result"]
        if result is None:
            return (
                "No chart drawn yet: a chart is drawn from the rows of a run_query result and "
                "there is none. If this question should have a chart, call run_query now for "
                "these numbers (describe_data first if you need the columns), then call "
                "show_chart again."
            )
        if charts_drawn["count"] >= MAX_CHARTS_PER_ANSWER:
            return f"No chart drawn: at most {MAX_CHARTS_PER_ANSWER} charts per answer."
        columns, rows, truncated = result
        outcome = build_chart(
            columns,
            rows,
            truncated=truncated,
            kind=kind,
            x=x,
            y=y,
            title=title,
            unit=unit,
        )
        if outcome.spec is None:
            return outcome.message
        charts_drawn["count"] += 1
        sources.append(
            ToolSource("chart", outcome.spec["title"], chart=spec_json(outcome.spec))
        )
        drawn = outcome.spec
        return (
            f"Chart drawn ({drawn['kind']}, {len(drawn['labels'])} points). "
            + (
                f"{drawn['caption']} Say so in your answer. "
                if drawn["caption"]
                else ""
            )
            + "Do not describe it point by point; the first sentence is still the conclusion."
        )

    @tool
    def report_gap(what_was_needed: str) -> str:
        """Call this when you could not answer a question with any tool or query — say in a
        sentence what data or ability was missing. It is logged so the app can be improved.
        Then tell the user plainly that you can't answer it."""
        sources.append(
            ToolSource("gap", f"Couldn't answer: {what_was_needed.strip()[:200]}")
        )
        return "Noted. Now tell the user plainly what you could not answer."

    return [describe_data, run_query, show_chart, report_gap]
