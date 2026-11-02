from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.models.branch import Branch
from app.retail.routers.common import require_retail, require_retail_management
from app.retail.services.import_completeness import (
    build_import_completeness,
    close_missing_day,
    reopen_missing_day,
)
from app.retail.services.import_integrity import (
    ignore_purchase_number_gap,
    restore_purchase_number_gap,
)

router = APIRouter(prefix="/api/imports", tags=["imports"], dependencies=[Depends(require_retail)])


@router.get("/completeness")
def get_import_completeness(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> dict:
    return build_import_completeness(db, user)


@router.post("/completeness/close", dependencies=[Depends(require_retail_management)])
def post_close_missing_day(
    branch_id: str = Body(...),
    import_type: str = Body(...),
    closure_date: date = Body(...),
    note: str | None = Body(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Confirms a missing day was a genuine branch closure, not a forgotten import."""
    close_missing_day(db, branch_id, import_type, closure_date, note, user)
    return {"ok": True}


@router.post("/completeness/reopen", dependencies=[Depends(require_retail_management)])
def post_reopen_missing_day(
    branch_id: str = Body(...),
    import_type: str = Body(...),
    closure_date: date = Body(...),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Undoes a mistaken "closed" mark — the day goes back to needing a look."""
    reopen_missing_day(db, branch_id, import_type, closure_date, user)
    return {"ok": True}


def _can_manage_branch(db: Session, branch_id: str, user: User) -> None:
    if db.get(Branch, branch_id) is None or (
        user.branch_id is not None and user.branch_id != branch_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Branch not found")


@router.post("/purchase-gaps/ignore", dependencies=[Depends(require_retail_management)])
def post_ignore_purchase_gap(
    branch_id: str = Body(...),
    prefix: str = Body(...),
    start_number: int = Body(..., ge=0),
    end_number: int = Body(..., ge=0),
    note: str | None = Body(None),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Hides one confirmed-intentional purchase-number gap from Import Health."""
    _can_manage_branch(db, branch_id, user)
    try:
        ignore_purchase_number_gap(
            db, branch_id, prefix, start_number, end_number, note, user.id
        )
    except ValueError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    return {"ok": True}


@router.post("/purchase-gaps/restore", dependencies=[Depends(require_retail_management)])
def post_restore_purchase_gap(
    branch_id: str = Body(...),
    prefix: str = Body(...),
    start_number: int = Body(..., ge=0),
    end_number: int = Body(..., ge=0),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Makes an ignored purchase-number gap actionable again."""
    _can_manage_branch(db, branch_id, user)
    try:
        restore_purchase_number_gap(db, branch_id, prefix, start_number, end_number)
    except ValueError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(error)) from error
    return {"ok": True}
