"""The one list of places goods can be: stops, receiving gates, warehouses."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.wholesale.models.entities import (
    Receiving,
    ShipmentStop,
    StockTransfer,
    WholesaleStockMovement,
)
from app.wholesale.models.master_data import (
    WholesaleDestination,
    WholesalePlace,
    WholesaleReceivingGate,
)


def place_names_in_use(db: Session) -> list[str]:
    """Every place name already written down anywhere: the old gate and destination lists, and
    the places used by receivings, shipments, stops, moves and deliveries. Trimmed, de-duplicated
    ignoring case (the first spelling met wins), in a stable order with the gates first."""
    columns = [
        WholesaleReceivingGate.name,
        WholesaleDestination.name,
        Receiving.gate,
        ShipmentStop.stop_name,
        StockTransfer.from_location,
        StockTransfer.to_location,
        WholesaleStockMovement.location,
    ]
    seen: dict[str, str] = {}
    for column in columns:
        for (value,) in db.query(column).distinct().order_by(column).all():
            name = (value or "").strip()
            if name and name.lower() not in seen:
                seen[name.lower()] = name
    return list(seen.values())


def seed_places(db: Session) -> int:
    """Adds every place in use that is not in the list yet. Returns how many were added."""
    existing = {name.lower() for (name,) in db.query(WholesalePlace.name).all()}
    added = 0
    for name in place_names_in_use(db):
        if name.lower() in existing:
            continue
        db.add(WholesalePlace(name=name, active=True))
        existing.add(name.lower())
        added += 1
    db.commit()
    return added


def warehouse_names(db: Session) -> set[str]:
    """The places that are warehouses, lower-cased. Goods are only in stock (can be set aside for a
    customer or delivered) at one of these; a receiving gate that is not a warehouse only counts."""
    return {
        name.strip().lower()
        for (name,) in db.query(WholesalePlace.name).filter(WholesalePlace.is_warehouse.is_(True)).all()
    }


def is_warehouse(db: Session, name: str) -> bool:
    return (name or "").strip().lower() in warehouse_names(db)


def ensure_warehouse(db: Session, name: str) -> None:
    """Goods moved to a place are in a warehouse there, so the place is marked as one (and added
    to the list when it is new). The caller commits."""
    clean = (name or "").strip()
    if not clean:
        return
    place = db.query(WholesalePlace).filter(func.lower(WholesalePlace.name) == clean.lower()).first()
    if place is None:
        db.add(WholesalePlace(name=clean, active=True, is_warehouse=True))
    elif not place.is_warehouse:
        place.is_warehouse = True
