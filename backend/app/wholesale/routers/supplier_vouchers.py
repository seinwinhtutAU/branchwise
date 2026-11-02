from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.models.entities import Receiving, Shipment
from app.wholesale.schemas.supplier_vouchers import SupplierVoucherIn, VoucherLineLinksIn, VoucherPaymentIn
from app.wholesale.schemas.write_offs import WriteOffIn
from app.services.branches import resolve_wholesale_branch_id
from app.wholesale.services.lifecycle import get_allowed_voucher_actions, voucher_status
from app.wholesale.services.supplier_vouchers_service import (
    set_line_order_links,
    add_payment,
    create_voucher,
    delete_payment,
    delete_voucher,
    list_vouchers,
    update_payment,
    received_pairs_by_voucher_no,
    received_pairs_by_voucher_stock,
    update_voucher,
)
from app.wholesale.services.money import voucher_totals
from app.wholesale.services.stock_transfers import pending_move_pairs_by_voucher
from app.wholesale.services.write_offs import write_off_to_dict, write_off_voucher_line
from app.wholesale.routers.common import paginate, require_wholesale


def _payment_dict(payment) -> dict:
    return {
        "payment_id": payment.id,
        "paid_on": payment.paid_on,
        "amount": float(payment.amount),
        "currency_code": payment.currency_code,
        "original_amount": float(payment.original_amount) if payment.original_amount is not None else None,
        "exchange_rate": float(payment.exchange_rate) if payment.exchange_rate is not None else None,
        "note": payment.note,
    }


router = APIRouter(prefix="/api/wholesale/supplier-vouchers", tags=["wholesale"])


def _out(
    voucher,
    received_pairs: int,
    received_by_stock: dict[str, int] | None = None,
    has_shipments: bool = False,
    has_receivings: bool = False,
    to_move_pairs: int = 0,
    to_count_pairs: int = 0,
) -> dict:
    remaining_by_stock = dict(received_by_stock or {})
    lines = []
    for line in voucher.lines:
        received = min(remaining_by_stock.get(line.stock_code, 0), line.quantity_pairs)
        remaining_by_stock[line.stock_code] = max(
            0, remaining_by_stock.get(line.stock_code, 0) - received
        )
        lines.append({
            "voucher_line_id": line.id,
            "stock_code": line.stock_code,
            "description": line.description,
            "product_group": line.product_group.value,
            "color_breakdown": line.color_breakdown,
            "unit": line.unit.value,
            "unit_conversions": line.unit_conversions,
            "quantity_pairs": line.quantity_pairs,
            "received_quantity_pairs": received,
            "lost_quantity_pairs": line.lost_quantity_pairs,
            "remaining_quantity_pairs": max(0, line.quantity_pairs - received - line.lost_quantity_pairs),
            "buying_price": float(line.buying_price),
            "currency_code": line.currency_code,
            "original_buying_price": float(line.original_buying_price) if line.original_buying_price is not None else None,
            "exchange_rate": float(line.exchange_rate) if line.exchange_rate is not None else None,
            # The customer-order lines this line was bought for (see SupplyLink).
            "for_orders": [
                {
                    "order_line_id": link.order_line_id,
                    "order_id": link.order_line.order_id,
                    "order_no": link.order_line.order.order_no,
                    "customer_name": link.order_line.order.customer_name,
                    "quantity_pairs": link.quantity_pairs,
                }
                for link in line.order_links
            ],
        })
    payments = [_payment_dict(payment) for payment in voucher.payments]
    totals = voucher_totals(voucher)
    total_qty_pairs = sum(line["quantity_pairs"] for line in lines)
    rec_qty_pairs = sum(line["received_quantity_pairs"] for line in lines)
    lost_qty_pairs = sum(line["lost_quantity_pairs"] for line in lines)

    eff_has_receivings = has_receivings or rec_qty_pairs > 0
    eff_has_payments = len(payments) > 0
    status_str = voucher_status(
        total_quantity_pairs=total_qty_pairs,
        received_quantity_pairs=rec_qty_pairs,
        lost_quantity_pairs=lost_qty_pairs,
        balance_due=totals["balance_due"],
        has_shipments=has_shipments,
    )
    allowed_actions = get_allowed_voucher_actions(
        status_str,
        has_shipments=has_shipments,
        has_receivings=eff_has_receivings,
        has_payments=eff_has_payments,
    )

    return {
        "voucher_id": voucher.id,
        "branch_id": voucher.branch_id,
        "voucher_no": voucher.voucher_no,
        "supplier_name": voucher.supplier_name,
        "voucher_date": voucher.voucher_date,
        "carrier_name": voucher.carrier_name,
        "total_packages": voucher.total_packages,
        "receiving_gate": voucher.receiving_gate,
        "total_quantity_pairs": total_qty_pairs,
        "received_quantity_pairs": rec_qty_pairs,
        "lost_quantity_pairs": lost_qty_pairs,
        "remaining_quantity_pairs": sum(line["remaining_quantity_pairs"] for line in lines),
        # Counted at a gate that is not a warehouse and not yet moved on.
        "to_move_pairs": to_move_pairs,
        # Moved on to another place that has not counted what arrived yet.
        "to_count_pairs": to_count_pairs,
        "lines": lines,
        "payment": {"account_id": voucher.id, "payments": payments},
        "subtotal_amount": totals["subtotal"],
        "discount_kind": voucher.discount_kind,
        "discount_value": float(voucher.discount_value),
        "discount_exchange_rate": (
            float(voucher.discount_exchange_rate) if voucher.discount_exchange_rate else None
        ),
        "discount_amount": totals["discount"],
        "total_amount": totals["total"],
        "paid_amount": totals["paid"],
        "balance_due": totals["balance_due"],
        "status": status_str,
        "allowed_actions": allowed_actions,
        "version_id": getattr(voucher, "version_id", 1),
    }


def _one(db: Session, voucher) -> dict:
    received_pairs = received_pairs_by_voucher_no(
        db, [voucher.voucher_no], voucher.branch_id
    ).get(voucher.voucher_no, 0)
    received_by_stock = received_pairs_by_voucher_stock(
        db, [voucher.voucher_no], voucher.branch_id
    )
    has_shipments_q = db.query(Shipment.id).filter(
        Shipment.voucher_no == voucher.voucher_no
    )
    if voucher.branch_id is not None:
        has_shipments_q = has_shipments_q.filter(Shipment.branch_id == voucher.branch_id)
    has_shipments = has_shipments_q.first() is not None

    has_receivings_q = db.query(Receiving.id).filter(
        Receiving.voucher_no == voucher.voucher_no
    )
    if voucher.branch_id is not None:
        has_receivings_q = has_receivings_q.filter(Receiving.branch_id == voucher.branch_id)
    has_receivings = received_pairs > 0 or has_receivings_q.first() is not None

    pending = pending_move_pairs_by_voucher(db, [voucher])
    return _out(
        voucher,
        received_pairs,
        {
            stock_code: pairs
            for (voucher_no, stock_code), pairs in received_by_stock.items()
            if voucher_no == voucher.voucher_no
        },
        has_shipments=has_shipments,
        has_receivings=has_receivings,
        to_move_pairs=pending[voucher.id]["to_move"],
        to_count_pairs=pending[voucher.id]["to_count"],
    )


@router.get("")
def list_supplier_vouchers(
    search: Annotated[str, Query(max_length=100)] = "",
    payment_status: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=2000)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    require_wholesale(user)
    vouchers = list_vouchers(db, user.branch_id)
    v_nos = [voucher.voucher_no for voucher in vouchers]
    received = received_pairs_by_voucher_no(db, v_nos, user.branch_id)
    received_by_stock = received_pairs_by_voucher_stock(
        db, v_nos, user.branch_id
    )
    pending = pending_move_pairs_by_voucher(db, vouchers)
    shipment_v_nos = set()
    receiving_v_nos = set()
    if v_nos:
        sq = db.query(Shipment.voucher_no).filter(Shipment.voucher_no.in_(v_nos))
        if user.branch_id is not None:
            sq = sq.filter(Shipment.branch_id == user.branch_id)
        shipment_v_nos = {r[0] for r in sq.distinct().all()}

        rq = db.query(Receiving.voucher_no).filter(Receiving.voucher_no.in_(v_nos))
        if user.branch_id is not None:
            rq = rq.filter(Receiving.branch_id == user.branch_id)
        receiving_v_nos = {r[0] for r in rq.distinct().all()}

    rows = [
        _out(
            voucher,
            received.get(voucher.voucher_no, 0),
            {
                stock_code: pairs
                for (voucher_no, stock_code), pairs in received_by_stock.items()
                if voucher_no == voucher.voucher_no
            },
            has_shipments=voucher.voucher_no in shipment_v_nos,
            has_receivings=voucher.voucher_no in receiving_v_nos or (received.get(voucher.voucher_no, 0) > 0),
            to_move_pairs=pending[voucher.id]["to_move"],
            to_count_pairs=pending[voucher.id]["to_count"],
        )
        for voucher in vouchers
    ]
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["voucher_no"].lower() or query in row["supplier_name"].lower()
            or query in row["carrier_name"].lower()
            or any(query in line["stock_code"].lower() or query in line["description"].lower() for line in row["lines"])
        ]
    if payment_status:
        rows = [
            row for row in rows
            if ("paid" if row["balance_due"] <= 0 else "partial" if row["paid_amount"] > 0 else "unpaid") == payment_status
        ]
    return paginate(rows, page, page_size, response)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_supplier_voucher(
    payload: SupplierVoucherIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    return _one(db, create_voucher(db, resolve_wholesale_branch_id(user, payload.branch_id, db), payload, operator_id=user.id))


@router.put("/{voucher_id}")
def update_supplier_voucher(
    voucher_id: str,
    payload: SupplierVoucherIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    return _one(db, update_voucher(db, voucher_id, user.branch_id, payload, operator_id=user.id))


@router.delete("/{voucher_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier_voucher(
    voucher_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    require_wholesale(user)
    delete_voucher(db, voucher_id, user.branch_id, operator_id=user.id)


@router.post("/{voucher_id}/payments", status_code=status.HTTP_201_CREATED)
def create_payment(
    voucher_id: str,
    payload: VoucherPaymentIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    payment = add_payment(db, voucher_id, user.branch_id, user.id, payload)
    return _payment_dict(payment)


@router.patch("/{voucher_id}/payments/{payment_id}")
def edit_payment(
    voucher_id: str,
    payment_id: str,
    payload: VoucherPaymentIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    payment = update_payment(db, voucher_id, payment_id, user.branch_id, user.id, payload)
    return _payment_dict(payment)


@router.put("/lines/{line_id}/orders")
def link_voucher_line_to_orders(
    line_id: str,
    payload: VoucherLineLinksIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Say which customer-order lines this voucher line was bought for (replaces the list)."""
    require_wholesale(user)
    voucher = set_line_order_links(db, line_id, user.branch_id, payload.links)
    return _one(db, voucher)


@router.post("/lines/{line_id}/write-off", status_code=status.HTTP_201_CREATED)
def write_off_supplier_voucher_line(
    line_id: str,
    payload: WriteOffIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    entry = write_off_voucher_line(
        db, line_id, payload.quantity, payload.reason, payload.note, user.id,
        branch_id=user.branch_id, color_breakdown=payload.color_breakdown,
    )
    return write_off_to_dict(entry)


@router.delete("/{voucher_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_payment(
    voucher_id: str,
    payment_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    require_wholesale(user)
    delete_payment(db, voucher_id, payment_id, user.branch_id, operator_id=user.id)

