"""Derived money totals shared by wholesale routers and monitoring views."""

from app.wholesale.services.currency import kyat_amount
from app.wholesale.services.units import priced_amount


def order_totals(order) -> dict[str, float]:
    total = sum(
        priced_amount(line.quantity_pairs, line.unit, float(line.selling_price), getattr(line, "unit_conversions", None))
        for line in order.lines
    )
    paid = sum(float(payment.amount) for payment in order.payments)
    balance_due = 0.0 if round(paid) >= round(total) else total - paid
    return {"total": total, "paid": paid, "balance_due": balance_due}


def voucher_subtotal(voucher) -> float:
    """What the lines add up to, before the supplier's discount."""
    return sum(
        priced_amount(line.quantity_pairs, line.unit, float(line.buying_price), getattr(line, "unit_conversions", None))
        for line in voucher.lines
    )


def voucher_discount(voucher, subtotal: float | None = None) -> float:
    """The supplier's discount in Kyat: a fixed amount, a Baht amount at its own rate, or a
    percentage of the lines' total, never more than the total itself."""
    subtotal = voucher_subtotal(voucher) if subtotal is None else subtotal
    kind = getattr(voucher, "discount_kind", "none")
    value = float(getattr(voucher, "discount_value", 0) or 0)
    if kind == "percent":
        amount = subtotal * value / 100
    elif kind == "amount":
        amount = value
    elif kind == "baht":
        # The Baht amount at the rate it was entered with, rounded like every foreign amount.
        rate = getattr(voucher, "discount_exchange_rate", None)
        amount = float(kyat_amount(value, rate)) if rate else 0.0
    else:
        amount = 0.0
    return round(max(0.0, min(subtotal, amount)), 2)


def voucher_price_factor(voucher) -> float:
    """What a line's buying price becomes once the discount is shared out in proportion to each
    line's amount: 0.9 for a 10% discount. 1 when there is no discount."""
    subtotal = voucher_subtotal(voucher)
    return 1.0 if subtotal <= 0 else 1 - voucher_discount(voucher, subtotal) / subtotal


def voucher_totals(voucher) -> dict[str, float]:
    """`total` is what is owed to the supplier: the lines less the discount. Payment caps, the
    balance and every cost figure read this one."""
    subtotal = voucher_subtotal(voucher)
    discount = voucher_discount(voucher, subtotal)
    total = subtotal - discount
    paid = sum(float(payment.amount) for payment in voucher.payments)
    balance_due = 0.0 if round(paid) >= round(total) else total - paid
    return {"subtotal": subtotal, "discount": discount, "total": total, "paid": paid, "balance_due": balance_due}
