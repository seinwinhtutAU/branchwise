import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { fetchJson } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { Pill } from "@renderer/components/ui/Pill";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { Input } from "@renderer/components/ui/Input";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CheckIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
} from "@renderer/components/ui/icons";
import {
  CARRIERS_URL,
  FEE_TYPES_URL,
  PLACES_URL,
  createWholesaleNamedEntity,
  updateWholesaleNamedEntity,
  type WholesaleNamedEntityWire,
} from "../shared/api";
import { WHOLESALE_QUERY_KEYS, invalidateWholesale } from "../shared/queryKeys";
import { useDelayedDelete } from "../shared/useDelayedDelete";

type LogisticsEntityKind = "carriers" | "places" | "fee-types";

interface SectionConfig {
  kind: LogisticsEntityKind;
  title: string;
  description: string;
  url: string;
  idKey: string;
  placeholder: string;
}

const SECTIONS: SectionConfig[] = [
  {
    kind: "carriers",
    title: "Carriers",
    description:
      "Everyone who carries goods: carrier companies and the drivers between two towns. A new one can also be added where it is typed.",
    url: CARRIERS_URL,
    idKey: "carrier_id",
    placeholder: "e.g. Aung Yadana Express or U Ba",
  },
  {
    kind: "fee-types",
    title: "Fee types",
    description:
      "What a transportation cost was for: carrier fee, porters, a second trip. A new kind can also be added where it is typed.",
    url: FEE_TYPES_URL,
    idKey: "fee_type_id",
    placeholder: "e.g. Customs fee",
  },
  {
    kind: "places",
    title: "Places",
    description:
      "Every place goods can be: stops on a route, receiving gates and warehouses. Tick Warehouse for a place that keeps stock: goods counted there are already in stock, and goods counted anywhere else must be moved to a warehouse before they can be given to a customer. A new place can also be added where it is typed.",
    url: PLACES_URL,
    idKey: "place_id",
    placeholder: "e.g. Mandalay 28th Street Gate",
  },
];

function LogisticsSectionCard({
  session,
  config,
}: {
  session: Session;
  config: SectionConfig;
}): React.JSX.Element {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const delayedDelete = useDelayedDelete<WholesaleNamedEntityWire>();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const query = useQuery<WholesaleNamedEntityWire[]>({
    // The table has its own "Show inactive" control, so its data must include
    // inactive entries instead of relying on the API's active-only default.
    queryKey: [...WHOLESALE_QUERY_KEYS.all, config.kind, "including-inactive"],
    queryFn: () =>
      fetchJson<WholesaleNamedEntityWire[]>(
        `${config.url}?active_only=false`,
        session,
      ),
    staleTime: 60_000,
  });

  const rawItems = query.data ?? [];
  const items = showInactive
    ? rawItems
    : rawItems.filter((item) => {
        const id = String(item[config.idKey] ?? item.name ?? "");
        return item.active && !delayedDelete.isPending(id);
      });

  async function handleAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await createWholesaleNamedEntity(session, config.kind, { name: trimmed });
      setNewName("");
      setIsAdding(false);
      await invalidateWholesale(queryClient);
      showToast("success", `${config.title.slice(0, -1)} added.`);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error
          ? err.message
          : `Could not add ${config.title.toLowerCase()}.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(id: string): Promise<void> {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await updateWholesaleNamedEntity(session, config.kind, id, {
        name: trimmed,
      });
      setEditingId(null);
      setEditName("");
      await invalidateWholesale(queryClient);
      showToast("success", "Updated.");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not update.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSetWarehouse(
    id: string,
    isWarehouse: boolean,
  ): Promise<void> {
    setSaving(true);
    try {
      await updateWholesaleNamedEntity(session, config.kind, id, {
        is_warehouse: isWarehouse,
      });
      await invalidateWholesale(queryClient);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : "Could not update.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleToggleActive(
    id: string,
    item: WholesaleNamedEntityWire,
  ): void {
    if (item.active) {
      delayedDelete.scheduleDelete({
        id,
        item,
        label: item.name,
        onDelete: async () => {
          await updateWholesaleNamedEntity(session, config.kind, id, {
            active: false,
          });
          await invalidateWholesale(queryClient);
        },
      });
    } else {
      void (async () => {
        try {
          await updateWholesaleNamedEntity(session, config.kind, id, {
            active: true,
          });
          await invalidateWholesale(queryClient);
          showToast("success", `Activated ${item.name}`);
        } catch (err) {
          showToast(
            "error",
            err instanceof Error ? err.message : "Could not activate.",
          );
        }
      })();
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 mb-4">
        <CardHeader title={config.title} description={config.description} />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-border text-brand focus:ring-brand"
            />
            <span>Show inactive</span>
          </label>
          {!isAdding && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setIsAdding(true);
                setNewName("");
              }}
            >
              <PlusIcon className="w-4 h-4 mr-1" />
              Add
            </Button>
          )}
        </div>
      </div>

      {isAdding && (
        <form
          onSubmit={handleAdd}
          className="flex items-center gap-2 mb-4 p-3 bg-bg-raised rounded-lg border border-border"
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={config.placeholder}
            className="flex-1"
            autoFocus
            disabled={saving}
          />
          <Button size="sm" type="submit" disabled={saving || !newName.trim()}>
            {saving ? (
              <Spinner className="w-4 h-4 mr-1" />
            ) : (
              <CheckIcon className="w-4 h-4 mr-1" />
            )}
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setIsAdding(false);
              setNewName("");
            }}
            disabled={saving}
          >
            <CloseIcon className="w-4 h-4" />
          </Button>
        </form>
      )}

      {query.isLoading && items.length === 0 ? (
        <div className="flex justify-center py-6">
          <Spinner className="w-6 h-6 text-brand" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">
          No entries found.
        </p>
      ) : (
        <TableContainer>
          <Thead>
            <Tr>
              <Th className="w-12 text-center text-text-muted font-normal select-none">
                #
              </Th>
              <Th>Name</Th>
              {config.kind === "places" && (
                <Th className="w-28 text-center">Warehouse</Th>
              )}
              <Th className="w-28 text-center">Status</Th>
              <Th className="w-28 text-right">Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item, idx) => {
              const id = String(item[config.idKey] ?? item.name ?? "");
              const isEditing = editingId === id;
              const isPendingDelete = delayedDelete.isPending(id);
              const isInactive = !item.active || isPendingDelete;

              return (
                <Tr
                  key={id || idx}
                  className={isInactive ? "opacity-60" : undefined}
                >
                  <Td className="text-center text-xs font-mono text-text-muted select-none">
                    {idx + 1}
                  </Td>
                  <Td>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                          disabled={saving}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit(id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => handleSaveEdit(id)}
                          disabled={saving || !editName.trim()}
                        >
                          <CheckIcon className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 px-2"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                        >
                          <CloseIcon className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span
                        className={
                          item.active && !isPendingDelete
                            ? "text-text-primary font-medium"
                            : "text-text-muted line-through"
                        }
                      >
                        {item.name}
                      </span>
                    )}
                  </Td>
                  {config.kind === "places" && (
                    <Td className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`${item.name} is a warehouse`}
                        checked={item.is_warehouse === true}
                        disabled={saving}
                        onChange={(e) =>
                          void handleSetWarehouse(id, e.target.checked)
                        }
                        className="rounded border-border text-brand focus:ring-brand"
                      />
                    </Td>
                  )}
                  <Td className="text-center">
                    <Pill
                      tone={
                        item.active && !isPendingDelete ? "success" : "neutral"
                      }
                      label={
                        item.active && !isPendingDelete ? "Active" : "Inactive"
                      }
                    />
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!isEditing && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setEditingId(id);
                              setEditName(item.name);
                            }}
                          >
                            <PencilIcon className="w-3 h-3 mr-1" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleToggleActive(id, item)}
                          >
                            {item.active && !isPendingDelete
                              ? "Deactivate"
                              : "Reactivate"}
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </TableContainer>
      )}
    </Card>
  );
}

export function WholesaleLogisticsSettings({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => (
        <LogisticsSectionCard
          key={section.kind}
          session={session}
          config={section}
        />
      ))}
    </div>
  );
}
export default WholesaleLogisticsSettings;
