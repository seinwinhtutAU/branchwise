import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {} from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {} from "@renderer/components/features/wholesale/shared/NamedInput";
import {} from "@renderer/components/features/wholesale/shared/PlaceInput";
import {
  cargoRemaining,
  packagesHere,
  shipmentPairs,
  type Shipment,
} from "./shipments";
import { ShipmentMapCard as MapCard } from "./ShipmentMapCard";
import {
  Bubble,
  FactoryGlyph,
  PackageGlyph,
  PinGlyph,
  TruckGlyph,
  WarehouseGlyph,
} from "./ShipmentMapGlyphs";
import {
  CARRIER_AT,
  CARRIER_R,
  COLUMN,
  HALO,
  MARGIN_RIGHT,
  MIN_COLUMN,
  RADIUS,
  SUPPLIER_X,
  layoutLane,
  roadPath,
  roadPoint,
  roadsOf,
  shorten,
  type GateCount,
  type Lane,
  type MapActions,
  type MapDelivery,
  type Open,
} from "./shipmentMapLayout";

export type { GateCount, MapActions, MapDelivery };

/**
 * Every shipment of a voucher drawn as a route map, left to right: the supplier, then the
 * places the goods travel through, joined by a road that forks where the goods went two ways.
 * The road is labelled with who carries the goods. Nothing is typed on the map itself: click a
 * place (or the cargo company's road) of the selected shipment to open a small card for it.
 */
export const ShipmentMap = memo(function ShipmentMap({
  supplierName,
  shipments,
  selectedId,
  counts,
  delivery,
  actions,
  onSelect,
}: {
  supplierName: string;
  /** The voucher's shipments; the selected one as it is on screen. */
  shipments: Shipment[];
  selectedId: string | undefined;
  /** What each counted place has counted so far, by stop id. */
  counts: Record<string, GateCount>;
  /** What can be delivered from a gate or warehouse; without it the cards offer no delivery. */
  delivery?: MapDelivery;
  actions: MapActions;
  onSelect: (shipmentId: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState<Open>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // The card floats over the page, so it follows the map when anything scrolls or resizes.
  const [, follow] = useReducer((n: number) => n + 1, 0);

  // Another shipment was chosen: the card of the old one goes away.
  useEffect(() => {
    setOpen(null);
  }, [selectedId]);

  // A click anywhere outside the map, or Escape, puts the card away.
  useEffect(() => {
    if (!open) return;
    function away(event: MouseEvent): void {
      const target = event.target as Element;
      if (rootRef.current?.contains(target)) return;
      if (target.closest?.("[data-map-card]")) return;
      setOpen(null);
    }
    function escape(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  // The roads shorten to fit the width on screen, down to a limit; past that the map scrolls.
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setAvailable(el.clientWidth);
    const observer = new ResizeObserver(() => setAvailable(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { lanes, width, height, supplierY } = useMemo(() => {
    const layoutAll = (column: number): Lane[] => {
      const found: Lane[] = [];
      let top = 0;
      for (const shipment of shipments) {
        const { lane } = layoutLane(shipment, top, column);
        found.push(lane);
        top += lane.height;
      }
      return found;
    };
    const rightmost = (found: Lane[], column: number): number =>
      Math.max(0, ...found.flatMap((lane) => lane.places.map((p) => p.x))) /
      column;
    // How many roads long the longest route is, then the road length that makes it fit.
    const steps = Math.round(
      (rightmost(layoutAll(COLUMN), COLUMN) * COLUMN - SUPPLIER_X) / COLUMN,
    );
    const column =
      available > 0 && steps > 0
        ? Math.max(
            MIN_COLUMN,
            Math.min(
              COLUMN,
              Math.floor((available - SUPPLIER_X - MARGIN_RIGHT) / steps),
            ),
          )
        : COLUMN;
    const lanes = layoutAll(column);
    const top = lanes.reduce((sum, lane) => sum + lane.height, 0);
    const reach = Math.max(
      0,
      ...lanes.flatMap((lane) => lane.places.map((p) => p.x)),
    );
    const supplierY =
      lanes.length === 0
        ? 100
        : (lanes[0].startY + lanes[lanes.length - 1].startY) / 2;
    return {
      lanes,
      width: Math.max(560, reach + MARGIN_RIGHT),
      height: Math.max(240, top),
      supplierY,
    };
  }, [shipments, available]);

  const totalPackages = shipments.reduce((sum, s) => sum + s.total_packages, 0);
  const totalPairs = shipments.reduce((sum, s) => sum + shipmentPairs(s), 0);
  const stillAtCargo = shipments.reduce((sum, s) => sum + cargoRemaining(s), 0);

  // The card for what was clicked: where it sits and what it holds.
  const selectedLane = lanes.find(
    (lane) => lane.shipment.shipment_id === selectedId,
  );
  const openPlace =
    open?.kind === "place"
      ? selectedLane?.places.find((p) => p.stop.stop_id === open.stopId)
      : undefined;
  const openCarrier =
    open?.kind === "carrier"
      ? selectedLane?.places.find((p) => p.stop.stop_id === open.stopId)
      : undefined;
  const carrierAnchor =
    open?.kind === "carrier" && selectedLane && openCarrier
      ? (() => {
          const road = roadsOf(selectedLane, supplierY).find(
            (r) =>
              r.stop.stop_id === open.stopId &&
              r.link?.from_stop_id === open.fromId,
          );
          return road
            ? roadPoint(
                road.from.x,
                road.from.y,
                road.to.x,
                road.to.y,
                CARRIER_AT,
              )
            : null;
        })()
      : null;
  const cardAnchor = openPlace
    ? { x: openPlace.x, y: openPlace.y }
    : carrierAnchor;

  return (
    <div ref={rootRef} className="overflow-x-auto">
      <div
        ref={innerRef}
        className="relative"
        style={{ width, height }}
        onClick={() => setOpen(null)}
      >
        <svg width={width} height={height} className="block">
          {lanes.map((lane) => {
            const { shipment } = lane;
            const selected = shipment.shipment_id === selectedId;
            return (
              <g
                key={shipment.shipment_id}
                opacity={selected ? 1 : 0.6}
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!selected) onSelect(shipment.shipment_id);
                }}
              >
                {/* Roads: a wide soft base, then the colour of what has been travelled. */}
                {roadsOf(lane, supplierY).map((road) => {
                  const { stop } = road;
                  const x1 = road.from.x;
                  const y1 = road.from.y;
                  const x2 = road.to.x;
                  const y = road.to.y;
                  const reached = road.link
                    ? road.link.packages_sent > 0
                    : stop.packages_received > 0 || !!counts[stop.stop_id];
                  const d = roadPath(x1, y1, x2, y);
                  return (
                    <g key={road.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke="var(--color-border)"
                        strokeWidth={10}
                        strokeLinecap="round"
                        opacity={0.7}
                      />
                      {reached ? (
                        <path
                          d={d}
                          fill="none"
                          stroke="var(--color-journey-cargo)"
                          strokeWidth={4}
                          strokeLinecap="round"
                        />
                      ) : (
                        <path
                          d={d}
                          fill="none"
                          stroke="var(--color-text-muted)"
                          strokeWidth={3}
                          strokeDasharray="2 9"
                          strokeLinecap="round"
                        />
                      )}
                    </g>
                  );
                })}

                {/* Who carries the goods along each road: a little truck, like a place. */}
                {roadsOf(lane, supplierY).map((road) => {
                  const { stop, link } = road;
                  const spot = roadPoint(
                    road.from.x,
                    road.from.y,
                    road.to.x,
                    road.to.y,
                    CARRIER_AT,
                  );
                  const isRoot = !link && stop.parent_stop_id === null;
                  const carried = link ? link.carrier_name : stop.carrier_name;
                  const sentOnRoad = link
                    ? link.packages_sent
                    : stop.packages_sent;
                  const name = isRoot
                    ? shipment.carrier_name
                    : carried && carried !== "—"
                      ? carried
                      : "";
                  const color = name
                    ? "var(--color-journey-cargo)"
                    : "var(--color-text-muted)";
                  const isOpen =
                    open?.kind === "carrier" &&
                    open.stopId === stop.stop_id &&
                    open.fromId === link?.from_stop_id;
                  // The number sits above the truck and the name under it, on every road.
                  const bubbleY = spot.y - CARRIER_R - 16;
                  const nameY = spot.y + CARRIER_R + 14;
                  return (
                    <g
                      key={`carrier-${road.id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!selected) onSelect(shipment.shipment_id);
                        else
                          setOpen((now) =>
                            now?.kind === "carrier" &&
                            now.stopId === stop.stop_id &&
                            now.fromId === link?.from_stop_id
                              ? null
                              : {
                                  kind: "carrier",
                                  stopId: stop.stop_id,
                                  fromId: link?.from_stop_id,
                                },
                          );
                      }}
                    >
                      <title>{name || "Who carries the goods?"}</title>
                      {isOpen && (
                        <circle
                          cx={spot.x}
                          cy={spot.y}
                          r={CARRIER_R + 6}
                          fill="none"
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray="3 4"
                        />
                      )}
                      <circle
                        cx={spot.x}
                        cy={spot.y}
                        r={CARRIER_R}
                        fill="var(--color-bg-base)"
                        stroke={color}
                        strokeWidth={2.5}
                        strokeDasharray={name ? undefined : "3 3"}
                      />
                      <g
                        transform={`translate(${spot.x} ${spot.y}) scale(0.78)`}
                      >
                        <TruckGlyph color={color} />
                      </g>
                      {name ? (
                        <text
                          x={spot.x}
                          y={nameY}
                          textAnchor="middle"
                          fontSize={10}
                          fill="var(--color-text-secondary)"
                          {...HALO}
                        >
                          {shorten(name, 16)}
                        </text>
                      ) : (
                        selected && (
                          <text
                            x={spot.x}
                            y={nameY}
                            textAnchor="middle"
                            fontSize={10}
                            fill="var(--color-text-muted)"
                            {...HALO}
                          >
                            Add carrier
                          </text>
                        )
                      )}
                      <Bubble
                        x={spot.x}
                        y={bubbleY}
                        text={
                          sentOnRoad > 0 || stop.packages_received > 0
                            ? `Sent ${sentOnRoad}`
                            : "Not sent"
                        }
                        fill="var(--color-journey-cargo-soft)"
                        stroke="var(--color-journey-cargo)"
                        color="var(--color-text-primary)"
                      />
                    </g>
                  );
                })}

                {/* The places. */}
                {lane.places.map(({ stop, x, y }) => {
                  const here = packagesHere(shipment, stop);
                  const count = counts[stop.stop_id];
                  const reached = stop.packages_received > 0 || !!count;
                  const isOpen =
                    open?.kind === "place" && open.stopId === stop.stop_id;
                  const color = stop.is_gate
                    ? "var(--color-journey-final)"
                    : "var(--color-journey-stop)";
                  const bubble = count
                    ? `Counted ${count.counted} of ${count.total}`
                    : reached
                      ? `Arrived ${stop.packages_received}`
                      : "Not yet";
                  return (
                    <g
                      key={`place-${stop.stop_id}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!selected) onSelect(shipment.shipment_id);
                        else
                          setOpen((now) =>
                            now?.kind === "place" && now.stopId === stop.stop_id
                              ? null
                              : { kind: "place", stopId: stop.stop_id },
                          );
                      }}
                    >
                      <title>{stop.stop_name}</title>
                      {isOpen && (
                        <circle
                          cx={x}
                          cy={y}
                          r={RADIUS + 7}
                          fill="none"
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray="3 4"
                        />
                      )}
                      {stop.is_gate ? (
                        <circle
                          cx={x}
                          cy={y}
                          r={RADIUS}
                          fill={reached ? color : "var(--color-bg-base)"}
                          stroke={color}
                          strokeWidth={2.5}
                          strokeDasharray={reached ? undefined : "4 4"}
                        />
                      ) : (
                        <circle
                          cx={x}
                          cy={y}
                          r={RADIUS - 2}
                          fill="var(--color-bg-base)"
                          stroke={color}
                          strokeWidth={2.5}
                          strokeDasharray={reached ? undefined : "4 4"}
                        />
                      )}
                      <g transform={`translate(${x} ${y}) scale(0.8)`}>
                        {stop.is_gate ? (
                          <WarehouseGlyph
                            color={reached ? "#fff" : color}
                            door={reached ? color : "var(--color-bg-base)"}
                          />
                        ) : (
                          <PinGlyph color={color} />
                        )}
                      </g>
                      <Bubble
                        x={x}
                        y={y - RADIUS - 17}
                        text={bubble}
                        fill={
                          stop.is_gate
                            ? "var(--color-journey-final-soft)"
                            : "var(--color-journey-stop-soft)"
                        }
                        stroke={color}
                        color="var(--color-text-primary)"
                      />
                      <text
                        x={x}
                        y={y + RADIUS + 16}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={500}
                        fill="var(--color-text-primary)"
                      >
                        {shorten(stop.stop_name)}
                      </text>
                      {stop.is_gate && (
                        <text
                          x={x}
                          y={y + RADIUS + 29}
                          textAnchor="middle"
                          fontSize={10}
                          fill="var(--color-text-muted)"
                        >
                          Receiving gate
                        </text>
                      )}
                      {stop.package_change_kind && stop.packages_after_change != null && (
                        <Bubble
                          x={x}
                          y={y + RADIUS + 34}
                          text={`${stop.package_change_kind === "split" ? "Split" : "Combine"} ${stop.packages_received} → ${stop.packages_after_change}`}
                          fill="var(--color-journey-stop-soft)"
                          stroke="var(--color-journey-stop)"
                          color="var(--color-text-primary)"
                        />
                      )}
                      {!stop.is_gate && here > 0 && (
                        <>
                          <Bubble
                            x={x}
                            y={y + RADIUS + (stop.package_change_kind ? 55 : 34)}
                            text={`${here} here now`}
                            fill="var(--color-warning-subtle)"
                            stroke="var(--color-warning)"
                            color="var(--color-warning)"
                          />
                          <g transform={`translate(${x + 15} ${y - 15})`}>
                            <circle
                              r={9}
                              fill="var(--color-bg-base)"
                              stroke="var(--color-warning)"
                              strokeWidth={1.8}
                            />
                            <g transform="scale(0.6)">
                              <PackageGlyph color="var(--color-warning)" />
                            </g>
                          </g>
                        </>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* The supplier, where every road starts. */}
          <g>
            <circle
              cx={SUPPLIER_X}
              cy={supplierY}
              r={RADIUS + 2}
              fill="var(--color-journey-supplier)"
            />
            <g transform={`translate(${SUPPLIER_X} ${supplierY}) scale(0.8)`}>
              <FactoryGlyph />
            </g>
            <text
              x={SUPPLIER_X}
              y={supplierY - RADIUS - 36}
              textAnchor="middle"
              fontSize={11}
              fontWeight={500}
              fill="var(--color-text-primary)"
            >
              Supplier
            </text>
            <text
              x={SUPPLIER_X}
              y={supplierY - RADIUS - 23}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-text-secondary)"
            >
              {shorten(supplierName, 16)}
            </text>
            <text
              x={SUPPLIER_X}
              y={supplierY - RADIUS - 11}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-text-muted)"
            >
              {totalPackages} {totalPackages === 1 ? "package" : "packages"} ·{" "}
              {formatSets(totalPairs)}
            </text>
            {stillAtCargo > 0 && (
              <Bubble
                x={SUPPLIER_X}
                y={supplierY + RADIUS + 22}
                text={`${stillAtCargo} still at the carrier`}
                fill="var(--color-warning-subtle)"
                stroke="var(--color-warning)"
                color="var(--color-warning)"
              />
            )}
          </g>
        </svg>

        {cardAnchor &&
          selectedLane &&
          (openPlace || openCarrier) &&
          createPortal(
            <MapCard
              origin={innerRef.current?.getBoundingClientRect() ?? null}
              key={open ? `${open.kind}-${open.stopId}` : "card"}
              anchorX={cardAnchor.x}
              anchorTop={cardAnchor.y}
              anchorRadius={open?.kind === "carrier" ? CARRIER_R : RADIUS}
              shipment={selectedLane.shipment}
              stop={openPlace?.stop ?? openCarrier?.stop}
              fromId={open?.kind === "carrier" ? open.fromId : undefined}
              mode={open?.kind === "carrier" ? "carrier" : "place"}
              count={openPlace ? counts[openPlace.stop.stop_id] : undefined}
              actions={actions}
              delivery={delivery}
              onClose={() => setOpen(null)}
            />,
            document.body,
          )}
      </div>
    </div>
  );
});
