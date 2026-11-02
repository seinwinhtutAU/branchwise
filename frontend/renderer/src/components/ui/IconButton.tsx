import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Spinner } from "./Spinner";

type IconButtonVariant =
  "primary" | "secondary" | "ghost" | "destructive" | "success";

type IconButtonSize = "sm" | "md";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "size" | "aria-label"
> {
  /** Accessible label describing the button action (required) */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const variantStyles: Record<IconButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-hover active:bg-brand-active shadow-sm",
  secondary:
    "bg-bg-base text-text-primary border border-border hover:bg-bg-raised active:bg-bg-subtle",
  ghost:
    "text-text-muted hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
  destructive:
    "bg-error text-white hover:bg-red-700 active:bg-red-800 shadow-sm",
  success:
    "bg-success text-white hover:opacity-90 active:opacity-100 shadow-sm",
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: "h-7 w-7 text-xs rounded-md",
  md: "h-8 w-8 text-sm rounded-md",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      variant = "ghost",
      size = "md",
      loading = false,
      className,
      children,
      disabled,
      title,
      type = "button",
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={title ?? label}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center shrink-0 transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          "active:scale-[0.98] motion-reduce:active:scale-100",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {loading ? <Spinner className="w-3.5 h-3.5" /> : children}
      </button>
    );
  },
);
IconButton.displayName = "IconButton";
