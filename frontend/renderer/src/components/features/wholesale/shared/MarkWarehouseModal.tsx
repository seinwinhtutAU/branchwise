import React, { useMemo, useState } from "react";
import { Modal } from "@renderer/components/ui/Modal";
import { Button } from "@renderer/components/ui/Button";
import { SearchIcon } from "@renderer/components/ui/icons";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import {
  addToList,
  setPlaceWarehouse,
  useNameList,
  useWarehousePlaces,
} from "../masterData/masterData";

export interface MarkWarehouseModalProps {
  open: boolean;
  onClose: () => void;
  /** Current receiving gate location, to highlight with a badge */
  gateLocation?: string;
  /** Optional callback when user picks a place directly as destination */
  onSelectDestination?: (placeName: string) => void;
}

/**
 * A modal to view and manage warehouse designations for all places and receiving gates.
 * Formatted as a clean, structured table allowing single-click toggle and quick destination selection.
 */
export function MarkWarehouseModal({
  open,
  onClose,
  gateLocation,
  onSelectDestination,
}: MarkWarehouseModalProps): React.JSX.Element | null {
  const showToast = useToast();
  const allPlaces = useNameList("places");
  const warehousePlaces = useWarehousePlaces();
  const [search, setSearch] = useState("");
  const [loadingPlace, setLoadingPlace] = useState<string | null>(null);

  const warehouseSet = useMemo(
    () => new Set(warehousePlaces.map((name) => name.toLowerCase())),
    [warehousePlaces],
  );

  const gateNorm = gateLocation?.trim().toLowerCase();

  const filteredPlaces = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...allPlaces].sort((a, b) => {
      // Prioritize current gate first, then warehouses, then alphabetical
      const aIsGate = gateNorm && a.toLowerCase() === gateNorm;
      const bIsGate = gateNorm && b.toLowerCase() === gateNorm;
      if (aIsGate && !bIsGate) return -1;
      if (!aIsGate && bIsGate) return 1;

      const aIsWh = warehouseSet.has(a.toLowerCase());
      const bIsWh = warehouseSet.has(b.toLowerCase());
      if (aIsWh && !bIsWh) return -1;
      if (!aIsWh && bIsWh) return 1;

      return a.localeCompare(b);
    });

    if (!q) return sorted;
    return sorted.filter((name) => name.toLowerCase().includes(q));
  }, [allPlaces, warehouseSet, gateNorm, search]);

  const hasExactMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return allPlaces.some((name) => name.toLowerCase() === q);
  }, [allPlaces, search]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark Places as Warehouse"
      subtitle="Select places to act as warehouses, or choose one directly as destination."
      size="md"
      summary={
        <span className="text-xs text-text-muted">
          {warehousePlaces.length} of {allPlaces.length} places marked as warehouses
        </span>
      }
      actions={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-3 py-0.5">
        {/* Search filter */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search places or gates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg-base py-1.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand transition-colors"
          />
        </div>

        {/* Quick-add place as warehouse if not found */}
        {search.trim() !== "" && !hasExactMatch && (
          <div className="flex items-center justify-between rounded-lg border border-dashed border-border bg-bg-subtle/50 px-3 py-2">
            <span className="text-xs text-text-secondary">
              No place named{" "}
              <span className="font-semibold text-text-primary">
                “{search.trim()}”
              </span>
            </span>
            <Button
              size="sm"
              onClick={async () => {
                const name = search.trim();
                try {
                  const added = await addToList("places", name, {
                    is_warehouse: true,
                  });
                  showToast("success", `Created warehouse “${added}”.`);
                  if (onSelectDestination) {
                    onSelectDestination(added);
                    onClose();
                  }
                } catch (err) {
                  showToast(
                    "error",
                    err instanceof Error ? err.message : "Could not add place.",
                  );
                }
              }}
            >
              + Add as warehouse
            </Button>
          </div>
        )}

        {/* Places Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-bg-base shadow-sm">
          <div className="max-h-[340px] overflow-y-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="sticky top-0 z-10 border-b border-border bg-bg-subtle text-[11px] font-semibold text-text-secondary">
                <tr>
                  <th className="px-3.5 py-2">Place / Gate</th>
                  <th className="w-28 px-3 py-2 text-center">Warehouse</th>
                  {onSelectDestination && (
                    <th className="w-20 px-3.5 py-2 text-right">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredPlaces.length === 0 ? (
                  <tr>
                    <td
                      colSpan={onSelectDestination ? 3 : 2}
                      className="px-4 py-8 text-center text-xs text-text-muted"
                    >
                      No places found matching “{search.trim()}”.
                    </td>
                  </tr>
                ) : (
                  filteredPlaces.map((place) => {
                    const isGate = gateNorm && place.toLowerCase() === gateNorm;
                    const isWarehouse = warehouseSet.has(place.toLowerCase());
                    const busy = loadingPlace === place;

                    return (
                      <tr
                        key={place}
                        className="hover:bg-bg-subtle/40 transition-colors"
                      >
                        {/* Name and Gate Tag */}
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-text-primary">
                              {place}
                            </span>
                            {isGate && (
                              <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                                Current gate
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Warehouse Toggle Checkbox */}
                        <td className="px-3 py-2.5 text-center">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isWarehouse}
                              disabled={busy}
                              onChange={async (e) => {
                                const nextVal = e.target.checked;
                                setLoadingPlace(place);
                                try {
                                  await setPlaceWarehouse(place, nextVal);
                                  showToast(
                                    "success",
                                    nextVal
                                      ? `“${place}” marked as warehouse.`
                                      : `“${place}” unmarked as warehouse.`,
                                  );
                                } catch (err) {
                                  showToast(
                                    "error",
                                    err instanceof Error
                                      ? err.message
                                      : "Could not update place.",
                                  );
                                } finally {
                                  setLoadingPlace(null);
                                }
                              }}
                              className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                            />
                            <span
                              className={cn(
                                "text-xs transition-colors",
                                isWarehouse
                                  ? "font-semibold text-brand"
                                  : "text-text-muted",
                              )}
                            >
                              {isWarehouse ? "Yes" : "No"}
                            </span>
                          </label>
                        </td>

                        {/* Quick Select Destination */}
                        {onSelectDestination && (
                          <td className="px-3.5 py-2.5 text-right">
                            <Button
                              size="sm"
                              variant={isWarehouse ? "secondary" : "ghost"}
                              onClick={async () => {
                                if (!isWarehouse) {
                                  try {
                                    await setPlaceWarehouse(place, true);
                                  } catch {
                                    // non-fatal
                                  }
                                }
                                onSelectDestination(place);
                                showToast(
                                  "success",
                                  `Selected “${place}” as destination.`,
                                );
                                onClose();
                              }}
                              className="text-xs h-6 px-2 font-medium"
                            >
                              Select
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
