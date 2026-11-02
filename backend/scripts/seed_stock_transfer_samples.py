"""Adds two sample vouchers so the "Move to warehouse" page has something to show.

  1. a voucher whose goods are counted at the gate and have not moved yet
  2. a voucher counted at the gate, part of which has already gone to a warehouse

Run from the repo root (it touches the real database, so use --directory):

    uv run --directory backend python scripts/seed_stock_transfer_samples.py --branch "Wholesale"
"""

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal  # noqa: E402
from app.models.branch import Branch  # noqa: E402
from app.models.user import User  # noqa: E402
from app.wholesale.models.entities import ProductGroup, WholesaleUnit  # noqa: E402
from app.wholesale.schemas.receivings import PackageUpdate, ReceivingCreate, ReceivingItemIn  # noqa: E402
from app.wholesale.schemas.shipments import ShipmentCreate, ShipmentStopIn  # noqa: E402
from app.wholesale.schemas.stock_transfers import StockTransferIn, StockTransferLineIn  # noqa: E402
from app.wholesale.schemas.supplier_vouchers import SupplierVoucherIn, VoucherLineIn  # noqa: E402
from app.wholesale.services.colors import color_qty_pairs  # noqa: E402
from app.wholesale.services.inventory import auto_allocate_arrivals  # noqa: E402
from app.wholesale.services.receivings_service import create_receiving, update_package  # noqa: E402
from app.wholesale.services.shipments_service import create_shipment  # noqa: E402
from app.wholesale.services.stock_transfers import create_transfer  # noqa: E402
from app.wholesale.services.supplier_vouchers_service import create_voucher  # noqa: E402

GATE = "Downtown Gate"
WAREHOUSE = "Yangon Warehouse"

PRODUCTS = {
    "D4001": ("Ladies' rubber slipper", ProductGroup.LADY, 112000),
    "E5001": ("Kids' rain boot", ProductGroup.CHILD, 161000),
    "B2001": ("Ladies' flat sandal", ProductGroup.LADY, 147000),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--branch", required=True)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        branch = db.get(Branch, args.branch) or db.query(Branch).filter(Branch.name == args.branch).one()
        actor = db.query(User).filter(User.branch_id == branch.id).first() or db.query(User).first()
        if actor is None:
            raise SystemExit("No user found to record the transfers against.")
        today = date.today()

        def counted_voucher(contents: dict[str, str]) -> "object":
            """A voucher for these products {stock_code: colours}, shipped and counted at the gate,
            one package per product."""
            voucher = create_voucher(db, branch.id, SupplierVoucherIn(
                supplier_name="Maldini", voucher_date=today, carrier_name="Apex Logistics",
                total_packages=len(contents),
                lines=[
                    VoucherLineIn(
                        stock_code=code, description=PRODUCTS[code][0], product_group=PRODUCTS[code][1],
                        color_breakdown=colors, buying_price=PRODUCTS[code][2],
                    )
                    for code, colors in contents.items()
                ],
            ))
            pairs = sum(line.quantity_pairs for line in voucher.lines)
            shipment = create_shipment(db, branch.id, ShipmentCreate(
                voucher_no=voucher.voucher_no, supplier_name="Maldini", carrier_name="Apex Logistics",
                sent_on=today, total_packages=len(contents),
                total_quantity_pairs=pairs // 6, packages_sent_by_cargo=len(contents),
                stops=[ShipmentStopIn(key="gate", stop_name=GATE, packages_received=len(contents), is_gate=True)],
            ))
            receiving = create_receiving(db, branch.id, ReceivingCreate(
                shipment_id=shipment.id, gate=GATE, received_on=today, total_packages=len(contents),
                total_quantity_pairs=pairs // 6, total_unit=WholesaleUnit.SET,
            ), operator_id=actor.id)
            for package, (code, colors) in zip(receiving.packages, contents.items()):
                update_package(db, receiving.id, package.id, branch.id, PackageUpdate(
                    opened=True, received_on=today, note="Counted at the gate",
                    items=[ReceivingItemIn(
                        stock_code=code, description=PRODUCTS[code][0], product_group=PRODUCTS[code][1],
                        color_breakdown=colors,
                        quantity=color_qty_pairs(colors, WholesaleUnit.SET, {"pair": 1, "set": 6, "dozen": 12}) // 6,
                        unit=WholesaleUnit.SET,
                    )],
                ), operator_id=actor.id)
            return voucher

        first = counted_voucher({"D4001": "pink6s,black4s", "E5001": "blue8s"})
        second = counted_voucher({"D4001": "pink6s,beige4s", "B2001": "black6s"})

        create_transfer(db, branch.id, actor.id, StockTransferIn(
            voucher_id=second.id, to_location=WAREHOUSE, moved_on=today,
            note="First truck to Yangon",
            lines=[
                StockTransferLineIn(stock_code="D4001", color_breakdown="pink4s,beige2s", unit=WholesaleUnit.SET),
                StockTransferLineIn(stock_code="B2001", color_breakdown="black3s", unit=WholesaleUnit.SET),
            ],
        ))
        touched = auto_allocate_arrivals(db, branch.id, set(PRODUCTS))
        db.commit()
        print(f"counted at the gate, nothing moved yet: {first.voucher_no}")
        print(f"counted, part moved to {WAREHOUSE}: {second.voucher_no}")
        print(f"allocated arrived stock to {touched} order line(s)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
