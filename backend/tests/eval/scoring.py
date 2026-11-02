"""Question file, expectations, and scoring — everything about judging a reply that does not
need a model, so it can be tested.

A question passes only if every check holds. The checks are deliberately plain (a number
appears, a tool was called, a phrase is absent): a failure then says exactly what was wrong,
and nothing depends on another model's opinion.
"""

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path

QUESTION_KEYS = {
    "id", "category", "turns", "truth", "tools_all", "tools_any", "tools_none", "contains_any",
    "contains_all", "not_contains", "min_chars", "max_tool_calls", "max_seconds", "context_branch", "chart", "no_chart",
}
DEFAULT_MAX_SECONDS = 90.0


@dataclass(frozen=True)
class Question:
    id: str
    category: str
    turns: tuple[str, ...]
    truth: str | None = None
    tools_all: tuple[str, ...] = ()
    tools_any: tuple[str, ...] = ()
    tools_none: tuple[str, ...] = ()
    contains_any: tuple[str, ...] = ()
    contains_all: tuple[str, ...] = ()
    not_contains: tuple[str, ...] = ()
    min_chars: int = 0
    max_tool_calls: int | None = None
    max_seconds: float = DEFAULT_MAX_SECONDS
    context_branch: str | None = None
    # A chart is expected and its kind is one of these; with `truth`, the figures and labels the
    # truth query returns must be in the chart's data.
    chart: tuple[str, ...] = ()
    # Drawing a chart here would be a mistake (one number, two items, a list of names).
    no_chart: bool = False


@dataclass
class Outcome:
    id: str
    category: str
    passed: bool
    failures: list[str] = field(default_factory=list)
    reply: str = ""
    tools_called: list[str] = field(default_factory=list)
    seconds: float = 0.0
    input_tokens: int | None = None
    output_tokens: int | None = None
    charts: list[dict] = field(default_factory=list)
    # How often the agent was sent back to look figures up, and the figures the reply ended up
    # saying it worked out itself (any of these is a figure no tool returned).
    grounding_retries: int = 0
    unchecked_figures: list[str] = field(default_factory=list)


def load_questions(path: Path) -> list[Question]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    questions: list[Question] = []
    seen: set[str] = set()
    for entry in raw:
        unknown = set(entry) - QUESTION_KEYS
        if unknown:
            raise ValueError(f"{entry.get('id', '?')}: unknown keys {sorted(unknown)}")
        for key in ("id", "category", "turns"):
            if not entry.get(key):
                raise ValueError(f"{entry.get('id', '?')}: missing '{key}'")
        if entry["id"] in seen:
            raise ValueError(f"duplicate question id {entry['id']}")
        seen.add(entry["id"])
        for pattern in entry.get("not_contains", []):
            re.compile(pattern)
        tuple_keys = (
            "turns", "tools_all", "tools_any", "tools_none", "contains_any", "contains_all", "not_contains",
            "chart",
        )
        questions.append(
            Question(**{k: tuple(v) if k in tuple_keys else v for k, v in entry.items()})
        )
    return questions


def expand(text: str, today: date) -> str:
    """Fill the date placeholders: {today}, {yesterday}, {dN} (N days ago), {last_month}."""
    first_of_month = today.replace(day=1)
    last_month = (first_of_month - timedelta(days=1)).strftime("%Y-%m")
    text = re.sub(r"\{d(\d+)\}", lambda m: (today - timedelta(days=int(m[1]))).isoformat(), text)
    return (
        text.replace("{today}", today.isoformat())
        .replace("{yesterday}", (today - timedelta(days=1)).isoformat())
        .replace("{last_month}", last_month)
    )


def _numbers(text: str) -> list[float]:
    without_commas = re.sub(r"(?<=\d),(?=\d{3})", "", text)
    return [float(token) for token in re.findall(r"\d+(?:\.\d+)?", without_commas)]


def cell_found(reply: str, cell: object) -> bool:
    """Is one expected figure or name in the reply? Amounts match as shown to the nearest Ks,
    so `Ks 3,500`, `3500` and `3,500.4` all satisfy 3500."""
    if isinstance(cell, bool) or cell is None:
        return True
    if isinstance(cell, (int, float)):
        tolerance = 0.51 if abs(cell) >= 1000 else 0.005
        return any(abs(found - cell) <= tolerance for found in _numbers(reply))
    return str(cell).casefold() in reply.casefold()


def score(
    question: Question,
    *,
    reply: str,
    tools_called: list[str],
    seconds: float,
    truth_cells: list[object],
    wrote_data: bool,
    error: str | None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    charts: list[dict] | None = None,
    grounding_retries: int = 0,
    unchecked_figures: list[str] | None = None,
) -> Outcome:
    charts = charts or []
    unchecked_figures = unchecked_figures or []
    failures: list[str] = []
    if unchecked_figures:
        failures.append(f"figures no tool returned: {unchecked_figures}")
    if error:
        failures.append(f"error: {error}")
    if wrote_data:
        failures.append("changed data (a row count differs)")
    failures.extend(_chart_failures(question, charts, truth_cells))
    for cell in truth_cells:
        if question.chart:
            break  # a charted answer is judged by the chart's data, below, not the reply's words
        if not cell_found(reply, cell):
            failures.append(f"reply is missing the expected value {cell!r}")
    for tool in question.tools_all:
        if tool not in tools_called:
            failures.append(f"did not call {tool}")
    if question.tools_any and not set(question.tools_any) & set(tools_called):
        failures.append(f"called none of {list(question.tools_any)}")
    for tool in question.tools_none:
        if tool in tools_called:
            failures.append(f"called {tool}")
    if question.contains_any and not any(
        phrase.casefold() in reply.casefold() for phrase in question.contains_any
    ):
        failures.append(f"reply has none of {list(question.contains_any)}")
    for phrase in question.contains_all:
        if phrase.casefold() not in reply.casefold():
            failures.append(f"reply is missing {phrase!r}")
    for pattern in question.not_contains:
        if re.search(pattern, reply, re.IGNORECASE):
            failures.append(f"reply matches forbidden /{pattern}/")
    if len(reply) < question.min_chars:
        failures.append(f"reply is shorter than {question.min_chars} characters")
    if question.max_tool_calls is not None and len(tools_called) > question.max_tool_calls:
        failures.append(f"used {len(tools_called)} tool calls (max {question.max_tool_calls})")
    if seconds > question.max_seconds:
        failures.append(f"took {seconds:.0f}s (max {question.max_seconds:.0f}s)")
    return Outcome(
        id=question.id,
        category=question.category,
        passed=not failures,
        failures=failures,
        reply=reply,
        tools_called=tools_called,
        seconds=round(seconds, 1),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        charts=charts,
        grounding_retries=grounding_retries,
        unchecked_figures=unchecked_figures,
    )


def _chart_failures(question: Question, charts: list[dict], truth_cells: list[object]) -> list[str]:
    if question.no_chart:
        return [f"drew a {c['kind']} chart where none was wanted" for c in charts]
    if not question.chart:
        return []
    if not charts:
        return [f"no chart was drawn (expected one of {list(question.chart)})"]
    failures: list[str] = []
    chart = charts[-1]
    if chart["kind"] not in question.chart:
        failures.append(f"drew a {chart['kind']} chart (expected one of {list(question.chart)})")
    values = [v for series in chart["series"] for v in series["values"]]
    labels = [label.casefold() for label in chart["labels"]]
    for cell in truth_cells:
        if isinstance(cell, bool) or cell is None:
            continue
        if isinstance(cell, (int, float)):
            tolerance = 0.51 if abs(cell) >= 1000 else 0.05
            if not any(abs(v - cell) <= tolerance for v in values):
                failures.append(f"the chart's data is missing the expected value {cell!r}")
        elif str(cell).casefold() not in labels:
            failures.append(f"the chart's labels are missing {cell!r}")
    return failures


def summarise(outcomes: list[Outcome]) -> dict[str, tuple[int, int]]:
    """category -> (passed, total)."""
    result: dict[str, list[int]] = {}
    for outcome in outcomes:
        counts = result.setdefault(outcome.category, [0, 0])
        counts[0] += outcome.passed
        counts[1] += 1
    return {category: (p, t) for category, (p, t) in result.items()}


def compare(old: dict, new: dict) -> tuple[list[str], list[str]]:
    """(improved, regressed) question ids between two saved reports."""
    before = {o["id"]: o["passed"] for o in old["outcomes"]}
    improved, regressed = [], []
    for outcome in new["outcomes"]:
        was = before.get(outcome["id"])
        if was is None or was == outcome["passed"]:
            continue
        (improved if outcome["passed"] else regressed).append(outcome["id"])
    return improved, regressed


def report(outcomes: list[Outcome], model: str, created_at: str) -> dict:
    return {
        "created_at": created_at,
        "model": model,
        "passed": sum(o.passed for o in outcomes),
        "total": len(outcomes),
        "outcomes": [asdict(o) for o in outcomes],
    }
