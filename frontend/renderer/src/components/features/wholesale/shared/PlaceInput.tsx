import React, { useMemo } from "react";
import { useToast } from "@renderer/lib/useToast";
import { SettingsIcon } from "@renderer/components/ui/icons";
import { NamedInput } from "./NamedInput";
import { SuggestInput, type SuggestionEntry } from "./formFields";
import {
  addToList,
  setPlaceWarehouse,
  useNameList,
  useWarehousePlaces,
} from "../masterData/masterData";

export interface PlaceInputProps
  extends Omit<
    React.ComponentProps<typeof SuggestInput>,
    "suggestions" | "onAddNew" | "addLabel"
  > {
  /** When true, this picker targets warehouses, with smart in-place upgrading of existing places */
  asWarehouse?: boolean;
  /** Current receiving gate location, shown as a selectable destination option for self-transfers */
  gateLocation?: string;
  /** Callback to open the full place-as-warehouse management dialog */
  onManagePlaces?: () => void;
  /** Custom extra action rendered to the right of the input label */
  headerAction?: React.ReactNode;
  /** Names left out of choices */
  exclude?: string[];
  /** Shows these names first */
  prioritize?: readonly string[];
  /** Extra fields for creating a new named entity */
  addExtra?: { is_warehouse?: boolean };
  /** Custom label for adding a new place */
  addLabel?: string;
}

/**
 * A box for picking a place (receiving gate, stop, or warehouse).
 * When `asWarehouse` is true, it shows only warehouses and the current gate by default,
 * while allowing non-warehouse places to be upgraded in-place with a single click,
 * and linking to the place-warehouse management modal.
 */
export function PlaceInput({
  asWarehouse = false,
  gateLocation,
  onManagePlaces,
  headerAction,
  exclude,
  prioritize,
  addLabel,
  footer,
  label,
  ...props
}: PlaceInputProps): React.JSX.Element {
  const showToast = useToast();
  const allPlaces = useNameList("places");
  const warehousePlaces = useWarehousePlaces();

  if (!asWarehouse) {
    return (
      <NamedInput
        {...props}
        label={label}
        list="places"
        noun="place"
        exclude={exclude}
        prioritize={prioritize}
        addExtra={props.addExtra}
      />
    );
  }

  const query = (props.value ?? "").trim().toLowerCase();
  const warehouseSet = useMemo(
    () => new Set(warehousePlaces.map((name) => name.toLowerCase())),
    [warehousePlaces],
  );

  const suggestions: SuggestionEntry[] = useMemo(() => {
    const list: SuggestionEntry[] = [];
    const gateNormalized = gateLocation?.trim().toLowerCase();

    // 1. Current gate option (if provided)
    if (gateLocation) {
      list.push({
        value: gateLocation,
        badge: "Current gate",
      });
    }

    // 2. Warehouses (excluding gateLocation if already added above)
    for (const name of warehousePlaces) {
      if (gateNormalized && name.trim().toLowerCase() === gateNormalized) {
        continue;
      }
      if (exclude?.includes(name)) continue;
      list.push(name);
    }

    // 3. When the user types a query, also offer matching non-warehouse places with upgrade badge
    if (query !== "") {
      for (const name of allPlaces) {
        const norm = name.trim().toLowerCase();
        if (norm === gateNormalized) continue;
        if (warehouseSet.has(norm)) continue;
        if (exclude?.includes(name)) continue;
        if (norm.includes(query)) {
          list.push({
            value: name,
            badge: "⚡ Set as warehouse",
            onSelect: () => {
              void setPlaceWarehouse(name, true)
                .then(() => {
                  showToast("success", `Marked “${name}” as warehouse.`);
                  props.onChange(name);
                })
                .catch((err) => {
                  showToast(
                    "error",
                    err instanceof Error ? err.message : "Could not update place.",
                  );
                });
            },
          });
        }
      }
    }

    return list;
  }, [
    gateLocation,
    warehousePlaces,
    allPlaces,
    query,
    warehouseSet,
    exclude,
    props.onChange,
    showToast,
  ]);

  const resolvedLabel = label ? (
    headerAction || onManagePlaces ? (
      <span className="flex items-center justify-between w-full">
        <span>{label}</span>
        {headerAction ?? (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onManagePlaces?.();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onManagePlaces?.();
            }}
            className="text-[11px] font-normal text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <SettingsIcon className="h-3 w-3" />
            <span>Mark place as warehouse</span>
          </button>
        )}
      </span>
    ) : (
      label
    )
  ) : undefined;

  return (
    <SuggestInput
      {...props}
      label={resolvedLabel}
      suggestions={suggestions}
      addLabel={addLabel ?? "Add new warehouse"}
      onAddNew={async (name) => {
        try {
          const added = await addToList("places", name, { is_warehouse: true });
          showToast("success", `Created warehouse “${added}”.`);
          props.onChange(added);
          return added;
        } catch (err: unknown) {
          showToast(
            "error",
            err instanceof Error ? err.message : "Could not add warehouse.",
          );
          throw err;
        }
      }}
      footer={footer}
    />
  );
}
