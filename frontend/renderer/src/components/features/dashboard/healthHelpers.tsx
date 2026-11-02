import {
  DashboardIcon,
  DollarIcon,
  InventoryIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@renderer/components/ui/icons";
import { STATUS_META, type HealthStatus } from "./helpers";

// Small helpers the Health pages (retail's and wholesale's) share; kept apart from the card
// component so that file only exports a component.

export function renderDimensionIcon(
  key: string,
  className = "w-4 h-4",
): React.JSX.Element {
  switch (key) {
    case "sales":
      return <TrendingUpIcon className={className} />;
    case "profit":
    case "money":
      return <DollarIcon className={className} />;
    case "inventory":
      return <InventoryIcon className={className} />;
    case "customer":
    case "customers":
      return <UsersIcon className={className} />;
    case "data_quality":
      return <ShieldCheckIcon className={className} />;
    default:
      return <DashboardIcon className={className} />;
  }
}

export function statusForScore(score: number | null): HealthStatus | null {
  if (score === null) return null;
  const rounded = Math.round(score);
  if (rounded >= 80) return "healthy";
  if (rounded >= 60) return "needs_attention";
  return "critical";
}

export function scoreTone(score: number | null): string {
  const status = statusForScore(score);
  return status === null ? "text-text-muted" : STATUS_META[status].text;
}
