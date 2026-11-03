"""Loads the wholesale demo data into Postgres, so the screens show the same working
business as the front-end's in-memory seed arrays once a phase's screen moves onto the
real database. See scripts/data/wholesale_demo.json for the data itself, transcribed once
from the TypeScript seed arrays; each phase adds its own section to both files.

Safe by default: the script refuses a branch that already has wholesale rows, so a demo
load can never silently mix with a person's work. Pass --force to run its idempotent
mode (existing demo references are skipped), or --wipe to explicitly replace only this
branch's wholesale rows. --dry-run prints what would happen without writing anything.

Touches the real database, so this must run with --directory, not --project (see
CLAUDE.md's note on backend/.env only being read that way).

    uv run --directory backend python scripts/seed_wholesale_demo.py --branch "Wholesale"
    uv run --directory backend python scripts/seed_wholesale_demo.py --branch "Wholesale" --force
    uv run --directory backend python scripts/seed_wholesale_demo.py --branch "Wholesale" --wipe
    uv run --directory backend python scripts/seed_wholesale_demo.py --branch "Wholesale" --dry-run
"""

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal  # noqa: E402
from app.models.branch import Branch  # noqa: E402
from app.models.user import User  # noqa: E402
from app.wholesale.models.entities import (  # noqa: E402
    ProductGroup,
    CustomerOrder,
    CustomerOrderLine,
    Receiving,
    ReceivingCost,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    ShipmentStop,
    SupplierVoucher,
    SupplierVoucherLine,
    StockTransfer,
    StockTransferLine,
    SupplyLink,
    WholesaleAuditLog,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
    WholesaleWriteOff,
)
from app.wholesale.models.master_data import (  # noqa: E402
    WholesaleCarrier,
    WholesaleCustomer,
    WholesaleDestination,
    WholesaleFeeType,
    WholesalePlace,
    WholesaleProduct,
    WholesaleReceivingGate,
    WholesaleSupplier,
)
from app.wholesale.services.inventory import auto_allocate_arrivals  # noqa: E402
from app.wholesale.services.colors import color_qty_pairs_by_color, colors_as_json  # noqa: E402
from app.wholesale.services.units import to_pairs  # noqa: E402

DATA_FILE = Path(__file__).parent / "data" / "wholesale_demo.json"


def _resolve_branch(db, name_or_id: str) -> Branch:
    branch = db.get(Branch, name_or_id) or db.query(Branch).filter(Branch.name == name_or_id).one_or_none()
    if branch is None:
        raise SystemExit(f"No branch found matching {name_or_id!r} — check the name or id and try again.")
    return branch


_NAMED_LISTS = [
    ("suppliers", WholesaleSupplier),
    ("customers", WholesaleCustomer),
    ("carriers", WholesaleCarrier),
    ("destinations", WholesaleDestination),
    ("gates", WholesaleReceivingGate),
    ("places", WholesalePlace),
    ("fee_types", WholesaleFeeType),
]
_MASTER_MODELS = [model for _, model in _NAMED_LISTS] + [WholesaleProduct]


def _seed_master_data(db, master: dict, *, dry_run: bool) -> int:
    """The pick-lists the screens' dropdowns read from. Global (not per branch), added
    by name / stock code so running it again never duplicates a row."""
    created = 0
    for key, model in _NAMED_LISTS:
        have = {row[0] for row in db.query(model.name).all()}
        for entry in master.get(key, []):
            fields = entry if isinstance(entry, dict) else {"name": entry}
            if fields["name"] in have:
                continue
            created += 1
            if not dry_run:
                db.add(model(**fields))
    have = {row[0] for row in db.query(WholesaleProduct.stock_code).all()}
    for entry in master.get("products", []):
        if entry["stock_code"] in have:
            continue
        created += 1
        if not dry_run:
            db.add(
                WholesaleProduct(
                    stock_code=entry["stock_code"],
                    description=entry["description"],
                    product_group=ProductGroup(entry["group"]),
                    default_unit=WholesaleUnit(entry["default_unit"]),
                )
            )
    print(f"  {'would add' if dry_run else 'add'} {created} master-data row(s)")
    return created


def _seed_shipments(db, branch: Branch, shipments: list[dict], *, dry_run: bool) -> int:
    existing = {
        row[0]: row[1]
        for row in db.query(Shipment.shipment_no, Shipment.id).filter(Shipment.branch_id == branch.id).all()
    }
    # shipment_no -> id, so later steps can find the shipments just created.
    by_no: dict[str, str] = dict(existing)
    created = 0
    for entry in shipments:
        if entry["shipment_no"] in existing:
            print(f"  skip {entry['shipment_no']} — already seeded")
            continue
        print(f"  {'would create' if dry_run else 'create'} {entry['shipment_no']}")
        if dry_run:
            created += 1
            continue
        # Each leg of the demo data is a place on the route, in order, ending in the gate.
        stops: list[ShipmentStop] = []
        for index, leg in enumerate(entry["legs"]):
            stops.append(
                ShipmentStop(
                    leg_order=index + 1,
                    stop_name=leg["stop_name"],
                    carrier_name=leg["carrier_name"],
                    packages_received=leg["packages_received"],
                    # The cargo company sent what the shipment says; later roads sent what arrived.
                    packages_sent=entry["packages_sent_by_cargo"] if not stops else leg["packages_received"],
                    parent=stops[-1] if stops else None,
                )
            )
        stops.append(
            ShipmentStop(
                leg_order=len(stops) + 1,
                stop_name=entry["final_location"],
                carrier_name="",
                packages_received=entry["final_received_packages"],
                packages_sent=entry["packages_sent_by_cargo"] if not stops else entry["final_received_packages"],
                is_gate=True,
                parent=stops[-1] if stops else None,
            )
        )
        shipment = Shipment(
            branch_id=branch.id,
            shipment_no=entry["shipment_no"],
            voucher_no=entry["voucher_no"],
            supplier_name=entry["supplier_name"],
            carrier_name=entry["cargo_name"],
            sent_on=date.fromisoformat(entry["sent_date"]),
            total_packages=entry["total_packages"],
            total_quantity_pairs=entry["total_pairs"],
            total_unit=entry["total_unit"],
            packages_sent_by_cargo=entry["packages_sent_by_cargo"],
            lost_packages=entry.get("lost_packages", 0),
            stops=stops,
        )
        db.add(shipment)
        db.flush()
        by_no[entry["shipment_no"]] = shipment.id
        created += 1
    return created


def _seed_vouchers(
    db, branch: Branch, vouchers: list[dict], *, dry_run: bool, actor_id: str
) -> int:
    existing_nos = {
        row[0]
        for row in db.query(SupplierVoucher.voucher_no)
        .filter(SupplierVoucher.branch_id == branch.id)
        .all()
    }
    created = 0
    for entry in vouchers:
        if entry["voucher_no"] in existing_nos:
            print(f"  skip {entry['voucher_no']} — already seeded")
            continue
        print(f"  {'would create' if dry_run else 'create'} {entry['voucher_no']}")
        if dry_run:
            created += 1
            continue
        lines = []
        for line in entry["lines"]:
            unit = WholesaleUnit(line["unit"])
            color_qty = line["color_qty"].strip()
            lines.append(
                SupplierVoucherLine(
                    stock_code=line["stock_code"],
                    description=line["description"],
                    product_group=ProductGroup(line["group"]),
                    color_breakdown=color_qty,
                    colors=colors_as_json(color_qty),
                    unit=unit,
                    quantity_pairs=to_pairs(line["qty"], unit),
                    buying_price=line["buying_price"],
                )
            )
        payments = [
            WholesalePayment(
                branch_id=branch.id,
                paid_on=date.fromisoformat(payment["date"]),
                amount=payment["amount"],
                note=payment["note"],
                recorded_by_user_id=actor_id,
            )
            for payment in entry["payments"]
        ]
        db.add(
            SupplierVoucher(
                branch_id=branch.id,
                voucher_no=entry["voucher_no"],
                supplier_name=entry["supplier_name"],
                voucher_date=date.fromisoformat(entry["voucher_date"]),
                carrier_name=entry["cargo_name"],
                total_packages=entry["total_packages"],
                lines=lines,
                payments=payments,
            )
        )
        created += 1
    return created


def _seed_receivings(
    db,
    branch: Branch,
    receivings: list[dict],
    *,
    dry_run: bool,
    planned_shipment_nos: set[str] | None = None,
) -> int:
    existing_nos = {
        row[0]
        for row in db.query(Receiving.receiving_no)
        .filter(Receiving.branch_id == branch.id)
        .all()
    }
    shipments = {
        row.shipment_no: row
        for row in db.query(Shipment).filter(Shipment.branch_id == branch.id).all()
    }
    created = 0
    for entry in receivings:
        if entry["receiving_no"] in existing_nos:
            print(f"  skip {entry['receiving_no']} — already seeded")
            continue
        shipment = shipments.get(entry["shipment_no"])
        if shipment is None:
            if dry_run and entry["shipment_no"] in (planned_shipment_nos or set()):
                print(f"  would create {entry['receiving_no']}")
                created += 1
                continue
            raise SystemExit(
                f"Cannot seed {entry['receiving_no']}: shipment "
                f"{entry['shipment_no']} is missing for {branch.name}."
            )
        print(f"  {'would create' if dry_run else 'create'} {entry['receiving_no']}")
        if dry_run:
            created += 1
            continue
        unit = WholesaleUnit(entry["total_unit"])
        packages = []
        for package in entry["packages"]:
            items = []
            for item in package["items"]:
                item_unit = WholesaleUnit(item["unit"])
                color_qty = item["color_qty"].strip()
                items.append(
                    ReceivingItem(
                        stock_code=item["stock_code"],
                        description=item["description"],
                        product_group=ProductGroup(item["group"]),
                        color_breakdown=color_qty,
                        colors=colors_as_json(color_qty),
                        unit=item_unit,
                        quantity_pairs=to_pairs(item["qty"], item_unit),
                    )
                )
            packages.append(
                ReceivingPackage(
                    package_no=package["package_no"],
                    opened=package["opened"],
                    received_on=(
                        date.fromisoformat(package["received_date"])
                        if package["received_date"]
                        else None
                    ),
                    note=package["note"],
                    items=items,
                )
            )
        costs = [
            ReceivingCost(
                **{
                    **cost,
                    "cost_date": date.fromisoformat(cost.get("cost_date", entry["received_date"])),
                }
            )
            for cost in entry["costs"]
        ]
        db.add(
            Receiving(
                branch_id=branch.id,
                receiving_no=entry["receiving_no"],
                shipment_id=shipment.id,
                shipment_no=shipment.shipment_no,
                voucher_no=shipment.voucher_no,
                supplier_name=shipment.supplier_name,
                gate=entry["gate"],
                received_on=date.fromisoformat(entry["received_date"]),
                total_packages=len(packages),
                total_quantity_pairs=to_pairs(entry["total_qty"], unit),
                total_unit=unit,
                packages=packages,
                costs=costs,
            )
        )
        created += 1
    return created


def _seed_orders(db, branch: Branch, orders: list[dict], *, dry_run: bool, actor_id: str) -> int:
    existing_nos = {
        row[0]
        for row in db.query(CustomerOrder.order_no).filter(CustomerOrder.branch_id == branch.id).all()
    }
    created = 0
    for entry in orders:
        if entry["order_no"] in existing_nos:
            print(f"  skip {entry['order_no']} — already seeded")
            continue
        print(f"  {'would create' if dry_run else 'create'} {entry['order_no']}")
        if dry_run:
            created += 1
            continue
        lines = []
        for line in entry["lines"]:
            unit = WholesaleUnit(line["unit"])
            color_qty = line["color_qty"].strip()
            lines.append(
                CustomerOrderLine(
                    stock_code=line["stock_code"], description=line["description"],
                    product_group=ProductGroup(line["group"]), supplier_name=line["supplier_name"],
                    color_breakdown=color_qty, colors=colors_as_json(color_qty), unit=unit,
                    quantity_pairs=to_pairs(line["qty"], unit), selling_price=line["selling_price"],
                )
            )
        payments = [
            WholesalePayment(
                branch_id=branch.id, paid_on=date.fromisoformat(payment["date"]),
                amount=payment["amount"], note=payment["note"], recorded_by_user_id=actor_id,
            )
            for payment in entry.get("payments", [])
        ]
        db.add(
            CustomerOrder(
                branch_id=branch.id, order_no=entry["order_no"],
                customer_name=entry["customer_name"], customer_phone=entry["customer_phone"],
                customer_address=entry["customer_address"], order_date=date.fromisoformat(entry["order_date"]),
                cancelled=entry.get("cancelled", False), lines=lines, payments=payments,
            )
        )
        created += 1
    return created


def _seed_outgoing(db, branch: Branch, movements: list[dict], *, dry_run: bool, actor_id: str) -> int:
    existing = {
        row[0] for row in db.query(WholesaleStockMovement.note).filter(WholesaleStockMovement.branch_id == branch.id).all()
    }
    orders = {
        order.order_no: order for order in db.query(CustomerOrder).filter(CustomerOrder.branch_id == branch.id).all()
    }
    created = 0
    for entry in movements:
        if entry["seed_key"] in existing:
            print(f"  skip delivery {entry['seed_key']} — already seeded")
            continue
        order = orders.get(entry["order_no"])
        if order is None and dry_run:
            # Only happens with --wipe: the order it points at is still the old data.
            print(f"  would create delivery {entry['seed_key']}")
            created += 1
            continue
        if order is None:
            raise SystemExit(f"Cannot seed delivery {entry['seed_key']}: order {entry['order_no']} is missing.")
        print(f"  {'would create' if dry_run else 'create'} delivery {entry['seed_key']}")
        if dry_run:
            created += 1
            continue
        color_qty = entry["color_qty"].strip()
        source = next(line for line in order.lines if line.stock_code == entry["stock_code"])
        db.add(WholesaleStockMovement(
            branch_id=branch.id, order_id=order.id, stock_code=source.stock_code,
            description=source.description, product_group=source.product_group,
            color_breakdown=color_qty, colors=colors_as_json(color_qty),
            quantity_pairs=to_pairs(entry["qty"], WholesaleUnit(entry["unit"])),
            location=entry["location"], delivery_address=order.customer_address, delivered_on=date.fromisoformat(entry["date"]),
            note=entry["seed_key"], recorded_by_user_id=actor_id,
        ))
        created += 1
    return created


def colors_pairs(text: str, unit: WholesaleUnit) -> dict[str, int]:
    return color_qty_pairs_by_color(text, unit, {"pair": 1, "set": 6, "dozen": 12})


def _seed_transfers(db, branch: Branch, transfers: list[dict], *, dry_run: bool, actor_id: str) -> int:
    """Goods moved from the Mawlamyine gate (not a warehouse) to the warehouse, some already
    counted there and one still waiting for its count. Keyed by voucher, gate and destination."""
    vouchers = {v.voucher_no: v for v in db.query(SupplierVoucher).filter(SupplierVoucher.branch_id == branch.id).all()}
    have = {
        (t.voucher_no, t.from_location, t.to_location)
        for t in db.query(StockTransfer).filter(StockTransfer.branch_id == branch.id).all()
    }
    created = 0
    for entry in transfers:
        key = (entry["voucher_no"], entry["from"], entry["to"])
        if key in have:
            print(f"  skip move of {entry['voucher_no']} — already seeded")
            continue
        print(f"  {'would create' if dry_run else 'create'} move of {entry['voucher_no']} to {entry['to']}")
        created += 1
        if dry_run:
            continue
        voucher = vouchers[entry["voucher_no"]]
        lines = []
        for line in entry["lines"]:
            sent = line["color_qty"].strip()
            counted = (line.get("counted_color_qty") or "").strip()
            unit = WholesaleUnit(line["unit"])
            lines.append(StockTransferLine(
                stock_code=line["stock_code"], description=line["description"],
                product_group=ProductGroup(line["group"]), color_breakdown=sent, unit=unit,
                quantity_pairs=sum(colors_pairs(sent, unit).values()),
                counted_color_breakdown=counted if entry["counted_on"] else None,
                counted_quantity_pairs=sum(colors_pairs(counted, unit).values()) if entry["counted_on"] else None,
            ))
        db.add(StockTransfer(
            branch_id=branch.id, voucher_id=voucher.id, voucher_no=voucher.voucher_no,
            supplier_name=voucher.supplier_name, from_location=entry["from"], to_location=entry["to"],
            moved_on=date.fromisoformat(entry["moved_on"]),
            counted_on=date.fromisoformat(entry["counted_on"]) if entry["counted_on"] else None,
            note=entry["note"], recorded_by_user_id=actor_id, lines=lines,
        ))
    return created


def _seed_write_offs(db, branch: Branch, entries: list[dict], *, dry_run: bool, actor_id: str) -> int:
    """The explanations for goods that never arrived. The shipment / voucher line already
    carries its lost count (the demo file's shipments say so); this adds the log entry the
    Write-offs screen lists, mirroring what app/wholesale/services/write_offs.py writes."""
    shipments = {r.shipment_no: r for r in db.query(Shipment).filter(Shipment.branch_id == branch.id).all()}
    lines = {
        (v.voucher_no, line.stock_code): line
        for v in db.query(SupplierVoucher).filter(SupplierVoucher.branch_id == branch.id).all()
        for line in v.lines
    }
    existing = {
        (subject_type, reference, stock_code, reason, note, created_at)
        for subject_type, reference, stock_code, reason, note, created_at in db.query(
            WholesaleWriteOff.subject_type,
            WholesaleWriteOff.reference,
            WholesaleWriteOff.stock_code,
            WholesaleWriteOff.reason,
            WholesaleWriteOff.note,
            WholesaleWriteOff.created_at,
        )
        .filter(WholesaleWriteOff.branch_id == branch.id)
        .all()
    }
    created = 0
    for entry in entries:
        if dry_run:
            created += 1
            continue
        when = datetime.fromisoformat(entry["date"] + "T09:00:00")
        if entry["subject"] == "shipment":
            shipment = shipments.get(entry["shipment_no"])
            if not shipment:
                continue
            row = dict(
                subject_type="shipment", subject_id=shipment.id, reference=shipment.shipment_no,
                description=next((stop.stop_name for stop in shipment.stops if stop.is_gate), ""), stock_code=shipment.voucher_no,
                quantity=entry["packages"], unit="package",
            )
        else:
            line = lines.get((entry["voucher_no"], entry["stock_code"]))
            if not line:
                continue
            pairs = to_pairs(entry["sets"], WholesaleUnit.SET)
            row = dict(
                subject_type="voucher_line", subject_id=line.id, reference=entry["voucher_no"],
                description=line.description, stock_code=line.stock_code, quantity=pairs,
                unit=line.unit.value, unit_conversions=line.unit_conversions,
            )
        key = (row["subject_type"], row["reference"], row["stock_code"], entry["reason"], entry["note"], when)
        if key in existing:
            continue
        created += 1
        if entry["subject"] != "shipment":
            line.lost_quantity_pairs += pairs
        db.add(WholesaleWriteOff(
            branch_id=branch.id, reason=entry["reason"], note=entry["note"],
            recorded_by_user_id=actor_id, created_at=when, **row,
        ))
        existing.add(key)
    print(f"  {'would create' if dry_run else 'create'} {created} write-off(s)")
    return created


def _seed_supply_links(db, branch: Branch, *, dry_run: bool) -> int:
    """Say which customer orders each voucher was bought for.

    Oldest voucher first, each voucher line covers the oldest open order lines for the
    same stock code until either runs out. Voucher lines that are already linked are
    left alone, so it is safe to run again.
    """
    lines = (
        db.query(SupplierVoucherLine)
        .join(SupplierVoucher)
        .filter(SupplierVoucher.branch_id == branch.id)
        .order_by(SupplierVoucher.voucher_date, SupplierVoucher.voucher_no)
        .all()
    )
    linked_pairs = {
        (voucher_line_id, order_line_id)
        for voucher_line_id, order_line_id in db.query(
            SupplyLink.voucher_line_id, SupplyLink.order_line_id
        )
        .filter(SupplyLink.branch_id == branch.id)
        .all()
    }
    made = 0
    for line in lines:
        if line.order_links:
            continue
        room = line.quantity_pairs
        candidates = (
            db.query(CustomerOrderLine)
            .join(CustomerOrder)
            .filter(
                CustomerOrder.branch_id == branch.id,
                CustomerOrder.cancelled.is_(False),
                CustomerOrderLine.stock_code == line.stock_code,
            )
            .order_by(CustomerOrder.order_date, CustomerOrder.order_no)
            .all()
        )
        for order_line in candidates:
            if room <= 0:
                break
            if (line.id, order_line.id) in linked_pairs:
                continue
            already = sum(link.quantity_pairs for link in order_line.voucher_links)
            need = order_line.quantity_pairs - already
            if need <= 0:
                continue
            take = min(need, room)
            room -= take
            made += 1
            if not dry_run:
                line.order_links.append(
                    SupplyLink(branch_id=branch.id, order_line_id=order_line.id, quantity_pairs=take)
                )
                linked_pairs.add((line.id, order_line.id))
                db.flush()
    print(f"  linked {made} voucher line(s) to customer order lines")
    return made


def _seed_actor_id(db, branch: Branch) -> str:
    user = (
        db.query(User)
        .filter(User.branch_id == branch.id)
        .order_by(User.email)
        .first()
    )
    return user.id if user else "seed-demo"


def _wipe(db, branch: Branch, *, dry_run: bool) -> None:
    shipment_count = db.query(Shipment).filter(Shipment.branch_id == branch.id).count()
    voucher_count = db.query(SupplierVoucher).filter(SupplierVoucher.branch_id == branch.id).count()
    receiving_count = db.query(Receiving).filter(Receiving.branch_id == branch.id).count()
    order_count = db.query(CustomerOrder).filter(CustomerOrder.branch_id == branch.id).count()
    outgoing_count = db.query(WholesaleStockMovement).filter(WholesaleStockMovement.branch_id == branch.id).count()
    action = "would delete" if dry_run else "deleting"
    print(
        f"  {action} {shipment_count} shipment(s), {voucher_count} voucher(s), "
        f"{receiving_count} receiving(s), {order_count} customer order(s), and {outgoing_count} delivery row(s) for {branch.name}"
    )
    if not dry_run:
        # Child rows use ON DELETE CASCADE; receivings go first because shipments use
        # RESTRICT once a gate record exists.
        db.query(StockTransfer).filter(StockTransfer.branch_id == branch.id).delete(synchronize_session=False)
        db.query(Receiving).filter(Receiving.branch_id == branch.id).delete(
            synchronize_session=False
        )
        db.query(WholesaleStockMovement).filter(WholesaleStockMovement.branch_id == branch.id).delete(
            synchronize_session=False
        )
        db.query(CustomerOrder).filter(CustomerOrder.branch_id == branch.id).delete(
            synchronize_session=False
        )
        db.query(SupplierVoucher).filter(SupplierVoucher.branch_id == branch.id).delete(
            synchronize_session=False
        )
        db.query(Shipment).filter(Shipment.branch_id == branch.id).delete()
        # Write-offs and the audit trail point at the rows above by id, so once those are
        # gone they would only be orphans in the demo.
        db.query(WholesaleWriteOff).filter(WholesaleWriteOff.branch_id == branch.id).delete(
            synchronize_session=False
        )
        db.query(WholesaleAuditLog).filter(WholesaleAuditLog.branch_id == branch.id).delete(
            synchronize_session=False
        )
        # The pick-lists are global, not per branch, and only wholesale uses them.
        for model in _MASTER_MODELS:
            db.query(model).delete(synchronize_session=False)


def _has_wholesale_rows(db, branch: Branch) -> bool:
    return any(
        db.query(model.id).filter(model.branch_id == branch.id).first() is not None
        for model in (Shipment, SupplierVoucher, Receiving, CustomerOrder, WholesaleStockMovement, StockTransfer)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--branch", required=True, help="The wholesale branch's name or id")
    parser.add_argument("--wipe", action="store_true", help="Delete this branch's wholesale rows first")
    parser.add_argument("--force", action="store_true", help="Allow an idempotent seed into a branch that already has wholesale rows")
    parser.add_argument("--links-only", action="store_true", help="Only link existing vouchers to the orders they cover; touch nothing else")
    parser.add_argument("--dry-run", action="store_true", help="Print what would happen, write nothing")
    args = parser.parse_args()

    data = json.loads(DATA_FILE.read_text())

    db = SessionLocal()
    try:
        branch = _resolve_branch(db, args.branch)
        print(f"Seeding wholesale demo data for {branch.name} ({branch.id})")

        if args.links_only:
            _seed_supply_links(db, branch, dry_run=args.dry_run)
            if args.dry_run:
                db.rollback()
            else:
                db.commit()
            return

        if _has_wholesale_rows(db, branch) and not (args.force or args.wipe):
            raise SystemExit(
                f"{branch.name} already has wholesale rows. Refusing to mix demo data with them; use --force to skip existing references or --wipe to replace wholesale demo rows."
            )

        if args.wipe:
            _wipe(db, branch, dry_run=args.dry_run)

        _seed_master_data(db, data.get("master_data", {}), dry_run=args.dry_run)
        created_shipments = _seed_shipments(
            db, branch, data["shipments"], dry_run=args.dry_run
        )
        if not args.dry_run:
            # SessionLocal deliberately disables autoflush; make the shipment rows
            # visible to the receiving lookup before building dependent rows.
            db.flush()
        created_vouchers = _seed_vouchers(
            db,
            branch,
            data.get("vouchers", []),
            dry_run=args.dry_run,
            actor_id=_seed_actor_id(db, branch),
        )
        created_receivings = _seed_receivings(
            db,
            branch,
            data.get("receivings", []),
            dry_run=args.dry_run,
            planned_shipment_nos={
                entry["shipment_no"] for entry in data.get("shipments", [])
            },
        )
        created_orders = _seed_orders(
            db,
            branch,
            data.get("orders", []),
            dry_run=args.dry_run,
            actor_id=_seed_actor_id(db, branch),
        )
        if not args.dry_run:
            db.flush()
        created_outgoing = _seed_outgoing(
            db, branch, data.get("outgoing", []), dry_run=args.dry_run,
            actor_id=_seed_actor_id(db, branch),
        )
        if not args.dry_run:
            db.flush()
        _seed_transfers(
            db, branch, data.get("transfers", []), dry_run=args.dry_run, actor_id=_seed_actor_id(db, branch)
        )

        if not args.dry_run:
            db.flush()
            db.commit()
            # What arrived is shared out to the waiting orders the same way opening a
            # package does in the app, so the demo's allocations are ones the app itself
            # would have made.
            codes = {entry["stock_code"] for r in data.get("receivings", []) for p in r["packages"] for entry in p["items"]}
            touched = auto_allocate_arrivals(db, branch.id, codes)
            print(f"  allocated arrived stock to {touched} order line(s)")

        _seed_write_offs(
            db, branch, data.get("write_offs", []), dry_run=args.dry_run, actor_id=_seed_actor_id(db, branch)
        )
        if not args.dry_run:
            _seed_supply_links(db, branch, dry_run=False)

        if args.dry_run:
            db.rollback()
            print(
                "Dry run — "
                f"{created_shipments} shipment(s), "
                f"{created_vouchers} voucher(s), and "
                f"{created_receivings} receiving(s), {created_orders} customer order(s), and {created_outgoing} delivery row(s) would be created. Nothing was written."
            )
        else:
            db.commit()
            print(
                "Done — "
                f"{created_shipments} shipment(s), "
                f"{created_vouchers} voucher(s), and "
                f"{created_receivings} receiving(s), {created_orders} customer order(s), and {created_outgoing} delivery row(s) created."
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
