import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  labelClassName,
  children,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className={cn(
            "text-xs font-semibold text-text-primary select-none",
            labelClassName,
          )}
        >
          {label}
          {required && <span className="ml-0.5 text-error">*</span>}
        </label>
      )}
      {children}
      {error && (
        <p role="alert" className="text-[11.5px] font-medium text-error">
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-[11.5px] text-text-muted">{hint}</p>
      )}
    </div>
  );
}
