import { useEffect, useRef, useState } from "react";
import { NamedInput } from "../shared/NamedInput";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { EDITABLE } from "@renderer/components/features/wholesale/shared/ui";
import { type SaveControl } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {
  gateStops,
  addLink,
  insertOnLink,
  insertStop,
  newStop,
  normaliseFlow,
  packagesAvailableToSend,
  packagesSentFrom,
  removeStop,
  withCargoSent,
  shipmentPairs,
  type Shipment,
  type ShipmentStop,
} from "@renderer/components/features/wholesale/delivery/shipments";
import { useWholesale } from "@renderer/components/features/wholesale/shared/store";
import { DestinationForm } from "./DestinationForm";
import { ShipmentMap, type GateCount, type MapDelivery } from "./ShipmentMap";

/** The fields a save would send, as one string: two shipments with the same one are the same. */
function fingerprint(shipment: Shipment): string {
  return JSON.stringify([
    shipment.carrier_name,
    shipment.sent_on,
    shipment.total_packages,
    shipment.packages_sent_by_cargo,
    shipment.stops.map((stop) => [
      stop.stop_id,
      stop.parent_stop_id,
      stop.stop_name,
      stop.carrier_name,
      // What a counted place received is the count's to say, not something typed here.
      stop.counted ? 0 : stop.packages_received,
      stop.packages_sent,
      stop.package_change_kind,
      stop.packages_after_change,
      stop.is_gate,
      stop.extra_parents ?? [],
    ]),
  ]);
}

/** The draft with every place that has been counted taken from the server copy. */
function withCountedFrom(draft: Shipment, server: Shipment): Shipment {
  const counted = new Map(
    server.stops
      .filter((stop) => stop.counted)
      .map((stop) => [stop.stop_id, stop]),
  );
  if (counted.size === 0) return draft;
  return {
    ...draft,
    stops: draft.stops.map((stop) => {
      const fromServer = counted.get(stop.stop_id);
      return fromServer
        ? {
            ...stop,
            counted: true,
            packages_received: fromServer.packages_received,
          }
        : stop;
    }),
  };
}

/** What the strip under the diagram is asking for. */
type Editing =
  | { kind: "insert"; parentId: string | null; childId: string }
  | { kind: "insertLink"; fromId: string; toId: string }
  | { kind: "route"; fromId: string | null }
  | null;

/** In the compact layout a field's label sits beside it instead of above it. */
function InlineField({
  label,
  required = true,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="whitespace-nowrap text-[11px] font-semibold text-text-secondary">
        {label}
        {required && <span className="text-error"> *</span>}
      </span>
      {children}
    </div>
  );
}

/**
 * One shipment of a supplier voucher, shown inside the voucher's "On the way" tab: its
 * cargo, date and packages, and the route map of every shipment of the voucher with this one
 * open for editing. A save bar tells the page when something has changed.
 */
export function ShipmentDetail({
  shipment: serverShipment,
  onSave,
  actions,
  onSaveControl,
  onOpenCount,
  onDraftChange,
  siblings,
  onSelectShipment,
  counts,
  delivery,
}: {
  shipment: Shipment;
  /** Saves the shipment; the saved copy comes back when the server has it. */
  onSave: (shipment: Shipment) => Promise<Shipment | void>;
  /** Buttons shown at the right end of the fields row. */
  actions?: React.ReactNode;
  /** Reports the unsaved state so the page can own the Save button. */
  onSaveControl?: (control: SaveControl) => void;
  /** Go to where a counted place's packages are opened and counted (the voucher's gate tab). */
  onOpenCount?: (stopId: string) => void;
  /** The version on screen while it has unsaved edits, else null. */
  onDraftChange?: (draft: Shipment | null) => void;
  /** Every shipment of the voucher, drawn on the map together with this one. */
  siblings?: Shipment[];
  /** Another shipment was clicked on the map. */
  onSelectShipment?: (shipmentId: string) => void;
  /** What each counted place has counted so far, by stop id. */
  counts?: Record<string, GateCount>;
  /** What can be delivered from a gate or warehouse. */
  delivery?: MapDelivery;
}): React.JSX.Element {
  const showToast = useToast();
  const [draft, setDraft] = useState<Shipment>(serverShipment);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  // The strip that names a new stop or route opens under the map: bring it into view.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) formRef.current?.scrollIntoView({ block: "nearest" });
  }, [editing]);
  const { vouchers } = useWholesale();

  const dirty = fingerprint(draft) !== fingerprint(serverShipment);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // The form starts over from the server copy when it changes, unless the user has edits in
  // it (a count at the gate refreshes the shipment too, and must not wipe them).
  const shownId = useRef(serverShipment.shipment_id);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // The server copy the form last matched. Edits are what the form has beyond *that*: comparing
  // it with the copy that has just arrived would call every server-side change (a count at the
  // gate moves the packages on the route) an edit, and the form would then never catch up and
  // keep asking "Leave without saving?" after everything was saved.
  const syncedKey = useRef(fingerprint(serverShipment));
  useEffect(() => {
    // Another shipment was chosen (the page has already asked about unsaved edits).
    const switched = shownId.current !== serverShipment.shipment_id;
    shownId.current = serverShipment.shipment_id;
    if (switched) setEditing(null);
    const edited = fingerprint(draftRef.current) !== syncedKey.current;
    syncedKey.current = fingerprint(serverShipment);
    if (switched || !edited) setDraft(serverShipment);
    // Edits are kept, but a place that has since been counted takes the count's figure: a number
    // typed for it before the count began no longer means anything, and would otherwise sit
    // there as a "change" that cannot be edited away.
    else setDraft((current) => withCountedFrom(current, serverShipment));
  }, [serverShipment]);

  // Every shipment of the voucher for the diagram, this one as it is on screen.
  const lanes = (siblings ?? [serverShipment]).map((other) =>
    other.shipment_id === draft.shipment_id ? draft : other,
  );

  const voucher = vouchers.find(
    (entry) => entry.voucher_no === draft.voucher_no,
  );
  const quantityMismatch =
    voucher && shipmentPairs(draft) !== voucher.total_quantity_pairs
      ? `The voucher says ${formatSets(voucher.total_quantity_pairs)}.`
      : undefined;
  function problem(): string | null {
    if (!draft.carrier_name.trim()) return "Enter a carrier name.";
    if (!draft.sent_on.trim()) return "Choose a shipment date.";
    if (draft.stops.some((stop) => !stop.stop_name.trim()))
      return "Every place on the route needs a name.";
    if (gateStops(draft).length === 0)
      return "The last place on the route must be a receiving gate.";
    const seen = new Set<string>();
    for (const stop of draft.stops) {
      const name = stop.stop_name.trim().toLowerCase();
      if (seen.has(name))
        return `${stop.stop_name} is on the route twice; a place can only appear once.`;
      seen.add(name);
    }
    const over = draft.stops.find(
      (stop) =>
        !stop.counted &&
        stop.packages_received >
          stop.packages_sent +
            (stop.extra_parents ?? []).reduce(
              (sum, l) => sum + l.packages_sent,
              0,
            ),
    );
    if (over)
      return `${over.stop_name}: more packages arrived than were sent to it.`;
    const sentTooFar = draft.stops.find(
      (stop) =>
        packagesSentFrom(draft, stop.stop_id) > packagesAvailableToSend(stop),
    );
    if (sentTooFar) {
      const sent = packagesSentFrom(draft, sentTooFar.stop_id);
      const available = packagesAvailableToSend(sentTooFar);
      const handling = sentTooFar.package_change_kind
        ? `after ${sentTooFar.package_change_kind}`
        : "after arriving";
      return `${sentTooFar.stop_name}: ${sent} packages are sent out, but only ${available} are available ${handling}.`;
    }
    const parents = new Set<string | null>(
      draft.stops.flatMap((stop) => [
        stop.parent_stop_id,
        ...(stop.extra_parents ?? []).map((link) => link.from_stop_id),
      ]),
    );
    const open = draft.stops.find(
      (stop) => !stop.is_gate && !parents.has(stop.stop_id),
    );
    if (open)
      return `${open.stop_name} is the last place on the route, so it has to be a receiving gate.`;
    return null;
  }

  async function save(): Promise<boolean> {
    const found = problem();
    if (found) {
      setTried(true);
      showToast("error", found);
      return false;
    }
    setSaving(true);
    try {
      const settled = normaliseFlow(draft);
      const saved = await onSave(settled);
      // Saved: what is on screen is now the saved version. The fresh server copy replaces it
      // when it arrives.
      setDraft(saved ?? settled);
      syncedKey.current = fingerprint(saved ?? settled);
      setTried(false);
      return true;
    } catch {
      // The page already said why it could not be saved.
      return false;
    } finally {
      setSaving(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirtyRef.current) void saveRef.current();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    onDraftChange?.(dirty ? draft : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft]);
  useEffect(() => () => onDraftChange?.(null), []);

  useEffect(() => {
    onSaveControl?.({
      dirty,
      saving,
      save: () => saveRef.current(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving]);

  function apply(patch: Partial<Shipment>): void {
    setDraft((current) => normaliseFlow({ ...current, ...patch }));
  }

  function setStop(stopId: string, patch: Partial<ShipmentStop>): void {
    setDraft((current) =>
      normaliseFlow({
        ...current,
        stops: current.stops.map((stop) =>
          stop.stop_id === stopId ? { ...stop, ...patch } : stop,
        ),
      }),
    );
  }

  const nameOf = (stopId: string | null): string =>
    stopId === null
      ? "the start"
      : (draft.stops.find((stop) => stop.stop_id === stopId)?.stop_name ??
        draft.carrier_name);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 [&>section+section]:mt-4 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-6">
          <section>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs [&_label]:whitespace-nowrap">
              <InlineField label="Carrier">
                <NamedInput
                  list="carriers"
                  noun="carrier"
                  label="Carrier"
                  bare
                  required
                  size="sm"
                  placeholder="e.g. Apex Logistics"
                  value={draft.carrier_name}
                  onChange={(next) => apply({ carrier_name: next })}
                  error={
                    tried && !draft.carrier_name.trim()
                      ? "Enter a carrier name."
                      : undefined
                  }
                />
              </InlineField>
              <InlineField label="Shipment date">
                <Input
                  aria-label="Shipment date"
                  required
                  size="sm"
                  type="date"
                  className={EDITABLE}
                  value={draft.sent_on}
                  onChange={(event) => apply({ sent_on: event.target.value })}
                  error={
                    tried && !draft.sent_on.trim()
                      ? "Choose a shipment date."
                      : undefined
                  }
                />
              </InlineField>
              <InlineField label="Packages" required={false}>
                <Input
                  aria-label="Packages"
                  size="sm"
                  inputMode="numeric"
                  placeholder="From the shipment"
                  className={cn(EDITABLE, "w-24")}
                  value={
                    draft.total_packages ? String(draft.total_packages) : ""
                  }
                  onChange={(event) => {
                    const next =
                      parseInt(event.target.value.replace(/\D/g, ""), 10) || 0;
                    // Everything was handed to the cargo company: that follows.
                    const handedAll =
                      draft.packages_sent_by_cargo === draft.total_packages;
                    setDraft((current) =>
                      normaliseFlow(
                        handedAll
                          ? withCargoSent(
                              { ...current, total_packages: next },
                              next,
                            )
                          : { ...current, total_packages: next },
                      ),
                    );
                  }}
                />
              </InlineField>
              {actions && (
                <div className="ml-auto flex items-center gap-2">{actions}</div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h3 className="mb-0 text-xs font-semibold uppercase tracking-wide text-text-muted">
                Where the packages are
              </h3>
            </div>
            <p className="mb-2 text-xs text-text-muted">
              Click a place to say how many packages reached it. Click the truck
              on a road to say how many were sent, who carried them, or to add a
              stop on that road. A place can only get as many as were sent to
              it.
            </p>
            {quantityMismatch && (
              <p className="mb-3 text-xs text-warning">{quantityMismatch}</p>
            )}
            <ShipmentMap
              supplierName={draft.supplier_name}
              shipments={lanes}
              selectedId={draft.shipment_id}
              counts={counts ?? {}}
              delivery={delivery}
              onSelect={(id) => onSelectShipment?.(id)}
              actions={{
                // Fewer sent than had arrived: what arrived comes down with it.
                onStopSent: (stopId, next) => {
                  const stop = draft.stops.find((s) => s.stop_id === stopId);
                  setStop(stopId, {
                    packages_sent: next,
                    ...(stop && !stop.counted && stop.packages_received > next
                      ? { packages_received: next }
                      : {}),
                  });
                },
                onCargoChange: (name) => apply({ carrier_name: name }),
                onStopArrived: (stopId, next) =>
                  setStop(stopId, { packages_received: next }),
                onStopChange: (stopId, patch) => setStop(stopId, patch),
                onOpenCount,
                onInsertOnLink: (fromId, toId) =>
                  setEditing({ kind: "insertLink", fromId, toId }),
                onLinkAdd: (fromId, toId) =>
                  setDraft((current) =>
                    normaliseFlow(addLink(current, fromId, toId)),
                  ),
                onLinkChange: (toId, fromId, patch) =>
                  setDraft((current) =>
                    normaliseFlow({
                      ...current,
                      stops: current.stops.map((stop) =>
                        stop.stop_id === toId
                          ? {
                              ...stop,
                              extra_parents: (stop.extra_parents ?? []).map(
                                (link) =>
                                  link.from_stop_id === fromId
                                    ? { ...link, ...patch }
                                    : link,
                              ),
                            }
                          : stop,
                      ),
                    }),
                  ),
                onLinkRemove: (toId, fromId) =>
                  setDraft((current) =>
                    normaliseFlow({
                      ...current,
                      stops: current.stops.map((stop) =>
                        stop.stop_id === toId
                          ? {
                              ...stop,
                              extra_parents: (stop.extra_parents ?? []).filter(
                                (link) => link.from_stop_id !== fromId,
                              ),
                            }
                          : stop,
                      ),
                    }),
                  ),
                onRemove: (stopId) =>
                  setDraft((current) =>
                    normaliseFlow(removeStop(current, stopId)),
                  ),
                onInsert: (parentId, childId) =>
                  setEditing({ kind: "insert", parentId, childId }),
                onAddRoute: (fromId) => setEditing({ kind: "route", fromId }),
              }}
            />
            <div ref={formRef}>
              {editing?.kind === "insert" && (
                <DestinationForm
                  title={`New place between ${nameOf(editing.parentId)} and ${nameOf(editing.childId)}`}
                  submitLabel="Add place"
                  askCarrier={editing.parentId !== null}
                  taken={draft.stops.map((stop) => stop.stop_name)}
                  onSubmit={(stopName, carrierName) => {
                    setDraft((current) =>
                      normaliseFlow(
                        insertStop(
                          current,
                          editing.parentId,
                          newStop(editing.parentId, stopName, carrierName),
                          editing.childId,
                        ),
                      ),
                    );
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
              {editing?.kind === "insertLink" && (
                <DestinationForm
                  title={`New place between ${nameOf(editing.fromId)} and ${nameOf(editing.toId)}`}
                  submitLabel="Add place"
                  taken={draft.stops.map((stop) => stop.stop_name)}
                  onSubmit={(stopName, carrierName) => {
                    setDraft((current) =>
                      normaliseFlow(
                        insertOnLink(
                          current,
                          editing.fromId,
                          editing.toId,
                          newStop(editing.fromId, stopName, carrierName),
                        ),
                      ),
                    );
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
              {editing?.kind === "route" && (
                <DestinationForm
                  title={`Another route from ${nameOf(editing.fromId)}: where does it end?`}
                  submitLabel="Add route"
                  askCarrier={editing.fromId !== null}
                  askKind
                  taken={draft.stops.map((stop) => stop.stop_name)}
                  onSubmit={(stopName, carrierName, isGate) => {
                    setDraft((current) =>
                      normaliseFlow(
                        insertStop(
                          current,
                          editing.fromId,
                          newStop(
                            editing.fromId,
                            stopName,
                            carrierName,
                            isGate,
                          ),
                        ),
                      ),
                    );
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              )}
            </div>
          </section>
          {dirty && (
            <div className="flex items-center justify-between rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-xs">
              <span className="font-medium text-text-primary">
                You have unsaved changes to this shipment. Use Save changes at
                the top.
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDraft(serverShipment)}
                  disabled={saving}
                >
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
