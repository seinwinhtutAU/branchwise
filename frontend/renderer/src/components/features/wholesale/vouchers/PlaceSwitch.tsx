import { cn } from "@renderer/lib/utils";
import { Select } from "@renderer/components/ui/Select";
import { type Receiving } from "../receiving/receivings";
import { type Shipment } from "../delivery/shipments";

type PlaceChoice = { shipment: Shipment; stop: Shipment["stops"][number] };

/** Places that are not a gate and have no count yet: any of them can still be counted. */
function otherPlaces(
  shipments: Shipment[],
  receivings: Receiving[],
): PlaceChoice[] {
  return shipments.flatMap((shipment) =>
    shipment.stops
      .filter(
        (stop) =>
          !stop.is_gate &&
          !receivings.some((receiving) => receiving.stop_id === stop.stop_id),
      )
      .map((stop) => ({ shipment, stop })),
  );
}

/** The gate on the same shipment as a temporary count at another place. */
export function receivingGateForStop(
  shipments: Shipment[],
  stopId: string | undefined,
): PlaceChoice | undefined {
  const shipment = shipments.find((entry) =>
    entry.stops.some((stop) => stop.stop_id === stopId),
  );
  const stop = shipment?.stops.find((entry) => entry.is_gate);
  return shipment && stop ? { shipment, stop } : undefined;
}

/** The "Count at another place" dropdown, for putting beside other fields. */
export function PlaceSelect({
  shipments,
  activeStopId,
  receivings,
  onSelect,
}: {
  shipments: Shipment[];
  activeStopId: string | undefined;
  receivings: Receiving[];
  onSelect: (shipmentId: string, stopId: string) => void;
}): React.JSX.Element | null {
  const others = otherPlaces(shipments, receivings);
  if (others.length === 0) return null;
  const several = shipments.length > 1;
  const activeIsOther = others.some(
    ({ stop }) => stop.stop_id === activeStopId,
  );
  const receivingGate = activeIsOther
    ? receivingGateForStop(shipments, activeStopId)
    : undefined;
  return (
    <Select
      size="sm"
      aria-label="Count at another place"
      className="w-48"
      value={activeIsOther ? (activeStopId ?? "") : ""}
      onChange={(event) => {
        if (event.target.value === "" && receivingGate) {
          onSelect(receivingGate.shipment.shipment_id, receivingGate.stop.stop_id);
          return;
        }
        const picked = others.find(
          ({ stop }) => stop.stop_id === event.target.value,
        );
        if (picked) onSelect(picked.shipment.shipment_id, picked.stop.stop_id);
      }}
    >
      <option value="">
        {receivingGate
          ? `← Back to receiving gate: ${receivingGate.stop.stop_name}`
          : "Count at another place…"}
      </option>
      {others.map(({ shipment, stop }) => (
        <option key={stop.stop_id} value={stop.stop_id}>
          {several && shipment.carrier_name.trim()
            ? `${shipment.carrier_name.trim()} → ${stop.stop_name}`
            : stop.stop_name}
        </option>
      ))}
    </Select>
  );
}

/**
 * Picks which place's count the tab below shows. A shipment's gates are listed as buttons, and so
 * is any other place that already has a count; every other place on the route is in the dropdown,
 * since any place can be counted. The same look as the Payments / Cost switch.
 */
export function PlaceSwitch({
  shipments,
  activeStopId,
  receivings,
  onSelect,
  trailing,
  showOthers = true,
}: {
  shipments: Shipment[];
  activeStopId: string | undefined;
  receivings: Receiving[];
  onSelect: (shipmentId: string, stopId: string) => void;
  trailing?: React.ReactNode;
  /** False when the caller puts the {@link PlaceSelect} dropdown elsewhere itself. */
  showOthers?: boolean;
}): React.JSX.Element | null {
  const counted = (stopId: string): boolean =>
    receivings.some((receiving) => receiving.stop_id === stopId);
  const options = shipments.flatMap((shipment) =>
    shipment.stops
      .filter((stop) => stop.is_gate || counted(stop.stop_id))
      .map((stop) => ({ shipment, stop })),
  );
  const others = showOthers ? otherPlaces(shipments, receivings) : [];
  const several = shipments.length > 1;
  if (options.length < 2 && others.length === 0 && !trailing) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {options.length > 1 && (
          <div
            role="tablist"
            className="inline-flex items-center gap-0.5 rounded-md border border-border bg-bg-subtle p-0.5"
          >
            {options.map(({ shipment, stop }) => {
              const active = stop.stop_id === activeStopId;
              return (
                <button
                  key={stop.stop_id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelect(shipment.shipment_id, stop.stop_id)}
                  className={cn(
                    "inline-flex h-6 items-center gap-1.5 rounded px-3 text-xs font-semibold transition-colors",
                    active
                      ? "bg-brand text-white shadow-sm"
                      : "text-text-secondary hover:bg-bg-base",
                  )}
                >
                  {several && shipment.carrier_name.trim()
                    ? `${shipment.carrier_name.trim()} → ${stop.stop_name}`
                    : stop.stop_name}
                </button>
              );
            })}
          </div>
        )}
        {others.length > 0 && (
          <PlaceSelect
            shipments={shipments}
            activeStopId={activeStopId}
            receivings={receivings}
            onSelect={onSelect}
          />
        )}
      </div>
      {trailing}
    </div>
  );
}
