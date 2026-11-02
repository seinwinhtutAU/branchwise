from app.retail.services import import_common
from app.retail.services.import_common import clean_description, clean_text, title_case


def test_title_case_normalizes_product_descriptions():
    """The whole point: the same brand typed five different ways reads one way."""
    assert title_case("golden duck") == "Golden Duck"
    assert title_case("goldenduck") == "Goldenduck"
    assert title_case("NIKE") == "Nike"
    assert title_case("adidas") == "Adidas"
    assert title_case("CLassic") == "Classic"
    assert title_case("Govy  soft") == "Govy Soft"


def test_title_case_leaves_myanmar_and_codes_alone():
    """Myanmar has no case at all, and a word carrying a digit reads as a size or code —
    "500ML" lowercased to "500Ml" looks like a typo rather than a tidy-up."""
    assert title_case("မိုးစီး") == "မိုးစီး"
    assert title_case("500ML bottle") == "500ML Bottle"
    assert title_case("3D sticker") == "3D Sticker"


def test_clean_description_collapses_whitespace_then_title_cases():
    assert clean_description("  golden   duck \n") == "Golden Duck"


def test_clean_text_rechecks_mixed_encoding_after_each_conversion(monkeypatch):
    detections = iter([True, True, False])
    monkeypatch.setattr(import_common, "is_zawgyi", lambda text: next(detections))
    monkeypatch.setattr(import_common.pds, "cvt2uni", lambda text: f"{text}!")
    clean_text.cache_clear()

    try:
        assert clean_text("က") == "က!!"
    finally:
        clean_text.cache_clear()
