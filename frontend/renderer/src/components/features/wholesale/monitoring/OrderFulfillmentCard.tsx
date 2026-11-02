import { Card, CardHeader } from "@renderer/components/ui/Card";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { SERIES_COLORS } from "./dashboardFormat";
import type { FulfillmentStage } from "./dashboardApi";

const COLOR: Record<FulfillmentStage["stage"], string> = {
  waiting_for_stock: SERIES_COLORS.amber,
  ready_to_deliver: SERIES_COLORS.primary,
  partly_delivered: SERIES_COLORS.purple,
  fulfilled: SERIES_COLORS.green,
};

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

/** What to say under a stage's number: what is still to hand over, and how long the oldest
 *  order has been there. */
function caption(stage: FulfillmentStage): string {
  if (stage.orders === 0) return "None";
  const age = `oldest ${days(stage.oldest_days)}`;
  switch (stage.stage) {
    case "fulfilled":
      return `Left to collect and delivered · ${age}`;
    case "ready_to_deliver":
      return `${formatSets(stage.left_pairs)} to hand over · ${age}`;
    default:
      return `${formatSets(stage.left_pairs)} to deliver · ${age}`;
  }
}

/** The Summary's order fulfillment: every open order, by where it is on its way to the customer.
 *  Waiting for stock, ready to deliver, partly delivered, then fulfilled (delivered, but still
 *  left to collect). It is the customer side of the stock timeline below it. */
export function OrderFulfillmentCard({
  stages,
  onOpenStage,
}: {
  stages: FulfillmentStage[];
  /** Opens the Customers directory filtered to this exact fulfillment stage. */
  onOpenStage: (stage: FulfillmentStage["stage"]) => void;
}): React.JSX.Element {
  const total = stages.reduce((sum, stage) => sum + stage.orders, 0);
  return (
    <Card className="p-3">
      <CardHeader
        className="mb-2"
        title="Order fulfillment"
        description="Where the open orders are on their way to the customer."
        action={
          <span className="shrink-0 text-xs text-text-muted">
            <span className="font-semibold tabular-nums text-text-primary">
              {total}
            </span>{" "}
            open {total === 1 ? "order" : "orders"}
          </span>
        }
      />
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stages.map((stage) => (
          <li key={stage.stage} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpenStage(stage.stage)}
              className="group w-full rounded text-left outline-none hover:bg-bg-subtle/70 focus-visible:ring-2 focus-visible:ring-brand/60"
              aria-label={`View ${stage.label.toLowerCase()} orders`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: COLOR[stage.stage] }}
                />
                <span className="truncate group-hover:text-brand">
                  {stage.label}
                </span>
              </div>
              <div className="mt-0.5 text-xl font-bold leading-tight tabular-nums text-text-primary group-hover:text-brand">
                {stage.orders}
              </div>
              <div className="text-[11px] text-text-muted">
                {caption(stage)}
              </div>
            </button>
          </li>
        ))}
      </ol>
      <div
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-bg-raised"
        role="img"
        aria-label="How the open orders are split between the stages"
      >
        {stages.map((stage) =>
          stage.orders > 0 ? (
            <div
              key={stage.stage}
              title={`${stage.label}: ${stage.orders}`}
              style={{
                width: `${(stage.orders / total) * 100}%`,
                background: COLOR[stage.stage],
              }}
            />
          ) : null,
        )}
      </div>
    </Card>
  );
}
