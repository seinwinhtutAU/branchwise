"""Decide whether SQL written by the model is safe to run, in code rather than by prompt.

The rules: one statement, a plain SELECT (WITH allowed), reading only the assistant's views,
calling only ordinary functions. The query that finally runs is the one sqlglot *regenerates*
from what it parsed, not the original text, so the database cannot read the statement
differently from the way it was checked.

The messages are written for the model: short, and saying what to do instead, so it can fix
one mistake without ever seeing a stack trace or a table name it should not know.
"""

from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError

from app.retail.services.chat.data_views import VIEW_NAMES

MAX_SQL_CHARS = 4000

DIALECTS = {"postgresql": "postgres", "sqlite": "sqlite"}

# Statement kinds that must not appear anywhere in the tree — including inside a CTE, where
# `WITH x AS (DELETE ... RETURNING *) SELECT ...` would otherwise sneak a write past a
# root-is-SELECT check.
FORBIDDEN_NODES = frozenset(
    {
        "Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter", "AlterTable",
        "Command", "Set", "Use", "Into", "Lock", "Copy", "Grant", "Revoke", "Transaction",
        "Commit", "Rollback", "Pragma", "Attach", "Detach", "TruncateTable",
    }
)

# Functions that would let a query run for ever or build huge results out of nothing.
FORBIDDEN_FUNCTIONS = frozenset(
    {
        "GenerateSeries", "ExplodingGenerateSeries", "GenerateDateArray",
        "GenerateTimestampArray", "Explode",
    }
)

# sqlglot has no dedicated class for these, so they parse as "anonymous". Any other
# anonymous function (pg_sleep, set_config, pg_read_file, lo_import, ...) is refused.
ALLOWED_ANONYMOUS = frozenset(
    {
        "abs", "ceil", "ceiling", "floor", "greatest", "least", "length", "lower", "upper",
        "trim", "ltrim", "rtrim", "substr", "substring", "left", "right", "replace",
        "concat", "nullif", "coalesce", "ifnull", "iif", "round", "strftime", "to_char",
        "date_part", "age", "strpos", "instr", "date",
    }
)


class UnsafeQuery(ValueError):
    """The SQL was refused; the message is safe to show the model."""


@dataclass(frozen=True)
class GuardedQuery:
    sql: str
    # The same query laid out for a person to read (shown under the answer's sources).
    display_sql: str
    views: tuple[str, ...]


def _set_operation_types() -> tuple[type, ...]:
    return tuple(
        kind
        for kind in (exp.Select, getattr(exp, "SetOperation", None), getattr(exp, "Union", None))
        if kind is not None
    )


def check(sql: str, dialect: str) -> GuardedQuery:
    """Raises UnsafeQuery; otherwise returns the SQL to run and the views it reads."""
    text = sql.strip().rstrip(";").strip()
    if not text:
        raise UnsafeQuery("The query is empty.")
    if len(text) > MAX_SQL_CHARS:
        raise UnsafeQuery(f"The query is too long (over {MAX_SQL_CHARS} characters). Make it simpler.")
    read = DIALECTS.get(dialect, "postgres")
    try:
        statements = [s for s in sqlglot.parse(text, read=read) if s is not None]
    except SqlglotError as exc:
        raise UnsafeQuery(f"The SQL couldn't be parsed: {str(exc).splitlines()[0][:200]}") from exc
    if len(statements) != 1:
        raise UnsafeQuery("Send exactly one SELECT statement.")
    root = statements[0]
    if not isinstance(root, _set_operation_types()):
        raise UnsafeQuery("Only SELECT queries are allowed.")

    for node in root.walk():
        kind = type(node).__name__
        if kind in FORBIDDEN_NODES:
            raise UnsafeQuery("Only SELECT queries are allowed; nothing can be changed.")
        if kind in FORBIDDEN_FUNCTIONS:
            raise UnsafeQuery("That function isn't available. Query the views directly.")
        if isinstance(node, exp.Select) and (node.args.get("into") or node.args.get("locks")):
            raise UnsafeQuery("Only plain SELECT queries are allowed.")
        if isinstance(node, exp.Anonymous) and node.name.lower() not in ALLOWED_ANONYMOUS:
            raise UnsafeQuery(f"The function {node.name}() isn't available.")

    own_names = {cte.alias_or_name.lower() for cte in root.find_all(exp.CTE)}
    if own_names & VIEW_NAMES:
        raise UnsafeQuery("Don't give a WITH name the same name as a view.")
    used: list[str] = []
    for table in root.find_all(exp.Table):
        if not isinstance(table.this, exp.Identifier) or table.args.get("db") or table.args.get("catalog"):
            raise UnsafeQuery("Select only from the views, by plain name (no schema or functions).")
        name = table.name.lower()
        if name in VIEW_NAMES:
            if name not in used:
                used.append(name)
        elif name not in own_names:
            raise UnsafeQuery(
                f"Unknown table '{table.name}'. Use only: {', '.join(sorted(VIEW_NAMES))}."
            )
    return GuardedQuery(
        sql=root.sql(dialect=read, comments=False),
        display_sql=root.sql(dialect=read, pretty=True, comments=False),
        views=tuple(used),
    )
