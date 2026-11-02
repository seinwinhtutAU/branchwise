from datetime import date

from pydantic import BaseModel, Field

from app.wholesale.models.entities import WholesaleUnit


class StockTransferLineIn(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    # Colour shorthand with a unit letter on every colour, e.g. "pink4s,black2s".
    color_breakdown: str = Field(min_length=1, max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET


class StockTransferIn(BaseModel):
    # Left out, the move is between two places and is not about one voucher (the place it
    # leaves must then be given).
    voucher_id: str | None = Field(default=None, max_length=36)
    # For a voucher, left out means the gate it was counted at (an error if there is more than one).
    from_location: str | None = Field(default=None, max_length=255)
    to_location: str = Field(min_length=1, max_length=255)
    moved_on: date
    note: str = Field(default="", max_length=1000)
    lines: list[StockTransferLineIn] = Field(min_length=1)


class StockTransferCountLineIn(BaseModel):
    stock_code: str = Field(min_length=1, max_length=100)
    # What arrived, in colour shorthand; empty means nothing arrived.
    color_breakdown: str = Field(default="", max_length=1000)
    unit: WholesaleUnit = WholesaleUnit.SET


class StockTransferCountIn(BaseModel):
    counted_on: date
    lines: list[StockTransferCountLineIn] = Field(min_length=1)
