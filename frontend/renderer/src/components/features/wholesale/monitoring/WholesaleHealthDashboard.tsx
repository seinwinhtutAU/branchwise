import type { Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { RefreshingHint } from "@renderer/components/features/dashboard/shared";
import {
  HealthDimensionCard,
  type WeightEditor,
} from "@renderer/components/features/dashboard/HealthDimensionCard";
import { scoreTone } from "@renderer/components/features/dashboard/healthHelpers";
import { STATUS_META } from "@renderer/components/features/dashboard/helpers";
import { cn } from "@renderer/lib/utils";
import { DashboardError, DashboardLoading } from "./dashboardParts";
import {
  WHOLESALE_HEALTH_WEIGHTS_URL,
  dashboardTabUrl,
  type DashboardWindow,
  type HealthDimension,
  type WholesaleHealthData,
} from "./dashboardApi";
import { formatScore } from "./healthFormat";
import { useHealthWeightEditor } from "@renderer/components/features/dashboard/useHealthWeightEditor";
import {
  WeightEditControls,
  WeightEditHint,
} from "@renderer/components/features/dashboard/WeightEditControls";

export type HealthEvidenceTab = "revenue" | "cost" | "inventory" | "customer";

// Which tab holds the figures behind each part, like the retail Health page's links.
const EVIDENCE: Record<string, { tab: HealthEvidenceTab; label: string }> = {
  orders: { tab: "customer", label: "View Customer" },
  money: { tab: "revenue", label: "View Revenue" },
  inventory: { tab: "inventory", label: "View Inventory" },
  profit: { tab: "cost", label: "View Cost" },
};

function DimensionCard({
  dimension,
  onOpenTab,
  editor,
}: {
  dimension: HealthDimension;
  onOpenTab: (tab: HealthEvidenceTab) => void;
  editor?: WeightEditor;
}): React.JSX.Element {
  const evidence = EVIDENCE[dimension.key];
  return (
    <HealthDimensionCard
      editor={editor}
      dimension={{
        ...dimension,
        // Hovering a measure says what it is and, where known, the figures behind it.
        sub_metrics: dimension.sub_metrics.map((sub) => ({
          ...sub,
          definition: sub.calculation
            ? `${sub.definition} ${sub.calculation}`
            : sub.definition,
        })),
      }}
      footer={
        <>
          <span className="text-[11px] text-text-muted">
            {dimension.description}
          </span>
          {evidence && (
            <button
              type="button"
              onClick={() => onOpenTab(evidence.tab)}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium cursor-pointer"
            >
              {evidence.label} →
            </button>
          )}
        </>
      }
    />
  );
}

/** The wholesale Dashboard's Health tab, laid out like the retail Health page for one branch: a
 *  title with the selected window, then a card per part of the business with its score and
 *  measures. "Edit weights" changes how much each part, and each measure inside it, counts. */
export function WholesaleHealthDashboard({
  session,
  window,
  onOpenTab,
}: {
  session: Session;
  window: DashboardWindow;
  onOpenTab: (tab: HealthEvidenceTab) => void;
}): React.JSX.Element {
  const showToast = useToast();
  const { data, isRefreshing, failed, reload } =
    useUrlQuery<WholesaleHealthData>(
      dashboardTabUrl("health", window),
      session,
      "Wholesale health score",
    );
  const empty = { dimensions: {}, sub_metrics: {} };
  const weights = data?.weights;
  const editing = useHealthWeightEditor({
    saved: weights ?? empty,
    defaults: weights?.defaults ?? empty,
    dimensions: data?.dimensions ?? [],
    save: async (draft) => {
      try {
        const response = await fetch(WHOLESALE_HEALTH_WEIGHTS_URL, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(draft),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          showToast("error", detail?.detail ?? "Couldn't save the weights.");
          return false;
        }
        await reload();
        showToast("success", "Weights saved.");
        return true;
      } catch {
        showToast("error", "Could not save weights. Please check your connection and try again.");
        return false;
      }
    },
  });

  // A copy saved by an older version of the app has none of these fields: treat it as not loaded.
  if (
    data === undefined ||
    data.dimensions === undefined ||
    data.weights === undefined
  ) {
    return failed ? (
      <DashboardError title="Health" reload={reload} />
    ) : (
      <DashboardLoading tiles={5} />
    );
  }

  const meta = data.status ? STATUS_META[data.status] : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary tracking-tight">
            Business health
          </h2>
          <p className="text-xs text-text-muted">
            {data.date_from} to {data.date_to} ·{" "}
            <span
              className={cn("font-semibold", scoreTone(data.overall_score))}
            >
              {formatScore(data.overall_score)} / 100
            </span>
            {meta && (
              <span className={cn("ml-1", meta.text)}>· {meta.label}</span>
            )}
            {data.scored_weight < 1 &&
              ` · ${Math.round(data.scored_weight * 100)}% score confidence`}
            {data.weights.customised && " · custom weights"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshingHint show={isRefreshing} />
          <WeightEditControls editing={editing} />
        </div>
      </div>
      <WeightEditHint editing={editing} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.dimensions.map((dimension) => (
          <DimensionCard
            key={dimension.key}
            dimension={dimension}
            onOpenTab={onOpenTab}
            editor={editing.editorFor(dimension)}
          />
        ))}
      </div>
    </div>
  );
}

export default WholesaleHealthDashboard;
