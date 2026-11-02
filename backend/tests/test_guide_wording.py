"""The written guides (`docs/guide/`) are what the assistant reads and quotes to the owner and staff.

They must sound like a shop owner explaining the app, and use the words the screens use. This test keeps the
agreed words (one name per idea) and keeps code out of them: no file paths, function names or change dates.
Developer references live in `docs/retail` and `docs/wholesale`, which are not read by the assistant.
"""

import re
from pathlib import Path

import pytest

GUIDE_ROOT = Path(__file__).resolve().parents[2] / "docs" / "guide"
GUIDES = sorted(GUIDE_ROOT.rglob("*.md"))

# Files that exist to list the words people wrongly use, and what to say instead.
GLOSSARIES = {"words-we-use.md", "words-everywhere.md"}

# Never in a wholesale guide (the owner's agreed words). Pattern -> what to write instead.
WHOLESALE_BANNED = {
    r"write[- ]offs?|write off": "say what happened: missing, damaged or lost products",
    r"\bset aside\b|\breserved\b|\bcommitted\b": "Allocated",
    r"\bfactor(y|ies)\b": "Supplier",
    r"balance due|\boutstanding\b|unpaid by": "Left to pay or Left to collect",
    r"\bcolours?\b": "colors",
    r"\bqty\b": "Quantity",
    r"\bfreight\b|\blanded\b|\blanding\b": "cost (Transportation cost)",
    r"\bgoods\b": "products",
    r"\bbox(es)?\b": "Package, or field for an input",
    r"\bremarks?\b": "Note",
    r"\bcargo (company|fee)\b": "Carrier",
    r"\bMMK\b": "Ks",
    r"\bon hand\b": "in stock",
    r"\breconcil": "check",
    r"\bpipeline\b": "(a system word)",
    r"\bmodels?\b": "product",
    r"percentage points?": "%",
}

# Never in a retail guide: the Dashboard's words win.
RETAIL_BANNED = {
    r"\bbasket": "transaction, average sale, items per transaction",
    r"\bcolours?\b": "colors",
    r"\breconcil": "check",
    r"percentage points?": "%",
    r"\bMMK\b": "Ks",
    r"write[- ]offs?|write off": "say what happened",
    r"\bWarning page\b": "Data Quality page",
}

# What marks a guide as a code diary.
CODE_SMELLS = {
    r"\b(backend|frontend)/": "a file path",
    r"\bapp/[a-z_]+/": "a file path",
    r"\b[a-z_]+\.(py|tsx?|json)\b": "a file name",
    r"/api/": "an endpoint",
    r"`[a-z]+(_[a-z0-9]+)+`": "a code name in backticks",
    r"`[a-z]+[A-Z][A-Za-z]*`": "a code name in backticks",
    r"^Sources?:": "a source line (it belongs in docs/calculation-sources.md)",
    r"\b([Uu]ntil|[Ss]ince|[Cc]hanged|as of)\s+20\d\d-\d\d-\d\d": "a date (a change log does not belong in a guide)",
}


def _lines(path: Path):
    in_aliases = False
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        # "Other ways to ask" lines are the words people really use, wrong ones included, so they can be found.
        if line.lstrip().startswith("*Other ways to ask"):
            in_aliases = True
        elif not line.strip():
            in_aliases = False
        if in_aliases:
            continue
        yield number, line


def _violations(path: Path, banned: dict[str, str], flags: int = re.IGNORECASE) -> list[str]:
    found = []
    for number, line in _lines(path):
        for pattern, instead in banned.items():
            if re.search(pattern, line, flags):
                found.append(f"{path.name}:{number}: {line.strip()[:80]!r} -> {instead}")
    return found


def test_the_guides_are_found():
    assert len(GUIDES) >= 10


@pytest.mark.parametrize("guide", GUIDES, ids=lambda path: f"{path.parent.name}/{path.name}")
def test_a_guide_uses_the_agreed_words(guide: Path):
    if guide.name in GLOSSARIES:
        return
    banned = {}
    if guide.parent.name in ("wholesale", "common"):
        banned |= WHOLESALE_BANNED if guide.parent.name == "wholesale" else {}
    if guide.parent.name == "retail":
        banned |= RETAIL_BANNED
    assert not _violations(guide, banned)


@pytest.mark.parametrize("guide", GUIDES, ids=lambda path: f"{path.parent.name}/{path.name}")
def test_a_guide_has_no_code_in_it(guide: Path):
    assert not _violations(guide, CODE_SMELLS, flags=0)
