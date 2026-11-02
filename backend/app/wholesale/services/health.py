"""The Wholesale health score: one 0-100 figure for the branch and one per part of the business,
so the owner can read it next to the retail branches' scores.

It follows the retail Branch Health Score's two rules (docs/retail/branch_health.md):

1. Nothing is measured twice. Every figure is read from what the Dashboard tabs already work
   out (the `open_*` dashboards and delivered-profit calculation), so the score and the tab it
   points to can never disagree.
2. A figure that cannot be known is `None`, never 0. It is neutral (50) in a partially-known
   Branch Health Score and reduces score confidence; a completely empty branch remains unscored.

The parts differ from retail's because wholesale trades differently: a few large orders, long and
variable transport, and inventory bought specifically for open orders. The score therefore looks
at whether orders can be completed, whether stock covers them, whether payments are being made,
and whether completed deliveries are profitable. `score_from_bands` and `health_status` are small
copies of retail's — wholesale does not import from the retail package.
"""

import math
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.app_settings import AppSetting
from app.wholesale.services import dashboard as tabs

# Same colours as retail: >= 80 green, >= 60 amber, below that red.
HEALTHY_SCORE = 80.0
NEEDS_ATTENTION_SCORE = 60.0

_POSITIVE_SHARE_BANDS = ((0.0, 0.0), (50.0, 40.0), (75.0, 70.0), (90.0, 90.0), (100.0, 100.0))
_NEGATIVE_SHARE_BANDS = ((0.0, 100.0), (10.0, 85.0), (25.0, 60.0), (50.0, 20.0), (75.0, 0.0))
_NET_MARGIN_BANDS = ((-10.0, 0.0), (0.0, 25.0), (3.0, 50.0), (8.0, 80.0), (15.0, 100.0))


def health_status(score: float | None) -> str | None:
    if score is None:
        return None
    rounded = round(score)
    if rounded >= HEALTHY_SCORE:
        return "healthy"
    if rounded >= NEEDS_ATTENTION_SCORE:
        return "needs_attention"
    return "critical"


def score_from_bands(value: float, bands: tuple[tuple[float, float], ...]) -> float:
    """Linear interpolation between (value, score) breakpoints, clamped at both ends."""
    if value <= bands[0][0]:
        return bands[0][1]
    if value >= bands[-1][0]:
        return bands[-1][1]
    for (low_value, low_score), (high_value, high_score) in zip(bands, bands[1:]):
        if low_value <= value <= high_value:
            span = high_value - low_value
            if span == 0:
                return high_score
            return low_score + (high_score - low_score) * (value - low_value) / span
    return bands[-1][1]


@dataclass(frozen=True)
class SubMetric:
    key: str
    label: str
    unit: str  # pct | pct_change | days — how the page formats the value
    weight: float
    bands: tuple[tuple[float, float], ...]
    definition: str


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    weight: float
    description: str
    sub_metrics: tuple[SubMetric, ...]


DIMENSIONS: tuple[Dimension, ...] = (
    Dimension(
        "orders",
        "Orders",
        35.0,
        "Can we send customer orders?",
        (
            SubMetric(
                "ready_to_send_pct",
                "Orders ready to send",
                "pct",
                50.0,
                _POSITIVE_SHARE_BANDS,
                "The share of undelivered order quantity that is ready to deliver now.",
            ),
            SubMetric(
                "waiting_for_stock_pct",
                "Orders waiting for stock",
                "pct",
                50.0,
                _NEGATIVE_SHARE_BANDS,
                "The share of undelivered order quantity that is still waiting for stock.",
            ),
        ),
    ),
    Dimension(
        "money",
        "Money",
        20.0,
        "Are payments under control?",
        (
            SubMetric(
                "customer_payment_pct",
                "Customer payments received",
                "pct",
                50.0,
                _POSITIVE_SHARE_BANDS,
                "The share of open customer-order value that customers have paid.",
            ),
            SubMetric(
                "supplier_payment_pct",
                "Supplier vouchers paid",
                "pct",
                50.0,
                _POSITIVE_SHARE_BANDS,
                "The share of open supplier-voucher value that has been paid.",
            ),
        ),
    ),
    Dimension(
        "inventory",
        "Inventory",
        25.0,
        "Is stock prepared for open orders?",
        (
            SubMetric(
                "stock_for_open_orders_pct",
                "Stock for open orders",
                "pct",
                60.0,
                _POSITIVE_SHARE_BANDS,
                "Available, allocated and confirmed incoming stock as a share of undelivered order quantity.",
            ),
            SubMetric(
                "stock_allocated_pct",
                "Stock allocated to orders",
                "pct",
                40.0,
                _POSITIVE_SHARE_BANDS,
                "Stock already allocated to customer orders as a share of undelivered order quantity.",
            ),
        ),
    ),
    Dimension(
        "profit",
        "Profit",
        20.0,
        "Are delivered orders making money?",
        (
            SubMetric(
                "costs_recorded_pct",
                "Costs recorded",
                "pct",
                40.0,
                _POSITIVE_SHARE_BANDS,
                "The share of delivered revenue with both product and transportation cost recorded.",
            ),
            SubMetric(
                "net_margin_pct",
                "Profit on delivered orders",
                "pct",
                60.0,
                _NET_MARGIN_BANDS,
                "Net margin from delivered revenue after product and transportation cost.",
            ),
        ),
    ),
)

_UNAVAILABLE = {
    "orders": "No undelivered customer orders to judge.",
    "money": "No open orders or open supplier vouchers to judge.",
    "inventory": "No undelivered customer orders to compare stock against.",
    "profit": "No delivered orders with complete cost information in this period.",
}


# --- Owner-set weights ------------------------------------------------------------------

WEIGHTS_KEY = "wholesale_health_weights"
MAX_WEIGHT = 100.0


def default_weights() -> dict[str, dict[str, float]]:
    """The weights written in DIMENSIONS: one per part, and one per measure within its part."""
    return {
        "dimensions": {d.key: d.weight for d in DIMENSIONS},
        "sub_metrics": {sub.key: sub.weight for d in DIMENSIONS for sub in d.sub_metrics},
    }


def _clean(saved: object, defaults: dict[str, float]) -> dict[str, float]:
    """A saved set laid over the defaults: unknown keys and unusable numbers fall back, so a
    setting saved before a measure existed (or hand-edited) still gives a complete set."""
    if not isinstance(saved, dict):
        return dict(defaults)
    result = dict(defaults)
    for key in defaults:
        value = saved.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if math.isfinite(value) and 0 <= value <= MAX_WEIGHT:
                result[key] = float(value)
    return result


def merge_weights(saved: object) -> dict[str, dict[str, float]]:
    defaults = default_weights()
    saved = saved if isinstance(saved, dict) else {}
    return {
        "dimensions": _clean(saved.get("dimensions"), defaults["dimensions"]),
        "sub_metrics": _clean(saved.get("sub_metrics"), defaults["sub_metrics"]),
    }


def validate_weights(payload: dict) -> dict[str, dict[str, float]]:
    """A weight set from the owner, checked before it is saved. Raises ValueError with a
    sentence that can be shown as it is."""
    defaults = default_weights()
    out: dict[str, dict[str, float]] = {}
    for group in ("dimensions", "sub_metrics"):
        given = payload.get(group)
        if not isinstance(given, dict):
            raise ValueError("Send a weight for every part and every measure.")
        unknown = set(given) - set(defaults[group])
        if unknown:
            raise ValueError(f"Unknown weight: {sorted(unknown)[0]}.")
        out[group] = dict(defaults[group])
        for key, value in given.items():
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("Weights must be numbers.")
            if value < 0 or value > MAX_WEIGHT:
                raise ValueError(f"Weights go from 0 to {MAX_WEIGHT:.0f}.")
            out[group][key] = float(value)
    if sum(out["dimensions"].values()) <= 0:
        raise ValueError("At least one part needs a weight above 0.")
    for dimension in DIMENSIONS:
        if sum(out["sub_metrics"][sub.key] for sub in dimension.sub_metrics) <= 0:
            raise ValueError(f"{dimension.label} needs at least one measure with a weight above 0.")
    return out


def saved_weights(db: Session) -> dict | None:
    """What the owner saved, or None when the defaults are in use."""
    row = db.get(AppSetting, WEIGHTS_KEY)
    return row.value if row is not None and row.value else None


def save_weights(db: Session, weights: dict[str, dict[str, float]] | None) -> None:
    """Save the owner's weights; None goes back to the defaults."""
    row = db.get(AppSetting, WEIGHTS_KEY)
    if weights is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(AppSetting(key=WEIGHTS_KEY, value=weights))
    else:
        row.value = weights
    db.commit()


def weights_payload(saved: object) -> dict:
    """The weights in use and the defaults, for the editor on the Health tab."""
    return {
        "dimensions": merge_weights(saved)["dimensions"],
        "sub_metrics": merge_weights(saved)["sub_metrics"],
        "defaults": default_weights(),
        "customised": bool(saved),
    }


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _share(part: float, whole: float) -> float | None:
    return part / whole * 100 if whole > 0 else None


def measure(db: Session, branch_id: str | None, window) -> tuple[dict[str, float | None], dict[str, str | None]]:
    """The raw value behind each sub-metric key, and the figures it was worked out from."""
    open_revenue = tabs.open_revenue_dashboard(db, branch_id)
    open_cost = tabs.open_cost_dashboard(db, branch_id)
    open_customers = tabs.open_customer_dashboard(db, branch_id)
    inventory = tabs.open_inventory_dashboard(db, branch_id)
    profit = tabs.gross_profit_payload(db, branch_id, window)

    values: dict[str, float | None] = {}
    calc: dict[str, str | None] = {}

    undelivered = float(open_customers["to_deliver_pairs"])
    fulfillment = {row["stage"]: row for row in open_customers["fulfillment"]}
    waiting = float(fulfillment.get("waiting_for_stock", {}).get("left_pairs", 0))
    values["ready_to_send_pct"] = _share(float(open_customers["ready_pairs"]), undelivered)
    calc["ready_to_send_pct"] = (
        f"{int(open_customers['ready_pairs'])} of {int(undelivered)} pairs are ready to deliver."
        if values["ready_to_send_pct"] is not None
        else None
    )
    values["waiting_for_stock_pct"] = _share(waiting, undelivered)
    calc["waiting_for_stock_pct"] = (
        f"{int(waiting)} of {int(undelivered)} pairs are waiting for stock."
        if values["waiting_for_stock_pct"] is not None
        else None
    )

    values["customer_payment_pct"] = _share(open_revenue["received"], open_revenue["open_total"])
    calc["customer_payment_pct"] = (
        f"{_ks(open_revenue['received'])} received of {_ks(open_revenue['open_total'])} on open orders."
        if values["customer_payment_pct"] is not None
        else None
    )
    values["supplier_payment_pct"] = _share(open_cost["paid"], open_cost["open_total"])
    calc["supplier_payment_pct"] = (
        f"{_ks(open_cost['paid'])} paid of {_ks(open_cost['open_total'])} on open vouchers."
        if values["supplier_payment_pct"] is not None
        else None
    )

    available = sum(group["available_pairs"] for group in inventory["groups"])
    allocated = sum(group["committed_pairs"] for group in inventory["groups"])
    incoming = sum(group["incoming_pairs"] for group in inventory["groups"])
    values["stock_for_open_orders_pct"] = _share(available + allocated + incoming, undelivered)
    calc["stock_for_open_orders_pct"] = (
        f"{int(available + allocated + incoming)} of {int(undelivered)} pairs are in stock or incoming."
        if values["stock_for_open_orders_pct"] is not None
        else None
    )
    values["stock_allocated_pct"] = _share(allocated, undelivered)
    calc["stock_allocated_pct"] = (
        f"{int(allocated)} of {int(undelivered)} pairs are allocated to orders."
        if values["stock_allocated_pct"] is not None
        else None
    )

    delivered_revenue = float(profit["delivered_revenue"])
    values["costs_recorded_pct"] = profit["cost_coverage_pct"] if delivered_revenue > 0 else None
    calc["costs_recorded_pct"] = (
        f"{_ks(profit['costed_delivered_revenue'])} of {_ks(delivered_revenue)} delivered revenue has recorded costs."
        if values["costs_recorded_pct"] is not None
        else None
    )
    values["net_margin_pct"] = (
        profit["net_profit"]["value"] / delivered_revenue * 100
        if delivered_revenue > 0 and profit["net_profit"]["value"] is not None and profit["cost_coverage_pct"] >= 90
        else None
    )
    calc["net_margin_pct"] = (
        f"{_ks(profit['net_profit']['value'])} net profit from {_ks(delivered_revenue)} delivered revenue."
        if values["net_margin_pct"] is not None
        else None
    )
    return values, calc


def score(
    values: dict[str, float | None], calc: dict[str, str | None], weights: dict | None = None
) -> dict:
    """Sub-metric values -> part scores -> overall score. Pure: no database, no clock.

    `weights` is the owner's set (see `merge_weights`); left out, the weights in DIMENSIONS apply.
    A metric without source data is neutral (50), never silently dropped. This preserves the
    requested 0-100 score without letting omitted data make a branch look healthier; the response
    separately reports how much of the score has evidence behind it. A completely empty branch is
    still unscored."""
    used = merge_weights(weights)
    total_weight = sum(used["dimensions"].values())
    dimensions: list[dict] = []
    weighted_total = 0.0
    measured_weight = 0.0
    has_any_measurement = False
    for dimension in DIMENSIONS:
        part_total = 0.0
        part_weight = 0.0
        part_has_measurement = False
        sub_payload = []
        for sub in dimension.sub_metrics:
            sub_weight = used["sub_metrics"][sub.key]
            value = values.get(sub.key)
            sub_score = None if value is None else score_from_bands(value, sub.bands)
            if sub_weight > 0:
                part_total += (sub_score if sub_score is not None else 50.0) * sub_weight
                part_weight += sub_weight
            if sub_score is not None:
                part_has_measurement = True
            sub_payload.append(
                {
                    "key": sub.key,
                    "label": sub.label,
                    "unit": sub.unit,
                    "weight": sub_weight,
                    "value": None if value is None else round(value, 1),
                    "score": None if sub_score is None else round(sub_score, 1),
                    "definition": sub.definition,
                    "calculation": calc.get(sub.key) if value is not None else None,
                    "bands": [[v, s] for v, s in sub.bands],
                }
            )
        part_score = part_total / part_weight if part_weight and part_has_measurement else None
        dimension_weight = used["dimensions"][dimension.key]
        weighted_total += (part_score if part_score is not None else 50.0) * dimension_weight
        if part_has_measurement:
            measured_weight += dimension_weight
            has_any_measurement = True
        dimensions.append(
            {
                "key": dimension.key,
                "label": dimension.label,
                "description": dimension.description,
                # A share of the whole (0-1), so the card can say "25% weight".
                "weight": dimension_weight / total_weight if total_weight else 0.0,
                "score": None if part_score is None else round(part_score, 1),
                "status": health_status(part_score),
                "insufficient_data_reason": None if part_score is not None else _UNAVAILABLE[dimension.key],
                "sub_metrics": sub_payload,
            }
        )
    overall = weighted_total / total_weight if has_any_measurement and total_weight else None
    for dimension in dimensions:
        dimension["effective_weight"] = (
            round(used["dimensions"][dimension["key"]] / total_weight, 4)
            if total_weight and dimension["score"] is not None
            else None
        )
    return {
        "overall_score": None if overall is None else round(overall, 1),
        "status": health_status(overall),
        "scored_weight": round(measured_weight / total_weight, 4) if total_weight else 0.0,
        "dimensions": dimensions,
    }


def build_health(db: Session, branch_id: str | None, window) -> dict:
    values, calc = measure(db, branch_id, window)
    saved = saved_weights(db)
    return {
        "date_from": window.start.isoformat(),
        "date_to": window.end.isoformat(),
        "previous_date_from": window.previous_start.isoformat(),
        "previous_date_to": window.previous_end.isoformat(),
        **score(values, calc, saved),
        "weights": weights_payload(saved),
    }
