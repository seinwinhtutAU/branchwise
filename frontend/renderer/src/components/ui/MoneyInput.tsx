import {
  forwardRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@renderer/lib/utils";
import { numberOfText, useDecimalText } from "@renderer/lib/decimalText";
import { useFieldDensity } from "./fieldDensity";

export interface MoneyInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "size"
> {
  value: number | string;
  onChange: (value: number, raw: string) => void;
  size?: "sm" | "md";
  label?: ReactNode;
  labelClassName?: string;
  error?: string;
  hint?: string;
  currency?: string;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      value,
      onChange,
      size: sizeProp = "md",
      label,
      labelClassName,
      error,
      hint,
      currency = "Ks",
      placeholder = "0",
      className,
      disabled,
      required,
      id,
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

    // What the page holds, as plain text: "" for nothing, "0" for an explicit zero.
    const held = (() => {
      if (value === "" || value === undefined || value === null) return "";
      const num = typeof value === "number" ? value : numberOfText(value);
      if (num === 0) return value === 0 || value === "0" ? "0" : "";
      return String(num);
    })();
    const [focused, setFocused] = useState(false);
    // Kyat amounts keep two decimals. While the box is focused it shows what was typed (so
    // "5." and "5.50" stay as typed); otherwise the amount with thousands separators.
    const decimalText = useDecimalText(
      held,
      (text) => onChange(numberOfText(text), text),
      2,
    );
    const formattedValue = focused
      ? decimalText.text
      : held === "" || held === "0"
        ? held
        : numberOfText(held).toLocaleString("en-US", {
            maximumFractionDigits: 2,
          });

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              "text-xs font-semibold text-text-primary select-none",
              labelClassName,
            )}
          >
            {label}
            {required && <span className="ml-0.5 text-error">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="decimal"
            value={formattedValue}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              decimalText.settle();
            }}
            onChange={(e) => decimalText.change(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            className={cn(
              "w-full rounded-lg border bg-bg-base text-text-primary tabular-nums font-mono text-right",
              size === "sm"
                ? cn("h-8 pl-2.5 pr-8", compact ? "text-[13px]" : "text-xs")
                : "h-10 pl-3 pr-10 text-sm",
              "placeholder:text-text-muted",
              "transition-all duration-150",
              "focus:outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/20",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg-subtle",
              error
                ? "border-error focus:border-error focus:ring-error/20"
                : "border-border hover:border-border-strong",
              className,
            )}
            aria-invalid={!!error}
            {...props}
          />
          {currency && (
            <span
              className={cn(
                "absolute top-1/2 -translate-y-1/2 text-text-muted pointer-events-none select-none font-medium",
                size === "sm" ? "right-2 text-xs" : "right-3 text-sm",
              )}
            >
              {currency}
            </span>
          )}
        </div>
        {error && (
          <p className="text-[11.5px] font-medium text-error">{error}</p>
        )}
        {hint && !error && (
          <p className="text-[11.5px] text-text-muted">{hint}</p>
        )}
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";
