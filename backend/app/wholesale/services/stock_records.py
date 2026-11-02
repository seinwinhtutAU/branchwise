"""The computed Stock Records view across the whole wholesale pipeline.

This module deliberately reads each source in a small, fixed number of batched
queries and combines the rows in memory.  It must not grow a query per product:
the screen is specifically useful for products which have not reached a gate yet.
"""

from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session, selectinload

from app.wholesale.services.stock_transfers import received_colors as transfer_received_colors
from app.wholesale.services.stock_transfers import received_pairs as transfer_received_pairs
from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    ProductGroup,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    StockTransfer,
    StockTransferLine,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesaleStockMovement,
    WholesaleUnit,
)
from app.wholesale.services.colors import color_qty_pairs_by_color
from app.wholesale.services.inventory import effective_allocated_color_pairs
from app.wholesale.services.places import warehouse_names
from app.wholesale.services.shipments import final_received, total_lost
from app.wholesale.services.supplier_vouchers_service import received_pairs_by_voucher_stock


def _filter_branch(query, model, branch_id: str | None):
    return query if branch_id is None else query.filter(model.branch_id == branch_id)


def _add_ref(target: dict[str, set[str]], name: str, value: str) -> None:
    if value:
        target[name].add(value)


def _remember_metadata(
    metadata: dict[str, tuple[int, date, str, ProductGroup]],
    code: str,
    description: str,
    product_group: ProductGroup,
    occurred_on: date,
    priority: int,
) -> None:
    if not code:
        return
    current = metadata.get(code)
    # A receiving line may legally omit its description even though the voucher or
    # order still has one.  "Most recent source" only applies to a source that carries
    # a value, so do not let an empty higher-priority value hide a useful one.
    if not description and current is not None and current[2]:
        return
    if (
        current is None
        or (description and not current[2])
        or priority > current[0]
        or (priority == current[0] and occurred_on >= current[1])
    ):
        metadata[code] = (priority, occurred_on, description or "", product_group or ProductGroup.MAN)


def _color_text(colors: dict[str, int]) -> str:
    return ",".join(
        f"{color}{pairs // 6}s" if pairs % 6 == 0 else f"{color}{pairs}p"
        for color, pairs in sorted(colors.items())
        if pairs > 0
    )


def _remember_colors(
    colors_by_code: dict[str, tuple[int, date, dict[str, int]]],
    code: str,
    colors: dict[str, int],
    occurred_on: date,
    priority: int,
) -> None:
    if not colors:
        return
    current = colors_by_code.get(code)
    if current is None or priority > current[0] or (priority == current[0] and occurred_on >= current[1]):
        colors_by_code[code] = (priority, occurred_on, colors)


def _shipment_stage_pairs(
    shipment_rows: list[Shipment],
    counts: dict[str, int],
    still_to_come: int,
) -> tuple[int, int]:
    """Split exact remaining pairs into approximate supplier/transit stages.

    Shipments only count packages, not product contents, so this proportional split is
    an estimate.  The total still to come remains exact from voucher lines and gate
    counts.
    """
    if still_to_come <= 0:
        return 0, 0
    if not shipment_rows:
        return still_to_come, 0

    total_packages = sum(max(0, shipment.total_packages) for shipment in shipment_rows)
    sent = sum(max(0, shipment.packages_sent_by_cargo) for shipment in shipment_rows)
    arrived = 0
    lost = 0
    for shipment in shipment_rows:
        arrived += max(0, final_received(shipment, counts))
        lost += max(0, total_lost(shipment))

    not_sent = max(0, total_packages - sent)
    in_transit = max(0, sent - arrived - lost)
    denominator = not_sent + in_transit
    if denominator == 0:
        return still_to_come, 0
    at_supplier = round(still_to_come * not_sent / denominator)
    return at_supplier, still_to_come - at_supplier


def stock_records(db: Session, branch_id: str | None) -> list[dict]:
    """Return one row per product seen anywhere in the wholesale pipeline."""
    metadata: dict[str, tuple[int, date, str, ProductGroup]] = {}
    sources: dict[str, set[str]] = defaultdict(set)
    references: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    last_activity: dict[str, date] = {}
    source_colors: dict[str, tuple[int, date, dict[str, int]]] = {}
    codes: set[str] = set()
    today = date.today()
    received_today_by_code: dict[str, int] = defaultdict(int)
    delivered_today_by_code: dict[str, int] = defaultdict(int)

    voucher_date: dict[str, date] = {}
    voucher_lines_by_code: dict[str, list[tuple[str, int, int]]] = defaultdict(list)

    voucher_query = (
        db.query(SupplierVoucherLine, SupplierVoucher)
        .join(SupplierVoucher, SupplierVoucherLine.voucher_id == SupplierVoucher.id)
    )
    voucher_query = _filter_branch(voucher_query, SupplierVoucher, branch_id)
    for line, voucher in voucher_query.all():
        code = line.stock_code.strip()
        if not code:
            continue
        codes.add(code)
        sources[code].add("voucher")
        _add_ref(references[code], "voucher", voucher.voucher_no)
        voucher_date[voucher.voucher_no] = max(voucher_date.get(voucher.voucher_no, voucher.voucher_date), voucher.voucher_date)
        last_activity[code] = max(last_activity.get(code, voucher.voucher_date), voucher.voucher_date)
        _remember_metadata(metadata, code, line.description, line.product_group, voucher.voucher_date, 3)
        _remember_colors(
            source_colors,
            code,
            color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions),
            voucher.voucher_date,
            3,
        )
        voucher_lines_by_code[code].append((voucher.voucher_no, max(0, line.quantity_pairs), max(0, line.lost_quantity_pairs)))

    received_by_voucher_stock = received_pairs_by_voucher_stock(
        db, list(voucher_date), branch_id
    )
    received_total: dict[tuple[str, str], int] = defaultdict(int, received_by_voucher_stock)

    received_by_location: dict[tuple[str, str], int] = defaultdict(int)
    received_colors: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    receiving_dates: dict[tuple[str, str], date] = {}
    receiving_history: set[str] = set()

    receiving_item_query = (
        db.query(ReceivingItem, ReceivingPackage, Receiving)
        .join(ReceivingPackage, ReceivingItem.package_id == ReceivingPackage.id)
        .join(Receiving, ReceivingPackage.receiving_id == Receiving.id)
        .filter(ReceivingPackage.opened.is_(True))
    )
    receiving_item_query = _filter_branch(receiving_item_query, Receiving, branch_id)
    for item, package, receiving in receiving_item_query.all():
        code = item.stock_code.strip()
        if not code:
            continue
        codes.add(code)
        receiving_history.add(code)
        sources[code].add("receiving")
        if receiving.voucher_no:
            sources[code].add("voucher")
        _add_ref(references[code], "receiving", receiving.receiving_no)
        _add_ref(references[code], "voucher", receiving.voucher_no)
        if receiving.shipment_no:
            _add_ref(references[code], "shipment", receiving.shipment_no)
        occurred_on = package.received_on or receiving.received_on
        last_activity[code] = max(last_activity.get(code, occurred_on), occurred_on)
        _remember_metadata(metadata, code, item.description, item.product_group, occurred_on, 4)
        _remember_colors(
            source_colors,
            code,
            color_qty_pairs_by_color(item.color_breakdown, item.unit, item.unit_conversions),
            occurred_on,
            4,
        )
        location_key = (code, receiving.gate)
        received_by_location[location_key] += max(0, item.quantity_pairs)
        if occurred_on == today:
            received_today_by_code[code] += max(0, item.quantity_pairs)
        for color, pairs in color_qty_pairs_by_color(item.color_breakdown, item.unit, item.unit_conversions).items():
            received_colors[location_key][color] += pairs
        receiving_dates[location_key] = max(receiving_dates.get(location_key, occurred_on), occurred_on)

    # Goods moved between places: a place gains what was transferred in and loses what went out.
    transfer_by_location: dict[tuple[str, str], int] = defaultdict(int)
    transfer_colors: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    transfer_dates: dict[tuple[str, str], date] = {}
    # Moved but not counted at the destination yet: on its way there, not in its stock.
    moving_by_place: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    transfer_query = db.query(StockTransferLine, StockTransfer).join(
        StockTransfer, StockTransferLine.transfer_id == StockTransfer.id
    )
    transfer_query = _filter_branch(transfer_query, StockTransfer, branch_id)
    for line, transfer in transfer_query.all():
        code = line.stock_code.strip()
        if not code:
            continue
        codes.add(code)
        sent_colors = color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions)
        if line.counted_quantity_pairs is None:
            moving_by_place[code][transfer.to_location] += max(0, line.quantity_pairs)
        # The destination holds only what it has counted; the sender loses what was sent.
        for place, sign, colors, amount in (
            (transfer.to_location, 1, transfer_received_colors(line), transfer_received_pairs(line)),
            (transfer.from_location, -1, sent_colors, line.quantity_pairs),
        ):
            key = (code, place)
            transfer_by_location[key] += sign * amount
            for color, pairs in colors.items():
                transfer_colors[key][color] += sign * pairs
            transfer_dates[key] = max(transfer_dates.get(key, transfer.moved_on), transfer.moved_on)

    movement_by_code: dict[str, int] = defaultdict(int)
    movement_by_location: dict[tuple[str, str], int] = defaultdict(int)
    movement_colors: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    movement_dates: dict[tuple[str, str], date] = {}
    delivered_by_order_color: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    movement_query = db.query(WholesaleStockMovement, CustomerOrder).join(
        CustomerOrder, WholesaleStockMovement.order_id == CustomerOrder.id
    )
    movement_query = _filter_branch(movement_query, WholesaleStockMovement, branch_id)
    for movement, order in movement_query.all():
        code = movement.stock_code.strip()
        if not code:
            continue
        codes.add(code)
        sources[code].add("delivery")
        _add_ref(references[code], "order", order.order_no)
        occurred_on = movement.delivered_on
        last_activity[code] = max(last_activity.get(code, occurred_on), occurred_on)
        _remember_metadata(metadata, code, movement.description, movement.product_group, occurred_on, 1)
        _remember_colors(
            source_colors,
            code,
            color_qty_pairs_by_color(movement.color_breakdown, WholesaleUnit.SET, movement.unit_conversions),
            occurred_on,
            1,
        )
        movement_by_code[code] += max(0, movement.quantity_pairs)
        if occurred_on == today:
            delivered_today_by_code[code] += max(0, movement.quantity_pairs)
        location_key = (code, movement.location)
        movement_by_location[location_key] += max(0, movement.quantity_pairs)
        for color, pairs in color_qty_pairs_by_color(movement.color_breakdown, WholesaleUnit.SET, movement.unit_conversions).items():
            movement_colors[location_key][color] += pairs
            delivered_by_order_color[movement.order_id][color] += pairs
        movement_dates[location_key] = max(movement_dates.get(location_key, occurred_on), occurred_on)

    ordered_by_code: dict[str, int] = defaultdict(int)
    customer_lost_by_code: dict[str, int] = defaultdict(int)
    order_lines_by_code: dict[str, list[tuple[CustomerOrderLine, CustomerOrder]]] = defaultdict(list)
    order_query = db.query(CustomerOrderLine, CustomerOrder).join(
        CustomerOrder, CustomerOrderLine.order_id == CustomerOrder.id
    ).filter(CustomerOrder.cancelled.is_(False))
    order_query = _filter_branch(order_query, CustomerOrder, branch_id)
    for line, order in order_query.all():
        code = line.stock_code.strip()
        if not code:
            continue
        codes.add(code)
        sources[code].add("order")
        _add_ref(references[code], "order", order.order_no)
        last_activity[code] = max(last_activity.get(code, order.order_date), order.order_date)
        _remember_metadata(metadata, code, line.description, line.product_group, order.order_date, 2)
        _remember_colors(
            source_colors,
            code,
            color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions),
            order.order_date,
            2,
        )
        ordered_by_code[code] += max(0, line.quantity_pairs)
        customer_lost_by_code[code] += max(0, line.lost_quantity_pairs)
        order_lines_by_code[code].append((line, order))

    allocated_by_code: dict[str, int] = defaultdict(int)
    for code, lines in order_lines_by_code.items():
        for line, order in lines:
            allocated_by_code[code] += sum(
                effective_allocated_color_pairs(line, delivered_by_order_color.get(order.id)).values()
            )

    shipment_query = db.query(Shipment).filter(Shipment.voucher_no.in_(list(voucher_date))) if voucher_date else None
    shipment_rows_by_voucher: dict[str, list[Shipment]] = defaultdict(list)
    shipment_ids: list[str] = []
    if shipment_query is not None:
        shipment_query = _filter_branch(shipment_query, Shipment, branch_id).options(selectinload(Shipment.stops))
        shipments = shipment_query.all()
        shipment_ids = [shipment.id for shipment in shipments]
        for shipment in shipments:
            shipment_rows_by_voucher[shipment.voucher_no].append(shipment)
            for code in {code for code, lines in voucher_lines_by_code.items() if any(voucher_no == shipment.voucher_no for voucher_no, _, _ in lines)}:
                sources[code].add("shipment")
                _add_ref(references[code], "shipment", shipment.shipment_no)
                last_activity[code] = max(last_activity.get(code, shipment.sent_on), shipment.sent_on)

    from app.wholesale.services.receivings_service import counts_by_stop

    counted_by_stop, _ = counts_by_stop(db, shipment_ids)

    warehouses = warehouse_names(db)
    records: list[dict] = []
    for code in sorted(codes):
        locations = sorted({
            location
            for product_code, location in set(received_by_location) | set(movement_by_location) | set(transfer_by_location)
            if product_code == code
        })
        location_rows = []
        for location in locations:
            key = (code, location)
            on_hand = max(0, received_by_location[key] + transfer_by_location[key] - movement_by_location[key])
            color_pairs = {
                color: max(
                    0,
                    received_colors[key].get(color, 0)
                    + transfer_colors[key].get(color, 0)
                    - movement_colors[key].get(color, 0),
                )
                for color in set(received_colors[key]) | set(transfer_colors[key]) | set(movement_colors[key])
            }
            location_rows.append({
                "location": location,
                # Goods are warehouse stock only at a warehouse; a gate that is not one only counts.
                "is_warehouse": location.strip().lower() in warehouses,
                "on_hand_pairs": on_hand,
                "colors": _color_text(color_pairs),
                "last_moved_on": max(
                    activity_date
                    for activity_date in (receiving_dates.get(key), movement_dates.get(key), transfer_dates.get(key))
                    if activity_date is not None
                ) if key in receiving_dates or key in movement_dates or key in transfer_dates else None,
            })
        on_hand = sum(row["on_hand_pairs"] for row in location_rows)
        warehouse_pairs = sum(row["on_hand_pairs"] for row in location_rows if row["is_warehouse"])
        allocated = allocated_by_code[code]
        # Only warehouse stock can be set aside or delivered, so only it can be available.
        available = max(0, warehouse_pairs - allocated)

        at_supplier = 0
        in_transit = 0
        for voucher_no, quantity, lost in voucher_lines_by_code[code]:
            received = received_total[(voucher_no, code)]
            still_to_come = max(0, quantity - received - lost)
            supplier_pairs, transit_pairs = _shipment_stage_pairs(
                shipment_rows_by_voucher[voucher_no],
                counted_by_stop,
                still_to_come,
            )
            at_supplier += supplier_pairs
            in_transit += transit_pairs

        owed = max(0, ordered_by_code[code] - movement_by_code[code] - customer_lost_by_code[code])
        lost = sum(lost for _, _, lost in voucher_lines_by_code[code]) + customer_lost_by_code[code]
        color_totals: dict[str, int] = defaultdict(int)
        for row in location_rows:
            for color, pairs in color_qty_pairs_by_color(row["colors"], WholesaleUnit.SET).items():
                color_totals[color] += pairs
        if not any(pairs > 0 for pairs in color_totals.values()) and code in source_colors:
            color_totals.update(source_colors[code][2])
        if on_hand > 0 and allocated >= on_hand:
            status = "Customer Allocated"
        elif on_hand > 0:
            status = "At Receiving"
        elif in_transit > 0 or moving_by_place.get(code):
            status = "In Transit"
        elif at_supplier > 0:
            status = "At Supplier"
        elif owed > 0:
            status = "Customer Ordered"
        else:
            status = "Finished"

        source_sets = sources[code]
        record_metadata = metadata.get(code, (0, date.min, "", ProductGroup.MAN))
        records.append({
            "stock_code": code,
            "description": record_metadata[2],
            "product_group": record_metadata[3].value,
            "on_hand_pairs": on_hand,
            "warehouse_pairs": warehouse_pairs,
            "at_gate_pairs": on_hand - warehouse_pairs,
            "allocated_pairs": allocated,
            "available_pairs": available,
            "at_supplier_pairs": at_supplier,
            "in_transit_pairs": in_transit,
            # Moved to a warehouse that has not counted it yet, by place.
            "moving_pairs": sum(moving_by_place.get(code, {}).values()),
            "moving": [
                {"location": place, "pairs": pairs}
                for place, pairs in sorted(moving_by_place.get(code, {}).items())
                if pairs > 0
            ],
            "incoming_pairs": at_supplier + in_transit,
            "customer_ordered_pairs": ordered_by_code[code],
            "owed_to_customers_pairs": owed,
            "delivered_pairs": movement_by_code[code],
            "lost_pairs": lost,
            "received_today_pairs": received_today_by_code[code],
            "delivered_today_pairs": delivered_today_by_code[code],
            "colors": _color_text(dict(color_totals)),
            "color_quantities_pairs": {color: pairs for color, pairs in sorted(color_totals.items()) if pairs > 0},
            "locations": location_rows,
            "sources": sorted(source_sets),
            "voucher_nos": sorted(references[code]["voucher"]),
            "shipment_nos": sorted(references[code]["shipment"]),
            "order_nos": sorted(references[code]["order"]),
            "receiving_nos": sorted(references[code]["receiving"]),
            "status": status,
            "last_activity_on": last_activity.get(code),
            "has_receiving_history": code in receiving_history,
        })
    return records
