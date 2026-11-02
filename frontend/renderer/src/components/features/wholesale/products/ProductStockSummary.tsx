import React from "react";
import { cn } from "@renderer/lib/utils";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { ChipsWithTotal } from "@renderer/components/features/wholesale/shared/ChipsWithTotal";
import { type StockRecord } from "../inventory/stock";

/** What is here, what is promised, what is free, and the colours in stock. */
export function ProductStockSummary({
  record,
  onHandPairs,
  atGatePairs,
  colorsInStock,
  movingHere,
  inOnePlace,
}: {
  record: StockRecord;
  /** Warehouse stock for the place picked, or for all warehouses. */
  onHandPairs: number;
  atGatePairs: number;
  colorsInStock: string;
  /** Goods moved to a warehouse and not counted there yet. */
  movingHere: { location: string; pairs: number }[];
  /** One warehouse is picked, so allocated and available still mean all warehouses. */
  inOnePlace: boolean;
}): React.JSX.Element {
  return (
    <>
      {/* Three numbers: what is here, what is promised, what is free */}
      <div data-explain="" className="grid grid-cols-3 divide-x divide-border/50 border-b border-border/60 bg-bg-subtle/20 px-2 py-4 text-xs sm:px-4">
        <div className="px-2 sm:px-3">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Warehouse stock
          </span>
          <span
            className={cn(
              "mt-0.5 block text-lg font-bold tabular-nums",
              onHandPairs > 0 ? "text-success" : "text-error",
            )}
          >
            {formatSets(onHandPairs)}
          </span>
        </div>
        <div className="px-2 sm:px-3">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Order allocated
            {inOnePlace && (
              <span className="font-normal normal-case"> · all warehouses</span>
            )}
          </span>
          <span className="mt-0.5 block text-lg font-bold tabular-nums text-text-primary">
            {formatSets(record.allocated_pairs)}
          </span>
        </div>
        <div className="px-2 sm:px-3">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Available stock
            {inOnePlace && (
              <span className="font-normal normal-case"> · all warehouses</span>
            )}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-lg font-bold tabular-nums",
              record.available_pairs >= 0 ? "text-text-primary" : "text-error",
            )}
          >
            {formatSets(record.available_pairs)}
          </span>
        </div>
      </div>

      {/* Colors in stock */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Colors in stock
        </span>
        {onHandPairs > 0 ? (
          <ChipsWithTotal
            breakdown={colorsInStock}
            unit="set"
            totalPairs={onHandPairs}
          />
        ) : (
          <span className="text-xs text-text-muted">None in stock.</span>
        )}
      </div>
      {atGatePairs > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            At a receiving gate
          </span>
          <span className="text-xs text-text-secondary">
            {formatSets(atGatePairs)} · not moved to a warehouse yet, so not in
            warehouse stock
          </span>
        </div>
      )}
      {movingHere.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Moving to a warehouse
          </span>
          <span className="text-xs text-text-secondary">
            {movingHere
              .map((entry) => `${entry.location}: ${formatSets(entry.pairs)}`)
              .join(" · ")}{" "}
            · not counted there yet, so not in its stock
          </span>
        </div>
      )}
    </>
  );
}
