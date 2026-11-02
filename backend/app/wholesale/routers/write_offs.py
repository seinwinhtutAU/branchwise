from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.schemas.write_offs import IssueCreateIn, IssueUpdateIn, WriteOffUpdate
from app.wholesale.services.write_offs import (
    create_manual_issue,
    delete_write_off,
    list_write_offs,
    resolve_issue,
    update_issue,
    update_write_off,
    write_off_to_dict,
)
from app.wholesale.routers.common import paginate, require_wholesale

router = APIRouter(prefix="/api/wholesale", tags=["wholesale"])


@router.post("/issues", status_code=status.HTTP_201_CREATED)
def create_wholesale_issue(
    payload: IssueCreateIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    entry = create_manual_issue(
        db,
        user_id=user.id,
        branch_id=user.branch_id,
        payload=payload,
    )
    return write_off_to_dict(entry)


@router.get("/issues")
def list_wholesale_issues(
    search: Annotated[str, Query(max_length=100)] = "",
    reference: Annotated[str | None, Query(max_length=100)] = None,
    reference_id: Annotated[str | None, Query(max_length=36)] = None,
    reference_type: Annotated[str | None, Query(max_length=30)] = None,
    subject_id: Annotated[str | None, Query(max_length=36)] = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=2000)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    require_wholesale(user)
    entries = paginate(
        list_write_offs(
            db,
            user.branch_id,
            search=search,
            subject_id=subject_id,
            reference=reference,
            reference_id=reference_id,
            reference_type=reference_type,
            status_filter=status,
            include_quantity_changes=False,
        ),
        page,
        page_size,
        response,
    )
    return [write_off_to_dict(entry) for entry in entries]


@router.patch("/issues/{issue_id}")
def update_wholesale_issue(
    issue_id: str,
    payload: IssueUpdateIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    entry = update_issue(
        db,
        issue_id,
        payload=payload,
        user_id=user.id,
        branch_id=user.branch_id,
    )
    return write_off_to_dict(entry)


@router.post("/issues/{issue_id}/resolve")
def resolve_wholesale_issue(
    issue_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    entry = resolve_issue(
        db,
        issue_id,
        user_id=user.id,
        branch_id=user.branch_id,
    )
    return write_off_to_dict(entry)


@router.delete("/issues/{issue_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_wholesale_issue(
    issue_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    require_wholesale(user)
    delete_write_off(db, issue_id, user_id=user.id, branch_id=user.branch_id)


@router.get("/write-offs")
def list_wholesale_write_offs(
    search: Annotated[str, Query(max_length=100)] = "",
    subject_id: Annotated[str | None, Query(max_length=36)] = None,
    reference: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=2000)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    require_wholesale(user)
    entries = paginate(
        list_write_offs(
            db,
            user.branch_id,
            search=search,
            subject_id=subject_id,
            reference=reference,
            include_quantity_changes=False,
        ),
        page,
        page_size,
        response,
    )
    return [write_off_to_dict(entry) for entry in entries]


@router.patch("/write-offs/{entry_id}")
def update_wholesale_write_off(
    entry_id: str,
    payload: WriteOffUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    entry = update_write_off(
        db, entry_id, quantity=payload.quantity, color_breakdown=payload.color_breakdown,
        reason=payload.reason, note=payload.note,
        user_id=user.id, branch_id=user.branch_id,
    )
    return write_off_to_dict(entry)


@router.delete("/write-offs/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_wholesale_write_off(
    entry_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    require_wholesale(user)
    delete_write_off(db, entry_id, user_id=user.id, branch_id=user.branch_id)
