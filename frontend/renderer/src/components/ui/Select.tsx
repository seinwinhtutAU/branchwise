import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { useFieldDensity } from "./fieldDensity";

interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "size"
> {
  label?: ReactNode;
  labelClassName?: string;
  error?: string;
  size?: "sm" | "md";
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      labelClassName,
      error,
      size: sizeProp = "md",
      className,
      id,
      children,
      required,
      ...props
    },
    ref,
  ) => {
    const compact = useFieldDensity() === "compact";
    const size = compact ? "sm" : sizeProp;
    const selectId =
      id ??
      (typeof label === "string"
        ? label.toLowerCase().replace(/\s+/g, "-")
        : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
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
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "w-full rounded-lg border bg-bg-base text-text-primary appearance-none",
              size === "sm"
                ? cn("h-8 pl-2.5 pr-7", compact ? "text-[13px]" : "text-xs")
                : "h-10 pl-3 pr-9 text-sm",
              "transition-all duration-150",
              "focus:outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/20",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg-subtle",
              error
                ? "border-error focus:border-error focus:ring-error/20"
                : "border-border hover:border-border-strong",
              className,
            )}
            aria-invalid={!!error}
            required={required}
            {...props}
          >
            {children}
          </select>
          <svg
            className={cn(
              "absolute top-1/2 -translate-y-1/2 text-text-muted pointer-events-none",
              size === "sm" ? "right-2 w-3.5 h-3.5" : "right-3 w-4 h-4",
            )}
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        {error && <p className="text-[11.5px] text-error">{error}</p>}
      </div>
    );
  },
);
Select.displayName = "Select";
