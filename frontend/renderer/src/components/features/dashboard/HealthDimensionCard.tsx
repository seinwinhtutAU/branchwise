import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/Badge";
import { InfoLabel } from "@renderer/components/ui/InfoTooltip";
import { MeasureValue } from "./shared";
import { STATUS_META, type HealthStatus } from "./helpers";
import {
  renderDimensionIcon,
  scoreTone,
  statusForScore,
} from "./healthHelpers";

/** What the card needs of one measure. Retail's `SubMetric` and the Wholesale health score's
 *  figures both fit it, so the two Health pages look the same. */
interface CardSubMetric {
  key: string;
  label: string;
  unit: "pct" | "pct_change" | "pct_points" | "days" | "count" | "rate";
  value: number | null;
  score: number | null;
  /** What it measures (and, where known, the figures behind it): shown on hover. */
  definition: string;
}

/** What the page passes to make the card editable: the weight of the whole part and of each of
 *  its measures become number boxes, with what each comes to as a share. */
export interface WeightEditor {
  dimensionWeight: number;
  /** What the part's weight comes to as a share of the score, e.g. "25%". */
  dimensionShare: string;
  onDimensionWeight: (value: number) => void;
  subWeight: (key: string) => number;
  /** What a measure's weight comes to as a share of its part, e.g. "30%". */
  subShare: (key: string) => string;
  onSubWeight: (key: string, value: number) => void;
}

export interface CardDimension {
  key: string;
  label: string;
  weight: number;
  effective_weight: number | null;
  score: number | null;
  status: HealthStatus | null;
  insufficient_data_reason: string | null;
  sub_metrics: CardSubMetric[];
}

/** One part of a branch's health: its score, its measures, and a footer the page fills in (what
 *  is wrong there and where to look). */
function WeightBox({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}): React.JSX.Element {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      step={1}
      value={Number.isFinite(value) ? value : ""}
      aria-label={label}
      onChange={(event) => {
        const next = event.target.valueAsNumber;
        onChange(Number.isFinite(next) ? next : 0);
      }}
      className="h-6 w-14 rounded border border-border bg-bg-base px-1.5 text-right text-xs tabular-nums text-text-primary focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
    />
  );
}

export function HealthDimensionCard({
  dimension,
  footer,
  editor,
}: {
  dimension: CardDimension;
  footer: ReactNode;
  editor?: WeightEditor;
}): React.JSX.Element {
  const status = statusForScore(dimension.score) ?? dimension.status;
  const meta = status ? STATUS_META[status] : null;
  const weight = dimension.effective_weight ?? dimension.weight;

  return (
    <div data-explain="" className="p-4 rounded-xl border border-border bg-bg-base flex flex-col justify-between gap-3 shadow-xs hover:border-border/80 transition-all">
      {/* Top Title & Header */}
      <div>
        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-border/70">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-bg-subtle border border-border/60 text-text-secondary shrink-0">
              {renderDimensionIcon(dimension.key, "w-4 h-4")}
            </div>
            <div>
              <span className="font-semibold text-sm text-text-primary">
                {dimension.label} Health
              </span>
              {editor ? (
                <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                  weight
                  <WeightBox
                    value={editor.dimensionWeight}
                    onChange={editor.onDimensionWeight}
                    label={`${dimension.label} weight`}
                  />
                  = {editor.dimensionShare}
                </span>
              ) : (
                <span className="ml-2 text-[11px] text-text-muted">
                  {Math.round(weight * 100)}% weight
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "font-bold text-sm tabular-nums",
                scoreTone(dimension.score),
              )}
            >
              {dimension.score === null ? "—" : Math.round(dimension.score)}
            </span>
            <span className="text-xs text-text-muted">/ 100</span>
            {meta && (
              <Badge variant={meta.badge} className="text-[10px] px-1.5 py-0">
                {meta.label}
              </Badge>
            )}
          </div>
        </div>

        {/* SubMetrics Grid */}
        {dimension.score === null && !editor ? (
          <p className="text-xs text-text-muted py-3">
            {dimension.insufficient_data_reason ??
              "Insufficient data for this dimension."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 py-3 sm:grid-cols-2">
            {dimension.sub_metrics.map((m) => (
              <div
                key={m.key}
                data-explain=""
                className="p-2 rounded-lg bg-bg-subtle/60 border border-border/50 flex flex-col justify-between"
              >
                <InfoLabel
                  className="min-w-0 max-w-full whitespace-normal break-words text-[11px] leading-tight text-text-muted"
                  description={m.definition}
                >
                  {m.label}
                </InfoLabel>
                <div className="flex items-baseline justify-between gap-1 mt-1">
                  <span className="font-semibold text-xs text-text-primary truncate">
                    {m.value === null ? (
                      "—"
                    ) : (
                      <MeasureValue value={m.value} unit={m.unit} />
                    )}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-bold tabular-nums",
                      scoreTone(m.score),
                    )}
                  >
                    {m.score === null ? "" : `${Math.round(m.score)} pts`}
                  </span>
                </div>
                {editor && (
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-1 gap-y-0.5 border-t border-border/50 pt-1.5 text-[11px] text-text-muted">
                    <span className="flex items-center gap-1">
                      weight
                      <WeightBox
                        value={editor.subWeight(m.key)}
                        onChange={(value) => editor.onSubWeight(m.key, value)}
                        label={`${m.label} weight`}
                      />
                    </span>
                    <span className="whitespace-nowrap tabular-nums">
                      = {editor.subShare(m.key)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: what is wrong here, and where to look */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60 text-xs">
        {footer}
      </div>
    </div>
  );
}
