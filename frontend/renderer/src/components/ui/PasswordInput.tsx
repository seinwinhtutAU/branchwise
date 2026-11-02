import { forwardRef, useState, type ComponentProps } from "react";
import { Input } from "./Input";
import { EyeIcon, EyeOffIcon } from "./icons";

type PasswordInputProps = Omit<
  ComponentProps<typeof Input>,
  "type" | "endIcon" | "endAction"
>;

// A password field with an eye button inside it that shows or hides what was typed.
// Hidden again whenever the field is remounted (for example a dialog reopening).
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  (props, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <Input
        {...props}
        ref={ref}
        type={visible ? "text" : "password"}
        endAction={
          <button
            type="button"
            tabIndex={-1}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
          >
            {visible ? (
              <EyeOffIcon className="h-4 w-4" />
            ) : (
              <EyeIcon className="h-4 w-4" />
            )}
          </button>
        }
      />
    );
  },
);
PasswordInput.displayName = "PasswordInput";
