import { useMemo } from "react";
import type { Session } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import {
  refreshEverything,
  useUrlQuery,
  useUrlQueries,
} from "@renderer/lib/queryClient";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import type { BranchOption } from "@renderer/lib/useBranches";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { Panel } from "@renderer/components/ui/Panel";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  CheckIcon,
  ChevronLeftIcon,
  DashboardIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  dashboardTabUrl,
  type WholesaleHealthData,
} from "@renderer/components/features/wholesale/monitoring/dashboardApi";
import { RefreshingHint } from "./shared";
import { HealthDimensionCard, type WeightEditor } from "./HealthDimensionCard";
import { WeightEditControls, WeightEditHint } from "./WeightEditControls";
import { useHealthWeightEditor } from "./useHealthWeightEditor";
import type { HealthWeightSet } from "./healthWeights";
import {
  renderDimensionIcon,
  scoreTone,
  statusForScore,
} from "./healthHelpers";
import {
  ACTIONABLE_SEVERITIES,
  EVIDENCE_LABEL,
  STATUS_META,
  dashboardUrl,
  dateRangeLabel,
  previousPeriodLabel,
  type DimensionScore,
  type EvidenceTarget,
  type HealthAlert,
  type HealthStatus,
  type OverviewData,
  type PeriodKey,
} from "./helpers";

// Which evidence tab each dimension's own numbers came from.
const DIMENSION_EVIDENCE: Record<string, EvidenceTarget> = {
  sales: "revenue",
  profit: "cost",
  inventory: "inventory",
  customer: "customer",
  data_quality: "warnings",
};

function ScoreBar({
  score,
  status,
  className,
}: {
  score: number | null;
  status: HealthStatus | null;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "h-1.5 rounded-full bg-bg-raised overflow-hidden",
        className,
      )}
      role="presentation"
    >
      {score !== null && status && (
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
            STATUS_META[status].bar,
          )}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      )}
    </div>
  );
}

// ========================================================================================
// 1. Multi-Branch Overview Table (Admin Page 1)
// ========================================================================================

function BranchLoadingCard({ name }: { name: string }): React.JSX.Element {
  return (
    <Panel className="flex flex-col gap-3 p-4 sm:p-5 rounded-lg border border-border bg-bg-base shadow-xs">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-border/70">
        <h3 className="font-bold text-base text-text-primary truncate">
          {name}
        </h3>
      </div>
      <Skeleton className="h-40" />
    </Panel>
  );
}

function BranchFailedCard({
  name,
  onRetry,
}: {
  name: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <Panel className="flex flex-col gap-3 p-4 sm:p-5 rounded-lg border border-border bg-bg-base shadow-xs">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-border/70">
        <h3 className="font-bold text-base text-text-primary truncate">
          {name}
        </h3>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
        <WarningIcon className="w-5 h-5 text-warning" />
        <p className="text-xs text-text-muted">
          Couldn't load this branch's health data.
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </Panel>
  );
}

/** The Wholesale branch's card among the branches' health cards. Wholesale is scored on its own
 *  five parts (see app/wholesale/services/health.py), so the pillars listed are the ones it
 *  reports, not the retail five; the score and the colours mean the same. */
function WholesaleHealthCard({
  health,
  rank,
  onOpen,
}: {
  health: WholesaleHealthData;
  rank: number;
  onOpen: () => void;
}): React.JSX.Element {
  const status = statusForScore(health.overall_score) ?? health.status;
  const meta = status ? STATUS_META[status] : null;
  return (
    <Panel
      data-explain=""
      className={cn(
        "flex flex-col justify-between p-4 sm:p-5 rounded-lg border border-border bg-bg-base shadow-xs",
        "hover:border-border-strong hover:shadow-sm transition-all cursor-pointer group",
      )}
      onClick={onOpen}
    >
      <div>
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-border/70">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-bg-subtle text-text-secondary text-xs font-bold font-mono shrink-0">
              #{rank}
            </span>
            <h3 className="font-bold text-base text-text-primary truncate group-hover:text-brand transition-colors">
              Wholesale
            </h3>
          </div>
          {meta && (
            <Badge
              variant={meta.badge}
              className="text-xs px-2 py-0.5 shrink-0"
            >
              {meta.label}
            </Badge>
          )}
        </div>
        <div className="py-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs font-medium text-text-muted">
              Overall Health Score
            </span>
            <div className="flex items-baseline gap-1">
              <span
                className={cn(
                  "text-2xl font-extrabold tabular-nums",
                  scoreTone(health.overall_score),
                )}
              >
                {health.overall_score === null
                  ? "—"
                  : Math.round(health.overall_score)}
              </span>
              <span className="text-xs text-text-muted">/ 100</span>
            </div>
          </div>
          <ScoreBar
            score={health.overall_score}
            status={status}
            className="h-2 w-full"
          />
        </div>
        <div className="space-y-2.5 pt-2 pb-3 border-t border-border/60">
          <span className="text-[11px] font-semibold text-text-muted tracking-wider uppercase">
            Pillars Performance
          </span>
          <div className="space-y-2">
            {health.dimensions.map((dimension) => {
              const score = dimension.score;
              return (
                <div key={dimension.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-text-secondary font-medium">
                      <span className="text-text-muted shrink-0">
                        {renderDimensionIcon(dimension.key, "w-3.5 h-3.5")}
                      </span>
                      <span>{dimension.label}</span>
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        scoreTone(score),
                      )}
                    >
                      {score === null ? "—" : `${Math.round(score)} / 100`}
                    </span>
                  </div>
                  <ScoreBar
                    score={score}
                    status={statusForScore(score)}
                    className="h-1.5 w-full"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="pt-3 mt-2 border-t border-border/70 flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="text-xs h-7 px-2.5 text-brand group-hover:bg-brand group-hover:text-white transition-all shrink-0"
        >
          View Health →
        </Button>
      </div>
    </Panel>
  );
}

function MultiBranchComparisonView({
  session,
  branchOptions,
  period,
  dateFrom,
  dateTo,
  month,
  onOpen,
  onOpenWholesale,
}: {
  session: Session;
  branchOptions: BranchOption[];
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  month: string;
  onOpen: (branchId: string) => void;
  /** Given only to accounts that can open Wholesale, which then joins the branches below. */
  onOpenWholesale?: () => void;
}): React.JSX.Element {
  const branchUrls = useMemo(
    () =>
      branchOptions.map((b) => ({
        branch: b,
        url: dashboardUrl("overview", b.id, {
          period,
          dateFrom,
          dateTo,
          month,
        }),
      })),
    [branchOptions, period, dateFrom, dateTo, month],
  );
  const urls = useMemo(() => branchUrls.map((b) => b.url), [branchUrls]);
  const { data, failedUrls, isRefreshing, refetchUrl } =
    useUrlQueries<OverviewData>(urls, session, "all branches health");
  const failedUrlSet = useMemo(() => new Set(failedUrls), [failedUrls]);
  // Wholesale is a branch too: its score sits among the retail branches' and is ranked with
  // them, for the same period as theirs (it is the same request the wholesale Health tab makes).
  const wholesaleUrl = useMemo(
    () =>
      dashboardTabUrl("health", {
        period,
        dateFrom,
        dateTo,
        month: month ?? "",
      }),
    [period, dateFrom, dateTo, month],
  );
  const wholesale = useUrlQuery<WholesaleHealthData>(
    onOpenWholesale ? wholesaleUrl : null,
    session,
    "Wholesale health score",
  ).data;

  // Every branch always renders its own card (loaded / loading / failed) rather than
  // dropping out of the grid when its own request is slow or fails — a large branch's
  // request failing used to make its whole card vanish instead of showing an error.
  const loaded = branchUrls
    .filter(({ url }) => data[url] !== undefined)
    .map(({ branch, url }) => ({ branch, overview: data[url] }))
    .sort(
      (a, b) =>
        (b.overview.overall_score ?? -1) - (a.overview.overall_score ?? -1),
    );
  const notLoaded = branchUrls.filter(({ url }) => data[url] === undefined);
  const wholesaleReady =
    onOpenWholesale && wholesale?.dimensions !== undefined ? wholesale : null;
  // One ranked list of cards: the retail branches and, when there is one, Wholesale.
  const ranked: (
    | { kind: "retail"; score: number | null; overview: OverviewData }
    | { kind: "wholesale"; score: number | null; health: WholesaleHealthData }
  )[] = [
    ...loaded.map(({ overview }) => ({
      kind: "retail" as const,
      score: overview.overall_score,
      overview,
    })),
    ...(wholesaleReady
      ? [
          {
            kind: "wholesale" as const,
            score: wholesaleReady.overall_score,
            health: wholesaleReady,
          },
        ]
      : []),
  ].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <div className="flex flex-col gap-4">
      {/* Multi-Branch Health Cards Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Branch Health
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Comprehensive health scores and operational pillar performance per
              branch.
            </p>
          </div>
          <RefreshingHint show={isRefreshing} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ranked.map((entry, index) =>
            entry.kind === "retail" ? (
              <BranchHealthCard
                key={entry.overview.branch_id}
                branch={entry.overview}
                rank={index + 1}
                onOpen={onOpen}
              />
            ) : (
              <WholesaleHealthCard
                key="wholesale"
                health={entry.health}
                rank={index + 1}
                onOpen={onOpenWholesale as () => void}
              />
            ),
          )}
          {notLoaded.map(({ branch, url }) =>
            failedUrlSet.has(url) ? (
              <BranchFailedCard
                key={branch.id}
                name={branch.name}
                onRetry={() => void refetchUrl(url)}
              />
            ) : (
              <BranchLoadingCard key={branch.id} name={branch.name} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function BranchHealthCard({
  branch,
  rank,
  onOpen,
}: {
  branch: OverviewData;
  rank: number;
  onOpen: (branchId: string) => void;
}): React.JSX.Element {
  const status = statusForScore(branch.overall_score) ?? branch.status;
  const meta = status ? STATUS_META[status] : null;
  const actionableAlerts = branch.alerts.filter(
    (a) =>
      a.dimension !== "data_quality" &&
      ACTIONABLE_SEVERITIES.includes(a.severity),
  );

  const dimensionKeys = [
    { key: "sales", label: "Sales" },
    { key: "profit", label: "Profit" },
    { key: "inventory", label: "Inventory" },
    { key: "customer", label: "Customer" },
    { key: "data_quality", label: "Data Quality" },
  ];

  return (
    <Panel
      data-explain=""
      className={cn(
        "flex flex-col justify-between p-4 sm:p-5 rounded-lg border border-border bg-bg-base shadow-xs",
        "hover:border-border-strong hover:shadow-sm transition-all cursor-pointer group",
      )}
      onClick={() => onOpen(branch.branch_id)}
    >
      <div>
        {/* Card Header: Rank & Branch Name & Status Badge */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-border/70">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-bg-subtle text-text-secondary text-xs font-bold font-mono shrink-0">
              #{rank}
            </span>
            <h3 className="font-bold text-base text-text-primary truncate group-hover:text-brand transition-colors">
              {branch.branch_name}
            </h3>
          </div>
          {meta && (
            <Badge
              variant={meta.badge}
              className="text-xs px-2 py-0.5 shrink-0"
            >
              {meta.label}
            </Badge>
          )}
        </div>

        {/* Overall Score Section */}
        <div className="py-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs font-medium text-text-muted">
              Overall Health Score
            </span>
            <div className="flex items-baseline gap-1">
              <span
                className={cn(
                  "text-2xl font-extrabold tabular-nums",
                  scoreTone(branch.overall_score),
                )}
              >
                {branch.overall_score === null
                  ? "—"
                  : Math.round(branch.overall_score)}
              </span>
              <span className="text-xs text-text-muted">/ 100</span>
            </div>
          </div>
          <ScoreBar
            score={branch.overall_score}
            status={status}
            className="h-2 w-full"
          />
        </div>

        {/* 4 Dimension Progress Bars */}
        <div className="space-y-2.5 pt-2 pb-3 border-t border-border/60">
          <span className="text-[11px] font-semibold text-text-muted tracking-wider uppercase">
            Pillars Performance
          </span>
          <div className="space-y-2">
            {dimensionKeys.map(({ key, label }) => {
              const dim = branch.dimensions.find((d) => d.key === key);
              const score = dim?.score ?? null;
              const status = statusForScore(score);
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-text-secondary font-medium">
                      <span className="text-text-muted shrink-0">
                        {renderDimensionIcon(key, "w-3.5 h-3.5")}
                      </span>
                      <span>{label}</span>
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        scoreTone(score),
                      )}
                    >
                      {score === null ? "—" : `${Math.round(score)} / 100`}
                    </span>
                  </div>
                  <ScoreBar
                    score={score}
                    status={status}
                    className="h-1.5 w-full"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Card Footer: Alerts + Open Action */}
      <div className="pt-3 mt-2 border-t border-border/70 flex items-center justify-between gap-2">
        <div className="text-xs">
          {actionableAlerts.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-warning font-medium">
              <WarningIcon className="w-3.5 h-3.5 shrink-0" />
              <span>
                {actionableAlerts.length}{" "}
                {actionableAlerts.length === 1
                  ? "active alert"
                  : "active alerts"}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-success font-medium text-[11px]">
              <CheckIcon className="w-3.5 h-3.5 shrink-0" />
              <span>All indicators clear</span>
            </span>
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(branch.branch_id);
          }}
          className="text-xs h-7 px-2.5 text-brand group-hover:bg-brand group-hover:text-white transition-all shrink-0"
        >
          View Health →
        </Button>
      </div>
    </Panel>
  );
}

// ========================================================================================
// 2. Single-Branch Health Matrix View (Page 2)
// ========================================================================================

function DimensionMatrixCard({
  dimension,
  alerts,
  onOpenEvidence,
  editor,
}: {
  dimension: DimensionScore;
  alerts: HealthAlert[];
  onOpenEvidence: (target: EvidenceTarget) => void;
  editor?: WeightEditor;
}): React.JSX.Element {
  const evidence = DIMENSION_EVIDENCE[dimension.key];
  const actionableAlerts = alerts.filter(
    (a) =>
      a.dimension === dimension.key &&
      ACTIONABLE_SEVERITIES.includes(a.severity),
  );

  return (
    <HealthDimensionCard
      dimension={dimension}
      editor={editor}
      footer={
        <>
          {actionableAlerts.length > 0 ? (
            <span className="text-[11px] font-medium text-warning flex items-center gap-1">
              <WarningIcon className="w-3.5 h-3.5 shrink-0" />
              {actionableAlerts.length} alert(s) in this area
            </span>
          ) : (
            <span className="text-[11px] text-text-muted">
              Operating smoothly
            </span>
          )}

          <button
            type="button"
            onClick={() => onOpenEvidence(evidence)}
            className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium cursor-pointer"
          >
            {EVIDENCE_LABEL[evidence]} →
          </button>
        </>
      }
    />
  );
}

function BranchDetailView({
  session,
  branchId,
  period,
  dateFrom,
  dateTo,
  month,
  onBack,
  onOpenEvidence,
  onViewBusinessAlerts,
  canEditWeights,
}: {
  session: Session;
  branchId: string;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  month: string;
  onBack: (() => void) | null;
  onOpenEvidence: (target: EvidenceTarget) => void;
  onViewBusinessAlerts: () => void;
  /** Admin and development accounts may change the weights. */
  canEditWeights: boolean;
}): React.JSX.Element {
  const showToast = useToast();
  const {
    data: fetched,
    isRefreshing,
    failed,
    reload,
  } = useUrlQuery<OverviewData>(
    dashboardUrl("overview", branchId, { period, dateFrom, dateTo, month }),
    session,
    "Branch health detail",
  );
  const data = fetched ?? null;
  // The server keeps weights as fractions of 1; the boxes on the page use 0 to 100.
  const toBoxes = (fractions: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(fractions).map(([key, value]) => [
        key,
        Math.round(value * 1000) / 10,
      ]),
    );
  const fromBoxes = (boxes: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(boxes).map(([key, value]) => [key, value / 100]),
    );
  const emptyWeights: HealthWeightSet = { dimensions: {}, sub_metrics: {} };
  const editing = useHealthWeightEditor({
    saved: data?.weights
      ? {
          dimensions: toBoxes(data.weights.dimensions),
          sub_metrics: toBoxes(data.weights.sub_metrics),
        }
      : emptyWeights,
    defaults: data?.weights
      ? {
          dimensions: toBoxes(data.weights.defaults.dimensions),
          sub_metrics: toBoxes(data.weights.defaults.sub_metrics),
        }
      : emptyWeights,
    dimensions: data?.dimensions ?? [],
    save: async (draft) => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/dashboard/overview/weights`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              dimensions: fromBoxes(draft.dimensions),
              sub_metrics: fromBoxes(draft.sub_metrics),
            }),
          },
        );
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          showToast("error", detail?.detail ?? "Couldn't save the weights.");
          return false;
        }
        // Every branch's score is worked out with these weights, so all of them are read again.
        refreshEverything();
        await reload();
        showToast("success", "Weights saved.");
        return true;
      } catch {
        showToast("error", "Could not save weights. Please check your connection and try again.");
        return false;
      }
    },
  });

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load branch health"
          description="Could not connect to the system. Please check your internet connection and try again."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const actionableAlerts = data.alerts.filter(
    (a) =>
      a.dimension !== "data_quality" &&
      ACTIONABLE_SEVERITIES.includes(a.severity),
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header Row with Back Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs h-8"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
              All Branches
            </Button>
          )}
          <div>
            <h2 className="text-lg font-bold text-text-primary tracking-tight">
              {data.branch_name} Health Overview
            </h2>
            <p className="text-xs text-text-muted">
              {dateRangeLabel(data.date_from, data.date_to)} ·{" "}
              {previousPeriodLabel(period, dateFrom, dateTo, "year_ago")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {actionableAlerts.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onViewBusinessAlerts}
              className="text-xs text-brand hover:text-brand-hover h-8 px-3"
            >
              View in Business Alerts →
            </Button>
          )}
          <RefreshingHint show={isRefreshing} />
          {canEditWeights && <WeightEditControls editing={editing} />}
        </div>
      </div>
      <WeightEditHint editing={editing} />

      {/* 5 Dimension Matrix Cards (2 grids per row) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.dimensions.map((dim) => (
          <DimensionMatrixCard
            key={dim.key}
            dimension={dim}
            alerts={data.alerts}
            onOpenEvidence={onOpenEvidence}
            editor={editing.editorFor(dim)}
          />
        ))}
      </div>
    </div>
  );
}

// ========================================================================================
// 3. Main Exported Component
// ========================================================================================

interface Props {
  session: Session;
  isAdmin: boolean;
  branchOptions: BranchOption[];
  branchId: string;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  month: string;
  canLoad: boolean;
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void;
  onViewBusinessAlerts: () => void;
  openBranchId: string | null;
  onOpenBranchChange: (branchId: string | null) => void;
  /** Opens Wholesale's Health tab. Given only to accounts that can use Wholesale. */
  onOpenWholesale?: () => void;
  /** Admin and development accounts may change the health weights (one set for every branch). */
  canEditWeights?: boolean;
}

export type { EvidenceTarget };

export function OverviewTab({
  session,
  isAdmin,
  branchOptions,
  branchId,
  period,
  dateFrom,
  dateTo,
  month,
  canLoad,
  onOpenEvidence,
  onViewBusinessAlerts,
  openBranchId,
  onOpenBranchChange,
  onOpenWholesale,
  canEditWeights = false,
}: Props): React.JSX.Element {
  if (!canLoad && isAdmin && branchOptions.length === 0) return <></>;

  // When Admin is in All-Branches overview mode
  if (isAdmin && openBranchId === null) {
    return (
      <MultiBranchComparisonView
        session={session}
        branchOptions={branchOptions}
        period={period}
        dateFrom={dateFrom}
        dateTo={dateTo}
        month={month}
        onOpen={onOpenBranchChange}
        onOpenWholesale={onOpenWholesale}
      />
    );
  }

  const shownBranchId = isAdmin ? (openBranchId as string) : branchId;
  return (
    <BranchDetailView
      session={session}
      branchId={shownBranchId}
      period={period}
      dateFrom={dateFrom}
      dateTo={dateTo}
      month={month}
      onBack={isAdmin ? () => onOpenBranchChange(null) : null}
      onOpenEvidence={(target) => onOpenEvidence(target, shownBranchId)}
      onViewBusinessAlerts={onViewBusinessAlerts}
      canEditWeights={canEditWeights}
    />
  );
}

export default OverviewTab;
