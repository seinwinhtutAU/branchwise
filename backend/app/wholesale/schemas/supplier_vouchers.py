from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.wholesale.models.entities import ProductGroup, WholesaleUnit


class SupplyLinkIn(BaseModel):
    """Part of a voucher line that was bought for one customer-order line."""

    order_line_id: str = Field(min_length=1, max_length=36)
    quantity_pairs: int = Field(gt=0)


class VoucherLineLinksIn(BaseModel):
    links: list[SupplyLinkIn] = []


class VoucherLineIn(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    product_group: ProductGroup
    color_breakdown: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET
    unit_conversions: dict[str, int] = Field(default_factory=lambda: {"pair": 1, "set": 6, "dozen": 12})
    # MMK (the default): buying_price is the Kyat unit price, typed directly.
    # Any other currency_code: original_buying_price/exchange_rate are required
    # instead, and buying_price (if sent at all) is ignored — the server computes the
    # Kyat unit price from them. See app/wholesale/services/currency.py::resolve_money.
    currency_code: str = Field(default="MMK", min_length=3, max_length=3)
    buying_price: float | None = Field(default=None, ge=0)
    original_buying_price: float | None = Field(default=None, ge=0)
    exchange_rate: float | None = Field(default=None, gt=0)
    # Optional: the customer-order lines this line is being bought for.
    for_order_lines: list[SupplyLinkIn] = []


class SupplierVoucherIn(BaseModel):
    branch_id: str | None = None
    supplier_name: str = Field(min_length=1, max_length=255)
    voucher_date: date
    # Cargo and packages come with the supplier's slip, later. Left out, an update keeps what is
    # there and a new voucher starts empty.
    carrier_name: str | None = Field(default=None, max_length=255)
    total_packages: int | None = Field(default=None, ge=0)
    # Where the goods are expected to arrive; known when the order is placed.
    receiving_gate: str | None = Field(default=None, max_length=255)
    # The supplier's discount on the whole voucher: a Kyat amount, a Baht amount or a percentage. Left out, an
    # update keeps what is there and a new voucher has none.
    discount_kind: Literal["none", "amount", "percent", "baht"] | None = None
    discount_value: float | None = Field(default=None, ge=0)
    # With kind "baht": the rate the Baht amount is converted at (required then, ignored otherwise).
    discount_exchange_rate: float | None = Field(default=None, gt=0)
    lines: list[VoucherLineIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _discount_makes_sense(self) -> "SupplierVoucherIn":
        if self.discount_kind == "percent" and (self.discount_value or 0) > 100:
            raise ValueError("A percentage discount cannot be more than 100")
        if self.discount_kind == "baht" and (self.discount_value or 0) > 0 and not self.discount_exchange_rate:
            raise ValueError("A discount in Baht needs the exchange rate")
        return self


class VoucherPaymentIn(BaseModel):
    paid_on: date
    # MMK (the default): amount is the Kyat payment, typed directly. Another currency:
    # original_amount and exchange_rate are required and the server works out the Kyat
    # amount (app/wholesale/services/currency.py::resolve_money).
    currency_code: str = Field(default="MMK", min_length=3, max_length=3)
    amount: float | None = Field(default=None, ge=0)
    original_amount: float | None = Field(default=None, ge=0)
    exchange_rate: float | None = Field(default=None, gt=0)
    note: str = Field(default="", max_length=1000)
