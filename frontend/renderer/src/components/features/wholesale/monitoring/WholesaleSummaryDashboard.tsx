import type { Session } from "@renderer/lib/auth";
import type { DashboardScope } from "./ScopeToggle";
import type { DashboardWindow } from "./dashboardApi";
import type { WholesaleSummaryData } from "./monitoringApi";
import { OpenSummary } from "./OpenSummary";
import { PeriodSummary } from "./PeriodSummary";
import { StockBoard } from "./StockBoard";
import { type WholesaleDashboardDrilldown } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";

/** The wholesale Dashboard's Summary: money KPIs (open now) or period figures, then stock. The
 *  stock board is always how it stands now. Detail is one click away on the Revenue, Cost,
 *  Customer and Inventory tabs, and a name in a list opens that customer or supplier. */
export function WholesaleSummaryDashboard({
  session,
  summaryData,
  scope,
  window,
  onSelectTab,
  onOpenDrilldown,
}: {
  session: Session;
  summaryData: WholesaleSummaryData;
  scope: DashboardScope;
  window: DashboardWindow;
  onSelectTab: (tab: "revenue" | "cost" | "inventory" | "customer") => void;
  onOpenDrilldown: (target: WholesaleDashboardDrilldown) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 text-text-primary">
      {scope === "open" ? (
        <OpenSummary session={session} onOpenDrilldown={onOpenDrilldown} />
      ) : (
        <PeriodSummary
          session={session}
          window={window}
          onSelectTab={onSelectTab}
        />
      )}
      <section aria-labelledby="current-inventory-heading">
        <div className="mb-2.5">
          <h2
            id="current-inventory-heading"
            className="text-base font-semibold tracking-tight text-text-primary"
          >
            Current inventory
          </h2>
          <p className="text-xs text-text-muted">
            The stock position today. It remains current even when you choose a
            period.
          </p>
        </div>
        <StockBoard
          data={summaryData}
          onOpenInventory={() => onSelectTab("inventory")}
          onOpenStockStage={(filter) =>
            onOpenDrilldown({ section: "products", filter })
          }
        />
      </section>
    </div>
  );
}

export default WholesaleSummaryDashboard;
