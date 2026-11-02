"""The step-by-step guides (`docs/guide/wholesale/how-to-*.md`) name real buttons and pages.

A guide that says "press Allocate" when the screen says "Allocate stock" costs the user's trust at
once, so every **bold** word in a guide must be a word the app's screens actually contain.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
GUIDES = sorted((ROOT / "docs" / "guide" / "wholesale").glob("how-to-*.md"))
SCREEN_FILES = sorted((ROOT / "frontend" / "renderer" / "src").rglob("*.tsx"))

# In a guide, bold means a word on a screen; a troubleshooting lead-in is italic.
# Bold words that label the guide's own structure rather than something on a screen.
NOT_ON_SCREEN = {"Short answer"}
BOLD = re.compile(r"\*\*(.+?)\*\*")
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


NOUN_TEMPLATE = re.compile(r"`([^`$]*?)\$\{copy\.noun\}([^`]*)`")
NOUN_VALUE = re.compile(r'\bnoun: "([^"]+)"')


@pytest.fixture(scope="module")
def screen_text() -> str:
    text = "\n".join(path.read_text(encoding="utf-8") for path in SCREEN_FILES)
    # A label built as `Save ${copy.noun}` is on screen once per noun a page passes in
    # (customer, supplier, ...), so spell those out rather than search for the template.
    nouns = set(NOUN_VALUE.findall(text))
    for before, after in set(NOUN_TEMPLATE.findall(text)):
        text += "\n" + "\n".join(f"{before}{noun}{after}" for noun in nouns)
    return text.replace("&amp;", "&")


def test_the_guides_are_found():
    assert len(GUIDES) >= 3
    assert SCREEN_FILES


@pytest.mark.parametrize("guide", GUIDES, ids=lambda path: path.name)
def test_every_bold_word_is_on_a_screen(guide: Path, screen_text: str):
    labels = {m.strip().rstrip(":.") for m in BOLD.findall(guide.read_text(encoding="utf-8"))}
    missing = sorted(
        label for label in labels - NOT_ON_SCREEN if label not in screen_text
    )
    assert not missing, f"{guide.name} names things no screen has: {missing}"


@pytest.mark.parametrize("guide", GUIDES, ids=lambda path: path.name)
def test_a_guide_is_a_question_with_numbered_steps(guide: Path):
    text = guide.read_text(encoding="utf-8")
    assert text.startswith("# ") and text.splitlines()[0].rstrip().endswith("?")
    assert re.search(r"^1\. ", text, re.MULTILINE), "no numbered steps"
    assert "**Short answer:**" in text
    assert not EMOJI.search(text), "no emoji in guides"
    assert len(text) < 6000, "a guide should stay short enough to read in one go"


def test_every_page_a_guide_can_open_is_a_real_menu_item():
    routes = (ROOT / "frontend/renderer/src/components/features/chat/pageRoutes.ts").read_text(
        encoding="utf-8"
    )
    app = (ROOT / "frontend/renderer/src/App.tsx").read_text(encoding="utf-8")
    pairs = re.findall(r'^\s+(\w+): "(\w+)",$', routes, re.MULTILINE)
    assert pairs
    for label, route in pairs:
        assert f'id: "{route}", label: "{label}"' in app, f"{label} is not a menu item"
