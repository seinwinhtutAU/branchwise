"""Which model the assistant uses depends only on which keys are configured."""

from types import SimpleNamespace

import pytest

from app.retail.services.chat.llm import resolve_llm


def _settings(**values):
    base = {
        "openai_api_key": "", "openai_chat_model": "gpt-4o-mini",
        "deepseek_api_key": "", "deepseek_api_url": "https://api.deepseek.com",
        "deepseek_chat_model": "deepseek-chat", "chat_provider": "",
    }
    return SimpleNamespace(**{**base, **values})


def test_no_key_means_not_configured():
    assert resolve_llm(_settings()) is None


def test_only_an_openai_key_uses_openai_at_its_own_address():
    llm = resolve_llm(_settings(openai_api_key="sk-o"))

    assert (llm.provider, llm.model, llm.base_url) == ("openai", "gpt-4o-mini", None)


def test_only_a_deepseek_key_uses_deepseek():
    llm = resolve_llm(_settings(deepseek_api_key="sk-d"))

    assert (llm.provider, llm.model, llm.base_url) == (
        "deepseek", "deepseek-chat", "https://api.deepseek.com",
    )
    assert llm.api_key == "sk-d"


def test_with_both_keys_deepseek_wins_unless_told_otherwise():
    both = {"openai_api_key": "sk-o", "deepseek_api_key": "sk-d"}

    assert resolve_llm(_settings(**both)).provider == "deepseek"
    assert resolve_llm(_settings(**both, chat_provider="openai")).provider == "openai"
    assert resolve_llm(_settings(**both, chat_provider="DeepSeek")).provider == "deepseek"


def test_choosing_a_provider_without_its_key_is_not_configured():
    assert resolve_llm(_settings(openai_api_key="sk-o", chat_provider="deepseek")) is None
    assert resolve_llm(_settings(deepseek_api_key="sk-d", chat_provider="openai")) is None


@pytest.mark.parametrize("choice", ["gemini", "yes"])
def test_an_unknown_provider_name_is_not_configured(choice: str):
    assert resolve_llm(_settings(openai_api_key="sk-o", chat_provider=choice)) is None


def test_a_blank_address_or_model_falls_back_to_the_default():
    llm = resolve_llm(_settings(deepseek_api_key="k", deepseek_api_url="", deepseek_chat_model=""))

    assert (llm.model, llm.base_url) == ("deepseek-chat", "https://api.deepseek.com")
