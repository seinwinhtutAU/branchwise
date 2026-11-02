"""Which language model the assistant talks to.

DeepSeek and OpenAI share one API, so both go through the same client; only the key, the
address and the model name differ. DeepSeek is used when its key is set (the OpenAI key may
still be there, nearly spent); `CHAT_PROVIDER=openai` or `CHAT_PROVIDER=deepseek` overrides
that.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LLMConfig:
    provider: str
    model: str
    api_key: str
    # None means the provider's own default address (OpenAI).
    base_url: str | None


def resolve_llm(settings) -> LLMConfig | None:
    """The configured model, or None when no key is set for the chosen provider."""
    choice = (getattr(settings, "chat_provider", "") or "").strip().lower()
    deepseek_key = getattr(settings, "deepseek_api_key", "") or ""
    openai_key = getattr(settings, "openai_api_key", "") or ""
    if choice not in ("", "openai", "deepseek"):
        return None
    provider = choice or ("deepseek" if deepseek_key else "openai")
    if provider == "deepseek":
        if not deepseek_key:
            return None
        return LLMConfig(
            provider="deepseek",
            model=getattr(settings, "deepseek_chat_model", "") or "deepseek-chat",
            api_key=deepseek_key,
            base_url=getattr(settings, "deepseek_api_url", "") or "https://api.deepseek.com",
        )
    if not openai_key:
        return None
    return LLMConfig(
        provider="openai",
        model=getattr(settings, "openai_chat_model", "") or "gpt-4o-mini",
        api_key=openai_key,
        base_url=None,
    )
