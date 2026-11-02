import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Button } from "./Button";
import { ChevronLeftIcon } from "./icons";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  children?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
  onBack,
  backLabel = "Back",
  className,
  children,
}: PageHeaderProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-4 mb-6", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={onBack}
                className="gap-1.5 -ml-2 text-text-muted hover:text-text-primary shrink-0"
              >
                <ChevronLeftIcon className="w-4 h-4" />
                <span>{backLabel}</span>
              </Button>
              <div className="h-5 w-px bg-border shrink-0" />
            </>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary truncate">
                {title}
              </h1>
              {badge}
            </div>
            {subtitle && (
              <p className="mt-1 text-sm text-text-muted truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex shrink-0 items-center gap-2 sm:self-center">
            {actions}
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
