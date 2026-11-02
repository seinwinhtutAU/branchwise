"""Global reference data used by the wholesale workspace."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.wholesale.models.entities import ProductGroup, WholesaleUnit


class _NamedMasterData(Base):
    __abstract__ = True

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class WholesaleProduct(Base):
    __tablename__ = "wholesale_products"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    stock_code: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    product_group: Mapped[ProductGroup] = mapped_column(
        Enum(ProductGroup, name="wholesale_product_group", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=ProductGroup.MAN,
    )
    default_unit: Mapped[WholesaleUnit] = mapped_column(
        Enum(WholesaleUnit, name="wholesale_unit", values_callable=lambda enum_cls: [m.value for m in enum_cls]),
        nullable=False,
        default=WholesaleUnit.SET,
        server_default=WholesaleUnit.SET.value,
    )
    default_unit_conversions: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: {"pair": 1, "set": 6, "dozen": 12},
        server_default='{"pair": 1, "set": 6, "dozen": 12}',
    )
    # Suggested prices only, in Kyat — what a new customer-order or supplier-voucher line
    # for this product pre-fills with. Never read back once a line exists: each line keeps
    # its own price, since what a factory actually charges or a customer actually pays
    # varies deal to deal. Kept separate (buying vs selling) because the two are rarely
    # close — one is cost, the other carries the markup.
    default_selling_price: Mapped[float] = mapped_column(
        Numeric(14, 2), nullable=False, default=0, server_default="0",
    )
    default_buying_price: Mapped[float] = mapped_column(
        Numeric(14, 2), nullable=False, default=0, server_default="0",
    )
    active: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class WholesaleSupplier(_NamedMasterData):
    __tablename__ = "wholesale_suppliers"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_suppliers_name"),)

    phone: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default="")
    address: Mapped[str] = mapped_column(String(1000), nullable=False, default="", server_default="")


class WholesaleCustomer(_NamedMasterData):
    __tablename__ = "wholesale_customers"

    phone: Mapped[str] = mapped_column(String(100), nullable=False, default="", server_default="")
    address: Mapped[str] = mapped_column(String(1000), nullable=False, default="", server_default="")


class WholesaleCarrier(_NamedMasterData):
    """Everyone who carries goods: a cargo company, or a driver between two towns. One list,
    since the same name can be either."""

    __tablename__ = "wholesale_carriers"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_carriers_name"),)


class WholesaleDestination(_NamedMasterData):
    __tablename__ = "wholesale_destinations"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_destinations_name"),)


class WholesalePlace(_NamedMasterData):
    """Every place goods can be: a stop on a route, a receiving gate, a warehouse. One list, so a
    place is picked from it rather than typed afresh each time (and spelled two ways)."""

    __tablename__ = "wholesale_places"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_places_name"),)

    # Goods counted at a warehouse are in stock the moment they are counted, and only goods in a
    # warehouse can be set aside for a customer or delivered. Anywhere else (a receiving gate that
    # is not a warehouse) the goods have to be moved to a warehouse first.
    is_warehouse: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="0")


class WholesaleFeeType(_NamedMasterData):
    """What a cost was for: a carrier fee, porters, a second trip. A new kind is added where it is
    typed, so a fee is never spelled two ways."""

    __tablename__ = "wholesale_fee_types"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_fee_types_name"),)


class WholesaleReceivingGate(_NamedMasterData):
    __tablename__ = "wholesale_receiving_gates"
    __table_args__ = (UniqueConstraint("name", name="uq_wholesale_receiving_gates_name"),)
