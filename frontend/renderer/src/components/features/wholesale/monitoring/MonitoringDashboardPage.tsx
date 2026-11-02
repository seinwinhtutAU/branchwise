import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import { fetchJson, refreshEverything } from "@renderer/lib/queryClient";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { TabBar } from "@renderer/components/ui/Tabs";
import { ExportDataButtons } from "@renderer/components/features/wholesale/monitoring/ExportDataButtons";
import { WholesaleSummaryDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleSummaryDashboard";
import { PeriodControls } from "@renderer/components/features/dashboard/shared";
import { usePeriodRange } from "@renderer/components/features/dashboard/usePeriodRange";
import { DASHBOARD_PERIOD_OPTIONS } from "@renderer/components/features/dashboard/helpers";
import { DashboardError, DashboardLoading } from "./dashboardParts";
import { WholesaleHealthDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleHealthDashboard";
import { WholesaleRevenueDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleRevenueDashboard";
import { ScopeToggle, type DashboardScope } from "./ScopeToggle";
import { WholesaleCostDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleCostDashboard";
import { WholesaleCustomerDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleCustomerDashboard";
import { WholesaleInventoryDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleInventoryDashboard";
import {
  WHOLESALE_SUMMARY_URL,
  type WholesaleSummaryData,
} from "./monitoringApi";
import { type WholesaleDashboardDrilldown } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";

const DASHBOARD_TABS = [
  { id: "summary", label: "Summary" },
  { id: "health", label: "Health" },
  { id: "revenue", label: "Revenue" },
  { id: "cost", label: "Cost" },
  { id: "inventory", label: "Inventory" },
  { id: "customer", label: "Customer" },
] as const;

type DashboardView = (typeof DASHBOARD_TABS)[number]["id"];

export default function MonitoringDashboardPage({
  session,
  openTab,
  onOpenCustomer,
  onOpenDrilldown,
}: {
  session: Session;
  /** Asks for a tab to open (a new token each time); used when another screen leads to Health. */
  openTab?: { tab: DashboardView | null; token: number };
  onOpenCustomer: (name: string) => void;
  onOpenDrilldown: (target: WholesaleDashboardDrilldown) => void;
}): React.JSX.Element {
  const [view, setView] = useState<DashboardView>(openTab?.tab ?? "summary");
  // Takes part in explain mode; the tab says which dashboard figures the assistant looks at.
  useExplainScreen({ tab: view, branchId: null, dateFrom: null, dateTo: null });
  const handledTab = useRef(openTab?.token ?? 0);
  useEffect(() => {
    if (!openTab || openTab.token === handledTab.current) return;
    handledTab.current = openTab.token;
    if (openTab.tab) setView(openTab.tab);
  }, [openTab]);
  // The Summary opens on what is still open now; choosing "By period" brings the period control.
  // The other tabs are always by period.
  const [summaryScope, setSummaryScope] = useState<DashboardScope>("open");
  // One period control for the Summary (By period), Health, Revenue, Cost and Customer views —
  // the same one the retail Dashboard uses (Daily, Weekly, Monthly, or a custom range).
  // Inventory is the current stock position, so it intentionally has no date range.
  const range = usePeriodRange("monthly");
  const window = {
    period: range.period,
    dateFrom: range.applied.from,
    dateTo: range.applied.to,
    month: range.month,
  };

  const summaryQuery = useQuery({
    // Stock is how it stands now, so the Summary read does not depend on the period.
    queryKey: ["wholesale", "summary"] as const,
    queryFn: async () => {
      return await fetchJson<WholesaleSummaryData>(
        WHOLESALE_SUMMARY_URL,
        session,
      );
    },
  });

  const isRefreshing = summaryQuery.isFetching;

  const handleRefresh = (): void => {
    void summaryQuery.refetch();
    // Each non-summary tab owns its own request.
    if (view !== "summary") {
      refreshEverything();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Streamlined Dashboard Navigation & Filters Toolbar (Matching Retail Summary Dashboard) */}
      <div className="flex flex-col gap-2 pb-2 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-text-primary shrink-0 hidden sm:block">
              Dashboard
            </h1>
            <TabBar<DashboardView>
              tabs={DASHBOARD_TABS}
              activeTab={view}
              onSelect={setView}
              className="border-b-0 w-auto"
            />
          </div>

          <div className="flex items-center gap-2">
            <ExportDataButtons session={session} />
            <RefreshButton onClick={handleRefresh} refreshing={isRefreshing} />
          </div>
        </div>

        {/* Filters Toolbar Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {view === "summary" && (
              <ScopeToggle scope={summaryScope} onChange={setSummaryScope} />
            )}

            {((view === "summary" && summaryScope === "period") ||
              view === "health" ||
              view === "revenue" ||
              view === "cost" ||
              view === "customer") && (
              <PeriodControls
                range={range}
                options={DASHBOARD_PERIOD_OPTIONS}
              />
            )}
          </div>
        </div>
      </div>

      <div key={view} className="flex animate-fade-in flex-col gap-4">
        {view === "health" && (
          <WholesaleHealthDashboard
            session={session}
            window={window}
            onOpenTab={setView}
          />
        )}
        {view === "revenue" && (
          <WholesaleRevenueDashboard session={session} window={window} />
        )}
        {view === "cost" && (
          <WholesaleCostDashboard session={session} window={window} />
        )}
        {view === "customer" && (
          <WholesaleCustomerDashboard
            session={session}
            window={window}
            onOpenCustomer={onOpenCustomer}
          />
        )}
        {view === "inventory" && (
          <WholesaleInventoryDashboard session={session} />
        )}

        {view === "summary" &&
          summaryQuery.data === undefined &&
          (summaryQuery.isError ? (
            <DashboardError
              title="Summary"
              reload={async () => {
                await summaryQuery.refetch();
              }}
            />
          ) : (
            <DashboardLoading tiles={5} />
          ))}
        {view === "summary" && summaryQuery.data !== undefined && (
          <WholesaleSummaryDashboard
            session={session}
            summaryData={summaryQuery.data}
            scope={summaryScope}
            window={window}
            onSelectTab={setView}
            onOpenDrilldown={onOpenDrilldown}
          />
        )}
      </div>
    </div>
  );
}
