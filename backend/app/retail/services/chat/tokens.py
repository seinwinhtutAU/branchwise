"""How many of a call's input tokens the provider served from its cache (billed at a lower price).

DeepSeek reports `prompt_cache_hit_tokens` and OpenAI `prompt_tokens_details.cached_tokens`;
LangChain only maps the OpenAI one into `usage_metadata`, so DeepSeek's is read from the raw
usage it keeps in `response_metadata`."""


def cached_input_tokens(message) -> int:
    usage = getattr(message, "usage_metadata", None)
    if isinstance(usage, dict):
        details = usage.get("input_token_details")
        if isinstance(details, dict) and details.get("cache_read"):
            return int(details["cache_read"])
    meta = getattr(message, "response_metadata", None)
    raw = meta.get("token_usage") if isinstance(meta, dict) else None
    if not isinstance(raw, dict):
        return 0
    if raw.get("prompt_cache_hit_tokens"):
        return int(raw["prompt_cache_hit_tokens"])
    details = raw.get("prompt_tokens_details")
    if isinstance(details, dict) and details.get("cached_tokens"):
        return int(details["cached_tokens"])
    return 0
