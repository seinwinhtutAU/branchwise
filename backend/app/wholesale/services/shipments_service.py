"""Owns the transactions for the Delivery screen's shipments: creating a shipment with its
route, and updating either. The route is a tree of places (see ShipmentStop); a write replaces
it as a whole, matching places by key so existing ones keep their ids (and with them their
receivings and write-offs).
"""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import (
    Receiving,
    ReceivingPackage,
    Shipment,
    ShipmentStop,
    ShipmentStopLink,
    SupplierVoucher,
)
from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.lifecycle import (
    ShipmentAction,
    assert_can_perform_shipment_action,
)
from app.wholesale.services.references import allocate_reference, retry_on_reference_collision
from app.wholesale.services.shipments import LinkInput, StopInput, final_received, normalise_flow


def _load(db: Session, shipment_id: str, branch_id: str | None) -> Shipment:
    shipment = (
        db.query(Shipment)
        .options(selectinload(Shipment.stops))
        .filter(Shipment.id == shipment_id)
        .first()
    )
    if shipment is None or (branch_id is not None and shipment.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment not found")
    return shipment


def list_shipments(db: Session, branch_id: str | None) -> list[Shipment]:
    query = db.query(Shipment).options(selectinload(Shipment.stops))
    if branch_id is not None:
        query = query.filter(Shipment.branch_id == branch_id)
    return query.order_by(Shipment.sent_on.desc(), Shipment.shipment_no.desc()).all()


def get_shipment(db: Session, shipment_id: str, branch_id: str | None) -> Shipment:
    return _load(db, shipment_id, branch_id)


def _check_tree(stops: list[StopInput]) -> None:
    """The route has to be a real tree: every parent is in the request, nothing is its own
    ancestor, a gate has nothing after it, and at least one place is a gate."""
    keys = [stop.key for stop in stops]
    if len(set(keys)) != len(keys):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Two places on the route share a key")
    names: set[str] = set()
    for stop in stops:
        name = stop.stop_name.strip().lower()
        if name in names:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{stop.stop_name} is already on this route; a place can only appear once",
            )
        names.add(name)
    by_key = {stop.key: stop for stop in stops}
    for stop in stops:
        if stop.parent_key is not None and stop.parent_key not in by_key:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{stop.stop_name} comes after a place that is not on the route")
        links = [link.from_key for link in stop.extra_parents]
        if len(set(links)) != len(links) or stop.key in links or stop.parent_key in links:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{stop.stop_name} has the same road into it more than once",
            )
        for from_key in links:
            if from_key not in by_key:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"{stop.stop_name} has a road from a place that is not on the route",
                )
    # No road may lead back to a place it came from (the main road and the extra ones alike).
    parents_of = {
        stop.key: ([stop.parent_key] if stop.parent_key is not None else [])
        + [link.from_key for link in stop.extra_parents]
        for stop in stops
    }
    done: set[str] = set()

    def walk(key: str, path: set[str]) -> None:
        if key in path:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The route goes round in a circle")
        if key in done:
            return
        for parent in parents_of[key]:
            walk(parent, path | {key})
        done.add(key)

    for stop in stops:
        walk(stop.key, set())
    parents = {parent for found in parents_of.values() for parent in found}
    for stop in stops:
        if stop.is_gate and stop.key in parents:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{stop.stop_name} is where a route ends, so nothing can come after it",
            )
    if not any(stop.is_gate for stop in stops):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The route needs a receiving gate at its end")
    for stop in stops:
        if not stop.is_gate and stop.key not in parents:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{stop.stop_name} is where a route ends, so it has to be a receiving gate",
            )


def _check_arrivals(db: Session, stops: list[StopInput], existing_ids: list[str]) -> None:
    """No place can have more packages arrive than were sent to it. A place a receiving has
    counted is left alone: what was counted there is a fact, whatever was sent."""
    counted = (
        {row[0] for row in db.query(Receiving.stop_id).filter(Receiving.stop_id.in_(existing_ids)).all()}
        if existing_ids
        else set()
    )
    for stop in stops:
        if stop.key in counted or stop.packages_sent is None:
            continue
        sent = stop.packages_sent + sum(link.packages_sent for link in stop.extra_parents)
        if stop.packages_received > sent:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{stop.stop_name}: more packages arrived ({stop.packages_received}) than were sent to it ({sent})",
            )


def _check_departures(stops: list[StopInput]) -> None:
    """The roads leaving a place cannot carry more packages than are available there.

    A split/combine explicitly changes the available package count; without one, the arrived
    count is what can go on.  Every road is included, including a route which rejoins through
    an extra parent link.
    """
    sent_from = {stop.key: 0 for stop in stops}
    for stop in stops:
        if stop.parent_key is not None:
            sent_from[stop.parent_key] += stop.packages_sent or 0
        for link in stop.extra_parents:
            sent_from[link.from_key] += link.packages_sent
    for stop in stops:
        available = (
            stop.packages_after_change
            if stop.package_change_kind is not None
            and stop.packages_after_change is not None
            else stop.packages_received
        )
        sent = sent_from[stop.key]
        if sent > available:
            handling = (
                f"after {stop.package_change_kind}"
                if stop.package_change_kind is not None
                else "after arriving"
            )
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{stop.stop_name}: {sent} packages are sent out, but only {available} are available {handling}",
            )


def _stop_inputs(raw: list) -> list[StopInput]:
    return [
        StopInput(
            key=stop["key"],
            parent_key=stop.get("parent_key"),
            stop_name=stop["stop_name"].strip(),
            carrier_name=stop.get("carrier_name", ""),
            packages_received=stop.get("packages_received", 0),
            is_gate=stop.get("is_gate", False),
            packages_sent=stop.get("packages_sent"),
            package_change_kind=stop.get("package_change_kind"),
            packages_after_change=stop.get("packages_after_change"),
            extra_parents=[
                LinkInput(
                    from_key=link["from_key"],
                    carrier_name=link.get("carrier_name", ""),
                    packages_sent=link.get("packages_sent", 0),
                )
                for link in stop.get("extra_parents", [])
            ],
        )
        for stop in raw
    ]


def _settle_sent(inputs: list[StopInput], cargo_sent: int | None) -> list[StopInput]:
    """Fills in every `packages_sent` the request left out: the number that arrived — except for
    the first place after the supplier, which takes `cargo_sent` when that was given."""
    first_root = next((item for item in inputs if item.parent_key is None), None)
    for item in inputs:
        if item.packages_sent is not None:
            continue
        item.packages_sent = (
            max(0, cargo_sent) if item is first_root and cargo_sent is not None else item.packages_received
        )
    return inputs


def _sync_cargo_sent(shipment: Shipment) -> None:
    """What the cargo company sent is what it sent along each road leaving the supplier."""
    shipment.packages_sent_by_cargo = sum(
        stop.packages_sent for stop in shipment.stops if stop.parent is None
    )


def _check_sent_total(db: Session, shipment: Shipment) -> None:
    """The packages sent out of the supplier cannot be more than the packages on the slip."""
    if shipment.packages_sent_by_cargo > shipment.total_packages:
        sent, total = shipment.packages_sent_by_cargo, shipment.total_packages
        db.rollback()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"More packages were sent ({sent}) than the shipment has ({total})",
        )


def _packages_sent_to(stop: ShipmentStop) -> int:
    """Every package sent along a road ending at this stop, including roads that rejoin."""
    return stop.packages_sent + sum(link.packages_sent for link in stop.links_in)


def _sync_receiving_package_totals(db: Session, shipment: Shipment) -> None:
    """Keep each receiving's package rows aligned with the roads that now end at its stop.

    Route editing may split or combine boxes after a receiving was started.  The receiving's
    package rows are the denominator for "Counted x of y", so they must reflect what was sent
    to its gate.  Added boxes are empty; removing an already opened box is refused.
    """
    receivings = (
        db.query(Receiving)
        .options(selectinload(Receiving.packages))
        .filter(Receiving.shipment_id == shipment.id)
        .all()
    )
    if not receivings:
        return
    stops_by_id = {stop.id: stop for stop in shipment.stops}
    gates = [stop for stop in shipment.stops if stop.is_gate]
    by_stop: dict[str, list[Receiving]] = {}
    for receiving in receivings:
        stop = stops_by_id.get(receiving.stop_id or "")
        # Legacy receivings did not have a stop id; they identify the shipment's sole gate.
        if stop is None and receiving.stop_id is None and len(gates) == 1:
            stop = gates[0]
        if stop is not None:
            by_stop.setdefault(stop.id, []).append(receiving)

    for stop_id, rows in by_stop.items():
        expected = _packages_sent_to(stops_by_id[stop_id])
        current = sum(len(receiving.packages) for receiving in rows)
        if current < expected:
            target = rows[-1]
            start = max((package.package_no for package in target.packages), default=0)
            target.packages.extend(
                ReceivingPackage(package_no=start + offset)
                for offset in range(1, expected - current + 1)
            )
        elif current > expected:
            remaining = current - expected
            to_remove: list[tuple[Receiving, ReceivingPackage]] = []
            for receiving in reversed(rows):
                for package in sorted(
                    receiving.packages, key=lambda entry: entry.package_no, reverse=True
                ):
                    if remaining == 0:
                        break
                    to_remove.append((receiving, package))
                    remaining -= 1
                if remaining == 0:
                    break
            opened = [package.package_no for _, package in to_remove if package.opened]
            if opened:
                numbers = ", ".join(str(number) for number in sorted(opened))
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"Cannot reduce packages sent to {stops_by_id[stop_id].stop_name}: package {numbers} has already been counted",
                )
            for receiving, package in to_remove:
                receiving.packages.remove(package)
                db.delete(package)
        for receiving in rows:
            receiving.total_packages = len(receiving.packages)


def _apply_stops(db: Session, shipment: Shipment, inputs: list[StopInput]) -> None:
    """Makes the shipment's stops match `inputs`. Places whose key is an existing stop id are
    updated in place (keeping their lost packages, receivings and write-offs); new keys are added;
    places left out are removed."""
    _check_tree(inputs)
    existing = {stop.id: stop for stop in shipment.stops}
    old_names = {stop.id: stop.stop_name for stop in shipment.stops}
    _check_arrivals(db, inputs, list(existing))
    _check_departures(inputs)
    # A receiving is the source of truth for its own gate.  The shipment can still have
    # its surrounding route corrected, but its receiving stop cannot be renamed, changed
    # into another kind of place, or have its arrived-package count overwritten.
    counted_rows = (
        db.query(Receiving.stop_id, func.count(ReceivingPackage.id))
        .outerjoin(ReceivingPackage, ReceivingPackage.receiving_id == Receiving.id)
        .filter(Receiving.stop_id.in_(list(existing)))
        .group_by(Receiving.id, Receiving.stop_id)
        .all()
    )
    counted_by_stop: dict[str, int] = {}
    for stop_id, count in counted_rows:
        if stop_id is not None:
            counted_by_stop[stop_id] = counted_by_stop.get(stop_id, 0) + count
    submitted = {item.key: item for item in inputs}
    for stop_id, counted_packages in counted_by_stop.items():
        before = existing[stop_id]
        item = submitted.get(stop_id)
        if item is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{before.stop_name} has a receiving recorded at it, so it cannot be removed from the route",
            )
        if item.stop_name != before.stop_name:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{before.stop_name} is a receiving gate, so its name cannot be changed from the shipment",
            )
        if item.is_gate != before.is_gate:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{before.stop_name} has a receiving recorded at it, so its place type cannot be changed",
            )
        if item.packages_received != counted_packages:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{before.stop_name} is a receiving gate, so its arrived packages are set by the receiving",
            )
        if (
            item.package_change_kind != before.package_change_kind
            or item.packages_after_change != before.packages_after_change
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{before.stop_name} is a receiving gate, so its package handling cannot be changed from the shipment",
            )
    for item in inputs:
        before = existing.get(item.key)
        if before is not None and before.is_gate and not item.is_gate:
            counted_here = db.query(Receiving.stop_id).filter(Receiving.stop_id == before.id).first()
            if counted_here is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"{before.stop_name} has a receiving counted at it, so it has to stay a receiving gate",
                )
    kept: dict[str, ShipmentStop] = {}
    for order, item in enumerate(inputs, start=1):
        stop = existing.get(item.key)
        old_name = old_names.get(item.key)
        if stop is None:
            stop = ShipmentStop(lost_packages=0)
            shipment.stops.append(stop)
        stop.leg_order = order
        stop.stop_name = item.stop_name
        stop.carrier_name = item.carrier_name
        stop.packages_received = item.packages_received
        stop.packages_sent = item.packages_sent if item.packages_sent is not None else item.packages_received
        stop.package_change_kind = item.package_change_kind
        stop.packages_after_change = item.packages_after_change
        stop.is_gate = item.is_gate
        kept[item.key] = stop

        # If an existing stop is renamed, keep linked Receivings and voucher in sync
        if old_name and old_name != item.stop_name:
            receivings = db.query(Receiving).filter(Receiving.stop_id == stop.id).all()
            for r in receivings:
                r.gate = item.stop_name
            if item.is_gate and shipment.voucher_no:
                voucher = (
                    db.query(SupplierVoucher)
                    .filter(SupplierVoucher.voucher_no == shipment.voucher_no)
                    .first()
                )
                if voucher and (not voucher.receiving_gate or voucher.receiving_gate == old_name):
                    voucher.receiving_gate = item.stop_name
    for item in inputs:
        kept[item.key].parent = kept[item.parent_key] if item.parent_key is not None else None
        # Keep unchanged roads instead of replacing every row. Replacing an existing road with a
        # new object can make SQLAlchemy INSERT it before deleting the old one, which conflicts
        # with the unique constraint on (to_stop_id, from_stop_id).
        existing_links = {
            link.from_stop_id: link for link in kept[item.key].links_in
        }
        next_links: list[ShipmentStopLink] = []
        for link_input in item.extra_parents:
            from_stop = kept[link_input.from_key]
            link = existing_links.get(from_stop.id)
            if link is None:
                link = ShipmentStopLink(from_stop=from_stop)
            link.carrier_name = link_input.carrier_name
            link.packages_sent = link_input.packages_sent
            next_links.append(link)
        kept[item.key].links_in = next_links
    removed = [stop for stop_id, stop in existing.items() if stop_id not in kept]
    if removed:
        counted = (
            db.query(Receiving.stop_id)
            .filter(Receiving.stop_id.in_([stop.id for stop in removed]))
            .first()
        )
        if counted is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "A place with a receiving counted at it cannot be removed from the route",
            )
        for stop in removed:
            shipment.stops.remove(stop)
    _sync_cargo_sent(shipment)
    _check_sent_total(db, shipment)


def create_shipment(db: Session, branch_id: str | None, payload) -> Shipment:
    inputs = _stop_inputs([stop.model_dump() for stop in payload.stops])
    _check_tree(inputs)

    def attempt() -> Shipment:
        shipment_no = allocate_reference(db, Shipment.shipment_no, branch_id, "SHP", date.today())
        settled = _settle_sent(normalise_flow(inputs), payload.packages_sent_by_cargo)
        shipment = Shipment(
            branch_id=branch_id,
            shipment_no=shipment_no,
            voucher_no=payload.voucher_no,
            supplier_name=payload.supplier_name,
            carrier_name=payload.carrier_name,
            sent_on=payload.sent_on,
            total_quantity_pairs=payload.total_quantity_pairs,
            total_unit=payload.total_unit,
            total_packages=payload.total_packages,
            packages_sent_by_cargo=0,
        )
        db.add(shipment)
        _apply_stops(db, shipment, settled)
        if payload.voucher_no:
            voucher = (
                db.query(SupplierVoucher)
                .filter(SupplierVoucher.voucher_no == payload.voucher_no)
                .first()
            )
            if voucher and not voucher.receiving_gate:
                gate_stop = next((s for s in shipment.stops if s.is_gate), None)
                if gate_stop and gate_stop.stop_name:
                    voucher.receiving_gate = gate_stop.stop_name
        db.commit()
        db.refresh(shipment)
        return shipment

    return retry_on_reference_collision(db, attempt)


def update_shipment(
    db: Session,
    shipment_id: str,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> Shipment:
    shipment = _load(db, shipment_id, branch_id)
    previous_total_packages = shipment.total_packages
    from app.wholesale.services.receivings_service import counts_by_stop

    counts, with_receiving = counts_by_stop(db, [shipment.id])
    assert_can_perform_shipment_action(
        shipment,
        ShipmentAction.EDIT,
        final_received(shipment, counts),
        has_receiving=shipment.id in with_receiving,
    )
    data = payload.model_dump(exclude_unset=True)
    stops_input = data.pop("stops", None)
    cargo_sent = data.pop("packages_sent_by_cargo", None)
    for field, value in data.items():
        setattr(shipment, field, value)

    if stops_input is not None:
        settled = _settle_sent(normalise_flow(_stop_inputs(stops_input)), cargo_sent)
        _apply_stops(db, shipment, settled)
        _sync_receiving_package_totals(db, shipment)
    elif cargo_sent is not None:
        first_root = next((stop for stop in shipment.stops if stop.parent is None), None)
        if first_root is not None:
            first_root.packages_sent = max(0, cargo_sent)
        _sync_cargo_sent(shipment)
        _check_sent_total(db, shipment)

    record_audit_log(
        db,
        branch_id=shipment.branch_id,
        entity_type="shipment",
        entity_id=shipment.id,
        action="update",
        operator_id=operator_id,
        summary=f"Updated shipment {shipment.shipment_no}",
        payload=payload.model_dump(exclude_unset=True),
    )
    db.commit()
    db.refresh(shipment)
    return shipment


def delete_shipment(
    db: Session,
    shipment_id: str,
    branch_id: str | None,
    operator_id: str | None = None,
) -> None:
    shipment = _load(db, shipment_id, branch_id)
    from app.wholesale.services.receivings_service import counts_by_stop

    counts, with_receiving = counts_by_stop(db, [shipment.id])
    assert_can_perform_shipment_action(
        shipment,
        ShipmentAction.DELETE,
        final_received(shipment, counts),
        has_receiving=shipment.id in with_receiving,
    )
    record_audit_log(
        db,
        branch_id=shipment.branch_id,
        entity_type="shipment",
        entity_id=shipment.id,
        action="delete",
        operator_id=operator_id,
        summary=f"Deleted shipment {shipment.shipment_no}",
        payload={"shipment_no": shipment.shipment_no},
    )
    db.delete(shipment)
    db.commit()
