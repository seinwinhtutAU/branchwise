"""Request/response shapes for /api/wholesale/shipments. Out models are built by hand in
the router rather than via model_config/from_attributes, because they carry derived
figures (shipment_status, here_now, ...) that are not columns at all — see
app/wholesale/services/shipments.py."""

from datetime import date

from pydantic import BaseModel, Field, model_validator

from app.wholesale.models.entities import WholesaleUnit, WholesaleWriteOffReason


class ShipmentStopLinkIn(BaseModel):
    """A further road into a place: `from_key` is the key of the place it leaves."""

    from_key: str = Field(min_length=1, max_length=64)
    carrier_name: str = ""
    packages_sent: int = Field(ge=0, default=0)


class ShipmentStopIn(BaseModel):
    """One place on the route. `key` is the stop's id when it already exists, otherwise any
    string that is unique within the request (so a new place can be the parent of another new
    one); `parent_key` is the key of the place before it, null for the first places after the
    cargo company."""

    key: str = Field(min_length=1, max_length=64)
    parent_key: str | None = None
    stop_name: str = Field(min_length=1, max_length=255)
    carrier_name: str = ""
    packages_received: int = Field(ge=0, default=0)
    # How many the carrier took from the place before. Left out, it is the number that arrived
    # (for the first place after the supplier: `packages_sent_by_cargo`, when that is given).
    packages_sent: int | None = Field(default=None, ge=0)
    # Optional handling at this place.  The input number is the packages available after all
    # packages that arrived here were split or combined.
    package_change_kind: str | None = Field(default=None, pattern="^(split|combine)$")
    packages_after_change: int | None = Field(default=None, ge=0)
    # A place where a route ends, normally where it is counted.
    is_gate: bool = False
    # Other roads into this place, where routes that forked meet again.
    extra_parents: list[ShipmentStopLinkIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def package_change_is_complete(self):
        if (self.package_change_kind is None) != (self.packages_after_change is None):
            raise ValueError(
                "package_change_kind and packages_after_change must be set together"
            )
        return self


class ShipmentWriteOffIn(BaseModel):
    quantity: int = Field(ge=0)
    reason: WholesaleWriteOffReason
    note: str = Field(default="", max_length=1000)
    stop_id: str | None = None


class ShipmentCreate(BaseModel):
    # Only used when the creating account has no fixed branch (admin) — ignored
    # otherwise, per app.services.branches.resolve_branch_id.
    branch_id: str | None = None
    voucher_no: str = Field(min_length=1, max_length=30)
    supplier_name: str = Field(min_length=1, max_length=255)
    carrier_name: str = ""
    sent_on: date
    total_packages: int = Field(ge=0)
    total_quantity_pairs: int = Field(ge=0)
    total_unit: WholesaleUnit = WholesaleUnit.SET
    # Shorthand for the first place's `packages_sent`; the shipment's figure is worked out from
    # its places.
    packages_sent_by_cargo: int | None = Field(default=None, ge=0)
    # The route, at least one place of which is a gate.
    stops: list[ShipmentStopIn] = Field(min_length=1)


class ShipmentUpdate(BaseModel):
    """All-optional: a PATCH only touches what it sends. A present `stops` is the whole route:
    places sent with an existing key are updated in place, new keys are added, and places
    left out are removed (refused while a receiving counted there)."""

    voucher_no: str | None = Field(default=None, min_length=1, max_length=30)
    supplier_name: str | None = Field(default=None, min_length=1, max_length=255)
    carrier_name: str | None = None
    sent_on: date | None = None
    total_packages: int | None = Field(default=None, ge=0)
    total_quantity_pairs: int | None = Field(default=None, ge=0)
    total_unit: WholesaleUnit | None = None
    packages_sent_by_cargo: int | None = Field(default=None, ge=0)
    stops: list[ShipmentStopIn] | None = Field(default=None, min_length=1)
