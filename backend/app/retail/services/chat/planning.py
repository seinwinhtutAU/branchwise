"""Planning a question that needs several lookups before the assistant answers it.

Most questions are one figure or one list and need no plan: planning them would only add a model
call. So a cheap rule decides first (`should_plan`: "why", "compare", several questions in one, a
long question), and only then is the model asked for a plan. The plan is a short numbered list of
what to look up, written before any tool runs, and it goes into the system message as a checklist
the agent follows step by step (calling the tools each step needs) before it writes the one answer.
The answer's figure check is unchanged: every number still has to come from a tool.

The plan is a guide, not a program: the agent may skip a step an earlier result already covers, and
a question the model calls simple gets no plan at all.
"""

import re
from dataclasses import dataclass

from app.retail.services.chat.small_call import ask_model

MAX_STEPS = 5
MIN_WORDS_FOR_A_PLAN = 16
PLAN_TIMEOUT_SECONDS = 25
SIMPLE = "SIMPLE"

# Words that mark a question as a "why / compare / several things" one, in English, Chinese and Burmese.
# Questions that diagnose ("why did it fall", "what changed"), where a step-by-step look pays off. A plain
# comparison is not here on purpose: it is one comparison and often a chart, and a plan whose last step
# was "answer" made the agent skip the chart.
_HINTS = re.compile(
    r"\b(why|reason|reasons|cause|causes|because|explain|what changed|how come|decline|declined|"
    r"drop|dropped|fell|fall|falling|behind)\b"
    r"|\u4e3a\u4ec0\u4e48|\u4e3a\u4f55|\u539f\u56e0|\u600e\u4e48\u56de\u4e8b|\u4e0b\u964d|\u53d8\u5316|"
    r"ဘာကြောင့်|အကြောင်းရင်း|ကျဆင်း|အပြောင်းအလဲ",
    re.IGNORECASE,
)

PLAN_PROMPT = """You plan how an assistant for a Myanmar shop owner will answer one question, using only \
the tools below. Write the plan, not the answer.

Question: {question}

Tools:
{tools}

Write 2 to {max_steps} short numbered steps, one per line, in English. Each step is one thing to look up \
(name the tool when it is clear) or the one comparison to make from what was found. If the question \
compares three or more things or asks about a trend over time, include a step to draw a chart with \
show_chart after the figures come from run_query. The last step is to answer. Do not invent tools. If one lookup answers the question, write exactly: {simple}"""


@dataclass(frozen=True)
class Plan:
    steps: list[str]
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0


def should_plan(question: str) -> bool:
    """A question worth the extra model call: it asks why or compares, holds more than one question,
    or is simply long."""
    flat = " ".join(question.split())
    if not flat:
        return False
    if len(flat.split()) >= MIN_WORDS_FOR_A_PLAN:
        return True
    if flat.count("?") + flat.count("？") >= 2:
        return True
    return bool(_HINTS.search(flat))


def parse_plan(text: str) -> list[str]:
    """The steps in a model's reply, or none when it said the question is simple (or wrote nothing
    usable). Numbering and bullets are stripped, and no more than MAX_STEPS are kept."""
    if not text or text.strip().upper().startswith(SIMPLE):
        return []
    steps = []
    for line in text.splitlines():
        step = re.sub(r"^\s*(?:\d+[.)]|[-*•])\s*", "", line).strip()
        if step and len(step) <= 300:
            steps.append(step)
    return steps[:MAX_STEPS] if len(steps) >= 2 else []


def plan_prompt(steps: list[str]) -> str:
    """The checklist added to the system message."""
    numbered = "\n".join(f"{i}. {step}" for i, step in enumerate(steps, start=1))
    return (
        "\n\nPlan for this question. Work through it in order, calling the tools each step needs; skip a "
        "step only if an earlier result already covers it. When the steps are done, write one answer that "
        "still follows every rule above (every figure from a tool, short and plain).\n" + numbered
    )


def make_plan(question: str, tools: list, ask=ask_model) -> Plan | None:
    """Ask the model for a plan. A Plan with no steps means it called the question simple (its tokens
    still count); None means the call failed."""
    listing = "\n".join(
        f"- {t.name}: {' '.join((t.description or '').split())[:160]}" for t in tools
    )
    prompt = PLAN_PROMPT.format(question=question, tools=listing, max_steps=MAX_STEPS, simple=SIMPLE)
    result = ask(prompt, temperature=0, timeout=PLAN_TIMEOUT_SECONDS)
    if result is None:
        return None
    return Plan(
        steps=parse_plan(result.text),
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        cached_input_tokens=result.cached_input_tokens,
    )
