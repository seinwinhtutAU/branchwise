import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.services import branch_health as branch_health_service
from app.retail.services.overview_cache import cached_overview
from app.services import dashboard as dashboard_service
from app.services import response_cache
from app.services.settings import get_purchase_warning_window_days, get_sale_warning_window_days
from app.services.branches import list_retail_branches, resolve_branch_id
from app.retail.routers.common import require_advanced_dashboard, require_retail

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(require_retail)])

DATE_FROM_DESCRIPTION = "Custom range start (inclusive) — overrides `period` when both date_from and date_to are given"
DATE_TO_DESCRIPTION = "Custom range end (inclusive) — overrides `period` when both date_from and date_to are given"
MONTH_DESCRIPTION = "Which calendar month period=monthly means, as YYYY-MM — defaults to the current month"

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _resolve_retail_branch(user: User, branch_id: str | None, db: Session) -> Branch:
    """Same rule as every other write/scoped endpoint (a branch-scoped account's own
    branch wins; admin must say which one). Resolves any valid retail branch (wholesale
    branches are excluded from the retail dashboard)."""
    resolved_id = resolve_branch_id(user, branch_id, db)
    branch = list_retail_branches(db).filter(Branch.id == resolved_id).first()
    if branch is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown or non-retail branch_id: {resolved_id}",
        )
    return branch


def _validate_period_or_dates(
    period: str,
    date_from: date | None,
    date_to: date | None,
    month: str | None = None,
) -> None:
    """A custom range must be a real pair — one date with no other is ambiguous rather
    than "half a custom range plus the preset." Only once both are absent does `period`
    (and, for period=monthly, `month`) matter at all."""
    if (date_from is None) != (date_to is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "date_from and date_to must both be provided together"
        )
    if date_from is not None and date_to is not None:
        if date_from > date_to:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "date_from must be on or before date_to")
        return
    if period not in dashboard_service.VALID_PERIODS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"period must be one of {sorted(dashboard_service.VALID_PERIODS)}",
        )
    if period == "monthly" and month is not None:
        if not _MONTH_RE.match(month):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "month must be YYYY-MM")
        if month > date.today().strftime("%Y-%m"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "month cannot be in the future")


@router.get("/overview")
def get_overview_dashboard(
    # Overview compares periods, so 30 days is more useful than a noisy one-day view.
    # Business Alerts still requests the supported 7d and 30d values.
    period: str = Query("30d", description="today | yesterday | 7d | 30d | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    # Overview is expensive, so cache it by branch, period, and day.
    return cached_overview(
        db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
    )


class HealthWeightsRequest(BaseModel):
    """A weight for every dimension and every measure inside them, as fractions of 1 (the same
    scale as the `branch_health_weights` setting); see branch_health.validate_weights."""

    dimensions: dict[str, float]
    sub_metrics: dict[str, float]


@router.put("/overview/weights")
def put_health_weights(
    payload: HealthWeightsRequest,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Save the owner's Branch Health weights (the dimensions' and the measures' inside them).
    One set for every branch, so their scores stay comparable. Admin and development only, like
    every business-wide setting."""
    if user.role not in (UserRole.ADMIN, UserRole.DEVELOPMENT):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin or development account can change the health weights",
        )
    try:
        dimensions, sub_metrics = branch_health_service.validate_weights(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    branch_health_service.save_weights(db, dimensions, sub_metrics)
    # Cached scores use the old weights, so clear them.
    response_cache.clear()
    return branch_health_service.weights_payload(db)


@router.get("/revenue")
def get_revenue_dashboard(
    period: str = Query("today", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_revenue",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_revenue_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/cost")
def get_cost_dashboard(
    period: str = Query("today", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_cost",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_cost_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/all-cost")
def get_all_cost_dashboard(
    period: str = Query("today", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    """Cost dashboard for an unscoped account's all-branches view."""
    if user.branch_id is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot view all-branches cost")
    _validate_period_or_dates(period, date_from, date_to, month)
    branch_ids = tuple(branch.id for branch in list_retail_branches(db).all())
    cache_key = (
        "dashboard_all_cost",
        period,
        date_from,
        date_to,
        month,
        date.today(),
        tuple(
            (branch_id, response_cache.import_data_version(db, branch_id))
            for branch_id in branch_ids
        ),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_all_cost_dashboard(
            db, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/inventory")
def get_inventory_dashboard(
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    # No period param — current stock is a point-in-time fact, not a date-range query.
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_inventory",
        branch.id,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_inventory_dashboard(db, branch.id, branch.name),
    )


@router.get("/all-inventory")
def get_all_inventory_dashboard(
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    """Current inventory dashboard for an unscoped account's all-branches view."""
    if user.branch_id is not None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "This account cannot view all-branches inventory"
        )
    branch_ids = tuple(branch.id for branch in list_retail_branches(db).all())
    cache_key = (
        "dashboard_all_inventory",
        date.today(),
        tuple(
            (branch_id, response_cache.import_data_version(db, branch_id))
            for branch_id in branch_ids
        ),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_all_inventory_dashboard(db),
    )


@router.get("/customer")
def get_customer_dashboard(
    period: str = Query("today", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_customer",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_customer_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/all-customer")
def get_all_customer_dashboard(
    period: str = Query("today", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    """Customer dashboard for an unscoped account's all-branches view."""
    if user.branch_id is not None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "This account cannot view all-branches customer data"
        )
    _validate_period_or_dates(period, date_from, date_to, month)
    branch_ids = tuple(branch.id for branch in list_retail_branches(db).all())
    cache_key = (
        "dashboard_all_customer",
        period,
        date_from,
        date_to,
        month,
        date.today(),
        tuple(
            (branch_id, response_cache.import_data_version(db, branch_id))
            for branch_id in branch_ids
        ),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_all_customer_dashboard(
            db, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/summary")
def get_summary_dashboard(
    period: str = Query("yesterday", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_summary",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_summary_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/all-summary")
def get_all_summary_dashboard(
    period: str = Query("yesterday", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Executive summary for the admin/development all-branches dashboard view."""
    if user.branch_id is not None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account cannot view the all-branches summary",
        )
    _validate_period_or_dates(period, date_from, date_to, month)
    branch_ids = tuple(branch.id for branch in list_retail_branches(db).all())
    cache_key = (
        "dashboard_all_summary",
        period,
        date_from,
        date_to,
        month,
        date.today(),
        tuple(
            (branch_id, response_cache.import_data_version(db, branch_id))
            for branch_id in branch_ids
        ),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_all_summary_dashboard(
            db, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/all-revenue")
def get_all_revenue_dashboard(
    period: str = Query("today", description="today | yesterday | monthly | yearly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Revenue dashboard for an unscoped account's all-branches view."""
    if user.branch_id is not None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This account cannot view all-branches revenue",
        )
    _validate_period_or_dates(period, date_from, date_to, month)
    branch_ids = tuple(branch.id for branch in list_retail_branches(db).all())
    cache_key = (
        "dashboard_all_revenue",
        period,
        date_from,
        date_to,
        month,
        date.today(),
        tuple(
            (branch_id, response_cache.import_data_version(db, branch_id))
            for branch_id in branch_ids
        ),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_all_revenue_dashboard(
            db, period, date_from=date_from, date_to=date_to, month=month
        ),
    )
