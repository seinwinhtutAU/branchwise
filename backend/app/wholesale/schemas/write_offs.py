from typing import Literal
from pydantic import BaseModel, Field

from app.wholesale.models.entities import WholesaleWriteOffReason


class WriteOffIn(BaseModel):
    """`color_breakdown` ("black2s,white1s"), when given, is what the quantity is made of and
    the server works the quantity out from it; otherwise `quantity` is the total in pairs
    (packages, for a shipment)."""

    quantity: int | None = Field(default=None, gt=0)
    color_breakdown: str = Field(default="", max_length=1000)
    reason: WholesaleWriteOffReason = WholesaleWriteOffReason.OTHER
    note: str = Field(default="", max_length=1000)


class WriteOffUpdate(BaseModel):
    """What can be changed on an existing record; anything left out stays as it was."""

    quantity: int | None = Field(default=None, gt=0)
    color_breakdown: str | None = Field(default=None, max_length=1000)
    reason: WholesaleWriteOffReason | None = None
    note: str | None = Field(default=None, max_length=1000)


class IssueCreateIn(BaseModel):
    """Payload for manually creating an Issue to track real exceptions/anomalies without affecting business data."""

    reference_type: Literal["voucher", "order", "shipment"] = Field(description="voucher | order | shipment")
    reference_id: str = Field(min_length=1, max_length=100, description="Document ID or document number")
    issue_type: str = Field(min_length=1, max_length=50, description="Anomaly type, e.g. shortfall, damaged, delivery_failed")
    subject_type: str = Field(default="general", max_length=30, description="product | package | delivery | general")
    subject_id: str | None = Field(default=None, max_length=36)
    color_breakdown: str = Field(default="", max_length=1000, description="e.g. black1s,white2s")
    affected_quantity: int | None = Field(default=None, ge=0)
    note: str = Field(min_length=1, max_length=1000, description="Reason / explanation of what happened")


class IssueUpdateIn(BaseModel):
    status: Literal["open", "resolved"] | None = Field(default=None, description="open | resolved")
    note: str | None = Field(default=None, max_length=1000)
    issue_type: str | None = Field(default=None, max_length=50)
    affected_quantity: int | None = Field(default=None, ge=0)
