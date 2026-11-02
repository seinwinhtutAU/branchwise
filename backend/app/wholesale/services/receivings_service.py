"""Owns the transactions for the Receiving screen: a delivery landing at a gate, the
packages it is due to arrive in, and what is actually found once each is opened. See
app/wholesale/services/receivings.py for the derived figures and
app/wholesale/services/colors.py for the colour grammar every item's color_breakdown is
checked against.
"""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import (
    Receiving,
    ReceivingCost,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    ShipmentStop,
    SupplierVoucher,
)
from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.colors import color_qty_problem, colors_as_json, conversion_rates
from app.wholesale.services.currency import resolve_money
from app.wholesale.services.lifecycle import (
    ReceivingAction,
    assert_can_perform_receiving_action,
)
from app.wholesale.services.master_data import get_or_create_product
from app.wholesale.services.inventory import auto_allocate_arrivals
from app.wholesale.services.receivings import (
    ItemLike,
    PackageLike,
    opened_count,
    receiving_status,
)
from app.wholesale.services.references import allocate_reference, retry_on_reference_collision
from app.wholesale.services.shipments_service import get_shipment

_LOAD_OPTIONS = (
    selectinload(Receiving.packages).selectinload(ReceivingPackage.items),
    selectinload(Receiving.costs),
)


def _current_receiving_status_and_opened(receiving: Receiving) -> tuple[str, int]:
    packages_like = [
        PackageLike(
            opened=p.opened,
            items=[ItemLike(quantity_pairs=item.quantity_pairs) for item in p.items],
        )
        for p in receiving.packages
    ]
    status_str = receiving_status(packages_like, receiving.total_quantity_pairs)
    opened = opened_count(packages_like)
    return status_str, opened


def _load(db: Session, receiving_id: str, branch_id: str | None) -> Receiving:
    receiving = (
        db.query(Receiving).options(*_LOAD_OPTIONS).filter(Receiving.id == receiving_id).first()
    )
    if receiving is None or (branch_id is not None and receiving.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receiving not found")
    return receiving


def list_receivings(db: Session, branch_id: str | None) -> list[Receiving]:
    query = db.query(Receiving).options(*_LOAD_OPTIONS)
    if branch_id is not None:
        query = query.filter(Receiving.branch_id == branch_id)
    return query.order_by(Receiving.received_on.desc(), Receiving.receiving_no.desc()).all()


def get_receiving(db: Session, receiving_id: str, branch_id: str | None) -> Receiving:
    return _load(db, receiving_id, branch_id)


def _empty_packages(count: int) -> list[ReceivingPackage]:
    return [ReceivingPackage(package_no=index + 1) for index in range(max(0, count))]


def _counting_place(shipment, stop_id: str | None):
    """The place on the route a receiving counts: the one named, else the shipment's only gate."""
    if stop_id is not None:
        stop = next((candidate for candidate in shipment.stops if candidate.id == stop_id), None)
        if stop is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That place is not on this shipment's route")
        return stop
    gate_stops = [candidate for candidate in shipment.stops if candidate.is_gate]
    if len(gate_stops) != 1:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Say which place on the route is being counted",
        )
    return gate_stops[0]


def create_receiving(
    db: Session,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> Receiving:
    # The shipment supplies the denormalised supplier_name/voucher_no/shipment_no, the
    # same way picking a stock code fills a line's description in elsewhere — a
    # receiving still reads correctly if the shipment is edited afterwards.
    shipment = get_shipment(db, payload.shipment_id, branch_id)
    stop = _counting_place(shipment, payload.stop_id)

    def attempt() -> Receiving:
        receiving_no = allocate_reference(db, Receiving.receiving_no, branch_id, "RCV", date.today())
        receiving = Receiving(
            branch_id=branch_id,
            receiving_no=receiving_no,
            shipment_id=shipment.id,
            stop_id=stop.id,
            shipment_no=shipment.shipment_no,
            voucher_no=shipment.voucher_no,
            supplier_name=shipment.supplier_name,
            gate=payload.gate,
            received_on=payload.received_on,
            total_packages=payload.total_packages,
            total_quantity_pairs=payload.total_quantity_pairs,
            total_unit=payload.total_unit,
            packages=_empty_packages(payload.total_packages),
        )
        db.add(receiving)
        db.flush()
        record_audit_log(
            db,
            branch_id=branch_id,
            entity_type="receiving",
            entity_id=receiving.id,
            action="create",
            operator_id=operator_id,
            summary=f"Created receiving {receiving.receiving_no} at gate {receiving.gate}",
            payload={
                "receiving_no": receiving.receiving_no,
                "shipment_no": receiving.shipment_no,
                "total_packages": receiving.total_packages,
                "total_quantity_pairs": receiving.total_quantity_pairs,
            },
        )
        db.commit()
        db.refresh(receiving)
        return receiving

    return retry_on_reference_collision(db, attempt)


def _resize_packages(db: Session, receiving: Receiving, count: int) -> None:
    """Keeps the package rows in step with total_packages: extra boxes gain empty rows,
    a lowered count drops rows from the end — but never one that has already been
    opened, since that would silently discard a real count."""
    current = sorted(receiving.packages, key=lambda entry: entry.package_no)
    if count == len(current):
        return
    if count > len(current):
        receiving.packages.extend(
            ReceivingPackage(package_no=len(current) + offset + 1) for offset in range(count - len(current))
        )
        return

    to_remove = current[count:]
    already_opened = [entry for entry in to_remove if entry.opened]
    if already_opened:
        numbers = ", ".join(str(entry.package_no) for entry in already_opened)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Package {numbers} has already been opened — remove its products first, or keep the package count as is.",
        )
    for entry in to_remove:
        receiving.packages.remove(entry)
        db.delete(entry)


def update_receiving(
    db: Session,
    receiving_id: str,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> Receiving:
    receiving = _load(db, receiving_id, branch_id)
    status_str, opened = _current_receiving_status_and_opened(receiving)
    assert_can_perform_receiving_action(
        ReceivingAction.EDIT,
        status_str,
        opened_packages_count=opened,
    )
    old_gate = receiving.gate
    data = payload.model_dump(exclude_unset=True)
    total_packages = data.pop("total_packages", None)
    for field, value in data.items():
        setattr(receiving, field, value)
    if total_packages is not None:
        receiving.total_packages = total_packages
        _resize_packages(db, receiving, total_packages)

    new_gate = (receiving.gate or "").strip()
    if new_gate and new_gate != (old_gate or "").strip():
        # Keep linked ShipmentStop in sync with the receiving gate
        if receiving.stop_id:
            stop = db.get(ShipmentStop, receiving.stop_id)
            if stop:
                stop.stop_name = new_gate
        else:
            shipment = db.get(Shipment, receiving.shipment_id)
            if shipment:
                gate_stops = [s for s in shipment.stops if s.is_gate]
                if len(gate_stops) == 1:
                    gate_stops[0].stop_name = new_gate

        # Keep SupplierVoucher receiving_gate in sync if applicable
        if receiving.voucher_no:
            voucher = (
                db.query(SupplierVoucher)
                .filter(SupplierVoucher.voucher_no == receiving.voucher_no)
                .first()
            )
            if voucher and (not voucher.receiving_gate or voucher.receiving_gate.strip() == (old_gate or "").strip()):
                voucher.receiving_gate = new_gate

    record_audit_log(
        db,
        branch_id=receiving.branch_id,
        entity_type="receiving",
        entity_id=receiving.id,
        action="edit",
        operator_id=operator_id,
        summary=f"Updated receiving {receiving.receiving_no}",
        payload={"gate": receiving.gate, "total_packages": receiving.total_packages},
    )
    db.commit()
    db.refresh(receiving)
    return receiving


def delete_receiving(
    db: Session,
    receiving_id: str,
    branch_id: str | None,
    operator_id: str | None = None,
) -> None:
    receiving = _load(db, receiving_id, branch_id)
    status_str, opened = _current_receiving_status_and_opened(receiving)
    assert_can_perform_receiving_action(
        ReceivingAction.DELETE,
        status_str,
        opened_packages_count=opened,
    )
    record_audit_log(
        db,
        branch_id=receiving.branch_id,
        entity_type="receiving",
        entity_id=receiving.id,
        action="delete",
        operator_id=operator_id,
        summary=f"Deleted receiving {receiving.receiving_no}",
        payload={"receiving_no": receiving.receiving_no, "shipment_no": receiving.shipment_no},
    )
    db.delete(receiving)
    db.commit()


def _item_from_payload(db: Session, item_in) -> ReceivingItem:
    color_breakdown = item_in.color_breakdown.strip()
    problem = color_qty_problem(color_breakdown)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    rates = conversion_rates(item_in.unit_conversions)
    get_or_create_product(
        db, item_in.stock_code, item_in.description, item_in.product_group, item_in.unit, rates,
    )
    return ReceivingItem(
        stock_code=item_in.stock_code.strip(),
        description=item_in.description.strip(),
        product_group=item_in.product_group,
        color_breakdown=color_breakdown,
        colors=colors_as_json(color_breakdown),
        unit=item_in.unit,
        unit_conversions=rates,
        quantity_pairs=item_in.quantity * rates[item_in.unit.value],
    )


def update_package(
    db: Session,
    receiving_id: str,
    package_id: str,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> Receiving:
    receiving = _load(db, receiving_id, branch_id)
    status_str, opened = _current_receiving_status_and_opened(receiving)
    assert_can_perform_receiving_action(
        ReceivingAction.INSPECT_PACKAGE,
        status_str,
        opened_packages_count=opened,
    )
    package = next((entry for entry in receiving.packages if entry.id == package_id), None)
    if package is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Package not found")

    # Keep nested Pydantic objects intact: model_dump() turns them into dictionaries,
    # while _item_from_payload deliberately reads their validated attributes.
    data = payload.model_dump(exclude_unset=True, exclude={"items"})
    items_in = payload.items if "items" in payload.model_fields_set else None
    for field, value in data.items():
        setattr(package, field, value)
    if items_in is not None:
        package.items = [_item_from_payload(db, item) for item in items_in]

    receiving.updated_at = func.now()
    record_audit_log(
        db,
        branch_id=receiving.branch_id,
        entity_type="receiving",
        entity_id=receiving.id,
        action="inspect_package",
        operator_id=operator_id,
        summary=f"Updated package #{package.package_no} on receiving {receiving.receiving_no}",
        payload={"package_no": package.package_no, "opened": package.opened, "item_count": len(package.items)},
    )
    db.commit()

    # Opening a package is the moment its contents become real stock, so it is also the
    # moment the customers waiting for that stock can have it set aside. Doing it here
    # means nobody has to reopen the Fulfill screen and retype a decision the supplier
    # voucher already recorded.
    if package.opened:
        auto_allocate_arrivals(
            db,
            branch_id if branch_id is not None else receiving.branch_id,
            {item.stock_code for item in package.items},
        )

    db.refresh(receiving)
    return receiving


def _cost(cost_in) -> ReceivingCost:
    currency_code, amount, original_amount, exchange_rate = resolve_money(
        cost_in.currency_code, cost_in.amount, cost_in.original_amount, cost_in.exchange_rate,
    )
    return ReceivingCost(
        cost_date=cost_in.cost_date,
        stage=cost_in.stage.strip(),
        carrier=cost_in.carrier.strip(),
        kind=cost_in.kind.strip(),
        amount=amount,
        currency_code=currency_code,
        original_amount=original_amount,
        exchange_rate=exchange_rate,
        note=cost_in.note.strip(),
    )


def replace_costs(
    db: Session,
    receiving_id: str,
    branch_id: str | None,
    costs_in,
    operator_id: str | None = None,
) -> Receiving:
    receiving = _load(db, receiving_id, branch_id)
    status_str, opened = _current_receiving_status_and_opened(receiving)
    assert_can_perform_receiving_action(
        ReceivingAction.UPDATE_COSTS,
        status_str,
        opened_packages_count=opened,
    )
    receiving.costs = [_cost(cost) for cost in costs_in]
    receiving.updated_at = func.now()
    record_audit_log(
        db,
        branch_id=receiving.branch_id,
        entity_type="receiving",
        entity_id=receiving.id,
        action="update_costs",
        operator_id=operator_id,
        summary=f"Updated transport costs for receiving {receiving.receiving_no}",
        payload={"cost_count": len(receiving.costs), "total_cost": sum(float(c.amount) for c in receiving.costs)},
    )
    db.commit()
    db.refresh(receiving)
    return receiving


def counts_by_stop(db: Session, shipment_ids: list[str]) -> tuple[dict[str, int], set[str]]:
    """What receivings have counted at each place of the given shipments: packages recorded per
    stop id (summed when a place has more than one receiving), whether or not each package has
    been opened yet, and the ids of the shipments that have any receiving at all. A place nobody
    has counted is absent from the first result; the caller uses the number typed on the stop."""
    if not shipment_ids:
        return {}, set()
    # Outer join, not inner: a receiving raised with no packages yet must still count as
    # "0 received", not fall back to the stop's typed figure as if no receiving existed at all.
    rows = (
        db.query(Receiving.shipment_id, Receiving.stop_id, func.count(ReceivingPackage.id))
        .outerjoin(ReceivingPackage, ReceivingPackage.receiving_id == Receiving.id)
        .filter(Receiving.shipment_id.in_(shipment_ids))
        .group_by(Receiving.id, Receiving.shipment_id, Receiving.stop_id)
        .all()
    )
    counts: dict[str, int] = {}
    with_receiving: set[str] = set()
    for shipment_id, stop_id, count in rows:
        with_receiving.add(shipment_id)
        if stop_id is not None:
            counts[stop_id] = counts.get(stop_id, 0) + count
    return counts, with_receiving
