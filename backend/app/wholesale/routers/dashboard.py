from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.schemas.dashboard import (
    CostDashboard,
    CustomerDashboard,
    InventoryDashboard,
    OpenCostDashboard,
    OpenCustomerDashboard,
    OpenInventoryDashboard,
    OpenRevenueDashboard,
    RevenueDashboard,
    WholesaleHealth,
    WholesaleHealthWeightsRequest,
)
from app.services import response_cache
from app.wholesale.services import dashboard as dashboard_tabs
from app.wholesale.services import health as health_score
from app.wholesale.services.response_cache import wholesale_data_version
from app.wholesale.routers.common import require_wholesale, resolve_window

router = APIRouter(prefix="/api/wholesale/dashboard", tags=["wholesale"])


PeriodQuery = Annotated[str, Query(description="today, yesterday, 7d or 30d")]
DateFromQuery = Annotated[date | None, Query()]
DateToQuery = Annotated[date | None, Query()]
MonthQuery = Annotated[str | None, Query(description="Which calendar month period=monthly means, as YYYY-MM")]


def _cache_key(name: str, branch_id: str | None, db: Session, window) -> tuple:
    # window.start/window.end are already resolved concrete dates (see _resolve_window
    # above), so unlike the retail dashboard's cache key there is no separate need for
    # date.today() to invalidate a "today"/"30d" preset after midnight — a calendar
    # rollover already changes window.start/window.end before this key is built.
    return (name, branch_id, window.period, window.start, window.end, wholesale_data_version(db, branch_id))


@router.get("/health", response_model=WholesaleHealth)
def get_wholesale_health(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """The Wholesale health score for the Dashboard's selected period."""
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    # The owner's weights are part of the key, so saving new ones shows at once.
    return response_cache.cached(
        (*_cache_key("wholesale_health", user.branch_id, db, window), repr(health_score.saved_weights(db))),
        lambda: health_score.build_health(db, user.branch_id, window),
    )


@router.put("/health/weights")
def put_wholesale_health_weights(
    payload: WholesaleHealthWeightsRequest,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Save the owner's weights for the five parts and for the measures inside each."""
    require_wholesale(user)
    try:
        weights = health_score.validate_weights(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    health_score.save_weights(db, weights)
    return health_score.weights_payload(weights)


@router.delete("/health/weights")
def reset_wholesale_health_weights(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Go back to the weights the app ships with."""
    require_wholesale(user)
    health_score.save_weights(db, None)
    return health_score.weights_payload(None)


@router.get("/revenue/open", response_model=OpenRevenueDashboard)
def get_open_revenue_dashboard(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Revenue with no period: every order still open, now. The date is in the key because
    the age bands move with it."""
    require_wholesale(user)
    return response_cache.cached(
        ("wholesale_dashboard_revenue_open", user.branch_id, date.today(), wholesale_data_version(db, user.branch_id)),
        lambda: dashboard_tabs.open_revenue_dashboard(db, user.branch_id),
    )


@router.get("/revenue", response_model=RevenueDashboard)
def get_revenue_dashboard(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    return response_cache.cached(
        _cache_key("wholesale_dashboard_revenue", user.branch_id, db, window),
        lambda: dashboard_tabs.revenue_dashboard(db, user.branch_id, window),
    )


@router.get("/inventory/open", response_model=OpenInventoryDashboard)
def get_open_inventory_dashboard(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Stock with no period: by product group, idle longest, running out soonest. The date is in the
    key because how long a product has been idle moves with it."""
    require_wholesale(user)
    return response_cache.cached(
        ("wholesale_dashboard_inventory_open", user.branch_id, date.today(), wholesale_data_version(db, user.branch_id)),
        lambda: dashboard_tabs.open_inventory_dashboard(db, user.branch_id),
    )


@router.get("/inventory", response_model=InventoryDashboard)
def get_inventory_dashboard(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    return response_cache.cached(
        _cache_key("wholesale_dashboard_inventory", user.branch_id, db, window),
        lambda: dashboard_tabs.inventory_dashboard(db, user.branch_id, window),
    )


@router.get("/customer/open", response_model=OpenCustomerDashboard)
def get_open_customer_dashboard(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Customers with no period: who is waiting for goods, how often customers buy, who has gone quiet."""
    require_wholesale(user)
    return response_cache.cached(
        ("wholesale_dashboard_customer_open", user.branch_id, date.today(), wholesale_data_version(db, user.branch_id)),
        lambda: dashboard_tabs.open_customer_dashboard(db, user.branch_id),
    )


@router.get("/customer", response_model=CustomerDashboard)
def get_customer_dashboard(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    return response_cache.cached(
        _cache_key("wholesale_dashboard_customer", user.branch_id, db, window),
        lambda: dashboard_tabs.customer_dashboard(db, user.branch_id, window),
    )


@router.get("/cost/open", response_model=OpenCostDashboard)
def get_open_cost_dashboard(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Cost with no period: every supplier voucher still open, now."""
    require_wholesale(user)
    return response_cache.cached(
        ("wholesale_dashboard_cost_open", user.branch_id, date.today(), wholesale_data_version(db, user.branch_id)),
        lambda: dashboard_tabs.open_cost_dashboard(db, user.branch_id),
    )


@router.get("/cost", response_model=CostDashboard)
def get_cost_dashboard(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    return response_cache.cached(
        _cache_key("wholesale_dashboard_cost", user.branch_id, db, window),
        lambda: dashboard_tabs.cost_dashboard(db, user.branch_id, window),
    )
