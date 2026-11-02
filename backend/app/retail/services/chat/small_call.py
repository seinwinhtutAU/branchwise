"""A single short model call for the small helpers (the next-question hint): one prompt in,
one piece of text out, and the tokens it used. Any failure is "no result", never an error,
because none of these helpers is worth interrupting the person for."""

import logging
from dataclasses import dataclass

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from app.config import get_settings
from app.retail.services.chat.llm import resolve_llm
from app.retail.services.chat.tokens import cached_input_tokens

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SmallCallResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int = 0


def ask_model(prompt: str, *, temperature: float, timeout: int) -> SmallCallResult | None:
    llm = resolve_llm(get_settings())
    if llm is None:
        return None
    model = ChatOpenAI(
        model=llm.model,
        api_key=llm.api_key,
        base_url=llm.base_url,
        temperature=temperature,
        timeout=timeout,
        max_retries=0,
    )
    try:
        response = model.invoke([HumanMessage(content=prompt)])
    except Exception:
        logger.info("Small model call failed", exc_info=True)
        return None
    text = response.content if isinstance(response.content, str) else ""
    usage = getattr(response, "usage_metadata", None)
    usage = usage if isinstance(usage, dict) else {}
    return SmallCallResult(
        text=text.strip(),
        model=llm.model,
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
        cached_input_tokens=cached_input_tokens(response),
    )
