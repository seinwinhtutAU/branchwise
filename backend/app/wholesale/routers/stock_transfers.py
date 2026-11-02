from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.routers.common import require_wholesale
from app.wholesale.schemas.stock_transfers import StockTransferCountIn, StockTransferIn
from app.wholesale.services.stock_transfers import (
    count_transfer,
    create_place_transfer,
    create_transfer,
    delete_transfer,
    list_transfers,
    transfer_to_dict,
    voucher_pool,
)

router = APIRouter(prefix="/api/wholesale/stock-transfers", tags=["wholesale"])


@router.get("")
def list_stock_transfers(
    voucher_id: Annotated[str | None, Query(max_length=36)] = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    require_wholesale(user)
    return [transfer_to_dict(t) for t in list_transfers(db, user.branch_id, voucher_id)]


@router.get("/pool")
def stock_waiting_at_the_gate(
    voucher_id: Annotated[str, Query(min_length=1, max_length=36)],
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """What was counted at each gate for a voucher, what has moved on, and what is left."""
    require_wholesale(user)
    return voucher_pool(db, voucher_id, user.branch_id)


@router.post("", status_code=status.HTTP_201_CREATED)
def move_stock_to_warehouse(
    payload: StockTransferIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    if payload.voucher_id is None:
        return transfer_to_dict(create_place_transfer(db, user.branch_id, user.id, payload))
    return transfer_to_dict(create_transfer(db, user.branch_id, user.id, payload))


@router.put("/{transfer_id}/count")
def count_stock_transfer(
    transfer_id: str,
    payload: StockTransferCountIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """The place the goods went to counts what arrived."""
    require_wholesale(user)
    return transfer_to_dict(count_transfer(db, transfer_id, user.branch_id, user.id, payload))


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
def undo_stock_transfer(
    transfer_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> Response:
    require_wholesale(user)
    delete_transfer(db, transfer_id, user.branch_id, user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
