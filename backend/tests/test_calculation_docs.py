"""The calculation references (the pages in docs/guide/retail/numbers/ and docs/guide/wholesale/numbers/) are the
knowledge the assistant reads when asked how a number is worked out, so they must not drift from the code.
These tests do not prove the prose is right; they fail when a rule's name, weight, points table or constant
changes in the code and the page still says the old thing. A failure means: read the function (docs/calculation-sources.md says where each one lives), then update the page (and this test only if the *format* of the page changed)."""

import re
from pathlib import Path

import pytest

from app.retail.services import branch_health, data_quality, early_warning, import_health
from app.services import dashboard as retail_dashboard
from app.wholesale.services import dashboard as wholesale_dashboard
from app.wholesale.services import health as wholesale_health

DOCS = Path(__file__).resolve().parents[2] / "docs"
def _read(path: Path) -> str:
    """The page with its line breaks flattened, so a fact wrapped across two lines still matches."""
    return " ".join(path.read_text(encoding="utf-8").split())


RETAIL = " ".join(_read(path) for path in sorted((DOCS / "guide" / "retail" / "numbers").glob("*.md")))
WHOLESALE = " ".join(_read(path) for path in sorted((DOCS / "guide" / "wholesale" / "numbers").glob("*.md")))


def _signed(value: float) -> str:
    return f"+{value:g}" if value > 0 else f"−{abs(value):g}" if value < 0 else "0"


def _bands(bands, unit: str, *, percent_sign: bool) -> str:
    """The points table the way the pages write it: 'value→points', growth with a sign, a level with %."""
    parts = []
    for value, points in bands:
        if unit == "pct_change":
            shown = _signed(value)
        elif unit == "pct" and percent_sign:
            shown = f"{value:g}%"
        else:
            shown = f"{value:g}"
        parts.append(f"{shown}→{points:g}")
    return ", ".join(parts)


# --- Retail ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "dimension", branch_health.DIMENSIONS, ids=lambda dimension: dimension.key
)
def test_retail_health_parts_and_measures_are_written_down(dimension):
    assert f"**{dimension.label}" in RETAIL, dimension.label
    assert f"{dimension.weight * 100:.0f}%" in RETAIL
    for sub in dimension.sub_metrics:
        assert f"**{sub.label}** | {sub.weight} |" in RETAIL, f"{sub.label}: name or default weight"
        assert _bands(sub.bands, sub.unit, percent_sign=True) in RETAIL, f"{sub.label}: points table"


def test_retail_health_cutoffs_and_constants():
    assert f"**{branch_health.HEALTHY_SCORE:.0f} or more" in RETAIL
    assert f"**below {branch_health.NEEDS_ATTENTION_SCORE:.0f} =" in RETAIL
    assert f"below {branch_health.MIN_COST_COVERAGE_PCT:.0f}%" in RETAIL
    assert f"{branch_health.AGED_STOCK_DAYS} or more days" in RETAIL
    assert f"{branch_health.WEEKLY_PATTERN_DAYS} days" in RETAIL
    assert f"≥ {data_quality.RECONCILIATION_MISMATCH_THRESHOLD} units" in RETAIL


def test_retail_stock_and_dashboard_constants():
    d = retail_dashboard
    assert f"≤ {d.CRITICAL_DAYS_OF_STOCK} days" in RETAIL
    assert f"≤ {d.LOW_DAYS_OF_STOCK}" in RETAIL
    assert f"≤ {d.WATCH_DAYS_OF_STOCK}" in RETAIL
    assert f"last {d.STOCK_VELOCITY_WINDOW_DAYS} days" in RETAIL
    assert f"last {d.DEAD_STOCK_WINDOW_DAYS} days" in RETAIL
    assert f"{d.BASELINE_VELOCITY_WINDOW_DAYS}" in RETAIL
    assert f"{d.HEATMAP_START_HOUR:02d}:00 to {d.HEATMAP_END_HOUR:02d}:00" in RETAIL
    assert d.TOP_PRODUCTS_LIMIT == 10 and "The 10 products" in RETAIL


def test_every_business_alert_is_written_down():
    source = Path(early_warning.__file__).read_text(encoding="utf-8")
    ids = set(re.findall(r'\bid="([a-z_]+)"', source))
    ids |= {f"daily_import_missing_{kind}" for kind in ("sales", "inventory")}
    assert ids >= {"urgent_reorder", "stock_allocation", "footwear_aging", "physical_stock_audit"}
    for alert_id in ids:
        # The two daily-import alerts share one row ("daily_import_missing_sales / _inventory").
        key = "daily_import_missing_sales" if alert_id.startswith("daily_import_missing_") else alert_id
        assert key in RETAIL, f"alert {alert_id} is not in docs/guide/retail/numbers/"
    assert len(early_warning.RULES) == 12  # the page numbers its twelve rules


def test_import_health_constants():
    h = import_health
    assert f"{h.SALES_SKIP_RATE_THRESHOLD:.0%}" in RETAIL
    assert f"at least {h.SALES_SKIP_MIN_COUNT} slips" in RETAIL
    assert f"{h.PURCHASE_DUPLICATE_LOOKBACK_DAYS} days" in RETAIL
    assert f"{h.PURCHASE_DUPLICATE_AMOUNT_TOLERANCE_PCT:.0%}" in RETAIL
    assert f"last **{h.INVENTORY_BASELINE_LOOKBACK_BATCHES}**" in RETAIL
    assert f"at least **{h.INVENTORY_BASELINE_MIN_BATCHES}**" in RETAIL
    assert f"({h.INVENTORY_ANOMALY_RATIO:.0%})" in RETAIL


# --- Wholesale ---------------------------------------------------------------------------


@pytest.mark.parametrize("dimension", wholesale_health.DIMENSIONS, ids=lambda dimension: dimension.key)
def test_wholesale_health_parts_and_measures_are_written_down(dimension):
    assert f"**{dimension.label} ({dimension.weight:g})**" in WHOLESALE, dimension.label
    for sub in dimension.sub_metrics:
        assert f"**{sub.label} ({sub.weight:g})**" in WHOLESALE, f"{sub.label}: name or default weight"
        assert _bands(sub.bands, sub.unit, percent_sign=False) in WHOLESALE, f"{sub.label}: points table"


def test_wholesale_cutoffs_and_constants():
    h, d = wholesale_health, wholesale_dashboard
    assert f"**{h.HEALTHY_SCORE:.0f} or more" in WHOLESALE
    assert f"**below {h.NEEDS_ATTENTION_SCORE:.0f} =" in WHOLESALE
    assert f"**{d.STUCK_DAYS} days or more**" in WHOLESALE
    assert f"**{d.RUNNING_OUT_DAYS} days or less**" in WHOLESALE
    assert f"last {d.PACE_DAYS} days" in WHOLESALE
    assert f"more than {d.QUIET_FACTOR} ×" in WHOLESALE
    assert f"at least {d.MIN_DAYS_FOR_PATTERN} order days" in WHOLESALE.replace("**", "")
    assert f"{d.DEPENDENCE_PCT:.0f}% or more" in WHOLESALE
    assert d.TOP_SHARE_SHOWN == 8 and "(8)" in WHOLESALE
    assert d.PAYABLES_SHOWN == 10 and "10 newest" in WHOLESALE


def test_wholesale_pairs_per_set_matches_the_page():
    from app.wholesale.models.entities import WholesaleUnit
    from app.wholesale.services.units import PAIRS_PER

    assert PAIRS_PER[WholesaleUnit.SET] == 6 and PAIRS_PER[WholesaleUnit.DOZEN] == 12
    assert "1 set = 6 pairs; 1 dozen = 12 pairs" in WHOLESALE


def test_both_pages_are_found_by_the_knowledge_sync():
    from app.retail.services.knowledge import DOCS_FOLDERS

    assert {"retail", "wholesale"} <= set(DOCS_FOLDERS)
    assert (DOCS / "guide" / "retail" / "numbers").is_dir() and (DOCS / "guide" / "wholesale" / "numbers").is_dir()
