"""Approved, versioned definitions for deterministic Retail metrics."""

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.services.chat.metric_calculator import Measure, MetricRule


SALES_SUMMARY = MetricRule(
    id="sales_summary",
    version=1,
    label="Sales summary",
    description="Completed retail sales grouped by date and branch.",
    dimensions=frozenset({"date", "branch"}),
    measures=(
        Measure("transactions", "Sales", "sum", source="transactions"),
        Measure("quantity", "Items sold", "sum", source="quantity"),
        Measure(
            "revenue", "Net revenue", "sum", source="revenue", value_format="money"
        ),
        Measure(
            "average_sale",
            "Average sale",
            "ratio",
            left="revenue",
            right="transactions",
            value_format="money",
        ),
    ),
    default_group_by=("date",),
    default_measures=("transactions", "quantity", "revenue", "average_sale"),
    default_sort_by="date",
    default_descending=False,
    route="sales",
    default_window="last_30_days",
)


TOP_SELLING_PRODUCTS = MetricRule(
    id="top_selling_products",
    version=1,
    label="Top-selling products",
    description="Retail product sales ranked by net revenue.",
    dimensions=frozenset({"product", "branch"}),
    measures=(
        Measure("quantity", "Items sold", "sum", source="quantity"),
        Measure(
            "revenue", "Net revenue", "sum", source="revenue", value_format="money"
        ),
    ),
    default_group_by=("product",),
    default_measures=("quantity", "revenue"),
    default_sort_by="revenue",
    route="sales",
    default_window="last_30_days",
)


PURCHASE_SUMMARY = MetricRule(
    id="purchase_summary",
    version=1,
    label="Purchase summary",
    description="Retail purchases grouped by date and branch.",
    dimensions=frozenset({"date", "branch"}),
    measures=(
        Measure("quantity", "Quantity purchased", "sum", source="quantity"),
        Measure("cost", "Purchase cost", "sum", source="cost", value_format="money"),
    ),
    default_group_by=("date",),
    default_measures=("quantity", "cost"),
    default_sort_by="date",
    default_descending=False,
    route="purchase",
    default_window="last_30_days",
)


RULES = {
    SALES_SUMMARY.id: SALES_SUMMARY,
    TOP_SELLING_PRODUCTS.id: TOP_SELLING_PRODUCTS,
    PURCHASE_SUMMARY.id: PURCHASE_SUMMARY,
}


def get_rule(rule_id: str) -> MetricRule | None:
    return RULES.get(rule_id)


def _sales_summary_rows(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[dict[str, object]]:
    query = (
        db.query(
            Sale.sale_date,
            Sale.branch_id,
            Branch.name,
            func.count(func.distinct(Sale.id)).label("transactions"),
            func.sum(SaleLine.qty).label("quantity"),
            func.sum(SaleLine.net_amount).label("revenue"),
        )
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .join(Branch, Branch.id == Sale.branch_id)
        .filter(Sale.sale_date >= start, Sale.sale_date <= end)
        .group_by(Sale.sale_date, Sale.branch_id, Branch.name)
        .order_by(Sale.sale_date, Branch.name)
    )
    if branch_id:
        query = query.filter(Sale.branch_id == branch_id)
    return [
        {
            "date": sale_date.isoformat(),
            "branch": branch_name,
            "transactions": int(transactions or 0),
            "quantity": float(quantity or 0),
            "revenue": float(revenue or 0),
        }
        for sale_date, _, branch_name, transactions, quantity, revenue in query.all()
    ]


def _top_selling_product_rows(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[dict[str, object]]:
    query = (
        db.query(
            Product.stock_code,
            Product.description,
            Sale.branch_id,
            Branch.name,
            func.sum(SaleLine.qty).label("quantity"),
            func.sum(SaleLine.net_amount).label("revenue"),
        )
        .join(SaleLine, SaleLine.product_id == Product.id)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Branch, Branch.id == Sale.branch_id)
        .filter(Sale.sale_date >= start, Sale.sale_date <= end)
        .group_by(
            Product.id,
            Product.stock_code,
            Product.description,
            Sale.branch_id,
            Branch.name,
        )
    )
    if branch_id:
        query = query.filter(Sale.branch_id == branch_id)
    return [
        {
            "product": " — ".join(part for part in (code, description) if part),
            "branch": branch_name,
            "quantity": float(quantity or 0),
            "revenue": float(revenue or 0),
        }
        for code, description, _, branch_name, quantity, revenue in query.all()
    ]


def _purchase_summary_rows(
    db: Session, branch_id: str | None, start: date, end: date
) -> list[dict[str, object]]:
    query = (
        db.query(
            Purchase.purchase_date,
            Purchase.branch_id,
            Branch.name,
            func.sum(PurchaseLine.quantity).label("quantity"),
            func.sum(PurchaseLine.quantity * PurchaseLine.buying_price).label("cost"),
        )
        .join(PurchaseLine, PurchaseLine.purchase_id == Purchase.id)
        .join(Branch, Branch.id == Purchase.branch_id)
        .filter(Purchase.purchase_date >= start, Purchase.purchase_date <= end)
        .group_by(Purchase.purchase_date, Purchase.branch_id, Branch.name)
        .order_by(Purchase.purchase_date, Branch.name)
    )
    if branch_id:
        query = query.filter(Purchase.branch_id == branch_id)
    return [
        {
            "date": purchase_date.isoformat(),
            "branch": branch_name,
            "quantity": float(quantity or 0),
            "cost": float(cost or 0),
        }
        for purchase_date, _, branch_name, quantity, cost in query.all()
    ]


def source_rows_for(
    db: Session, rule_id: str, branch_id: str | None, start: date, end: date
) -> list[dict[str, object]]:
    if rule_id == SALES_SUMMARY.id:
        return _sales_summary_rows(db, branch_id, start, end)
    if rule_id == TOP_SELLING_PRODUCTS.id:
        return _top_selling_product_rows(db, branch_id, start, end)
    if rule_id == PURCHASE_SUMMARY.id:
        return _purchase_summary_rows(db, branch_id, start, end)
    raise ValueError(f"No source is registered for metric rule '{rule_id}'.")
