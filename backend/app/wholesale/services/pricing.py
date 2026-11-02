"""The selling price to suggest for a product — the same rule the customer-order form uses
(`frontend/.../wholesale/orders/priceSuggestion.ts`; `docs/guide/wholesale/calculations.md`, "Suggested selling
price"): the product's cost per set plus the profit the owner chose, rounded up to the next 10 Ks.

The cost is read from one supplier voucher, the latest that has the product: its buying price after the
voucher's discount, and the voucher's transportation cost (every charge on its receivings) shared over the
voucher's sets."""

import math

from sqlalchemy.orm import Session, selectinload

from app.models.app_settings import DEFAULT_SETTINGS
from app.services.settings import get_setting
from app.wholesale.models.entities import Receiving, SupplierVoucher
from app.wholesale.services.money import voucher_price_factor
from app.wholesale.services.units import priced_amount
from app.models.app_settings import DEFAULT_SETTINGS
from app.services.settings import get_setting

PAIRS_PER_SET = 6


def profit_rule(db: Session) -> dict:
    """The owner's profit rule, `{"kind": "percent" | "amount", "value": number}`."""
    return get_setting(db, "wholesale_profit") or DEFAULT_SETTINGS["wholesale_profit"]


def _voucher_with(db: Session, branch_id: str | None, stock_code: str) -> SupplierVoucher | None:
    query = db.query(SupplierVoucher).options(selectinload(SupplierVoucher.lines))
    if branch_id is not None:
        query = query.filter(SupplierVoucher.branch_id == branch_id)
    code = stock_code.strip().lower()
    best = None
    for voucher in query.order_by(SupplierVoucher.voucher_date.desc(), SupplierVoucher.voucher_no.desc()).all():
        if any(line.stock_code.strip().lower() == code and float(line.buying_price) > 0 for line in voucher.lines):
            best = voucher
            break
    return best


def _transport_per_set(db: Session, voucher: SupplierVoucher) -> float:
    receivings = (
        db.query(Receiving)
        .options(selectinload(Receiving.costs))
        .filter(Receiving.voucher_no == voucher.voucher_no)
    )
    if voucher.branch_id is not None:
        receivings = receivings.filter(Receiving.branch_id == voucher.branch_id)
    cost = sum(float(entry.amount) for receiving in receivings.all() for entry in receiving.costs)
    sets = sum(max(0, line.quantity_pairs) / PAIRS_PER_SET for line in voucher.lines)
    return cost / sets if sets > 0 else 0.0


def latest_cost(db: Session, branch_id: str | None, stock_code: str) -> dict | None:
    """What a product costs per set, read from the latest voucher that has it: the supplier, the voucher, the buying
    price after the voucher's discount, and that voucher's transport cost per set. None when no voucher has it."""
    voucher = _voucher_with(db, branch_id, stock_code)
    if voucher is None:
        return None
    code = stock_code.strip().lower()
    line = next(line for line in voucher.lines if line.stock_code.strip().lower() == code)
    buying = priced_amount(PAIRS_PER_SET, line.unit, float(line.buying_price), line.unit_conversions)
    buying *= voucher_price_factor(voucher)
    return {
        "stock_code": line.stock_code,
        "description": line.description,
        "voucher_no": voucher.voucher_no,
        "supplier": voucher.supplier_name,
        "buying_per_set": buying,
        "transport_per_set": _transport_per_set(db, voucher),
    }


def suggest_price(db: Session, branch_id: str | None, stock_code: str) -> dict | None:
    """The suggestion for one product, or None when no voucher has it or the profit rule gives no price."""
    found = latest_cost(db, branch_id, stock_code)
    if found is None:
        return None
    cost = found["buying_per_set"] + found["transport_per_set"]
    rule = profit_rule(db)
    value = float(rule["value"])
    if rule["kind"] == "percent":
        if value < 0 or value >= 100:
            return None
        price = cost / (1 - value / 100)
    else:
        price = cost + max(0.0, value)
    return {
        **found,
        "profit_kind": rule["kind"],
        "profit_value": value,
        "price_per_set": math.ceil(price / 10) * 10,
    }


OPTION_MARGINS = (10, 15, 20, 25, 30)


def price_options(db: Session, branch_id: str | None, stock_code: str) -> dict | None:
    """Prices to choose between for one product: what it costs, the price that earns each of a few profit shares, and
    how the prices already in use (the product's default and the last one quoted to a customer) compare.
    None when no voucher has the product."""
    from app.wholesale.models.master_data import WholesaleProduct
    from app.wholesale.services.dashboard import _latest_selling_prices

    found = latest_cost(db, branch_id, stock_code)
    if found is None:
        return None
    cost = found["buying_per_set"] + found["transport_per_set"]

    def margin(price: float) -> float | None:
        return (price - cost) / price * 100 if price > 0 else None

    code = stock_code.strip().lower()
    product = db.query(WholesaleProduct).filter(WholesaleProduct.stock_code.ilike(code)).first()
    default = float(product.default_selling_price or 0) if product is not None else 0.0
    quoted = _latest_selling_prices(db, branch_id).get(code)
    quoted_per_set = (
        priced_amount(PAIRS_PER_SET, quoted[0], quoted[1]) if quoted else 0.0
    )
    rule = profit_rule(db)
    return {
        **found,
        "cost_per_set": cost,
        "options": [
            {"margin_pct": m, "price_per_set": math.ceil(cost / (1 - m / 100) / 10) * 10} for m in OPTION_MARGINS
        ],
        "default_price": default or None,
        "default_margin_pct": margin(default) if default else None,
        "last_quoted": quoted_per_set or None,
        "last_quoted_margin_pct": margin(quoted_per_set) if quoted_per_set else None,
        "profit_kind": rule["kind"],
        "profit_value": float(rule["value"]),
    }
