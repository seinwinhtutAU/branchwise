"""One cached Overview per branch, period and day, shared by the Dashboard and the assistant.

The Overview (Branch Health and the Business Alerts) is one of the most expensive reads in the app: a cold
branch takes 6 to 15 seconds against the remote database. The Dashboard page already cached it; the assistant
used to recompute it every turn, so "what needs a decision" cost about 40 seconds every time, and so did every
follow-up that needed the same numbers. Both now ask here, with the same key, so whichever asked first pays
and the other (and a repeat or follow-up question) gets the answer at once.

The key says when the answer stops being true: a confirmed import or a revert (the branch's data version),
the calendar day, and the two Settings windows the alerts' data checks use. A change to the Branch Health
weights clears the whole cache from the endpoint that saves them (see dashboard.put_health_weights).
"""

from datetime import date

from sqlalchemy.orm import Session

from app.retail.services import branch_health
from app.services import response_cache
from app.services.settings import get_purchase_warning_window_days, get_sale_warning_window_days


def cached_overview(
    db: Session,
    branch_id: str,
    branch_name: str,
    period: str,
    date_from: date | None = None,
    date_to: date | None = None,
    month: str | None = None,
) -> dict:
    cache_key = (
        "dashboard_overview",
        branch_id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch_id),
        # The alerts' data-quality checks use these two Settings windows, which can change
        # without any import happening.
        get_sale_warning_window_days(db),
        get_purchase_warning_window_days(db),
    )
    return response_cache.cached(
        cache_key,
        lambda: branch_health.build_overview_dashboard(
            db, branch_id, branch_name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )
