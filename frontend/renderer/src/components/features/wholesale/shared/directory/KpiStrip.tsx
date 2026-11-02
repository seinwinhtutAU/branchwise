import React from "react";
import { cn } from "@renderer/lib/utils";
import { formatKyat } from "../shared";

export interface KpiItem {
  label: string;
  value: number;
  /** "balance" is red while something is owed and green once it is settled. */
  tone: "neutral" | "success" | "balance";
}

/** The three Kyat figures under a customer's or supplier's name. */
export function KpiStrip({ items }: { items: KpiItem[] }): React.JSX.Element {
  return (
    <div className="grid grid-cols-3 divide-x divide-border/50 border-b border-border/60 bg-bg-subtle/20 px-2 py-4 text-xs sm:px-4">
      {items.map((item) => (
        <div key={item.label} className="px-2 sm:px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted block">
            {item.label}
          </span>
          <span
            className={cn(
              "mt-0.5 block text-lg font-bold tabular-nums",
              item.tone === "neutral" && "text-text-primary",
              item.tone === "success" && "text-success",
              item.tone === "balance" &&
                (item.value > 0 ? "text-error" : "text-success"),
            )}
          >
            {formatKyat(item.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
