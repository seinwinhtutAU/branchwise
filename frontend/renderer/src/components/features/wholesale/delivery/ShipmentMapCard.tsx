import { useLayoutEffect, useRef, useState } from "react";
import {} from "react-dom";
import { CloseIcon, PlusIcon } from "@renderer/components/ui/icons";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { NamedInput } from "@renderer/components/features/wholesale/shared/NamedInput";
import { PlaceInput } from "@renderer/components/features/wholesale/shared/PlaceInput";
import {
  childrenOf,
  gateStops,
  linkTargets,
  packagesAvailableOnRoad,
  packagesAvailableToSend,
  packagesSentFrom,
  type Shipment,
  type ShipmentStop,
} from "./shipments";
import { PackageInput } from "./ShipmentBadges";
import { PlaceKindPicker } from "./PlaceKindPicker";
import {
  sentInTotal,
  type GateCount,
  type MapActions,
  type MapDelivery,
} from "./shipmentMapLayout";

const CARD_WIDTH = 300;
const COMPACT_NUMBER_INPUT =
  "!min-h-0 !h-full !px-1 !text-xs !font-semibold leading-none";

/** The small card that opens when a place (or the cargo company's road) is clicked: the
 *  number that reached it, what it is called, who carried the goods to it, and what can be
 *  done from it. */
export function ShipmentMapCard({
  fromId,
  origin,
  anchorX,
  anchorTop,
  anchorRadius,
  shipment,
  stop,
  mode,
  count,
  actions,
  delivery,
  onClose,
}: {
  /** Where the map sits on screen: the card is placed on the page, not inside the map. */
  origin: DOMRect | null;
  /** The place the card belongs to, so it can open above it when there is no room below. */
  anchorX: number;
  anchorTop: number;
  anchorRadius: number;
  shipment: Shipment;
  stop?: ShipmentStop;
  /** For a further road into `stop`: the place it leaves. */
  fromId?: string;
  mode: "place" | "carrier";
  count?: GateCount;
  actions: MapActions;
  delivery?: MapDelivery;
  onClose: () => void;
}): React.JSX.Element {
  // The road leaving the supplier is the cargo company's.
  const roadLink = fromId
    ? stop?.extra_parents?.find((entry) => entry.from_stop_id === fromId)
    : undefined;
  const isStart =
    mode === "carrier" && !roadLink && stop?.parent_stop_id === null;
  const canRemove = stop
    ? !count && (!stop.is_gate || gateStops(shipment).length > 1)
    : false;
  const showPlaceActions = Boolean(stop && (!stop.is_gate || canRemove));
  const receivingGateLocked = Boolean(count);
  const roadPackages = roadLink
    ? roadLink.packages_sent
    : (stop?.packages_sent ?? 0);
  const roadLimit = stop
    ? packagesAvailableOnRoad(shipment, stop, fromId ?? stop.parent_stop_id)
    : 0;
  const title = isStart
    ? `${shipment.carrier_name || "Carrier"} · ${formatDate(shipment.sent_on)}`
    : mode === "carrier"
      ? `Carried to ${stop?.stop_name ?? ""}`
      : stop?.is_gate
        ? "Receiving gate"
        : (stop?.stop_name ?? "");
  const link =
    "nodrag text-left text-xs font-semibold text-brand hover:underline";
  const cardRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null,
  );
  // Beside its place, kept inside the window: moved up when there is no room underneath.
  useLayoutEffect(() => {
    if (!origin) return;
    const box = cardRef.current?.getBoundingClientRect();
    const cardHeight = box?.height ?? 0;
    const cx = origin.left + anchorX;
    const cy = origin.top + anchorTop;
    const gap = 10;
    // Below, above, to the right, to the left: the first that fits in the window and leaves
    // the place itself (and the labels around it) uncovered.
    const options = [
      { left: cx - CARD_WIDTH / 2, top: cy + anchorRadius + 46 },
      {
        left: cx - CARD_WIDTH / 2,
        top: cy - anchorRadius - 38 - cardHeight,
      },
      { left: cx + anchorRadius + gap, top: cy - cardHeight / 2 },
      {
        left: cx - anchorRadius - gap - CARD_WIDTH,
        top: cy - cardHeight / 2,
      },
    ];
    const fits = (o: { left: number; top: number }): boolean =>
      o.left >= 8 &&
      o.top >= 8 &&
      o.left + CARD_WIDTH <= window.innerWidth - 8 &&
      o.top + cardHeight <= window.innerHeight - 8;
    const chosen = options.find(fits) ?? options[2];
    const next = {
      left: Math.max(
        8,
        Math.min(chosen.left, window.innerWidth - CARD_WIDTH - 8),
      ),
      top: Math.max(
        8,
        Math.min(chosen.top, window.innerHeight - cardHeight - 8),
      ),
    };
    setPlace((now) =>
      now && now.left === next.left && now.top === next.top ? now : next,
    );
  });
  return (
    <div
      ref={cardRef}
      data-map-card
      onClick={(event) => event.stopPropagation()}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        width: CARD_WIDTH,
        visibility: place ? "visible" : "hidden",
      }}
      className="fixed z-50 rounded-xl border border-brand/50 bg-bg-base p-4 shadow-md"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-base font-semibold text-text-primary">
          {title}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded-full text-text-muted hover:bg-bg-subtle"
        >
          <CloseIcon className="h-3 w-3" />
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {mode === "carrier" && stop && (
          <>
            {isStart ? (
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-text-secondary">
                  Carrier
                </span>
                <NamedInput
                  list="carriers"
                  noun="carrier"
                  label="Carrier"
                  bare
                  size="sm"
                  placeholder="e.g. Apex Logistics"
                  value={shipment.carrier_name}
                  onChange={actions.onCargoChange}
                />
              </div>
            ) : roadLink && fromId ? (
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-text-secondary">
                  Carried by
                </span>
                <NamedInput
                  list="carriers"
                  noun="carrier"
                  label="Carried by"
                  bare
                  size="sm"
                  placeholder="e.g. U Hla Myint"
                  value={roadLink.carrier_name}
                  onChange={(carrier) =>
                    actions.onLinkChange(stop.stop_id, fromId, {
                      carrier_name: carrier,
                    })
                  }
                />
              </div>
            ) : (
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-text-secondary">
                  Carried by
                </span>
                <NamedInput
                  list="carriers"
                  noun="carrier"
                  label="Carried by"
                  bare
                  size="sm"
                  placeholder="e.g. U Hla Myint"
                  value={stop.carrier_name === "—" ? "" : stop.carrier_name}
                  onChange={(carrier) =>
                    actions.onStopChange(stop.stop_id, {
                      carrier_name: carrier,
                    })
                  }
                />
              </div>
            )}
            <Row label="Packages sent">
              <PackageInput
                label={`Packages sent to ${stop.stop_name}`}
                value={roadPackages}
                max={roadLimit}
                className="!min-h-7 !h-7 !px-1 !text-xs !font-semibold leading-none"
                onChange={(next) =>
                  roadLink && fromId
                    ? actions.onLinkChange(stop.stop_id, fromId, {
                        packages_sent: next,
                      })
                    : actions.onStopSent(stop.stop_id, next)
                }
              />
            </Row>
            <p className="-mt-1 text-[11px] text-text-muted">
              Maximum for this road: {roadLimit} packages
            </p>
            <button
              type="button"
              className={link}
              onClick={() => {
                if (roadLink && fromId)
                  actions.onInsertOnLink(fromId, stop.stop_id);
                else actions.onInsert(stop.parent_stop_id, stop.stop_id);
                onClose();
              }}
            >
              <PlusIcon className="mr-1 inline h-3 w-3" />
              Add a stop on this road
            </button>
            {roadLink && fromId && (
              <button
                type="button"
                className="text-left text-xs font-semibold text-error hover:underline"
                onClick={() => {
                  actions.onLinkRemove(stop.stop_id, fromId);
                  onClose();
                }}
              >
                Remove this road
              </button>
            )}
            {isStart && (
              <button
                type="button"
                className={link}
                onClick={() => {
                  actions.onAddRoute(null);
                  onClose();
                }}
              >
                <PlusIcon className="mr-1 inline h-3 w-3" />
                Add another route from the start
              </button>
            )}
          </>
        )}
        {mode === "place" && stop && (
          <>
            {count ? (
              <>
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <span className="font-medium">Counted</span>
                  <span className="font-semibold tabular-nums text-text-primary">
                    {count.counted} of {count.total}
                  </span>
                </div>
                <p className="text-xs text-text-muted">
                  Counted at the receiving gate.
                </p>
                {actions.onOpenCount && (
                  <button
                    type="button"
                    className={link}
                    onClick={() => {
                      actions.onOpenCount?.(stop.stop_id);
                      onClose();
                    }}
                  >
                    Go to receiving gate
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-text-secondary">
                  Arrived
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="h-7 w-12 overflow-hidden rounded-md border border-border bg-bg-base text-center">
                    <PackageInput
                      label={`Packages arrived at ${stop.stop_name}`}
                      value={stop.packages_received}
                      max={sentInTotal(stop)}
                      className={COMPACT_NUMBER_INPUT}
                      onChange={(next) =>
                        actions.onStopArrived(stop.stop_id, next)
                      }
                    />
                  </div>
                  <span className="text-[11px] text-text-muted">
                    of {sentInTotal(stop)} sent here
                  </span>
                </div>
              </div>
            )}
            {!count && !stop.is_gate && (
              <PackageChangeControl
                shipment={shipment}
                stop={stop}
                onChange={(patch) => actions.onStopChange(stop.stop_id, patch)}
              />
            )}
            <div>
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                Type
              </span>
              <PlaceKindPicker
                small
                isGate={stop.is_gate}
                onChange={(isGate) =>
                  actions.onStopChange(stop.stop_id, { is_gate: isGate })
                }
                gateBlocked={
                  childrenOf(shipment, stop.stop_id).length > 0 ||
                  shipment.stops.some((other) =>
                    (other.extra_parents ?? []).some(
                      (entry) => entry.from_stop_id === stop.stop_id,
                    ),
                  )
                    ? "The route goes on from this place, so it cannot be where the goods end up."
                    : undefined
                }
                stopBlocked={
                  receivingGateLocked || gateStops(shipment).length < 2
                    ? "This receiving gate is set by its receiving record."
                    : undefined
                }
              />
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-text-secondary">
                Place
              </span>
              <PlaceInput
                label="Place"
                bare
                size="sm"
                className="text-xs font-medium"
                placeholder="Choose or type a place"
                exclude={shipment.stops
                  .filter((other) => other.stop_id !== stop.stop_id)
                  .map((other) => other.stop_name)}
                value={stop.stop_name}
                disabled={receivingGateLocked}
                onChange={(place) =>
                  actions.onStopChange(stop.stop_id, { stop_name: place })
                }
                error={
                  shipment.stops.some(
                    (other) =>
                      other.stop_id !== stop.stop_id &&
                      other.stop_name.trim().toLowerCase() ===
                        stop.stop_name.trim().toLowerCase(),
                  )
                    ? "Already on this route."
                    : undefined
                }
              />
            </div>
            {!stop.is_gate &&
              linkTargets(shipment, stop.stop_id).length > 0 && (
                <select
                  aria-label="Also goes to"
                  value=""
                  onChange={(event) => {
                    if (!event.target.value) return;
                    actions.onLinkAdd(stop.stop_id, event.target.value);
                    onClose();
                  }}
                  className="nodrag h-8 w-full rounded-lg border border-border bg-bg-base px-2 text-xs font-semibold text-brand"
                >
                  <option value="">Also goes to…</option>
                  {linkTargets(shipment, stop.stop_id).map((target) => (
                    <option key={target.stop_id} value={target.stop_id}>
                      {target.stop_name}
                    </option>
                  ))}
                </select>
              )}
            {showPlaceActions && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                {!stop.is_gate ? (
                  <button
                    type="button"
                    className={link}
                    onClick={() => {
                      actions.onAddRoute(stop.stop_id);
                      onClose();
                    }}
                  >
                    <PlusIcon className="mr-1 inline h-3 w-3" />
                    Add another route from here
                  </button>
                ) : (
                  <span />
                )}
                {canRemove && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-error hover:underline"
                    onClick={() => {
                      actions.onRemove(stop.stop_id);
                      onClose();
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
            {stop.is_gate && delivery && (
              <TotalProducts place={stop.stop_name} delivery={delivery} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** A compact control for repacking at a stop. A split/combine uses every package that arrived
 * here, so the only number to enter is what came out after handling. */
function PackageChangeControl({
  shipment,
  stop,
  onChange,
}: {
  shipment: Shipment;
  stop: ShipmentStop;
  onChange: (patch: {
    package_change_kind?: "split" | "combine" | null;
    packages_after_change?: number | null;
  }) => void;
}): React.JSX.Element {
  const kind = stop.package_change_kind ?? null;
  const suggested = Math.max(
    stop.packages_received,
    packagesSentFrom(shipment, stop.stop_id),
  );
  const result = stop.packages_after_change ?? suggested;
  const available = packagesAvailableToSend(stop);
  const sentOnward = packagesSentFrom(shipment, stop.stop_id);
  const setKind = (next: "split" | "combine" | null): void => {
    onChange(
      next
        ? { package_change_kind: next, packages_after_change: suggested }
        : { package_change_kind: null, packages_after_change: null },
    );
  };
  const button = (value: "split" | "combine" | null): string =>
    `nodrag rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
      kind === value
        ? "border-brand bg-brand/10 text-brand"
        : "border-transparent text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
    }`;

  return (
    <div className="border-y border-border py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text-secondary">
          Handling
        </span>
        <div className="flex rounded-md bg-bg-subtle p-0.5">
          <button
            type="button"
            className={button(null)}
            onClick={() => setKind(null)}
          >
            No change
          </button>
          <button
            type="button"
            className={button("split")}
            onClick={() => setKind("split")}
          >
            Split
          </button>
          <button
            type="button"
            className={button("combine")}
            onClick={() => setKind("combine")}
          >
            Combine
          </button>
        </div>
      </div>
      {kind && (
        <div className="mt-2 flex items-center justify-between text-xs text-text-secondary">
          <span>{stop.packages_received} packages</span>
          <span className="text-text-muted">→</span>
          <div className="h-7 w-12 overflow-hidden rounded-md border border-border bg-bg-base text-center">
            <PackageInput
              label={`Packages after ${kind} at ${stop.stop_name}`}
              value={result}
              max={999999}
              className={COMPACT_NUMBER_INPUT}
              onChange={(packages) =>
                onChange({ packages_after_change: packages })
              }
            />
          </div>
          <span>packages</span>
        </div>
      )}
      <p
        className={`mt-2 text-[11px] ${
          sentOnward > available ? "font-medium text-error" : "text-text-muted"
        }`}
      >
        {available} available · {sentOnward} sent out
        {sentOnward > available && " — reduce the roads before saving."}
      </p>
    </div>
  );
}

/** How much of this voucher's products is at a gate or warehouse. */
function TotalProducts({
  place,
  delivery,
}: {
  place: string;
  delivery: MapDelivery;
}): React.JSX.Element {
  return (
    <div className="border-t border-border pt-2.5">
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <span className="font-medium">Total products</span>
        <span className="font-semibold tabular-nums text-text-primary">
          {formatSets(delivery.here(place))}
        </span>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
      <span>{label}</span>
      <div className="w-16 overflow-hidden rounded border border-border bg-bg-base text-center">
        {children}
      </div>
    </div>
  );
}
