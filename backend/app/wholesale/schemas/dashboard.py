"""Read-only response contracts for the wholesale Dashboard's Revenue, Customer and
Inventory tabs."""

from typing import Any

from pydantic import BaseModel


class DashboardKpi(BaseModel):
    value: float
    previous_value: float | None = None
    delta_pct: float | None = None


class DashboardWindow(BaseModel):
    period: str
    date_from: str
    date_to: str
    previous_date_from: str
    previous_date_to: str


class RevenueDashboard(DashboardWindow):
    delivered_revenue: DashboardKpi
    collected: DashboardKpi
    receivables: float
    potential_stock_sales_value: float
    inventory_cost_value: float
    potential_gross_profit: float
    trend: list[dict[str, Any]]
    factories: list[dict[str, Any]]
    top_factory_share_pct: float
    customer_receivables: list[dict[str, Any]] = []
    top_products: list[dict[str, Any]] = []
    # The insight part of the tab (see services/dashboard.py "Revenue insight").
    headline: str = ""
    sales: DashboardKpi = DashboardKpi(value=0.0)
    sales_received: float = 0.0
    sales_left: float = 0.0
    top_customers: list[dict[str, Any]] = []
    top_selling_products: list[dict[str, Any]] = []
    top_groups: list[dict[str, Any]] = []
    customer_count: int = 0


class OpenRevenueDashboard(BaseModel):
    """The Revenue tab with no period: every order still open (see services/dashboard.py)."""

    scope: str
    order_count: int
    open_total: float
    received: float
    left: float
    debtors: list[dict[str, Any]]
    debtor_count: int
    ageing: list[dict[str, Any]]


class OpenCustomerDashboard(BaseModel):
    """The Customer tab with no period: who is waiting for goods, how often customers buy and who has gone quiet."""

    scope: str
    open_customer_count: int
    to_deliver_pairs: int
    ready_pairs: int
    # Open orders by stage: orders, sets still to deliver, and how old the oldest order is.
    fulfillment: list[dict[str, Any]] = []
    waiting: list[dict[str, Any]]
    waiting_count: int
    pattern_known_count: int
    pattern_unknown_count: int
    quiet: list[dict[str, Any]]
    quiet_count: int


class CostDashboard(DashboardWindow):
    goods_purchased: float
    cost_to_bring_in: float
    total_cost: float
    goods_share_pct: float
    cost_share_pct: float
    supplier_balance_due: float
    factories: list[dict[str, Any]]
    factory_count: int
    payable_count: int
    payables: list[dict[str, Any]]
    # The tab's own figures (see services/dashboard.py "Cost tab").
    total: DashboardKpi = DashboardKpi(value=0.0)
    paid: float = 0.0
    left: float = 0.0
    headline: str = ""
    top_suppliers: list[dict[str, Any]] = []
    top_products: list[dict[str, Any]] = []
    trend: list[dict[str, Any]] = []
    # Gross profit on what was delivered (see services/dashboard.py gross_profit_payload).
    profit: dict[str, Any] = {}


class OpenCostDashboard(BaseModel):
    """The Cost tab with no period: every supplier voucher still open."""

    scope: str
    voucher_count: int
    open_total: float
    paid: float
    left: float
    suppliers: list[dict[str, Any]]
    supplier_count: int
    ageing: list[dict[str, Any]]


class RepeatCustomers(BaseModel):
    value: float
    share_of_active_pct: float


class CustomerDashboard(DashboardWindow):
    active_customers: DashboardKpi
    new_customers: DashboardKpi
    repeat_customers: RepeatCustomers
    open_orders: float
    order_count: int
    total_ordered_value: float
    top_customers: list[dict[str, Any]]
    delivery_status: dict[str, int]
    # The tab's own figures for the period (see services/dashboard.py "Customer tab").
    headline: str = ""
    sales_from_new: float = 0.0
    sales_from_repeat: float = 0.0
    new_customer_list: list[dict[str, Any]] = []
    orders_by_day: list[dict[str, Any]] = []
    customers_by_month: list[dict[str, Any]] = []
    frequency: list[dict[str, Any]] = []
    typical_gap_days: int | None = None
    pattern_unknown_count: int = 0
    awaiting_orders: list[dict[str, Any]]


class InventoryDashboard(DashboardWindow):
    """The Inventory tab for a period: what was counted in, what was delivered, which products went out most."""

    counted: DashboardKpi
    delivered: DashboardKpi
    change_pairs: int
    headline: str
    by_day: list[dict[str, Any]]
    top_delivered: list[dict[str, Any]]


class OpenInventoryDashboard(BaseModel):
    """The current Inventory tab: stock by place and product group, plus products that need attention."""

    scope: str
    pace_days: int
    places: list[dict[str, Any]]
    groups: list[dict[str, Any]]
    stuck: list[dict[str, Any]]
    running_out: list[dict[str, Any]]
    stocked_count: int = 0
    stock_cost: float = 0.0
    stuck_cost: float = 0.0
    running_out_count: int = 0


class WholesaleHealth(BaseModel):
    """The Wholesale health score: an overall figure and one per part of the business, each with
    the figures behind it (see app/wholesale/services/health.py)."""

    date_from: str
    date_to: str
    previous_date_from: str
    previous_date_to: str
    overall_score: float | None
    status: str | None
    scored_weight: float
    dimensions: list[dict[str, Any]]
    # The weights in use, the defaults, and whether the owner has changed them.
    weights: dict[str, Any] = {}


class WholesaleHealthWeightsRequest(BaseModel):
    """A weight for every part and every measure; see health.validate_weights."""

    dimensions: dict[str, float]
    sub_metrics: dict[str, float]
