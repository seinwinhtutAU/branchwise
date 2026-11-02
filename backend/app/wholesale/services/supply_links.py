"""Which customer-order lines a supplier-voucher line was bought for.

A link records intent only ("these 24 pairs of D4001 are for order ORD-…"); stock still
reaches customers through allocation when packages are opened. See SupplyLink.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.wholesale.models.entities import CustomerOrder, CustomerOrderLine, SupplierVoucherLine, SupplyLink


def set_voucher_line_links(
    db: Session,
    line: SupplierVoucherLine,
    links,
    branch_id: str | None,
) -> None:
    """Replace what one voucher line is for. `links` is [{order_line_id, quantity_pairs}]."""
    total = 0
    seen: set[str] = set()
    wanted: dict[str, int] = {}
    for entry in links:
        if entry.order_line_id in seen:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An order line can only be linked once")
        seen.add(entry.order_line_id)
        order_line = db.get(CustomerOrderLine, entry.order_line_id)
        order = db.get(CustomerOrder, order_line.order_id) if order_line else None
        if order_line is None or order is None or (branch_id is not None and order.branch_id != branch_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Order line not found")
        if order_line.stock_code.strip().lower() != line.stock_code.strip().lower():
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f"{order_line.stock_code} on the order is not the same product as {line.stock_code} on the voucher",
            )
        if entry.quantity_pairs <= 0:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Linked quantity must be more than zero")
        total += entry.quantity_pairs
        wanted[order_line.id] = entry.quantity_pairs
    if total > line.quantity_pairs:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Linked quantity cannot be more than the voucher line's quantity",
        )
    # Change the existing rows in place rather than replacing the whole list: replacing
    # inserts the new rows before deleting the old ones, which trips the unique
    # (voucher line, order line) constraint the moment an existing link is kept.
    for link in list(line.order_links):
        if link.order_line_id in wanted:
            link.quantity_pairs = wanted.pop(link.order_line_id)
        else:
            line.order_links.remove(link)
    for order_line_id, quantity in wanted.items():
        line.order_links.append(
            SupplyLink(
                branch_id=line.voucher.branch_id if line.voucher else branch_id,
                order_line_id=order_line_id,
                quantity_pairs=quantity,
            )
        )


def voucher_links_snapshot(voucher) -> dict[str, list[tuple[str, int]]]:
    """Taken before an edit replaces every line, so the links can be put back."""
    return {
        line.stock_code: [(link.order_line_id, link.quantity_pairs) for link in line.order_links]
        for line in voucher.lines
    }


def restore_voucher_links(new_lines, snapshot: dict[str, list[tuple[str, int]]], branch_id: str | None) -> None:
    for line in new_lines:
        remaining = line.quantity_pairs
        for order_line_id, quantity in snapshot.get(line.stock_code, []):
            kept = min(quantity, remaining)
            if kept <= 0:
                break
            remaining -= kept
            line.order_links.append(SupplyLink(branch_id=branch_id, order_line_id=order_line_id, quantity_pairs=kept))


def order_links_snapshot(order) -> dict[str, list[tuple[str, int]]]:
    return {
        line.stock_code: [(link.voucher_line_id, link.quantity_pairs) for link in line.voucher_links]
        for line in order.lines
    }


def restore_order_links(new_lines, snapshot: dict[str, list[tuple[str, int]]], branch_id: str | None) -> None:
    for line in new_lines:
        for voucher_line_id, quantity in snapshot.get(line.stock_code, []):
            line.voucher_links.append(
                SupplyLink(branch_id=branch_id, voucher_line_id=voucher_line_id, quantity_pairs=quantity)
            )
