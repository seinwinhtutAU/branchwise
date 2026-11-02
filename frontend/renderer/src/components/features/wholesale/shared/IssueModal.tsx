import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { Spinner } from "@renderer/components/ui/Spinner";
import { Modal, ModalSection } from "@renderer/components/ui/Modal";
import { CheckIcon, PlusIcon, TrashIcon } from "@renderer/components/ui/icons";
import type { Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { formatDate, parseColorQty } from "./shared";
import { WholesaleApiError } from "./apiClient";
import { PresetColorPicker } from "../orders/PresetColorPicker";
import { ColorQuantityChips } from "./ColorQuantityChips";
import { colorPairsForText } from "../inventory/stock";
import {
  createIssue,
  deleteIssueRecord,
  formatIssueType,
  getIssueTypeOptions,
  listIssueRecords,
  resolveIssueRecord,
  type IssueRecord,
} from "./issuesApi";
import { WHOLESALE_QUERY_KEYS } from "./queryKeys";

const inputClass =
  "min-h-20 rounded-lg border border-border px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all duration-150 hover:border-border-strong focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20 bg-bg-base";

/**
 * Lightweight button to open Create Issue modal.
 */
export function CreateIssueButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-bg-base px-2 py-0.5 text-xs font-medium text-text-secondary hover:border-border-strong hover:bg-bg-subtle hover:text-text-primary transition-colors",
        className,
      )}
      title="Create an issue"
    >
      <PlusIcon className="h-3 w-3" />
      <span>Create issue</span>
    </button>
  );
}

/**
 * Header badge displaying issue count (e.g. "Issues 2").
 * Clicking opens the Issue history modal. Automatic quantity_change records are excluded.
 */
export function IssueHistoryBadge({
  session,
  reference,
  onOpen,
}: {
  session: Session;
  reference: string;
  onOpen: () => void;
}): React.JSX.Element | null {
  const recordsQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.writeOffs, reference],
    queryFn: () => listIssueRecords(session, reference),
  });

  const manualIssues = (recordsQuery.data ?? []).filter(
    (record) =>
      record.reference === reference && record.record_type !== "quantity_change",
  );
  const count = manualIssues.length;
  if (count === 0) return null;

  const hasOpen = manualIssues.some((record) => record.status !== "resolved");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors",
        hasOpen
          ? "border-warning/40 bg-warning-subtle text-warning hover:bg-warning-subtle/70"
          : "border-border bg-bg-subtle text-text-secondary hover:bg-bg-raised hover:text-text-primary",
      )}
      title="View issue history"
    >
      Issues {count}
    </button>
  );
}

export interface CreateIssueModalProps {
  session: Session;
  referenceType: "voucher" | "order" | "shipment";
  referenceId: string;
  referenceNumber: string;
  subtitle?: string;
  context?: "voucher" | "shipment" | "order" | "delivery";
  lines?: {
    id: string;
    stock_code: string;
    description: string;
    unit?: string;
    color_breakdown?: string;
  }[];
  initialLineId?: string;
  defaultUnit?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Modal to manually create an issue against a voucher, order, or shipment.
 */
export function CreateIssueModal({
  session,
  referenceType,
  referenceId,
  referenceNumber,
  subtitle,
  context,
  lines,
  initialLineId,
  defaultUnit,
  onClose,
  onSuccess,
}: CreateIssueModalProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const options = getIssueTypeOptions(context || referenceType);
  const [issueType, setIssueType] = useState(options[0]?.value || "other");
  const [subjectId, setSubjectId] = useState(initialLineId || "");
  const [colorBreakdown, setColorBreakdown] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const selectedLine = lines?.find((l) => l.id === subjectId);
  const unitLabel =
    selectedLine?.unit ||
    defaultUnit ||
    (referenceType === "shipment" ? "packages" : "sets");

  async function handleCreate(): Promise<void> {
    if (!note.trim()) {
      setError("Please enter a note explaining what happened.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const totalFromColors = parseColorQty(colorBreakdown).reduce(
        (sum, item) => sum + item.qty,
        0,
      );
      const finalQuantity = colorBreakdown.trim()
        ? totalFromColors
        : quantity
          ? parseInt(quantity, 10)
          : undefined;

      await createIssue(session, {
        reference_type: referenceType,
        reference_id: referenceId,
        issue_type: issueType,
        subject_type: selectedLine
          ? "product"
          : context === "delivery"
            ? "delivery"
            : referenceType === "shipment"
              ? "package"
              : "general",
        subject_id: subjectId || undefined,
        color_breakdown: colorBreakdown.trim() || undefined,
        affected_quantity: finalQuantity,
        note: note.trim(),
      });
      await queryClient.invalidateQueries({
        queryKey: WHOLESALE_QUERY_KEYS.all,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof WholesaleApiError
          ? err.message
          : "Could not create issue.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Create issue"
      subtitle={subtitle ?? referenceNumber}
      size="md"
      onClose={onClose}
      error={error}
      busy={saving}
      actions={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={saving}
            disabled={!note.trim()}
            onClick={() => void handleCreate()}
          >
            Create issue
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        <Select
          label="Type"
          value={issueType}
          onChange={(e) => setIssueType(e.target.value)}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        {lines && lines.length > 0 && (
          <Select
            label="Product (optional)"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            <option value="">General / Entire document</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.stock_code} · {l.description}
              </option>
            ))}
          </Select>
        )}

        {selectedLine ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-text-primary">
                Colors affected{" "}
                <span className="font-normal text-text-muted">(pick colors, optional)</span>
              </label>
              {colorBreakdown.trim() && (
                <button
                  type="button"
                  onClick={() => setColorBreakdown("")}
                  className="text-[11px] text-text-muted hover:text-text-primary"
                >
                  Clear colors
                </button>
              )}
            </div>
            <PresetColorPicker
              value={colorBreakdown}
              unit="set"
              showUnit={false}
              allowed={
                selectedLine.color_breakdown
                  ? colorPairsForText(selectedLine.color_breakdown, "set")
                  : undefined
              }
              className="border border-border rounded-xl p-3 bg-bg-subtle/30"
              onChange={(next) => setColorBreakdown(next)}
            />
            {colorBreakdown.trim() && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-text-muted">Selected:</span>
                <ColorQuantityChips breakdown={colorBreakdown} unit="set" />
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-xs font-semibold text-text-primary">
              Affected quantity{" "}
              <span className="font-normal text-text-muted">optional</span>
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                placeholder="e.g. 2"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-32"
              />
              <span className="text-xs text-text-secondary">{unitLabel}</span>
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1.5 text-xs font-semibold text-text-primary">
          Note <span className="font-normal text-text-muted">(required)</span>
          <textarea
            className={inputClass}
            placeholder="Explain what happened..."
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

export interface IssueHistoryModalProps {
  session: Session;
  referenceNumber: string;
  subtitle?: string;
  onClose: () => void;
  onOpenCreate?: () => void;
}

/**
 * Modal to view manual issues and mark them resolved.
 */
export function IssueHistoryModal({
  session,
  referenceNumber,
  subtitle,
  onClose,
  onOpenCreate,
}: IssueHistoryModalProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  const recordsQuery = useQuery({
    queryKey: [...WHOLESALE_QUERY_KEYS.writeOffs, referenceNumber],
    queryFn: () => listIssueRecords(session, referenceNumber),
  });

  const manualIssues = (recordsQuery.data ?? []).filter(
    (record) =>
      record.reference === referenceNumber &&
      record.record_type !== "quantity_change",
  );

  async function handleResolve(issue: IssueRecord): Promise<void> {
    setBusyId(issue.id || issue.write_off_id);
    setError(undefined);
    try {
      await resolveIssueRecord(session, issue.id || issue.write_off_id);
      await queryClient.invalidateQueries({
        queryKey: WHOLESALE_QUERY_KEYS.all,
      });
      showToast("success", "Issue marked as resolved.");
    } catch (err) {
      setError(
        err instanceof WholesaleApiError
          ? err.message
          : "Could not mark issue resolved.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(issue: IssueRecord): Promise<void> {
    setBusyId(issue.id || issue.write_off_id);
    setError(undefined);
    try {
      await deleteIssueRecord(session, issue.id || issue.write_off_id);
      await queryClient.invalidateQueries({
        queryKey: WHOLESALE_QUERY_KEYS.all,
      });
      showToast("success", "Issue removed.");
    } catch (err) {
      setError(
        err instanceof WholesaleApiError
          ? err.message
          : "Could not remove issue.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      title="Issues"
      subtitle={subtitle ?? referenceNumber}
      size="lg"
      onClose={onClose}
      error={error}
      actions={
        onOpenCreate ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpenCreate}
          >
            + Create issue
          </Button>
        ) : undefined
      }
    >
      <ModalSection
        title={`History (${manualIssues.length})`}
        hint="Manually recorded exceptions and anomalies."
      >
        {manualIssues.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">
            No issues recorded.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-bg-base">
            {manualIssues.map((issue) => {
              const issueId = issue.id || issue.write_off_id;
              const isResolved = issue.status === "resolved";
              const isBusy = busyId === issueId;
              const qtyPart =
                issue.affected_quantity != null && issue.affected_quantity > 0
                  ? `${issue.affected_quantity} ${issue.unit} · `
                  : "";
              const datePart = issue.created_at
                ? formatDate(issue.created_at)
                : "";

              return (
                <div
                  key={issueId}
                  className={cn(
                    "flex flex-col gap-1.5 p-3.5 hover:bg-bg-subtle/30 transition-colors",
                    isBusy && "opacity-50 pointer-events-none",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary">
                        {formatIssueType(issue.issue_type || issue.reason || "")}
                      </span>
                      {isResolved ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          <CheckIcon className="h-3 w-3" />
                          Resolved
                        </span>
                      ) : (
                        <span className="rounded-full border border-warning/40 bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-warning">
                          Open
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!isResolved && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={isBusy}
                          onClick={() => void handleResolve(issue)}
                        >
                          Mark resolved
                        </Button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDelete(issue)}
                        className="rounded p-1 text-text-muted hover:bg-error-subtle hover:text-error transition-colors"
                        title="Remove issue"
                      >
                        {isBusy ? (
                          <Spinner className="h-3.5 w-3.5 text-error" />
                        ) : (
                          <TrashIcon className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    {issue.stock_code ? (
                      <span className="font-semibold text-text-primary">
                        {issue.stock_code}
                      </span>
                    ) : null}
                    {issue.color_breakdown ? (
                      <ColorQuantityChips
                        breakdown={issue.color_breakdown}
                        unit="set"
                      />
                    ) : qtyPart ? (
                      <span>{qtyPart}</span>
                    ) : null}
                    <span>· {datePart}</span>
                  </div>

                  <p className="text-xs text-text-secondary whitespace-pre-wrap">
                    {issue.note}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </ModalSection>
    </Modal>
  );
}

/**
 * Combined / backwards-compatible IssueModal.
 * Displays history with a fast button to create an issue.
 */
export function IssueModal({
  session,
  reference,
  subtitle,
  lines,
  packages,
  onClose,
}: {
  session: Session;
  reference: string;
  subtitle?: string;
  lines?: {
    id: string;
    stock_code: string;
    description: string;
    unit?: string;
  }[];
  packages?: { subjectId: string; remaining: number };
  initialLineId?: string;
  onCreate?: (subjectId: string, input: unknown) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [creating, setCreating] = useState(false);

  if (creating) {
    return (
      <CreateIssueModal
        session={session}
        referenceType={
          packages ? "shipment" : lines ? "voucher" : "order"
        }
        referenceId={packages?.subjectId || reference}
        referenceNumber={reference}
        subtitle={subtitle}
        lines={lines}
        onClose={() => setCreating(false)}
        onSuccess={() => setCreating(false)}
      />
    );
  }

  return (
    <IssueHistoryModal
      session={session}
      referenceNumber={reference}
      subtitle={subtitle}
      onClose={onClose}
      onOpenCreate={() => setCreating(true)}
    />
  );
}
