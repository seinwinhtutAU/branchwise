import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@renderer/lib/useToast";

export interface PendingDeleteRecord<T> {
  id: string;
  item: T;
  label: string;
  timerId: ReturnType<typeof setTimeout>;
  onDelete: (item: T) => Promise<void>;
  onUndo?: (item: T) => void;
}

export interface ScheduleDeleteOptions<T> {
  id: string;
  item: T;
  label?: string;
  onDelete: (item: T) => Promise<void>;
  onUndo?: (item: T) => void;
  /** What happened, for the message: "deleted" (a whole record), "removed" (a row), "cancelled". */
  verb?: "deleted" | "removed" | "cancelled";
  delayMs?: number;
}

export interface DelayedDelete<T> {
  isPending: (id: string) => boolean;
  /** `I` is inferred from each call, so one hook can schedule items of different kinds. */
  scheduleDelete: <I = T>(options: ScheduleDeleteOptions<I>) => void;
  cancelDelete: (id: string) => void;
  flushAll: () => Promise<void>;
}

export function useDelayedDelete<T = unknown>(
  defaultDelayMs = 8000,
): DelayedDelete<T> {
  const showToast = useToast();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingMapRef = useRef<Map<string, PendingDeleteRecord<T>>>(new Map());

  const cancelDelete = useCallback(
    (id: string) => {
      const record = pendingMapRef.current.get(id);
      if (!record) return;
      clearTimeout(record.timerId);
      pendingMapRef.current.delete(id);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (record.onUndo) {
        record.onUndo(record.item);
      }
      showToast("info", `Restored ${record.label}`);
    },
    [showToast],
  );

  const executeDelete = useCallback(
    async (id: string) => {
      const record = pendingMapRef.current.get(id);
      if (!record) return;
      pendingMapRef.current.delete(id);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        await record.onDelete(record.item);
      } catch (err) {
        showToast(
          "error",
          err instanceof Error
            ? err.message
            : `Could not delete ${record.label}`,
        );
        if (record.onUndo) {
          record.onUndo(record.item);
        }
      }
    },
    [showToast],
  );

  const scheduleDelete = useCallback(
    <I = T>({
      id,
      item,
      label,
      onDelete,
      onUndo,
      verb = "deleted",
      delayMs = defaultDelayMs,
    }: ScheduleDeleteOptions<I>): void => {
      // If already pending, clear old timer
      const existing = pendingMapRef.current.get(id);
      if (existing) {
        clearTimeout(existing.timerId);
      }

      const itemLabel = label || "Item";

      const timerId = setTimeout(() => {
        void executeDelete(id);
      }, delayMs);

      pendingMapRef.current.set(id, {
        id,
        item,
        label: itemLabel,
        timerId,
        onDelete,
        onUndo,
      } as unknown as PendingDeleteRecord<T>);

      setPendingIds((prev) => new Set(prev).add(id));

      showToast("info", `${itemLabel} ${verb}`, {
        action: {
          label: "Undo",
          onClick: () => cancelDelete(id),
        },
        durationMs: delayMs,
      });
    },
    [cancelDelete, defaultDelayMs, executeDelete, showToast],
  );

  const flushAll = useCallback(async () => {
    const records = Array.from(pendingMapRef.current.values());
    for (const record of records) {
      clearTimeout(record.timerId);
      pendingMapRef.current.delete(record.id);
      try {
        await record.onDelete(record.item);
      } catch {
        // Best effort flush
      }
    }
    setPendingIds(new Set());
  }, []);

  // Flush on unmount and beforeunload
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      void flushAll();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void flushAll();
    };
  }, [flushAll]);

  const isPending = useCallback(
    (id: string) => pendingIds.has(id),
    [pendingIds],
  );

  return {
    isPending,
    scheduleDelete,
    cancelDelete,
    flushAll,
  };
}
