import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { COMPACT_FIELD, useFieldDensity } from "./fieldDensity";

interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  label?: ReactNode;
  labelClassName?: string;
  error?: string;
  hint?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  /** Like endIcon, but clickable (a button inside the field). */
  endAction?: ReactNode;
  size?: "sm" | "md";
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      labelClassName,
      error,
      hint,
      startIcon,
      endIcon,
      endAction,
      size: sizeProp = "md",
      className,
      id,
      required,
      ...props
    },
    ref,
  ) => {
    const compact = useFieldDensity() === "compact";
    const size = compact ? "sm" : sizeProp;
    const inputId =
      id ??
      (typeof label === "string"
        ? label.toLowerCase().replace(/\s+/g, "-")
        : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              "text-xs font-semibold text-text-primary",
              labelClassName,
            )}
          >
            {label}
            {required && <span className="ml-0.5 text-error">*</span>}
          </label>
        )}
        <div className="relative">
          {startIcon && (
            <span
              className={cn(
                "absolute top-1/2 -translate-y-1/2 text-text-muted pointer-events-none",
                size === "sm" ? "left-2.5" : "left-3",
              )}
            >
              {startIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full rounded-lg border bg-bg-base text-text-primary",
              compact
                ? COMPACT_FIELD
                : size === "sm"
                  ? "h-8 px-2.5 text-xs"
                  : "h-10 px-3 text-sm",
              "placeholder:text-text-muted",
              "transition-all duration-150",
              "focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg-subtle",
              error
                ? "border-error focus:border-error focus:ring-error/20"
                : "border-border hover:border-border-strong",
              startIcon && (size === "sm" ? "pl-7" : "pl-9"),
              (endIcon || endAction) && (size === "sm" ? "pr-8" : "pr-10"),
              className,
            )}
            aria-invalid={!!error}
            required={required}
            {...props}
          />
          {endAction && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
              {endAction}
            </span>
          )}
          {endIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {endIcon}
            </span>
          )}
        </div>
        {error && <p className="text-[11.5px] text-error">{error}</p>}
        {hint && !error && (
          <p className="text-[11.5px] text-text-muted">{hint}</p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
