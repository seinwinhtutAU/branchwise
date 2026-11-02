import { Card, CardHeader } from "@renderer/components/ui/Card";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { SERIES_COLORS, formatMmk } from "./dashboardFormat";
import { type OpenInventoryDashboardData } from "./dashboardApi";

function groupLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function stockTotal(
  group: OpenInventoryDashboardData["groups"][number],
): number {
  return group.available_pairs + group.committed_pairs + group.incoming_pairs;
}

function StockByPlace({
  places,
}: {
  places: OpenInventoryDashboardData["places"] | undefined;
}): React.JSX.Element {
  const currentPlaces = places ?? [];
  const totalPairs = currentPlaces.reduce((sum, place) => sum + place.pairs, 0);

  return (
    <Card className="flex h-[22rem] min-h-0 flex-col p-3 lg:h-full">
      <CardHeader
        className="mb-1.5"
        title="Stock by place"
        description="Counted stock at each receiving gate or warehouse."
      />
      {currentPlaces.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">
          No counted stock yet.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto pr-1">
          {currentPlaces.map((place) => {
            const share = totalPairs > 0 ? (place.pairs / totalPairs) * 100 : 0;
            return (
              <li
                key={place.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-sm first:pt-0 last:pb-0"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text-primary">
                    {place.name}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {place.is_warehouse ? "Warehouse" : "Receiving gate"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular-nums text-text-primary">
                    {formatSets(place.pairs)}
                  </span>
                  <span className="block text-[11px] tabular-nums text-text-muted">
                    {share.toFixed(1)}%
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** The current stock detail: stock by product group and by physical place, not a delivery-pace
 * forecast. Wholesale lead times are too long and variable for a short delivery window to make
 * a dependable depletion or idle-stock signal. */
export function OpenInventorySection({
  data,
}: {
  data: OpenInventoryDashboardData;
}): React.JSX.Element {
  const biggest = Math.max(...data.groups.map(stockTotal), 1);
  const segments = [
    {
      key: "available_pairs",
      label: "Available",
      color: SERIES_COLORS.primary,
    },
    { key: "committed_pairs", label: "Allocated", color: SERIES_COLORS.purple },
    { key: "incoming_pairs", label: "Incoming", color: SERIES_COLORS.amber },
  ] as const;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        Stock right now · not affected by the period
      </h2>

      <div className="grid grid-cols-1 gap-3 lg:h-[22rem] lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
        <Card className="flex h-[22rem] min-h-0 flex-col p-3 lg:h-full">
          <CardHeader
            className="mb-1.5"
            title="Stock by product group"
            description="Available, allocated to orders and incoming stock, with what it cost."
          />
          <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
            {segments.map((segment) => (
              <li key={segment.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: segment.color }}
                />
                {segment.label}
              </li>
            ))}
          </ul>
          {data.groups.length === 0 ? (
            <p className="py-4 text-center text-xs text-text-muted">
              No stock yet.
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
              {data.groups.map((group) => {
                const total = stockTotal(group);
                return (
                  <li
                    key={group.product_group}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-border py-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
                  >
                    <span className="min-w-0 text-sm font-medium text-text-primary">
                      <span className="block truncate">
                        {groupLabel(group.product_group)}
                      </span>
                      <span className="block text-xs font-normal text-text-muted">
                        {formatSets(total)} total
                      </span>
                    </span>
                    <span className="text-right text-xs tabular-nums sm:order-3">
                      <span className="text-text-muted">Cost </span>
                      <span className="font-semibold text-text-primary">
                        {formatMmk(group.cost)}
                      </span>
                    </span>
                    <div className="col-span-full min-w-0 sm:col-span-1">
                      <div className="flex h-2.5 overflow-hidden rounded-sm bg-bg-raised">
                        {segments.map((segment) =>
                          group[segment.key] > 0 ? (
                            <div
                              key={segment.key}
                              title={`${segment.label}: ${formatSets(group[segment.key])}`}
                              style={{
                                width: `${(group[segment.key] / biggest) * 100}%`,
                                background: segment.color,
                              }}
                            />
                          ) : null,
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-text-muted">
                        {segments.map((segment) => (
                          <span key={segment.key}>
                            {segment.label} {formatSets(group[segment.key])}
                          </span>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <StockByPlace places={data.places} />
      </div>
    </section>
  );
}
