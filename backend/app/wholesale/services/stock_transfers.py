"""Moving counted goods from a receiving gate to a warehouse.

Counting and moving are two steps. A receiving records what arrived at a gate; a transfer
says how much of it, by product and colour, went on to which warehouse. Goods can be packed
again on the way, so nothing here knows about the boxes: only quantities per product and
colour. What is still waiting at the gate for a voucher is what was counted for it there,
less what has already been transferred out.
"""

from collections import defaultdict

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import (
    Receiving,
    ReceivingPackage,
    StockTransfer,
    StockTransferLine,
    SupplierVoucher,
)
from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.colors import color_qty_pairs_by_color, color_qty_problem
from app.wholesale.services.places import ensure_warehouse, warehouse_names

ColorPairs = dict[str, int]


def _allocate_arrivals(db: Session, transfer: StockTransfer) -> None:
    """Goods that just reached a warehouse are real stock now, so the customers waiting for them can
    have them set aside (the same thing opening a package at a warehouse gate does)."""
    from app.wholesale.services.inventory import auto_allocate_arrivals

    auto_allocate_arrivals(db, transfer.branch_id, {line.stock_code for line in transfer.lines})


def _load_voucher(db: Session, voucher_id: str, branch_id: str | None) -> SupplierVoucher:
    voucher = db.get(SupplierVoucher, voucher_id)
    if voucher is None or (branch_id is not None and voucher.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier voucher not found")
    return voucher


def _transfers(db: Session, voucher_id: str) -> list[StockTransfer]:
    return (
        db.query(StockTransfer)
        .options(selectinload(StockTransfer.lines))
        .filter(StockTransfer.voucher_id == voucher_id)
        .order_by(StockTransfer.moved_on.desc(), StockTransfer.created_at.desc())
        .all()
    )


def _counted_at_gates(db: Session, voucher: SupplierVoucher) -> dict[str, dict[str, dict]]:
    """What was counted for this voucher: {gate: {stock_code: {"colors": {...}, ...}}}."""
    receivings = (
        db.query(Receiving)
        .options(selectinload(Receiving.packages).selectinload(ReceivingPackage.items))
        .filter(Receiving.voucher_no == voucher.voucher_no)
        .all()
    )
    counted: dict[str, dict[str, dict]] = defaultdict(dict)
    for receiving in receivings:
        if voucher.branch_id is not None and receiving.branch_id != voucher.branch_id:
            continue
        for package in receiving.packages:
            if not package.opened:
                continue
            for item in package.items:
                if not item.stock_code.strip() or item.quantity_pairs <= 0:
                    continue
                entry = counted[receiving.gate].setdefault(
                    item.stock_code,
                    {
                        "description": item.description,
                        "product_group": item.product_group.value,
                        "unit": item.unit.value,
                        "unit_conversions": item.unit_conversions,
                        "colors": defaultdict(int),
                        "counted_on": None,
                    },
                )
                counted_on = package.received_on or receiving.received_on
                if counted_on and (entry["counted_on"] is None or counted_on > entry["counted_on"]):
                    entry["counted_on"] = counted_on
                for color, pairs in color_qty_pairs_by_color(
                    item.color_breakdown, item.unit, item.unit_conversions
                ).items():
                    entry["colors"][color] += pairs
    return counted


def _line_colors(line: StockTransferLine) -> ColorPairs:
    return color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions)


def received_colors(line: StockTransferLine) -> ColorPairs:
    """What the destination holds for this line: only what it has counted. Goods that were moved
    but not counted yet are not in the warehouse's stock; they are on their way to it."""
    if line.counted_quantity_pairs is None:
        return {}
    return color_qty_pairs_by_color(line.counted_color_breakdown or "", line.unit, line.unit_conversions)


def received_pairs(line: StockTransferLine) -> int:
    return 0 if line.counted_quantity_pairs is None else line.counted_quantity_pairs


def _moved_out(transfers: list[StockTransfer]) -> dict[str, dict[str, ColorPairs]]:
    """{from_location: {stock_code: {color: pairs}}} already transferred out."""
    moved: dict[str, dict[str, ColorPairs]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for transfer in transfers:
        for line in transfer.lines:
            for color, pairs in _line_colors(line).items():
                moved[transfer.from_location][line.stock_code][color] += pairs
    return moved


def voucher_pool(db: Session, voucher_id: str, branch_id: str | None) -> dict:
    """What has been counted at each gate for a voucher, what has moved on, and what is left."""
    voucher = _load_voucher(db, voucher_id, branch_id)
    counted = _counted_at_gates(db, voucher)
    transfers = _transfers(db, voucher.id)
    moved = _moved_out(transfers)

    gates = []
    warehouse_gates = []
    warehouse_counted = []
    for gate, products in sorted(counted.items()):
        rows = []
        for stock_code, entry in sorted(products.items()):
            gone = moved.get(gate, {}).get(stock_code, {})
            left = {
                color: pairs - gone.get(color, 0)
                for color, pairs in entry["colors"].items()
                if pairs - gone.get(color, 0) > 0
            }
            rows.append({
                "stock_code": stock_code,
                "description": entry["description"],
                "product_group": entry["product_group"],
                "unit_conversions": entry["unit_conversions"],
                "counted_pairs": dict(entry["colors"]),
                "moved_pairs": {c: p for c, p in gone.items() if p > 0},
                "left_pairs": left,
            })
        gates.append({"location": gate, "products": rows})
    return {
        "voucher_id": voucher.id,
        "voucher_no": voucher.voucher_no,
        "gates": gates,
        "warehouse_gates": warehouse_gates,
        "warehouse_counted": warehouse_counted,
    }


def transfer_to_dict(transfer: StockTransfer) -> dict:
    return {
        "transfer_id": transfer.id,
        "voucher_id": transfer.voucher_id,
        "voucher_no": transfer.voucher_no,
        "supplier_name": transfer.supplier_name,
        "from_location": transfer.from_location,
        "to_location": transfer.to_location,
        "moved_on": transfer.moved_on,
        "counted_on": transfer.counted_on,
        "note": transfer.note,
        "created_at": transfer.created_at,
        "lines": [
            {
                "stock_code": line.stock_code,
                "description": line.description,
                "product_group": line.product_group.value,
                "color_breakdown": line.color_breakdown,
                "unit": line.unit.value,
                "unit_conversions": line.unit_conversions,
                "quantity_pairs": line.quantity_pairs,
                "counted_color_breakdown": line.counted_color_breakdown,
                "counted_quantity_pairs": line.counted_quantity_pairs,
            }
            for line in transfer.lines
        ],
    }


def list_transfers(db: Session, branch_id: str | None, voucher_id: str | None = None) -> list[StockTransfer]:
    query = db.query(StockTransfer).options(selectinload(StockTransfer.lines))
    if branch_id is not None:
        query = query.filter(StockTransfer.branch_id == branch_id)
    if voucher_id is not None:
        query = query.filter(StockTransfer.voucher_id == voucher_id)
    return query.order_by(StockTransfer.moved_on.desc(), StockTransfer.created_at.desc()).all()


def create_transfer(db: Session, branch_id: str | None, user_id: str, payload) -> StockTransfer:
    from app.wholesale.services.inventory import available_color_pairs_at_location

    voucher = _load_voucher(db, payload.voucher_id, branch_id)
    counted = _counted_at_gates(db, voucher)
    if not counted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Nothing has been counted at the receiving gate for this voucher yet.",
        )

    from_location = (payload.from_location or "").strip()
    if not from_location:
        if len(counted) > 1:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "This voucher was counted at more than one gate. Say which gate the goods move from.",
            )
        from_location = next(iter(counted))
    if from_location not in counted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f'Nothing has been counted at "{from_location}" for this voucher.',
        )
    to_location = payload.to_location.strip()
    # Moving a gate's goods to that same named place is how staff make that gate a warehouse
    # from the Move screen. Keep it as a real, immediately counted transfer: merely changing the
    # place flag would lose the audit trail and make the move invisible on the voucher.
    is_self_transfer = to_location.lower() == from_location.lower()
    if from_location.strip().lower() in warehouse_names(db) and not is_self_transfer:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{from_location} is a warehouse, so the goods counted there are already in stock.",
        )

    moved = _moved_out(_transfers(db, voucher.id)).get(from_location, {})
    lines: list[StockTransferLine] = []
    seen: set[str] = set()
    for entry in payload.lines:
        code = entry.stock_code.strip()
        if code.lower() in seen:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{code} appears twice — put all of its colours on one line."
            )
        seen.add(code.lower())
        gate_entry = counted[from_location].get(code)
        if gate_entry is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{code} was not counted at {from_location} for this voucher."
            )
        text = entry.color_breakdown.strip()
        problem = color_qty_problem(text)
        if problem or not text:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{code}: {problem or 'Say which colours are moving.'}")
        requested = color_qty_pairs_by_color(text, entry.unit, gate_entry["unit_conversions"])
        shelf = available_color_pairs_at_location(db, voucher.branch_id, code, from_location)
        for color, pairs in requested.items():
            in_pool = gate_entry["colors"].get(color, 0) - moved.get(code, {}).get(color, 0)
            if pairs > in_pool:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"{code} {color}: only {max(0, in_pool)} pairs from this voucher are still at the gate.",
                )
            if pairs > shelf.get(color, 0):
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"{code} {color}: only {max(0, shelf.get(color, 0))} pairs are on the shelf at {from_location} right now.",
                )
        lines.append(
            StockTransferLine(
                stock_code=code,
                description=gate_entry["description"],
                product_group=entry_group(gate_entry),
                color_breakdown=text,
                unit=entry.unit,
                unit_conversions=gate_entry["unit_conversions"],
                quantity_pairs=sum(requested.values()),
                counted_color_breakdown=text if is_self_transfer else None,
                counted_quantity_pairs=sum(requested.values()) if is_self_transfer else None,
            )
        )
    if not lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose at least one product to move.")

    transfer = StockTransfer(
        branch_id=voucher.branch_id,
        voucher_id=voucher.id,
        voucher_no=voucher.voucher_no,
        supplier_name=voucher.supplier_name,
        from_location=from_location,
        to_location=to_location,
        moved_on=payload.moved_on,
        counted_on=payload.moved_on if is_self_transfer else None,
        note=payload.note.strip(),
        recorded_by_user_id=user_id,
        lines=lines,
    )
    db.add(transfer)
    db.flush()
    record_audit_log(
        db,
        branch_id=voucher.branch_id,
        entity_type="voucher",
        entity_id=voucher.id,
        action="transfer_stock",
        operator_id=user_id,
        summary=f"Moved stock from {voucher.voucher_no} to {to_location}",
        payload={
            "voucher_no": voucher.voucher_no,
            "from": from_location,
            "to": to_location,
            "pairs": sum(line.quantity_pairs for line in lines),
        },
    )
    ensure_warehouse(db, to_location)
    db.commit()
    db.refresh(transfer)
    _allocate_arrivals(db, transfer)
    return transfer


def entry_group(gate_entry: dict):
    from app.wholesale.models.entities import ProductGroup

    return ProductGroup(gate_entry["product_group"])


def delete_transfer(db: Session, transfer_id: str, branch_id: str | None, user_id: str) -> None:
    from app.wholesale.services.inventory import available_color_pairs_at_location

    transfer = (
        db.query(StockTransfer)
        .options(selectinload(StockTransfer.lines))
        .filter(StockTransfer.id == transfer_id)
        .first()
    )
    if transfer is None or (branch_id is not None and transfer.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stock transfer not found")
    # Taking the transfer back removes the goods from the warehouse again, so they must
    # still be there (not delivered to a customer meanwhile).
    for line in transfer.lines:
        shelf = available_color_pairs_at_location(db, transfer.branch_id, line.stock_code, transfer.to_location)
        for color, pairs in received_colors(line).items():
            if shelf.get(color, 0) < pairs:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"Part of {line.stock_code} {color} has already left {transfer.to_location}, so this transfer can't be undone.",
                )
    record_audit_log(
        db,
        branch_id=transfer.branch_id,
        entity_type="voucher" if transfer.voucher_id else "stock_transfer",
        entity_id=transfer.voucher_id or transfer.id,
        action="undo_transfer",
        operator_id=user_id,
        summary=f"Undid a stock transfer from {transfer.voucher_no} to {transfer.to_location}",
        payload={"voucher_no": transfer.voucher_no, "to": transfer.to_location},
    )
    db.delete(transfer)
    db.commit()


def create_place_transfer(db: Session, branch_id: str | None, user_id: str, payload) -> StockTransfer:
    """Goods moved from one place to another that is not about a single voucher, such as
    warehouse to warehouse. The goods must be on the shelf at the place they leave."""
    from app.wholesale.models.master_data import WholesaleProduct
    from app.wholesale.services.inventory import available_color_pairs_at_location

    from_location = (payload.from_location or "").strip()
    to_location = payload.to_location.strip()
    if not from_location:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say which place the goods leave.")
    if to_location.lower() == from_location.lower():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The goods must go to a different place than they leave."
        )
    lines: list[StockTransferLine] = []
    seen: set[str] = set()
    for entry in payload.lines:
        code = entry.stock_code.strip()
        if code.lower() in seen:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"{code} appears twice — put all of its colours on one line."
            )
        seen.add(code.lower())
        product = db.query(WholesaleProduct).filter(WholesaleProduct.stock_code == code).first()
        if product is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{code} is not a known product.")
        text = entry.color_breakdown.strip()
        problem = color_qty_problem(text)
        if problem or not text:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{code}: {problem or 'Say which colours are moving.'}")
        conversions = product.default_unit_conversions
        requested = color_qty_pairs_by_color(text, entry.unit, conversions)
        shelf = available_color_pairs_at_location(db, branch_id, code, from_location)
        for color, pairs in requested.items():
            if pairs > shelf.get(color, 0):
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"{code} {color}: only {max(0, shelf.get(color, 0))} pairs are on the shelf at {from_location} right now.",
                )
        lines.append(
            StockTransferLine(
                stock_code=code,
                description=product.description,
                product_group=product.product_group,
                color_breakdown=text,
                unit=entry.unit,
                unit_conversions=conversions,
                quantity_pairs=sum(requested.values()),
            )
        )
    if not lines:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose at least one product to move.")
    transfer = StockTransfer(
        branch_id=branch_id,
        voucher_id=None,
        voucher_no="",
        supplier_name="",
        from_location=from_location,
        to_location=to_location,
        moved_on=payload.moved_on,
        note=payload.note.strip(),
        recorded_by_user_id=user_id,
        lines=lines,
    )
    db.add(transfer)
    db.flush()
    record_audit_log(
        db,
        branch_id=branch_id,
        entity_type="stock_transfer",
        entity_id=transfer.id,
        action="transfer_stock",
        operator_id=user_id,
        summary=f"Moved stock from {from_location} to {to_location}",
        payload={"from": from_location, "to": to_location, "pairs": sum(line.quantity_pairs for line in lines)},
    )
    ensure_warehouse(db, to_location)
    db.commit()
    db.refresh(transfer)
    _allocate_arrivals(db, transfer)
    return transfer


def count_transfer(db: Session, transfer_id: str, branch_id: str | None, user_id: str, payload) -> StockTransfer:
    """The destination counts what arrived. Its stock then follows the count, so a difference
    from what was sent shows up there. A count can be corrected later."""
    from app.wholesale.services.inventory import available_color_pairs_at_location

    transfer = (
        db.query(StockTransfer)
        .options(selectinload(StockTransfer.lines))
        .filter(StockTransfer.id == transfer_id)
        .first()
    )
    if transfer is None or (branch_id is not None and transfer.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stock transfer not found")
    by_code = {line.stock_code.lower(): line for line in transfer.lines}
    changes: list[tuple[StockTransferLine, str, ColorPairs]] = []
    for entry in payload.lines:
        line = by_code.get(entry.stock_code.strip().lower())
        if line is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{entry.stock_code} was not in this move.")
        text = entry.color_breakdown.strip()
        if text:
            problem = color_qty_problem(text)
            if problem:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{line.stock_code}: {problem}")
        counted = color_qty_pairs_by_color(text, entry.unit, line.unit_conversions) if text else {}
        changes.append((line, text, counted))

    # A lower count takes goods off the destination's shelf, so they must still be there.
    for line, _text, counted in changes:
        before = received_colors(line)
        shelf = available_color_pairs_at_location(db, transfer.branch_id, line.stock_code, transfer.to_location)
        for color in set(before) | set(counted):
            drop = before.get(color, 0) - counted.get(color, 0)
            if drop > 0 and shelf.get(color, 0) < drop:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"Part of {line.stock_code} {color} has already left {transfer.to_location}, so the count can't be lowered that far.",
                )
    for line, text, counted in changes:
        line.counted_color_breakdown = text
        line.counted_quantity_pairs = sum(counted.values())
    transfer.counted_on = payload.counted_on
    record_audit_log(
        db,
        branch_id=transfer.branch_id,
        entity_type="voucher" if transfer.voucher_id else "stock_transfer",
        entity_id=transfer.voucher_id or transfer.id,
        action="count_transfer",
        operator_id=user_id,
        summary=f"Counted a move into {transfer.to_location}",
        payload={"to": transfer.to_location, "lines": len(changes)},
    )
    db.commit()
    db.refresh(transfer)
    _allocate_arrivals(db, transfer)
    return transfer


def pending_move_pairs_by_voucher(db: Session, vouchers: list[SupplierVoucher]) -> dict[str, dict[str, int]]:
    """For each voucher, what is not settled in a warehouse yet, in two parts.

    `to_move`: pairs counted at a gate that is not a warehouse and not yet moved on (the sum of
    `left_pairs` in `voucher_pool`). `to_count`: pairs moved on whose destination has not counted
    them yet. Worked out for many vouchers at once so a list does not ask the database per voucher.
    A gate that is itself a warehouse never adds to either.
    """
    if not vouchers:
        return {}
    by_no = {voucher.voucher_no: voucher for voucher in vouchers}
    warehouses = warehouse_names(db)

    receivings = (
        db.query(Receiving)
        .options(selectinload(Receiving.packages).selectinload(ReceivingPackage.items))
        .filter(Receiving.voucher_no.in_(list(by_no)))
        .all()
    )
    counted: dict[tuple[str, str], int] = defaultdict(int)  # (voucher_id, gate) -> pairs
    for receiving in receivings:
        voucher = by_no[receiving.voucher_no]
        if voucher.branch_id is not None and receiving.branch_id != voucher.branch_id:
            continue
        if receiving.gate.strip().lower() in warehouses:
            continue
        for package in receiving.packages:
            if not package.opened:
                continue
            for item in package.items:
                if item.stock_code.strip() and item.quantity_pairs > 0:
                    counted[(voucher.id, receiving.gate)] += item.quantity_pairs

    moved: dict[tuple[str, str], int] = defaultdict(int)  # (voucher_id, from_location) -> pairs
    uncounted: dict[str, int] = defaultdict(int)  # voucher_id -> pairs not yet counted at the destination
    transfers = (
        db.query(StockTransfer)
        .options(selectinload(StockTransfer.lines))
        .filter(StockTransfer.voucher_id.in_([voucher.id for voucher in vouchers]))
        .all()
    )
    for transfer in transfers:
        for line in transfer.lines:
            moved[(transfer.voucher_id, transfer.from_location)] += line.quantity_pairs
            if line.counted_quantity_pairs is None:
                uncounted[transfer.voucher_id] += line.quantity_pairs

    result: dict[str, dict[str, int]] = {voucher.id: {"to_move": 0, "to_count": uncounted.get(voucher.id, 0)} for voucher in vouchers}
    for (voucher_id, gate), pairs in counted.items():
        result[voucher_id]["to_move"] += max(0, pairs - moved.get((voucher_id, gate), 0))
    return result
