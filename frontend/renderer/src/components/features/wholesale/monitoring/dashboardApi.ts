// Response shapes for the wholesale Dashboard's Revenue, Customer and Inventory tabs
// (GET /api/wholesale/dashboard/{revenue,customer,inventory}). Read-only.

import { apiBaseUrl } from "@renderer/lib/auth";
import {
  periodQueryParams,
  type PeriodKey,
} from "@renderer/components/features/dashboard/helpers";

const WHOLESALE_DASHBOARD_URL = `${apiBaseUrl}/api/wholesale/dashboard`;

interface DashboardKpi {
  value: number;
  previous_value: number | null;
  delta_pct: number | null;
}

/** One customer, product or product group's delivered revenue and its share of the window's. */
export interface RevenueShare {
  name: string;
  revenue: number;
  share_pct: number;
  /** Products only: how many sets were delivered. */
  quantity_sets?: number;
}

interface RevenueTrendPoint {
  date: string;
  delivered_revenue: number;
  collected: number;
  /** Sales so far this window; null for days that have not happened yet. */
  cumulative_sales: number | null;
  /** The same day of the window before; null once that window has ended. */
  previous_cumulative_sales: number | null;
  /** Orders placed on this day, rather than the running total. */
  sales: number | null;
  /** Orders placed on the matching day in the preceding window. */
  previous_sales: number | null;
}

export interface RevenueDashboardData {
  period: string;
  date_from: string;
  date_to: string;
  delivered_revenue: DashboardKpi;
  collected: DashboardKpi;
  receivables: number;
  potential_stock_sales_value: number;
  inventory_cost_value: number;
  potential_gross_profit: number;
  previous_date_from: string;
  previous_date_to: string;
  trend: RevenueTrendPoint[];
  factories: { factory_name: string; delivered_revenue: number }[];
  top_factory_share_pct: number;
  headline: string;
  /** Orders placed in the window: total, what has been paid on them by the end, what is left. */
  sales: DashboardKpi;
  sales_received: number;
  sales_left: number;
  top_customers: RevenueShare[];
  top_selling_products: RevenueShare[];
  top_groups: RevenueShare[];
  customer_count: number;
  customer_receivables?: {
    customer_name: string;
    balance_due: number;
    order_count: number;
  }[];
  top_products?: {
    stock_code: string;
    quantity_pairs: number;
    quantity_sets: number;
    delivered_revenue: number;
  }[];
}

/** One customer who still owes money on open orders. */
interface OpenDebtor {
  name: string;
  left: number;
  share_pct: number;
  order_count: number;
  oldest_days: number;
}

/** The Revenue tab with no period: every order still open (GET .../revenue/open). */
export interface OpenRevenueDashboardData {
  scope: "open";
  order_count: number;
  open_total: number;
  received: number;
  left: number;
  debtors: OpenDebtor[];
  debtor_count: number;
  ageing: { label: string; left: number; order_count: number }[];
}

/** One supplier we still owe money to on open vouchers. */
interface OpenSupplier {
  name: string;
  left: number;
  share_pct: number;
  voucher_count: number;
  oldest_days: number;
}

/** The Cost tab with no period: every supplier voucher still open (GET .../cost/open). */
export interface OpenCostDashboardData {
  scope: "open";
  voucher_count: number;
  open_total: number;
  paid: number;
  left: number;
  suppliers: OpenSupplier[];
  supplier_count: number;
  ageing: { label: string; left: number; voucher_count: number }[];
  top_products: {
    name: string;
    amount: number;
    share_pct: number;
    quantity_sets: number;
  }[];
}

/** A profit figure that is null (not 0) when it could not be worked out, with no change then. */
interface ProfitKpi {
  value: number | null;
  previous_value: number | null;
  delta_pct: number | null;
}

/** Profit recognised when goods are delivered, less their allocated landed costs. */
export interface WholesaleProfit {
  delivered_revenue: number;
  product_cost: number;
  transportation_cost: number;
  gross_profit: ProfitKpi;
  gross_margin_pct: ProfitKpi;
  net_profit: ProfitKpi;
  reason: string | null;
}

export interface CostDashboardData {
  period: string;
  profit: WholesaleProfit;
  date_from: string;
  date_to: string;
  previous_date_from: string;
  previous_date_to: string;
  goods_purchased: number;
  cost_to_bring_in: number;
  total_cost: number;
  goods_share_pct: number;
  cost_share_pct: number;
  supplier_balance_due: number;
  factories: { factory_name: string; purchased: number }[];
  factory_count: number;
  payable_count: number;
  /** The tab's own figures for the period: total = paid + left. */
  total: DashboardKpi;
  paid: number;
  left: number;
  headline: string;
  top_suppliers: { name: string; amount: number; share_pct: number }[];
  top_products: {
    name: string;
    amount: number;
    share_pct: number;
    quantity_sets: number;
  }[];
  trend: {
    date: string;
    cumulative_cost: number | null;
    previous_cumulative_cost: number | null;
    cost: number | null;
    previous_cost: number | null;
    gross_profit: number | null;
    previous_gross_profit: number | null;
    net_profit: number | null;
    previous_net_profit: number | null;
  }[];
  payables: {
    voucher_id: string;
    voucher_no: string;
    supplier_name: string;
    voucher_date: string;
    days_open: number;
    balance_due: number;
  }[];
}

/** The Customer tab for a period: who ordered, who was new, and what each group ordered. */
export interface CustomerDashboardData {
  period: string;
  date_from: string;
  date_to: string;
  active_customers: DashboardKpi;
  new_customers: DashboardKpi;
  repeat_customers: { value: number; share_of_active_pct: number };
  headline: string;
  sales_from_new: number;
  sales_from_repeat: number;
  new_customer_list: {
    name: string;
    first_order: string;
    first_order_value: number;
  }[];
  /** Order value each day, split between new and repeat customers. */
  orders_by_day: {
    date: string;
    new_customers: number;
    repeat_customers: number;
  }[];
  /** The 12 months up to the end of the period: how many customers ordered, new or repeat. */
  customers_by_month: {
    month: string;
    new_customers: number;
    repeat_customers: number;
  }[];
  /** Customers who ordered in the period, by how often they usually order. */
  frequency: { label: string; customer_count: number }[];
  typical_gap_days: number | null;
  pattern_unknown_count: number;
}

/** Someone waiting for goods on open orders. */
export interface WaitingCustomer {
  name: string;
  left_pairs: number;
  ready_pairs: number;
  order_count: number;
  oldest_days: number;
}

/** A customer whose last order is well past their own usual gap between orders. */
export interface QuietCustomer {
  name: string;
  last_order: string;
  days_since: number;
  usual_gap_days: number;
  order_count: number;
}

/** The Customer tab with no period (GET .../customer/open). */
/** Open orders at one stage on their way to the customer. */
export interface FulfillmentStage {
  stage:
    "waiting_for_stock" | "ready_to_deliver" | "partly_delivered" | "fulfilled";
  label: string;
  orders: number;
  /** Pairs still to deliver on these orders (shown as sets). */
  left_pairs: number;
  /** How old the oldest order at this stage is, in days. */
  oldest_days: number;
}

export interface OpenCustomerDashboardData {
  scope: "open";
  open_customer_count: number;
  to_deliver_pairs: number;
  ready_pairs: number;
  fulfillment: FulfillmentStage[];
  waiting: WaitingCustomer[];
  waiting_count: number;
  pattern_known_count: number;
  pattern_unknown_count: number;
  quiet: QuietCustomer[];
  quiet_count: number;
}

/** The Inventory tab for a period: what was counted in, what was delivered, what went out most.
 *  Quantities are in pairs, as everywhere on the wire. */
export interface InventoryDashboardData {
  period: string;
  date_from: string;
  date_to: string;
  previous_date_from: string;
  previous_date_to: string;
  counted: DashboardKpi;
  delivered: DashboardKpi;
  change_pairs: number;
  headline: string;
  by_day: { date: string; counted_pairs: number; delivered_pairs: number }[];
  top_delivered: {
    name: string;
    description: string;
    pairs: number;
    share_pct: number;
  }[];
}

/** A product in stock, for the two lists of what is stuck and what is running out. */
export interface StockedProduct {
  stock_code: string;
  description: string;
  on_hand_pairs: number;
  delivered_recent_pairs: number;
  never_delivered: boolean;
  idle_days: number | null;
  cost: number;
  lasts_days: number | null;
}

/** The Inventory tab with no period (GET .../inventory/open). */
export interface OpenInventoryDashboardData {
  scope: "open";
  /** How many recent days a product's pace is judged over. */
  pace_days: number;
  places: {
    name: string;
    pairs: number;
    is_warehouse: boolean;
  }[];
  groups: {
    product_group: string;
    available_pairs: number;
    committed_pairs: number;
    incoming_pairs: number;
    cost: number;
  }[];
  stuck: StockedProduct[];
  running_out: StockedProduct[];
}

/** The window a period-based Dashboard tab is showing — what the Dashboard's period control
 *  (the same one the retail Dashboard uses) hands down. */
export interface DashboardWindow {
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  month: string;
}

export const OPEN_REVENUE_URL = `${WHOLESALE_DASHBOARD_URL}/revenue/open`;
export const OPEN_CUSTOMER_URL = `${WHOLESALE_DASHBOARD_URL}/customer/open`;
export const OPEN_INVENTORY_URL = `${WHOLESALE_DASHBOARD_URL}/inventory/open`;
export const OPEN_COST_URL = `${WHOLESALE_DASHBOARD_URL}/cost/open`;

export function dashboardTabUrl(
  tab: "health" | "revenue" | "cost" | "customer" | "inventory",
  window?: DashboardWindow,
): string {
  const query = window
    ? periodQueryParams(
        window.period,
        window.dateFrom,
        window.dateTo,
        window.month,
      ).toString()
    : "";
  return `${WHOLESALE_DASHBOARD_URL}/${tab}${query ? `?${query}` : ""}`;
}

/** One measured input to a part of the health score, with the figures behind it. */
export interface HealthSubMetric {
  key: string;
  label: string;
  /** How the value is written: a level, a signed change, or a number of days. */
  unit: "pct" | "pct_change" | "days";
  weight: number;
  value: number | null;
  score: number | null;
  definition: string;
  calculation: string | null;
}

export interface HealthDimension {
  key: string;
  label: string;
  description: string;
  weight: number;
  /** Its configured share of the branch score (null when the part has no source data). */
  effective_weight: number | null;
  score: number | null;
  status: "healthy" | "needs_attention" | "critical" | null;
  /** Why the part could not be scored (set only when score is null). */
  insufficient_data_reason: string | null;
  sub_metrics: HealthSubMetric[];
}

/** How much each part, and each measure inside it, counts toward the score. Whole numbers from 0
 *  to 100; they need not add up to anything (see health.py `score`). */
export interface HealthWeightSet {
  dimensions: Record<string, number>;
  sub_metrics: Record<string, number>;
}

interface HealthWeights extends HealthWeightSet {
  /** The weights the app ships with, which "Reset to default" goes back to. */
  defaults: HealthWeightSet;
  /** True once the owner has saved weights of their own. */
  customised: boolean;
}

/** The Wholesale health score (GET .../dashboard/health) for the selected Dashboard window. */
export interface WholesaleHealthData {
  date_from: string;
  date_to: string;
  overall_score: number | null;
  status: "healthy" | "needs_attention" | "critical" | null;
  /** How much of the score has measured source data (1 = all of it). */
  scored_weight: number;
  dimensions: HealthDimension[];
  weights: HealthWeights;
}

export const WHOLESALE_HEALTH_URL = `${WHOLESALE_DASHBOARD_URL}/health`;
export const WHOLESALE_HEALTH_WEIGHTS_URL = `${WHOLESALE_HEALTH_URL}/weights`;
