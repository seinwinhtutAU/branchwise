import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import {
  DotPill,
  FloatingLayer,
  MenuItem,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  EyeIcon,
  MoreVerticalIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import { onlyDigits } from "@renderer/components/features/wholesale/shared/shared";
import {} from "@renderer/components/features/wholesale/shared/api";
import {
  type Shipment,
  type ShipmentStatus,
} from "@renderer/components/features/wholesale/delivery/shipments";
import { STATUS_LABELS, STATUS_STYLES } from "./types";

export function StatusBadge({
  status,
}: {
  status: ShipmentStatus;
}): React.JSX.Element {
  const style = STATUS_STYLES[status];
  return (
    <DotPill
      label={STATUS_LABELS[status]}
      className={style.bg}
      dotClassName={style.dot}
    />
  );
}

/** A row's own actions. Deleting asks a second time inside the menu, with FSM guards. */
export function RowMenu({
  shipment,
  onOpen,
  onDelete,
}: {
  shipment?: Shipment;
  onOpen: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const canDelete = shipment?.allowed_actions
    ? shipment.allowed_actions.includes("delete")
    : true;

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Shipment actions"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          <MenuItem
            icon={<EyeIcon className="w-4 h-4" />}
            label="View & edit"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          />
          {canDelete ? (
            <MenuItem
              icon={<TrashIcon className="w-4 h-4" />}
              label="Delete shipment"
              danger
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            />
          ) : (
            <div
              className="px-3.5 py-2 text-xs text-text-muted flex items-center gap-2 cursor-not-allowed opacity-60"
              title="Cannot delete shipment with recorded arrival or when completed"
            >
              <TrashIcon className="w-4 h-4 text-text-muted" />
              <span>Cannot delete (locked)</span>
            </div>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

export function PackageInput({
  label,
  value,
  max,
  onChange,
  className,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  /** Lets compact cards use the same numeric input with their own type scale. */
  className?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      // A text box is ~20 characters wide by default, which would keep the column wide.
      size={1}
      aria-label={label}
      value={draft}
      onChange={(event) => {
        const digits = onlyDigits(event.target.value);
        setDraft(digits);
        if (digits === "") return;
        onChange(Math.min(Number(digits), max));
      }}
      onBlur={() => setDraft(String(value))}
      className={cn(
        // Spreadsheet-style: fills the whole cell, no box until it is selected.
        "block h-full min-h-9 w-full min-w-0 bg-transparent px-2 text-center text-sm font-bold tabular-nums text-text-primary",
        "focus:outline-none focus:[outline:2px_solid_var(--color-brand)] focus:[outline-offset:-2px]",
        className,
      )}
    />
  );
}
