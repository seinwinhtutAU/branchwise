"""Catch an answer that gives figures without having looked anything up.

The prompt says every number must come from a tool, but a model sometimes answers from nothing
(a table of invented zeros was shown to the owner this way). A rule in the prompt cannot stop
that; this check can: if a turn gave figures and called no tool that could have produced them,
the answer is not shown. The agent is asked once more, and if it still has not looked anything
up, it says so instead of giving figures.

The second check is stricter: every figure in the reply must be one a tool returned this turn (or
one the model was told in words). A figure that is not, such as a share worked out by hand, sends
the agent back once to get it from a query; if it still is not, the reply ends with a plain note
saying which figures the assistant worked out itself. It is a note, not a refusal, so a check that
is wrong costs a line of text, never a correct answer.
"""

import re

# Tools that look at no figures themselves: describing the views, noting a gap, drawing rows an
# earlier query returned. A turn that used only these has not looked anything up.
NO_FIGURES_TOOLS = {"describe_data", "report_gap", "show_chart"}

RETRY_NOTE = (
    "Your last reply gave figures without calling any tool in this turn. Do not answer from "
    "memory or from earlier replies. Call the right tool now and answer only from what it returns."
)

FALLBACK_REPLY = (
    "I couldn't check the data for this question, so I won't give figures. Please ask again.\n\n"
    "\u8fd9\u6b21\u6ca1\u80fd\u67e5\u5230\u6570\u636e\uff0c\u6240\u4ee5\u6211\u4e0d\u7ed9\u51fa\u6570\u5b57\uff0c\u8bf7\u518d\u95ee\u4e00\u6b21\u3002"
)

UNCHECKED_NOTE = "(Worked out by the assistant, not read from the data: {figures})"

RETRY_FIGURES_NOTE = (
    "These figures in your last reply do not appear in any tool result of this turn: {figures}. "
    "Do not work figures out by hand. Get them from a tool (run_query can compute shares, "
    "differences and averages), or leave them out. Then answer again."
)

# A whole number this small is a count, a rank or a day of the month ("5 days", "top 3"), not a
# figure to check, unless it is a percentage.
STRUCTURAL_MAX = 31

_DATE = re.compile(r"\d{4}-\d{2}(-\d{2})?")
_LIST_MARKER = re.compile(r"^\s*\d+[.)、]\s", re.MULTILINE)
_NUMBER = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
_FIGURE = re.compile(r"(\d+(?:,\d{3})*(?:\.\d+)?)(\s*%)?")


def _is_year(token: str) -> bool:
    """A four-digit year without a comma is a year, not a business figure.

    This holds whether it has a locale-specific suffix or not. A figure of 2,026 has its comma.
    """
    return token.isdigit() and len(token) == 4 and 1990 <= int(token) <= 2100


def figures_in(reply: str) -> list[str]:
    """The numbers in a reply that could be data: dates, years and the numbers of a list of steps
    are not."""
    text = _LIST_MARKER.sub("", _DATE.sub(" ", reply))
    return [token for token in _NUMBER.findall(text) if not _is_year(token)]


def is_ungrounded(reply: str, tools_this_turn: list[str], known: str = "") -> bool:
    """Figures were given but nothing was looked up to produce them. Figures the model was
    already told (the owner's pinned notes, the user's own question) are not invented."""
    if any(name not in NO_FIGURES_TOOLS for name in tools_this_turn):
        return False
    told = set(figures_in(known))
    return any(figure not in told for figure in figures_in(reply))


def _strip(text: str) -> str:
    return _LIST_MARKER.sub("", _DATE.sub(" ", text))


def _value(token: str) -> float | None:
    try:
        return float(token.replace(",", ""))
    except ValueError:
        return None


def _decimals(token: str) -> int:
    return len(token.split(".", 1)[1]) if "." in token else 0


def figures_returned(texts: list[str]) -> list[float]:
    """Every number in what the tools returned (and what the model was told)."""
    found: list[float] = []
    for text in texts:
        for match in _FIGURE.finditer(_strip(text)):
            value = _value(match.group(1))
            if value is not None:
                found.append(value)
    return found


def unchecked_figures(reply: str, returned: list[float]) -> list[str]:
    """The figures in `reply` that no tool result contains, as written. A figure matches when it
    equals a returned number to the precision it is written at ("46" matches 46.4, "46.4" does not
    match 46.9). Small whole numbers (counts, ranks, days) are not checked unless they are %."""
    unchecked: list[str] = []
    for match in _FIGURE.finditer(_strip(reply)):
        token, percent = match.group(1), bool(match.group(2))
        value = _value(token)
        if value is None:
            continue
        if not percent and _is_year(token):
            continue
        if (
            not percent
            and "." not in token
            and "," not in token
            and value <= STRUCTURAL_MAX
        ):
            continue
        tolerance = 0.5 * 10 ** -_decimals(token) + 1e-9
        if any(abs(value - found) <= tolerance for found in returned):
            continue
        written = f"{token}%" if percent else token
        if written not in unchecked:
            unchecked.append(written)
    return unchecked
