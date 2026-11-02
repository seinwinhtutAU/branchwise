import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { RefreshingHint } from "@renderer/components/features/dashboard/shared";
import { Card } from "@renderer/components/ui/Card";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { DashboardError, DashboardLoading } from "./dashboardParts";
import { formatMmk } from "./dashboardFormat";
import {
  OPEN_INVENTORY_URL,
  type OpenInventoryDashboardData,
} from "./dashboardApi";
import { OpenInventorySection } from "./OpenInventorySection";

function total(
  groups: OpenInventoryDashboardData["groups"],
  key: "available_pairs" | "committed_pairs" | "incoming_pairs" | "cost",
): number {
  return groups.reduce((sum, group) => sum + group[key], 0);
}

function CurrentInventorySummary({
  data,
}: {
  data: OpenInventoryDashboardData;
}): React.JSX.Element {
  const available = total(data.groups, "available_pairs");
  const allocated = total(data.groups, "committed_pairs");
  const incoming = total(data.groups, "incoming_pairs");
  const cost = total(data.groups, "cost");

  return (
    <Card className="overflow-hidden p-0">
      <p className="border-b border-border bg-bg-subtle/40 px-4 py-3 text-sm font-medium text-text-primary">
        Current stock position
      </p>
      <section className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-4 sm:divide-y-0">
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Available
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatSets(available)}
          </div>
          <div className="mt-1 text-xs text-text-muted">Ready to allocate</div>
        </div>
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Allocated
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-brand">
            {formatSets(allocated)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            Held for open orders
          </div>
        </div>
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Incoming
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-warning">
            {formatSets(incoming)}
          </div>
          <div className="mt-1 text-xs text-text-muted">Still on its way</div>
        </div>
        <div className="px-4 py-4 sm:py-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Stock value
          </div>
          <div className="mt-1 text-xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatMmk(cost)}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {data.groups.length} product groups
          </div>
        </div>
      </section>
    </Card>
  );
}

/** The wholesale Dashboard's Inventory tab is a current stock view. It intentionally does not
 * follow the dashboard's period picker: the figures describe what is available, allocated and
 * incoming now, followed by the products that need attention. */
export function WholesaleInventoryDashboard({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  const { data, isRefreshing, failed, reload } =
    useUrlQuery<OpenInventoryDashboardData>(
      OPEN_INVENTORY_URL,
      session,
      "Current inventory dashboard",
    );

  // A copy saved before "places" existed has no such field: treat it as not loaded yet.
  if (data === undefined || data.places === undefined) {
    return failed ? (
      <DashboardError title="Inventory" reload={reload} />
    ) : (
      <DashboardLoading tiles={4} />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <RefreshingHint show={isRefreshing} />
      <CurrentInventorySummary data={data} />
      <OpenInventorySection data={data} />
    </div>
  );
}

export default WholesaleInventoryDashboard;
