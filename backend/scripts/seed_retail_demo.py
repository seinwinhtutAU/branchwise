"""Generates two years of realistic retail trading data (2024-11-01 to 2026-11-02)
for all four retail branches:
  - b-1: Downtown Flagship
  - b-2: CentralStore
  - b-3: BranchAlpha
  - b-4: WestMall

Data generated:
  - Catalog of ~30 Products across categories (Men, Ladies, Children, Accessories)
  - Bi-weekly Purchases with distinct buying prices (to establish COGS history)
  - Daily Sales & SaleLines for each branch with realistic footfall, time distribution,
    weekend boosts, seasonal variations, and realistic retail margins
  - Dead stock items (with stock on hand but 0 sales in the last 90 days)
  - Low stock items (critical/low stock on hand for the latest snapshot)
  - StockLevel inventory snapshots (latest snapshot on 2026-11-02 plus quarterly milestones)
  - Daily Operating Costs (DailyCostRecord) for every single day to support Net Profit / Cost tab
  - Monthly Salary Records (SalaryRecord) for 2-3 staff members per branch
  - ZeroSellingRecords for customer conversion rate analysis
  - Proper ImportBatches linking all records

Usage:
  uv run --directory backend python scripts/seed_retail_demo.py [--wipe]
"""

import argparse
import random
import sys
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.session import SessionLocal
from app.models.branch import Branch
from app.models.user import User
from app.retail.models.branch_closure import BranchClosure
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.salary import SalaryRecord
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.retail.models.zero_selling import ZeroSellingRecord

START_DATE = date(2024, 11, 1)
END_DATE = date(2026, 11, 2)

# Retail catalog: code -> (description, category, default_buying_price, default_selling_price)
PRODUCT_CATALOG = {
    # Men's Shoes
    "R-M01": ("Men's Oxford Leather Shoes", "Men's Shoes", 35000, 58000),
    "R-M02": ("Men's Classic Penny Loafers", "Men's Shoes", 32000, 52000),
    "R-M03": ("Men's Lightweight Running Shoes", "Men's Shoes", 28000, 48000),  # Will be low stock
    "R-M04": ("Men's Breathable Mesh Sneakers", "Men's Shoes", 24000, 39000),
    "R-M05": ("Men's Casual Slip-on Shoes", "Men's Shoes", 22000, 36000),
    "R-M06": ("Men's Leather Strap Sandals", "Men's Shoes", 16000, 26000),
    "R-M07": ("Men's Waterproof Work Boots", "Men's Shoes", 42000, 68000),

    # Ladies' Shoes
    "R-L01": ("Ladies' Stiletto High Heels", "Ladies' Shoes", 29000, 49000),
    "R-L02": ("Ladies' Pointed Kitten Heels", "Ladies' Shoes", 26000, 44000),  # Will be low stock
    "R-L03": ("Ladies' Ballet Comfort Flats", "Ladies' Shoes", 18000, 32000),
    "R-L04": ("Ladies' Square-Toe Loafers", "Ladies' Shoes", 22000, 38000),
    "R-L05": ("Ladies' Platform Wedge Sandals", "Ladies' Shoes", 24000, 42000),
    "R-L06": ("Ladies' Strappy Heeled Sandals", "Ladies' Shoes", 21000, 36000),
    "R-L07": ("Ladies' Casual Canvas Slip-ons", "Ladies' Shoes", 17000, 29000),
    "R-L08": ("Ladies' Cushion Walking Sneakers", "Ladies' Shoes", 25000, 43000),

    # Children's Shoes
    "R-C01": ("Kids' Standard School Uniform Shoes", "Children's Shoes", 15000, 25000),
    "R-C02": ("Kids' Light-up Sport Sneakers", "Children's Shoes", 18000, 30000),
    "R-C03": ("Kids' Anti-slip Water Sandals", "Children's Shoes", 11000, 19000),
    "R-C04": ("Kids' Waterproof Cartoon Rain Boots", "Children's Shoes", 14000, 24000),
    "R-C05": ("Kids' Daily Velcro Casual Shoes", "Children's Shoes", 13000, 22000),

    # Accessories
    "R-A01": ("Genuine Leather Casual Belt", "Accessories", 9000, 16000),
    "R-A02": ("Premium Sneaker Care Cleaning Kit", "Accessories", 6000, 12000),
    "R-A03": ("Breathable Cotton Cushioned Socks (Pack of 3)", "Accessories", 4500, 8500),
    "R-A04": ("Ergonomic Memory Foam Arch Insoles", "Accessories", 5000, 9500),

    # Dead stock items: will have stock on hand, but ZERO sales in the last 100 days
    "R-D01": ("Vintage Embroidered Satin Slippers", "Ladies' Shoes", 28000, 46000),
    "R-D02": ("Heavy Duty Steel Toe Safety Boots", "Men's Shoes", 45000, 75000),
}

DEAD_STOCK_CODES = {"R-D01", "R-D02"}
LOW_STOCK_CODES = {"R-M03", "R-L02"}

# Relative sales volume per branch
BRANCH_WEIGHTS = {
    "b-1": 1.4,  # Flagship
    "b-2": 1.1,  # Central
    "b-3": 0.8,  # Alpha
    "b-4": 0.9,  # WestMall (boosted on weekends)
}

STAFF_BY_BRANCH = {
    "b-1": [("Daw Hla Hla", "Branch Manager", 450000), ("Ko Aung Kyaw", "Sales Staff", 280000), ("Ma Thuzar", "Sales Staff", 260000)],
    "b-2": [("U Win Myint", "Branch Manager", 420000), ("Ma Su Su", "Sales Staff", 270000), ("Ko Phyo", "Sales Staff", 250000)],
    "b-3": [("Daw San San", "Branch Manager", 380000), ("Ko Thein", "Sales Staff", 250000)],
    "b-4": [("Daw Aye Myat", "Branch Manager", 400000), ("Ko Yan Naing", "Sales Staff", 260000), ("Ma Ei Ei", "Sales Staff", 250000)],
}


def is_festival_month(d: date) -> bool:
    # Myanmar Water Festival (April), Thadingyut / Tazaungdaing (Oct, Nov), Year End (Dec)
    return d.month in {4, 10, 11, 12}


def random_business_time(rnd: random.Random) -> str:
    # 09:00 to 21:00 with peak hours at 12:00-14:00 and 17:00-20:00
    r = rnd.random()
    if r < 0.15:
        hour = rnd.randint(9, 11)
    elif r < 0.45:
        hour = rnd.randint(12, 14)
    elif r < 0.60:
        hour = rnd.randint(15, 16)
    elif r < 0.92:
        hour = rnd.randint(17, 20)
    else:
        hour = 21
    minute = rnd.randint(0, 59)
    return f"{hour:02d}:{minute:02d}"


def wipe_retail_data(db):
    print("Wiping existing retail demo data...")
    retail_branch_ids = ["b-1", "b-2", "b-3", "b-4"]

    # Delete dependent child rows first
    db.query(SaleLine).filter(SaleLine.sale_id.in_(
        db.query(Sale.id).filter(Sale.branch_id.in_(retail_branch_ids))
    )).delete(synchronize_session=False)

    db.query(Sale).filter(Sale.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)

    db.query(PurchaseLine).filter(PurchaseLine.purchase_id.in_(
        db.query(Purchase.id).filter(Purchase.branch_id.in_(retail_branch_ids))
    )).delete(synchronize_session=False)

    db.query(Purchase).filter(Purchase.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)

    db.query(StockLevel).filter(StockLevel.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)
    db.query(DailyCostRecord).filter(DailyCostRecord.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)
    db.query(SalaryRecord).filter(SalaryRecord.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)
    db.query(ZeroSellingRecord).filter(ZeroSellingRecord.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)
    db.query(BranchClosure).filter(BranchClosure.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)
    db.query(ImportBatch).filter(ImportBatch.branch_id.in_(retail_branch_ids)).delete(synchronize_session=False)

    db.commit()
    print("Retail data wiped successfully.")


def seed_products(db) -> dict[str, Product]:
    print("Seeding retail products...")
    products = {}
    for code, (desc, cat, _, _) in PRODUCT_CATALOG.items():
        p = db.query(Product).filter(Product.stock_code == code).first()
        if not p:
            p = Product(
                id=str(uuid.uuid4()),
                stock_code=code,
                description=desc,
                group_name=cat,
            )
            db.add(p)
        else:
            p.description = desc
            p.group_name = cat
        products[code] = p
    db.flush()
    return products


def seed_retail_demo(db, *, wipe: bool = False):
    rnd = random.Random(20261103)

    branches = db.query(Branch).filter(Branch.id.in_(["b-1", "b-2", "b-3", "b-4"])).all()
    if not branches:
        raise SystemExit("Retail branches (b-1 .. b-4) not found in database!")

    admin_user = db.query(User).first()
    actor_id = admin_user.id if admin_user else None

    if wipe:
        wipe_retail_data(db)

    products = seed_products(db)
    active_product_codes = [c for c in PRODUCT_CATALOG.keys() if c not in DEAD_STOCK_CODES]

    total_days = (END_DATE - START_DATE).days + 1
    print(f"Generating retail data from {START_DATE} to {END_DATE} ({total_days} days) for 4 branches...")

    # Create monthly purchase batches and stock
    print("1. Generating Purchases...")
    purchases_to_add = []
    purchase_lines_to_add = []
    import_batches_to_add = []

    # Bi-weekly purchase on the 1st and 15th of each month
    curr_p_date = START_DATE
    p_seq = 1
    while curr_p_date <= END_DATE:
        if curr_p_date.day in {1, 15}:
            for branch in branches:
                batch_id = str(uuid.uuid4())
                import_batch = ImportBatch(
                    id=batch_id,
                    import_type=ImportType.PURCHASE,
                    branch_id=branch.id,
                    uploaded_by=actor_id,
                    filename=f"purchase_{branch.id}_{curr_p_date.strftime('%Y%m%d')}.csv",
                    status=ImportBatchStatus.COMPLETED,
                    created_at=datetime.combine(curr_p_date, time(8, 30)),
                )
                import_batches_to_add.append(import_batch)

                p_id = str(uuid.uuid4())
                purchase_num = f"PO-{curr_p_date.strftime('%y%m%d')}-{branch.id}-{p_seq:03d}"
                purchase = Purchase(
                    id=p_id,
                    branch_id=branch.id,
                    import_batch_id=batch_id,
                    purchase_number=purchase_num,
                    purchase_date=curr_p_date,
                    source_file=import_batch.filename,
                    created_at=datetime.combine(curr_p_date, time(8, 30)),
                )
                purchases_to_add.append(purchase)

                # Order stock for all items
                for code, (_, _, b_price, _) in PRODUCT_CATALOG.items():
                    qty = rnd.randint(15, 45) if code not in DEAD_STOCK_CODES else 20
                    # Small inflation/variation over time (+/- 5%)
                    price_factor = Decimal(str(round(rnd.uniform(0.97, 1.05), 3)))
                    actual_b_price = round(Decimal(b_price) * price_factor / 500) * 500
                    p_line = PurchaseLine(
                        id=str(uuid.uuid4()),
                        purchase_id=p_id,
                        product_id=products[code].id,
                        quantity=qty,
                        uom="pair",
                        buying_price=actual_b_price,
                    )
                    purchase_lines_to_add.append(p_line)
                p_seq += 1

        curr_p_date += timedelta(days=1)

    db.bulk_save_objects(import_batches_to_add)
    db.bulk_save_objects(purchases_to_add)
    db.bulk_save_objects(purchase_lines_to_add)
    db.commit()
    print(f"  Added {len(purchases_to_add)} purchases with {len(purchase_lines_to_add)} lines.")

    # 2. Monthly Salaries
    print("2. Generating Monthly Salaries...")
    salaries_to_add = []
    salary_batches = []
    month_cursor = date(START_DATE.year, START_DATE.month, 1)
    end_month = date(END_DATE.year, END_DATE.month, 1)

    while month_cursor <= end_month:
        for branch in branches:
            batch_id = str(uuid.uuid4())
            salary_batches.append(ImportBatch(
                id=batch_id,
                import_type=ImportType.GENERAL,
                branch_id=branch.id,
                uploaded_by=actor_id,
                filename=f"payroll_{branch.id}_{month_cursor.strftime('%Y_%m')}.xlsx",
                status=ImportBatchStatus.COMPLETED,
                created_at=datetime.combine(month_cursor, time(9, 0)),
            ))
            staff_list = STAFF_BY_BRANCH.get(branch.id, [])
            for row_idx, (staff_name, role_title, base_salary) in enumerate(staff_list, start=1):
                # Festive bonus in April (Water festival) & December
                bonus = 50000 if month_cursor.month in {4, 12} else None
                salaries_to_add.append(SalaryRecord(
                    id=str(uuid.uuid4()),
                    import_batch_id=batch_id,
                    branch_id=branch.id,
                    name=staff_name,
                    branch=branch.name,
                    salary=base_salary,
                    bonus=bonus,
                    source_sheet="Payroll",
                    source_row=row_idx,
                ))

        # Next month
        if month_cursor.month == 12:
            month_cursor = date(month_cursor.year + 1, 1, 1)
        else:
            month_cursor = date(month_cursor.year, month_cursor.month + 1, 1)

    db.bulk_save_objects(salary_batches)
    db.bulk_save_objects(salaries_to_add)
    db.commit()
    print(f"  Added {len(salaries_to_add)} salary records.")

    # 3. Daily Sales, Daily Cost, Zero Selling (chunked by 60 days to keep memory lean)
    print("3. Generating Daily Sales, Daily Operating Costs, and Customer Zero-Selling...")
    dead_stock_cutoff = END_DATE - timedelta(days=95)

    chunk_start = START_DATE
    chunk_size_days = 60
    total_sales_count = 0
    total_sale_lines_count = 0

    while chunk_start <= END_DATE:
        chunk_end = min(chunk_start + timedelta(days=chunk_size_days - 1), END_DATE)
        print(f"  Processing chunk {chunk_start} to {chunk_end}...")

        sales_batch = []
        sale_lines_batch = []
        costs_batch = []
        zero_selling_batch = []
        chunk_import_batches = []

        curr = chunk_start
        while curr <= chunk_end:
            is_weekend = curr.weekday() in {5, 6}
            festive = is_festival_month(curr)

            for branch in branches:
                branch_weight = BRANCH_WEIGHTS.get(branch.id, 1.0)
                if branch.id == "b-4" and is_weekend:
                    branch_weight *= 1.6  # WestMall weekend shopping rush

                # Import batch for daily pos
                batch_id = str(uuid.uuid4())
                chunk_import_batches.append(ImportBatch(
                    id=batch_id,
                    import_type=ImportType.SALES,
                    branch_id=branch.id,
                    uploaded_by=actor_id,
                    filename=f"pos_sales_{branch.id}_{curr.strftime('%Y%m%d')}.csv",
                    status=ImportBatchStatus.COMPLETED,
                    created_at=datetime.combine(curr, time(22, 15)),
                ))

                # Number of sales slips
                base_slips = rnd.randint(8, 14)
                if is_weekend:
                    base_slips = int(base_slips * 1.6)
                if festive:
                    base_slips = int(base_slips * 1.35)
                slips_count = max(4, int(base_slips * branch_weight))

                # Determine if dead stock can be sold (never in last 95 days)
                can_sell_dead_stock = (curr < dead_stock_cutoff) and (rnd.random() < 0.08)

                for slip_idx in range(1, slips_count + 1):
                    s_id = str(uuid.uuid4())
                    slip_id = f"S-{branch.id}-{curr.strftime('%y%m%d')}-{slip_idx:04d}"
                    slip_time = random_business_time(rnd)

                    sale = Sale(
                        id=s_id,
                        branch_id=branch.id,
                        import_batch_id=batch_id,
                        location_raw=branch.name,
                        slip_id=slip_id,
                        slip_number=f"{slip_idx:04d}",
                        sale_date=curr,
                        sale_time=slip_time,
                        source_file=f"pos_{curr.strftime('%Y%m%d')}.csv",
                        created_at=datetime.combine(curr, time(22, 15)),
                    )
                    sales_batch.append(sale)

                    # 1 to 3 items per basket (Customer tab histogram)
                    items_in_basket = rnd.choices([1, 2, 3, 4], weights=[65, 24, 8, 3])[0]
                    chosen_codes = rnd.sample(active_product_codes, min(items_in_basket, len(active_product_codes)))
                    if can_sell_dead_stock and rnd.random() < 0.2:
                        chosen_codes[0] = rnd.choice(list(DEAD_STOCK_CODES))

                    for line_no, code in enumerate(chosen_codes, start=1):
                        _, _, b_price, s_price = PRODUCT_CATALOG[code]
                        qty = 1 if rnd.random() < 0.88 else 2
                        # Small discount on some baskets
                        discount = 0
                        if rnd.random() < 0.12:
                            discount = round(s_price * 0.1 / 100) * 100  # 10% off
                        amount = s_price * qty
                        net_amount = amount - (discount * qty)

                        line = SaleLine(
                            id=str(uuid.uuid4()),
                            sale_id=s_id,
                            line_id=f"{slip_id}-{line_no}",
                            line_no=line_no,
                            product_id=products[code].id,
                            selling_price=s_price,
                            qty=qty,
                            uom="pair",
                            discount_amount=discount * qty,
                            amount=amount,
                            net_amount=net_amount,
                        )
                        sale_lines_batch.append(line)

                # Daily Operating Cost (usage_total between 12000 and 38000)
                cost_batch_id = str(uuid.uuid4())
                chunk_import_batches.append(ImportBatch(
                    id=cost_batch_id,
                    import_type=ImportType.GENERAL,
                    branch_id=branch.id,
                    uploaded_by=actor_id,
                    filename=f"daily_expense_{branch.id}_{curr.strftime('%Y%m%d')}.xlsx",
                    status=ImportBatchStatus.COMPLETED,
                    created_at=datetime.combine(curr, time(22, 30)),
                ))
                daily_usage = rnd.randint(15, 36) * 1000
                costs_batch.append(DailyCostRecord(
                    id=str(uuid.uuid4()),
                    import_batch_id=cost_batch_id,
                    branch_id=branch.id,
                    cost_date=curr,
                    branch=branch.name,
                    usage="Utilities, store consumables, internet & maintenance",
                    usage_total=daily_usage,
                    digital_income="KBZPay / AYA Pay collections",
                    digital_income_total=0,
                    return_items=None,
                    return_total=0,
                    capital_expenditure=None,
                    capital_total=0,
                    source_sheet="DailyLog",
                ))

                # Zero Selling visits (2-6 visits without purchase)
                zero_visits = rnd.randint(2, 6) if not is_weekend else rnd.randint(4, 9)
                reasons = ["Out of required shoe size", "Price comparison", "Just browsing", "Wanted different color"]
                for z_idx in range(1, zero_visits + 1):
                    zero_selling_batch.append(ZeroSellingRecord(
                        id=str(uuid.uuid4()),
                        import_batch_id=batch_id,
                        branch_id=branch.id,
                        sale_date=curr,
                        sale_time=random_business_time(rnd),
                        branch=branch.name,
                        category=rnd.choice(["Men's Shoes", "Ladies' Shoes", "Children's Shoes"]),
                        reason=rnd.choice(reasons),
                        source_sheet="Footfall",
                        source_row=z_idx,
                    ))

            curr += timedelta(days=1)

        db.bulk_save_objects(chunk_import_batches)
        db.bulk_save_objects(sales_batch)
        db.bulk_save_objects(sale_lines_batch)
        db.bulk_save_objects(costs_batch)
        db.bulk_save_objects(zero_selling_batch)
        db.commit()

        total_sales_count += len(sales_batch)
        total_sale_lines_count += len(sale_lines_batch)
        print(f"    Chunk done. Cumulative sales slips: {total_sales_count:,}, lines: {total_sale_lines_count:,}")

        chunk_start = chunk_end + timedelta(days=1)

    # 4. Inventory Snapshots (StockLevel)
    print("4. Generating Inventory Snapshots (Historical + Latest)...")
    # Milestones: quarterly snapshots, plus today's latest snapshot (2026-11-02 22:00)
    snapshot_dates = [
        datetime(2025, 3, 31, 22, 0),
        datetime(2025, 9, 30, 22, 0),
        datetime(2026, 3, 31, 22, 0),
        datetime(2026, 9, 30, 22, 0),
        datetime(2026, 11, 2, 22, 0),  # Latest snapshot
    ]

    stock_levels_to_add = []
    stock_batches = []
    for snap_dt in snapshot_dates:
        is_latest = (snap_dt == snapshot_dates[-1])
        for branch in branches:
            batch_id = str(uuid.uuid4())
            stock_batches.append(ImportBatch(
                id=batch_id,
                import_type=ImportType.INVENTORY,
                branch_id=branch.id,
                uploaded_by=actor_id,
                filename=f"inventory_count_{branch.id}_{snap_dt.strftime('%Y%m%d')}.csv",
                status=ImportBatchStatus.COMPLETED,
                created_at=snap_dt,
            ))

            for code, (_, _, b_price, s_price) in PRODUCT_CATALOG.items():
                if is_latest and code in LOW_STOCK_CODES:
                    # Low or critical stock on hand to trigger alerts
                    qty = rnd.randint(2, 5)
                elif code in DEAD_STOCK_CODES:
                    # Dead stock has on hand qty but no recent sales
                    qty = rnd.randint(18, 35)
                else:
                    qty = rnd.randint(25, 90)

                stock_levels_to_add.append(StockLevel(
                    id=str(uuid.uuid4()),
                    branch_id=branch.id,
                    import_batch_id=batch_id,
                    location_raw=branch.name,
                    product_id=products[code].id,
                    on_hand_qty=qty,
                    buying_price=b_price,
                    selling_price=s_price,
                    snapshot_at=snap_dt,
                    source_file=f"inventory_{snap_dt.strftime('%Y%m%d')}.csv",
                ))

    db.bulk_save_objects(stock_batches)
    db.bulk_save_objects(stock_levels_to_add)
    db.commit()
    print(f"  Added {len(stock_levels_to_add)} stock level records across snapshots.")

    print("\nRetail demo seed completed successfully!")
    print(f"Total sales slips created: {total_sales_count:,}")
    print(f"Total sale lines created: {total_sale_lines_count:,}")
    print(f"Total purchases: {len(purchases_to_add):,}")
    print(f"Total inventory rows: {len(stock_levels_to_add):,}")
    print(f"Total daily costs: {total_days * len(branches):,}")
    print(f"Total salary records: {len(salaries_to_add):,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wipe", action="store_true", help="Wipe existing retail demo data before seeding")
    args = parser.parse_args()

    with SessionLocal() as db:
        seed_retail_demo(db, wipe=args.wipe)
