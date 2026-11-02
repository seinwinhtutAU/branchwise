import { Card, CardHeader } from "@renderer/components/ui/Card";
import { SERIES_COLORS, formatMmk } from "./dashboardFormat";
import type { WholesaleSummaryData } from "./monitoringApi";
import type { ProductDashboardFilter } from "@renderer/components/features/wholesale/shared/dashboardDrilldown";

// The colors of the stages, in the order stock travels. Set aside and Available are the two
// parts of what is in a warehouse.
const COLOR = {
  supplier: SERIES_COLORS.amber,
  onTheWay: SERIES_COLORS.purple,
  gate: "#94a3b8",
  setAside: SERIES_COLORS.primary,
  available: SERIES_COLORS.green,
} as const;

function sets(value: number): string {
  return value.toLocaleString();
}

/** One stop on the timeline: a dot on the line, the stage, its number and what it means. */
function Stop({
  color,
  label,
  value,
  caption,
  children,
  onOpen,
}: {
  color: string;
  label: string;
  value: number;
  caption: string;
  children?: React.ReactNode;
  onOpen?: () => void;
}): React.JSX.Element {
  return (
    <li className="relative flex-1 pt-4 text-center">
      <span
        className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-4 ring-bg-base"
        style={{ background: color }}
      />
      <button
        type="button"
        onClick={onOpen}
        className="group w-full rounded text-center outline-none hover:bg-bg-subtle/70 focus-visible:ring-2 focus-visible:ring-brand/60"
        aria-label={`View products ${label.toLowerCase()}`}
      >
        <div className="text-xs font-semibold text-text-secondary group-hover:text-brand">
          {label}
        </div>
        <div className="text-xl font-bold tabular-nums leading-tight text-text-primary group-hover:text-brand">
          {sets(value)}
        </div>
        <div className="px-1 text-[11px] text-text-muted">{caption}</div>
      </button>
      {children}
    </li>
  );
}

/** The Summary's stock board: every set of stock on the journey from the supplier to a customer,
 *  as a timeline with the total on top, and where the counted stock is now by place. Stock is
 *  always how it stands now, so it does not change with Open now or By period. */
export function StockBoard({
  data,
  onOpenInventory,
  onOpenStockStage,
}: {
  data: WholesaleSummaryData;
  onOpenInventory: () => void;
  onOpenStockStage: (filter: ProductDashboardFilter) => void;
}): React.JSX.Element | null {
  const flow = data.pipeline;
  // A copy saved by an older version of the app lacks the new figures: show nothing until the
  // fresh answer replaces it.
  if (flow?.total_sets === undefined) return null;

  const warehouse = flow.allocated_sets + flow.available_sets;
  const counted = flow.at_gate_sets + warehouse;
  const parts = [
    {
      key: "supplier",
      label: "At supplier",
      value: flow.supplier_sets,
      color: COLOR.supplier,
    },
    {
      key: "onTheWay",
      label: "On the way",
      value: flow.transit_sets,
      color: COLOR.onTheWay,
    },
    {
      key: "gate",
      label: "At receiving gate",
      value: flow.at_gate_sets,
      color: COLOR.gate,
    },
    {
      key: "setAside",
      label: "Allocated",
      value: flow.allocated_sets,
      color: COLOR.setAside,
    },
    {
      key: "available",
      label: "Available",
      value: flow.available_sets,
      color: COLOR.available,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1.3fr)_minmax(19rem,0.7fr)]">
      <Card className="p-3">
        <CardHeader
          className="mb-1.5"
          title="Stock"
          description="Every set of stock, from the supplier to your warehouses."
          action={
            <button
              type="button"
              onClick={onOpenInventory}
              className="shrink-0 text-xs font-medium text-brand hover:underline"
            >
              Details →
            </button>
          }
        />
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
          <span>
            <span className="text-xl font-bold tabular-nums tracking-tight text-text-primary">
              {sets(flow.total_sets)}
            </span>
            <span className="ml-1.5 text-xs text-text-secondary">
              sets in all
            </span>
          </span>
          <span className="text-xs text-text-muted">
            Stock value{" "}
            <span className="font-semibold tabular-nums text-text-primary">
              {formatMmk(data.inventory_value ?? 0)}
            </span>
          </span>
        </div>

        <ol className="relative flex items-start">
          <span
            className="absolute left-[12.5%] right-[12.5%] top-1.5 h-px bg-border"
            aria-hidden
          />
          <Stop
            color={COLOR.supplier}
            label="At supplier"
            value={flow.supplier_sets}
            caption="Ordered, not sent"
            onOpen={() => onOpenStockStage("at-supplier")}
          />
          <Stop
            color={COLOR.onTheWay}
            label="On the way"
            value={flow.transit_sets}
            caption="Sent, not arrived"
            onOpen={() => onOpenStockStage("on-the-way")}
          />
          <Stop
            color={COLOR.gate}
            label="At receiving gate"
            value={flow.at_gate_sets}
            caption="Counted, not moved"
            onOpen={() => onOpenStockStage("at-receiving-gate")}
          />
          <Stop
            color={COLOR.available}
            label="In a warehouse"
            value={warehouse}
            caption="Counted and moved in"
            onOpen={() => onOpenStockStage("in-warehouse")}
          />
        </ol>

        <div
          className="mt-3 flex h-2 overflow-hidden rounded-full bg-bg-raised"
          role="img"
          aria-label="How all the stock is split between the stages"
        >
          {parts.map((part) =>
            part.value > 0 ? (
              <div
                key={part.key}
                title={`${part.label}: ${sets(part.value)} sets`}
                style={{
                  width: `${(part.value / flow.total_sets) * 100}%`,
                  background: part.color,
                }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-text-secondary">
          <span className="text-text-muted">In a warehouse:</span>
          <button
            type="button"
            onClick={() => onOpenStockStage("allocated")}
            className="flex items-center gap-1.5 rounded outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: COLOR.setAside }}
            />
            Allocated{" "}
            <span className="font-semibold tabular-nums text-text-primary">
              {sets(flow.allocated_sets)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onOpenStockStage("available")}
            className="flex items-center gap-1.5 rounded outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: COLOR.available }}
            />
            Available{" "}
            <span className="font-semibold tabular-nums text-text-primary">
              {sets(flow.available_sets)}
            </span>
          </button>
        </div>
      </Card>

      <Card className="p-3">
        <CardHeader
          className="mb-1.5"
          title="Stock by place"
          description={`Counted in all ${sets(counted)} sets`}
        />
        <div className="flex flex-col gap-2">
          {data.locations.map((place) => {
            const pct =
              counted > 0
                ? Math.min(100, Math.round((place.sets / counted) * 100))
                : 0;
            return (
              <div key={place.name}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-medium text-text-secondary">
                    {place.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-semibold text-text-primary">
                      {sets(place.sets)}
                    </span>
                    <span className="text-text-muted"> · {pct}%</span>
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-bg-raised">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: place.color ?? "#5252E8",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
