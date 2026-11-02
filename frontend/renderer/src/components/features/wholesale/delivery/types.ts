import { type ShipmentStatus } from "@renderer/components/features/wholesale/delivery/shipments";

export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  waiting_at_cargo: "At carrier",
  in_transit: "On the way",
  partly_delivered: "Partly arrived",
  completed: "Arrived",
};

export const STATUS_STYLES: Record<
  ShipmentStatus,
  { bg: string; dot: string }
> = {
  waiting_at_cargo: {
    bg: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  },
  in_transit: {
    bg: "bg-brand-subtle text-brand border border-brand-pill",
    dot: "bg-brand",
  },
  partly_delivered: {
    bg: "bg-warning-subtle text-warning border border-warning-pill",
    dot: "bg-warning",
  },
  completed: {
    bg: "bg-success-subtle text-success border border-success-pill",
    dot: "bg-success",
  },
};
