import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export type PillTone = "neutral" | "brand" | "warning" | "success" | "error";
type PillSize = "sm" | "md";

export interface PillProps {
  tone?: PillTone;
  dot?: boolean;
  size?: PillSize;
  label?: ReactNode;
  children?: ReactNode;
  title?: string;
  className?: string;
  dotClassName?: string;
}

const toneStyles: Record<PillTone, { pill: string; dot: string }> = {
  neutral: {
    pill: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  },
  brand: {
    pill: "bg-brand-subtle text-brand border border-brand-pill",
    dot: "bg-brand",
  },
  warning: {
    pill: "bg-warning-subtle text-warning border border-warning-pill",
    dot: "bg-warning",
  },
  success: {
    pill: "bg-success-subtle text-success border border-success-pill",
    dot: "bg-success",
  },
  error: {
    pill: "bg-error-subtle text-error border border-error-pill",
    dot: "bg-error",
  },
};

const sizeStyles: Record<PillSize, { pill: string; dot: string }> = {
  sm: {
    pill: "px-2 py-0.5 text-[11px] gap-1",
    dot: "w-1 h-1",
  },
  md: {
    pill: "px-2.5 py-0.5 text-xs gap-1.5",
    dot: "w-1.5 h-1.5",
  },
};

export function Pill({
  tone = "neutral",
  dot = true,
  size = "md",
  label,
  children,
  title,
  className,
  dotClassName,
}: PillProps): React.JSX.Element {
  const content = children ?? label;
  const currentTone = toneStyles[tone];
  const currentSize = sizeStyles[size];

  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full font-semibold whitespace-nowrap select-none",
        currentTone.pill,
        currentSize.pill,
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "rounded-full shrink-0",
            currentTone.dot,
            currentSize.dot,
            dotClassName,
          )}
        />
      )}
      {content}
    </span>
  );
}
