"""Transactions for closing an outstanding wholesale shortfall with an explanation."""

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    Shipment,
    ShipmentStop,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesaleWriteOff,
    WholesaleWriteOffReason,
)
from app.wholesale.schemas.write_offs import IssueCreateIn, IssueUpdateIn
from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.colors import color_qty_pairs, color_qty_problem, parse_color_qty
from app.wholesale.services.lifecycle import (
    ShipmentAction,
    assert_can_perform_shipment_action,
)
from app.wholesale.services.shipments import final_received, final_remaining, here_now
from app.wholesale.services.supplier_vouchers_service import received_pairs_by_voucher_stock
from app.wholesale.services.receivings_service import counts_by_stop
from app.wholesale.services.inventory import (
    delivered_color_pairs_by_order,
    delivered_pairs_by_order,
    effective_allocated_color_pairs,
)


def _validate_reason(reason: WholesaleWriteOffReason | str) -> WholesaleWriteOffReason:
    try:
        return reason if isinstance(reason, WholesaleWriteOffReason) else WholesaleWriteOffReason(reason)
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a valid write-off reason") from error


def _positive(quantity: int) -> None:
    if quantity <= 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Write-off quantity must be greater than zero")


def _loss_reason(reason: WholesaleWriteOffReason) -> None:
    if reason is WholesaleWriteOffReason.REPACKAGED:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Repackaging can only be recorded for shipment packages",
        )


def _repackaged_note(previous: int, current: int, note: str) -> str:
    summary = f"Recounted: {previous} → {current} packages"
    extra = note.strip()
    return f"{summary} — {extra}" if extra else summary


def _exceeding(quantity: int, remaining: int) -> None:
    if quantity > remaining:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Write-off cannot exceed the {remaining} still outstanding",
        )


def _quantity_from_colors(line, quantity: int | None, color_breakdown: str) -> tuple[int, str]:
    """The pairs an issue comes to. When colours are given they are the truth (and must be
    colours the line actually has); otherwise the plain total the caller sent."""
    text = color_breakdown.strip()
    if not text:
        if quantity is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter a quantity")
        return quantity, ""
    problem = color_qty_problem(text)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    on_line = {" ".join(entry.color.split()).casefold() for entry in parse_color_qty(line.color_breakdown)}
    for entry in parse_color_qty(text):
        if " ".join(entry.color.split()).casefold() not in on_line:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{entry.color.strip().title()} is not one of this product's colors",
            )
    return color_qty_pairs(text, line.unit, line.unit_conversions), text


def _write_off(
    db: Session,
    *,
    branch_id: str | None,
    subject_type: str,
    subject_id: str,
    reference: str,
    description: str,
    stock_code: str,
    quantity: int,
    unit: str,
    unit_conversions: dict[str, int] | None = None,
    color_breakdown: str = "",
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
) -> WholesaleWriteOff:
    entry = WholesaleWriteOff(
        branch_id=branch_id,
        subject_type=subject_type,
        subject_id=subject_id,
        reference=reference,
        description=description,
        stock_code=stock_code,
        quantity=quantity,
        unit=unit,
        unit_conversions=unit_conversions or {"pair": 1, "set": 6, "dozen": 12},
        color_breakdown=color_breakdown,
        reason=_validate_reason(reason),
        note=note.strip(),
        recorded_by_user_id=user_id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def record_quantity_change(
    db: Session,
    *,
    branch_id: str | None,
    subject_type: str,
    subject_id: str,
    reference: str,
    description: str,
    stock_code: str,
    before: int,
    after: int,
    unit: str,
    unit_conversions: dict[str, int] | None,
    user_id: str | None,
) -> WholesaleWriteOff | None:
    """Record an edit to a source quantity without treating the change as stock loss.

    The regular Issue/write-off path keeps an expected quantity in place and accounts for the
    missing part separately.  The simpler workflow edits the original quantity instead.  This
    record preserves why the number changed, but deliberately does not touch any ``lost_*``
    column, inventory, payment or lifecycle calculation.
    """
    if before == after:
        return None
    entry = WholesaleWriteOff(
        branch_id=branch_id,
        subject_type=subject_type,
        subject_id=subject_id,
        reference=reference,
        description=description,
        stock_code=stock_code,
        quantity=abs(after - before),
        unit=unit,
        unit_conversions=unit_conversions or {"pair": 1, "set": 6, "dozen": 12},
        record_type="quantity_change",
        quantity_before=before,
        quantity_after=after,
        reason=WholesaleWriteOffReason.OTHER,
        note=f"Quantity changed: {before} → {after}",
        recorded_by_user_id=user_id or "",
    )
    db.add(entry)
    return entry


def write_off_shipment(
    db: Session,
    shipment_id: str,
    leg_id_or_none: str | None,
    quantity: int,
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
    branch_id: str | None = None,
) -> WholesaleWriteOff:
    validated_reason = _validate_reason(reason)
    if validated_reason is not WholesaleWriteOffReason.REPACKAGED:
        _positive(quantity)
    shipment = (
        db.query(Shipment)
        .options(selectinload(Shipment.stops))
        .filter(Shipment.id == shipment_id)
        .with_for_update()
        .first()
    )
    if shipment is None or (branch_id is not None and shipment.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment not found")

    counts, _ = counts_by_stop(db, [shipment.id])
    received = final_received(shipment, counts)
    assert_can_perform_shipment_action(shipment, ShipmentAction.WRITE_OFF, received)
    shipment.updated_at = func.now()

    if leg_id_or_none is not None:
        leg = next((candidate for candidate in shipment.stops if candidate.id == leg_id_or_none), None)
        if leg is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment stop not found")
        if validated_reason is WholesaleWriteOffReason.REPACKAGED:
            previous = leg.packages_received
            leg.packages_received = quantity
            return _write_off(
                db,
                branch_id=shipment.branch_id,
                subject_type="shipment_leg",
                subject_id=leg.id,
                reference=shipment.shipment_no,
                description=leg.stop_name,
                stock_code=shipment.voucher_no,
                quantity=quantity,
                unit="package",
                reason=validated_reason,
                note=_repackaged_note(previous, quantity, note),
                user_id=user_id,
            )
        remaining = here_now(shipment, leg, counts)
        _exceeding(quantity, remaining)
        leg.lost_packages += quantity
        return _write_off(
            db,
            branch_id=shipment.branch_id,
            subject_type="shipment_leg",
            subject_id=leg.id,
            reference=shipment.shipment_no,
            description=leg.stop_name,
            stock_code=shipment.voucher_no,
            quantity=quantity,
            unit="package",
            reason=validated_reason,
            note=note,
            user_id=user_id,
        )

    if validated_reason is WholesaleWriteOffReason.REPACKAGED:
        previous = shipment.total_packages
        shipment.total_packages = quantity
        return _write_off(
            db,
            branch_id=shipment.branch_id,
            subject_type="shipment",
            subject_id=shipment.id,
            reference=shipment.shipment_no,
            description=", ".join(stop.stop_name for stop in shipment.stops if stop.is_gate),
            stock_code=shipment.voucher_no,
            quantity=quantity,
            unit="package",
            reason=validated_reason,
            note=_repackaged_note(previous, quantity, note),
            user_id=user_id,
        )
    remaining = final_remaining(shipment, received)
    _exceeding(quantity, remaining)
    shipment.lost_packages += quantity
    return _write_off(
        db,
        branch_id=shipment.branch_id,
        subject_type="shipment",
        subject_id=shipment.id,
        reference=shipment.shipment_no,
        description=", ".join(stop.stop_name for stop in shipment.stops if stop.is_gate),
        stock_code=shipment.voucher_no,
        quantity=quantity,
        unit="package",
        reason=validated_reason,
        note=note,
        user_id=user_id,
    )


def write_off_voucher_line(
    db: Session,
    voucher_line_id: str,
    quantity: int | None,
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
    branch_id: str | None = None,
    color_breakdown: str = "",
) -> WholesaleWriteOff:
    validated_reason = _validate_reason(reason)
    _loss_reason(validated_reason)
    line = (
        db.query(SupplierVoucherLine)
        .options(selectinload(SupplierVoucherLine.voucher))
        .filter(SupplierVoucherLine.id == voucher_line_id)
        .with_for_update()
        .first()
    )
    if line is None or (branch_id is not None and line.voucher.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier voucher line not found")
    quantity, color_breakdown = _quantity_from_colors(line, quantity, color_breakdown)
    _positive(quantity)
    received = received_pairs_by_voucher_stock(
        db, [line.voucher.voucher_no], line.voucher.branch_id
    ).get((line.voucher.voucher_no, line.stock_code), 0)
    remaining = max(0, line.quantity_pairs - received - line.lost_quantity_pairs)
    _exceeding(quantity, remaining)
    line.lost_quantity_pairs += quantity
    if line.voucher is not None:
        line.voucher.updated_at = func.now()
    return _write_off(
        db,
        branch_id=line.voucher.branch_id,
        subject_type="voucher_line",
        subject_id=line.id,
        reference=line.voucher.voucher_no,
        description=line.description,
        stock_code=line.stock_code,
        quantity=quantity,
        unit=line.unit.value,
        unit_conversions=line.unit_conversions,
        color_breakdown=color_breakdown,
        reason=validated_reason,
        note=note,
        user_id=user_id,
    )


def write_off_order_line(
    db: Session,
    order_line_id: str,
    quantity: int | None,
    reason: WholesaleWriteOffReason | str,
    note: str,
    user_id: str,
    branch_id: str | None = None,
    color_breakdown: str = "",
) -> WholesaleWriteOff:
    validated_reason = _validate_reason(reason)
    _loss_reason(validated_reason)
    line = (
        db.query(CustomerOrderLine)
        .options(selectinload(CustomerOrderLine.order))
        .filter(CustomerOrderLine.id == order_line_id)
        .with_for_update()
        .first()
    )
    if line is None or (branch_id is not None and line.order.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order line not found")
    if line.order.cancelled:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A cancelled order cannot be written off")
    quantity, color_breakdown = _quantity_from_colors(line, quantity, color_breakdown)
    _positive(quantity)
    delivered = delivered_pairs_by_order(db, [line.order_id], line.order.branch_id).get(
        line.order_id, {}
    ).get(line.stock_code, 0)
    # Stock already set aside for this order is not short: it is on the shelf waiting to be
    # handed over, so it cannot be explained away (that would also mark the order delivered
    # with nothing having gone out).
    held = sum(
        effective_allocated_color_pairs(
            line,
            delivered_color_pairs_by_order(db, line.order_id, line.stock_code, line.order.branch_id),
        ).values()
    )
    remaining = max(0, line.quantity_pairs - delivered - line.lost_quantity_pairs - held)
    _exceeding(quantity, remaining)
    line.lost_quantity_pairs += quantity
    return _write_off(
        db,
        branch_id=line.order.branch_id,
        subject_type="order_line",
        subject_id=line.id,
        reference=line.order.order_no,
        description=line.description,
        stock_code=line.stock_code,
        quantity=quantity,
        unit=line.unit.value,
        unit_conversions=line.unit_conversions,
        color_breakdown=color_breakdown,
        reason=validated_reason,
        note=note,
        user_id=user_id,
    )


def _find_entry(db: Session, entry_id: str, branch_id: str | None) -> WholesaleWriteOff:
    entry = db.get(WholesaleWriteOff, entry_id)
    if entry is None or (branch_id is not None and entry.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Record not found")
    if entry.record_type == "quantity_change":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "This Issue records a quantity change. Edit the original record to make another correction.",
        )
    if entry.reason is WholesaleWriteOffReason.REPACKAGED:
        # A recount overwrote a count in place, so there is nothing to put back.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A recount cannot be changed or removed. Record another recount instead.",
        )
    return entry


def _shift_loss(db: Session, entry: WholesaleWriteOff, new_quantity: int) -> None:
    """Moves the running loss the entry fed by (new - old), after checking it still fits.

    The loss columns stay what every other screen reads; this keeps them equal to what the
    records say without recomputing lines that were loaded before records existed."""
    delta = new_quantity - entry.quantity
    if entry.subject_type == "voucher_line":
        line = (
            db.query(SupplierVoucherLine)
            .options(selectinload(SupplierVoucherLine.voucher))
            .filter(SupplierVoucherLine.id == entry.subject_id)
            .with_for_update()
            .first()
        )
        if line is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier voucher line not found")
        received = received_pairs_by_voucher_stock(
            db, [line.voucher.voucher_no], line.voucher.branch_id
        ).get((line.voucher.voucher_no, line.stock_code), 0)
        if delta > 0:
            _exceeding(delta, max(0, line.quantity_pairs - received - line.lost_quantity_pairs))
        line.lost_quantity_pairs = max(0, line.lost_quantity_pairs + delta)
        line.voucher.updated_at = func.now()
    elif entry.subject_type == "order_line":
        line = (
            db.query(CustomerOrderLine)
            .options(selectinload(CustomerOrderLine.order))
            .filter(CustomerOrderLine.id == entry.subject_id)
            .with_for_update()
            .first()
        )
        if line is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order line not found")
        if line.order.cancelled:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A cancelled order cannot be changed")
        if delta > 0:
            delivered = delivered_pairs_by_order(db, [line.order_id], line.order.branch_id).get(
                line.order_id, {}
            ).get(line.stock_code, 0)
            held = sum(
                effective_allocated_color_pairs(
                    line,
                    delivered_color_pairs_by_order(db, line.order_id, line.stock_code, line.order.branch_id),
                ).values()
            )
            _exceeding(delta, max(0, line.quantity_pairs - delivered - line.lost_quantity_pairs - held))
        line.lost_quantity_pairs = max(0, line.lost_quantity_pairs + delta)
    elif entry.subject_type in ("shipment", "shipment_leg"):
        shipment_id = entry.subject_id
        leg = None
        if entry.subject_type == "shipment_leg":
            leg = db.get(ShipmentStop, entry.subject_id)
            if leg is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment stop not found")
            shipment_id = leg.shipment_id
        shipment = (
            db.query(Shipment)
            .options(selectinload(Shipment.stops))
            .filter(Shipment.id == shipment_id)
            .with_for_update()
            .first()
        )
        if shipment is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment not found")
        counts, _ = counts_by_stop(db, [shipment.id])
        if leg is not None:
            leg = next(candidate for candidate in shipment.stops if candidate.id == leg.id)
            if delta > 0:
                _exceeding(delta, here_now(shipment, leg, counts))
            leg.lost_packages = max(0, leg.lost_packages + delta)
        else:
            if delta > 0:
                _exceeding(delta, final_remaining(shipment, final_received(shipment, counts)))
            shipment.lost_packages = max(0, shipment.lost_packages + delta)
        shipment.updated_at = func.now()
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This record cannot be changed")


def update_write_off(
    db: Session,
    entry_id: str,
    *,
    quantity: int | None,
    reason: WholesaleWriteOffReason | str | None,
    note: str | None,
    user_id: str,
    branch_id: str | None = None,
    color_breakdown: str | None = None,
) -> WholesaleWriteOff:
    entry = _find_entry(db, entry_id, branch_id)
    previous = {
        "quantity": entry.quantity,
        "color_breakdown": entry.color_breakdown,
        "reason": entry.reason.value,
        "note": entry.note,
    }
    if color_breakdown is not None:
        model = {"voucher_line": SupplierVoucherLine, "order_line": CustomerOrderLine}.get(entry.subject_type)
        line = db.get(model, entry.subject_id) if model else None
        if line is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Colors only apply to a product line")
        quantity, color_breakdown = _quantity_from_colors(line, quantity, color_breakdown)
        entry.color_breakdown = color_breakdown
    if reason is not None:
        validated = _validate_reason(reason)
        if validated is WholesaleWriteOffReason.REPACKAGED:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A record cannot be turned into a recount")
        entry.reason = validated
    if quantity is not None and quantity != entry.quantity:
        _positive(quantity)
        if entry.record_type != "manual_issue":
            _shift_loss(db, entry, quantity)
        entry.quantity = quantity
    if note is not None:
        entry.note = note.strip()
    record_audit_log(
        db,
        branch_id=entry.branch_id,
        entity_type="issue" if entry.record_type == "manual_issue" else "write_off",
        entity_id=entry.id,
        action="updated",
        operator_id=user_id,
        summary=f"Changed a record on {entry.reference}",
        payload={
            "before": previous,
            "after": {
                "quantity": entry.quantity,
                "color_breakdown": entry.color_breakdown,
                "reason": entry.reason.value,
                "note": entry.note,
            },
        },
    )
    db.commit()
    db.refresh(entry)
    return entry


def delete_write_off(db: Session, entry_id: str, *, user_id: str, branch_id: str | None = None) -> None:
    entry = _find_entry(db, entry_id, branch_id)
    if entry.record_type != "manual_issue":
        _shift_loss(db, entry, 0)
    record_audit_log(
        db,
        branch_id=entry.branch_id,
        entity_type="issue" if entry.record_type == "manual_issue" else "write_off",
        entity_id=entry.id,
        action="deleted",
        operator_id=user_id,
        summary=f"Removed a record on {entry.reference}",
        payload={"quantity": entry.quantity, "reason": entry.reason.value, "note": entry.note},
    )
    db.delete(entry)
    db.commit()


def create_manual_issue(
    db: Session,
    *,
    user_id: str,
    branch_id: str | None,
    payload: IssueCreateIn,
) -> WholesaleWriteOff:
    """Manually record a real anomaly/issue against a voucher, order, or shipment.

    Does NOT modify quantities, inventory, amounts, payments, or document status.
    """
    reference_type = payload.reference_type
    ref_id = payload.reference_id.strip()
    issue_type = payload.issue_type.strip()
    subject_type = payload.subject_type.strip() or "general"
    subject_id = payload.subject_id.strip() if payload.subject_id else None
    affected_qty = payload.affected_quantity if payload.affected_quantity is not None else None
    note = payload.note.strip()
    if not note:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Note is required")

    reference = ""
    resolved_doc_id = ""
    description = ""
    stock_code = ""
    unit = "unit"

    if reference_type == "voucher":
        voucher = (
            db.query(SupplierVoucher)
            .filter((SupplierVoucher.id == ref_id) | (SupplierVoucher.voucher_no == ref_id))
            .first()
        )
        if voucher is None or (branch_id is not None and voucher.branch_id != branch_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier voucher not found")
        reference = voucher.voucher_no
        resolved_doc_id = voucher.id
        description = f"Voucher {voucher.voucher_no}"
        unit = "set"

        if subject_type == "product" and subject_id:
            line = db.get(SupplierVoucherLine, subject_id)
            if line and line.voucher_id == voucher.id:
                stock_code = line.stock_code
                description = line.description
                unit = line.unit.value
        elif subject_type == "package":
            unit = "package"
            description = "Package"

    elif reference_type == "order":
        order = (
            db.query(CustomerOrder)
            .filter((CustomerOrder.id == ref_id) | (CustomerOrder.order_no == ref_id))
            .first()
        )
        if order is None or (branch_id is not None and order.branch_id != branch_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order not found")
        reference = order.order_no
        resolved_doc_id = order.id
        description = f"Order {order.order_no}"
        unit = "set"

        if subject_type == "product" and subject_id:
            line = db.get(CustomerOrderLine, subject_id)
            if line and line.order_id == order.id:
                stock_code = line.stock_code
                description = line.description
                unit = line.unit.value
        elif subject_type == "delivery":
            description = "Delivery"
            unit = "set"

    elif reference_type == "shipment":
        shipment = (
            db.query(Shipment)
            .filter((Shipment.id == ref_id) | (Shipment.shipment_no == ref_id))
            .first()
        )
        if shipment is None or (branch_id is not None and shipment.branch_id != branch_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment not found")
        reference = shipment.shipment_no
        resolved_doc_id = shipment.id
        description = f"Shipment {shipment.shipment_no}"
        stock_code = shipment.voucher_no
        unit = "package"
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid reference type")

    # Map issue_type to reason enum if possible, else OTHER
    reason = WholesaleWriteOffReason.OTHER
    try:
        reason = WholesaleWriteOffReason(issue_type)
    except ValueError:
        if issue_type in ("shortfall", "short_shipped"):
            reason = WholesaleWriteOffReason.SHORT_SHIPPED
        elif "damaged" in issue_type:
            reason = WholesaleWriteOffReason.DAMAGED
        elif "transit" in issue_type or "lost" in issue_type:
            reason = WholesaleWriteOffReason.LOST_IN_TRANSIT
        else:
            reason = WholesaleWriteOffReason.OTHER

    entry = WholesaleWriteOff(
        branch_id=branch_id,
        reference_type=reference_type,
        reference_id=resolved_doc_id,
        issue_type=issue_type,
        subject_type=subject_type,
        subject_id=subject_id or resolved_doc_id,
        reference=reference,
        description=description,
        stock_code=stock_code,
        quantity=affected_qty if affected_qty is not None else 0,
        unit=unit,
        color_breakdown=payload.color_breakdown.strip() if payload.color_breakdown else "",
        record_type="manual_issue",
        status="open",
        reason=reason,
        note=note,
        recorded_by_user_id=user_id,
    )
    db.add(entry)
    db.flush()
    record_audit_log(
        db,
        branch_id=branch_id,
        entity_type="issue",
        entity_id=entry.id,
        action="created",
        operator_id=user_id,
        summary=f"Created issue on {reference}: {issue_type}",
        payload={
            "reference_type": reference_type,
            "reference_id": resolved_doc_id,
            "issue_type": issue_type,
            "subject_type": subject_type,
            "affected_quantity": affected_qty,
            "note": note,
        },
    )
    db.commit()
    db.refresh(entry)
    return entry


def resolve_issue(
    db: Session,
    issue_id: str,
    *,
    user_id: str,
    branch_id: str | None = None,
) -> WholesaleWriteOff:
    entry = db.get(WholesaleWriteOff, issue_id)
    if entry is None or (branch_id is not None and entry.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found")
    entry.status = "resolved"
    entry.resolved_at = func.now()
    entry.resolved_by_user_id = user_id
    record_audit_log(
        db,
        branch_id=entry.branch_id,
        entity_type="issue",
        entity_id=entry.id,
        action="resolved",
        operator_id=user_id,
        summary=f"Marked issue on {entry.reference} resolved",
        payload={"issue_id": entry.id, "status": "resolved"},
    )
    db.commit()
    db.refresh(entry)
    return entry


def update_issue(
    db: Session,
    issue_id: str,
    payload: IssueUpdateIn,
    *,
    user_id: str,
    branch_id: str | None = None,
) -> WholesaleWriteOff:
    entry = db.get(WholesaleWriteOff, issue_id)
    if entry is None or (branch_id is not None and entry.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Issue not found")
    if payload.status is not None:
        if payload.status == "resolved":
            entry.status = "resolved"
            entry.resolved_at = func.now()
            entry.resolved_by_user_id = user_id
        elif payload.status == "open":
            entry.status = "open"
            entry.resolved_at = None
            entry.resolved_by_user_id = None
    if payload.note is not None:
        entry.note = payload.note.strip()
    if payload.issue_type is not None:
        entry.issue_type = payload.issue_type.strip()
    if payload.affected_quantity is not None:
        entry.quantity = payload.affected_quantity
    db.commit()
    db.refresh(entry)
    return entry


def list_write_offs(
    db: Session,
    branch_id: str | None,
    search: str = "",
    subject_id: str | None = None,
    reference: str | None = None,
    reference_id: str | None = None,
    reference_type: str | None = None,
    status_filter: str | None = None,
    include_quantity_changes: bool = False,
) -> list[WholesaleWriteOff]:
    query = db.query(WholesaleWriteOff)
    if branch_id is not None:
        query = query.filter(WholesaleWriteOff.branch_id == branch_id)
    if not include_quantity_changes:
        query = query.filter(WholesaleWriteOff.record_type != "quantity_change")
    if subject_id is not None:
        query = query.filter(WholesaleWriteOff.subject_id == subject_id)
    if reference is not None:
        query = query.filter(WholesaleWriteOff.reference == reference)
    if reference_id is not None:
        query = query.filter(WholesaleWriteOff.reference_id == reference_id)
    if reference_type is not None:
        query = query.filter(WholesaleWriteOff.reference_type == reference_type)
    if status_filter is not None and status_filter in ("open", "resolved"):
        query = query.filter(WholesaleWriteOff.status == status_filter)
    entries = query.order_by(WholesaleWriteOff.created_at.desc()).all()
    query_text = search.strip().lower()
    if not query_text:
        return entries
    return [
        entry
        for entry in entries
        if query_text in entry.reference.lower()
        or query_text in entry.description.lower()
        or query_text in entry.stock_code.lower()
        or query_text in (entry.issue_type or "").lower()
        or query_text in entry.reason.value.lower()
        or query_text in entry.note.lower()
    ]


def _infer_reference_type(entry: WholesaleWriteOff) -> str | None:
    if entry.reference_type:
        return entry.reference_type
    if entry.subject_type in ("voucher_line", "voucher"):
        return "voucher"
    if entry.subject_type in ("order_line", "order", "delivery"):
        return "order"
    if entry.subject_type in ("shipment", "shipment_leg", "package"):
        return "shipment"
    return None


def write_off_to_dict(entry: WholesaleWriteOff) -> dict:
    return {
        "id": entry.id,
        "issue_id": entry.id,
        "write_off_id": entry.id,
        "branch_id": entry.branch_id,
        "reference_type": _infer_reference_type(entry),
        "reference_id": entry.reference_id,
        "subject_type": entry.subject_type,
        "subject_id": entry.subject_id,
        "reference": entry.reference,
        "description": entry.description,
        "stock_code": entry.stock_code,
        "issue_type": entry.issue_type or entry.reason.value,
        "status": entry.status or "open",
        "resolved_at": entry.resolved_at,
        "resolved_by_user_id": entry.resolved_by_user_id,
        "quantity": entry.quantity,
        "affected_quantity": entry.quantity if entry.quantity > 0 else None,
        "unit": entry.unit,
        "unit_conversions": entry.unit_conversions,
        "color_breakdown": entry.color_breakdown,
        "record_type": entry.record_type,
        "quantity_before": entry.quantity_before,
        "quantity_after": entry.quantity_after,
        "reason": entry.reason.value,
        "note": entry.note,
        "recorded_by_user_id": entry.recorded_by_user_id,
        "created_at": entry.created_at,
    }
