import pytest

from app.retail.services.chat.agent import PERSONAS, SYSTEM_PROMPT, _to_langchain_messages, persona_prompt


def test_each_character_has_its_own_rules_and_unknown_or_none_adds_nothing():
    assert set(PERSONAS) == {"cat", "robot"}
    cat, robot = persona_prompt("cat"), persona_prompt("robot")
    assert "little cat" in cat and "meow" in cat and "little robot" in robot and "beep" in robot
    assert cat != robot
    assert persona_prompt(None) == "" and persona_prompt("dog") == ""


@pytest.mark.parametrize("persona", ["cat", "robot"])
def test_a_character_is_style_only(persona: str):
    text = persona_prompt(persona)
    for rule in ("at most one short touch", "never let it change, soften or hide", "no emoji", "when the news is bad"):
        assert rule in text


def test_the_character_is_added_to_the_system_message_only_when_chosen():
    history = [{"role": "user", "content": "How were sales?"}]

    plain = _to_langchain_messages(history)[0].content
    cat = _to_langchain_messages(history, persona="cat")[0].content

    assert plain.startswith(SYSTEM_PROMPT[:40]) and "Personality (style only)" not in plain
    assert "Personality (style only)" in cat and cat.startswith(plain)


def test_the_request_accepts_only_the_two_characters():
    from pydantic import ValidationError

    from app.schemas.chat import ChatRequest

    assert ChatRequest(message="hi", persona="cat").persona == "cat"
    assert ChatRequest(message="hi").persona is None
    with pytest.raises(ValidationError):
        ChatRequest(message="hi", persona="dog")


def test_a_turn_passes_the_character_on_only_when_one_was_chosen():
    from app.retail.routers.chat import _Turn

    chosen = _Turn(conversation_id="c", history=[], context={}, persona="robot")
    none = _Turn(conversation_id="c", history=[], context={})
    assert chosen.agent_options() == {"persona": "robot"} and none.agent_options() == {}
