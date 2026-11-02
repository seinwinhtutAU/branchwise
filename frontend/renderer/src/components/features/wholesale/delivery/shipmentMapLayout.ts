import {
  childrenOf,
  type Shipment,
  type ShipmentStop,
  type StopLink,
} from "./shipments";

export const NO_CAP = 99999;
/** The longest a road is (the distance between two columns of places), and the shortest it is
 *  squeezed to when the route has to fit a narrow screen. */
export const COLUMN = 300;
export const MIN_COLUMN = 180;
const ROW = 140;
/** Where the supplier sits, and where the first places start. */
export const SUPPLIER_X = 110;
export const RADIUS = 19;
/** The little circle of a carrier on a road, and how far along the road it sits. */
export const CARRIER_R = 13;
export const CARRIER_AT = 0.62;
/** How soon a road turns toward the place it leads to: early, so roads that fork part quickly
 *  and each truck sits on its own flat stretch with room for its name. */
const BEND = 0.35;
/** A rim in the page colour round a label, so a road passing behind it never hides a letter. */
export const HALO = {
  stroke: "var(--color-bg-base)",
  strokeWidth: 5,
  strokeLinejoin: "round" as const,
  paintOrder: "stroke" as const,
};
const LANE_PAD = 30;
export const MARGIN_RIGHT = 150;

/** What a counted place has counted so far. */
export interface GateCount {
  counted: number;
  total: number;
}

/** What the selected shipment can do; the others only show their figures. */
export interface MapActions {
  /** How many the carrier on the road into this place took from the place before. */
  onStopSent: (stopId: string, packages: number) => void;
  onStopArrived: (stopId: string, packages: number) => void;
  /** The shipment's cargo company was changed. */
  onCargoChange: (name: string) => void;
  /** A place's name, or who carried the goods to it, was changed. */
  onStopChange: (
    stopId: string,
    patch: {
      stop_name?: string;
      carrier_name?: string;
      is_gate?: boolean;
      package_change_kind?: "split" | "combine" | null;
      packages_after_change?: number | null;
    },
  ) => void;
  onRemove: (stopId: string) => void;
  /** A second road from `fromId` joins `toId`: routes that forked meet again. */
  onLinkAdd: (fromId: string, toId: string) => void;
  onLinkChange: (
    toId: string,
    fromId: string,
    patch: { carrier_name?: string; packages_sent?: number },
  ) => void;
  onLinkRemove: (toId: string, fromId: string) => void;
  /** A place goes between `parentId` (null: the start) and the place after it. */
  onInsert: (parentId: string | null, childId: string) => void;
  /** A place goes on a further road, between `fromId` and the place `toId` it joins. */
  onInsertOnLink: (fromId: string, toId: string) => void;
  /** Another route starts from this place (null: from the start). */
  onAddRoute: (fromId: string | null) => void;
  /** Go to where the packages of this counted place are opened and counted. */
  onOpenCount?: (stopId: string) => void;
}

/** What is at a place: how much of this voucher's products is there. */
export interface MapDelivery {
  /** Pairs of this voucher's products at a place, by the place's name. */
  here: (place: string) => number;
}

export interface Placed {
  stop: ShipmentStop;
  x: number;
  y: number;
}

export interface Lane {
  shipment: Shipment;
  top: number;
  height: number;
  places: Placed[];
  /** Where the cargo company's road leaves the supplier. */
  startY: number;
}

/** Lays one shipment's route out: a column per step along it and a row per route end, each
 *  place level with the middle of what follows it. */
export function layoutLane(
  shipment: Shipment,
  top: number,
  column: number,
): { lane: Lane; rows: number } {
  const places: Placed[] = [];
  let nextRow = 0;
  const rowOf = (followers: number[]): number => {
    if (followers.length === 0) {
      const row = nextRow;
      nextRow += 1;
      return row;
    }
    return (followers[0] + followers[followers.length - 1]) / 2;
  };
  // A place is as far right as its furthest road in; where two roads meet it sits after both.
  const byId = new Map(shipment.stops.map((stop) => [stop.stop_id, stop]));
  const linksOf = (stop: ShipmentStop): StopLink[] =>
    (stop.extra_parents ?? []).filter((link) => byId.has(link.from_stop_id));
  const isMerge = (stop: ShipmentStop): boolean => linksOf(stop).length > 0;
  const parentIds = (stop: ShipmentStop): string[] => [
    ...(stop.parent_stop_id !== null && byId.has(stop.parent_stop_id)
      ? [stop.parent_stop_id]
      : []),
    ...linksOf(stop).map((link) => link.from_stop_id),
  ];
  const depths = new Map<string, number>();
  const depthOf = (stop: ShipmentStop): number => {
    const known = depths.get(stop.stop_id);
    if (known !== undefined) return known;
    const parents = parentIds(stop).map((id) => depthOf(byId.get(id)!));
    const depth = parents.length === 0 ? 0 : 1 + Math.max(...parents);
    depths.set(stop.stop_id, depth);
    return depth;
  };
  const rowsOfStops = new Map<string, number>();
  // A place where roads meet keeps its own row on the road from the place before it, so that
  // road does not run through the places on the other roads.
  const reservedRows = new Map<string, number>();
  const reserveRow = (stop: ShipmentStop): number => {
    const known = reservedRows.get(stop.stop_id);
    if (known !== undefined) return known;
    const row = nextRow;
    nextRow += 1;
    reservedRows.set(stop.stop_id, row);
    return row;
  };
  // A place where roads meet that goes on somewhere is placed like any other (level with what
  // follows it); one that ends there takes its own row.
  const settleMerge = (stop: ShipmentStop): number =>
    childrenOf(shipment, stop.stop_id).length > 0
      ? placeStop(stop)
      : reserveRow(stop);
  const placeStop = (stop: ShipmentStop): number => {
    const known = rowsOfStops.get(stop.stop_id);
    if (known !== undefined) return known;
    const rows = childrenOf(shipment, stop.stop_id).map((next) =>
      isMerge(next) ? settleMerge(next) : placeStop(next),
    );
    const row = rowOf(rows);
    rowsOfStops.set(stop.stop_id, row);
    return row;
  };
  const roots = childrenOf(shipment, null);
  for (const root of roots) {
    if (isMerge(root)) settleMerge(root);
    else placeStop(root);
  }
  // Places where roads meet sit level with the middle of the places the roads come from.
  const merges = shipment.stops
    .filter(isMerge)
    .sort((a, b) => depthOf(a) - depthOf(b));
  for (const merge of merges) {
    if (rowsOfStops.has(merge.stop_id)) continue;
    const parentRows = parentIds(merge)
      .map((id) => rowsOfStops.get(id))
      .filter((row): row is number => row !== undefined);
    rowsOfStops.set(
      merge.stop_id,
      reservedRows.get(merge.stop_id) ??
        (parentRows.length > 0
          ? (Math.min(...parentRows) + Math.max(...parentRows)) / 2
          : nextRow++),
    );
  }
  for (const stop of shipment.stops) placeStop(stop);
  for (const stop of shipment.stops) {
    places.push({
      stop,
      x: SUPPLIER_X + (depthOf(stop) + 1) * column,
      y: top + LANE_PAD + rowsOfStops.get(stop.stop_id)! * ROW + ROW / 2,
    });
  }
  const rootRows = roots.map((root) => rowsOfStops.get(root.stop_id)!);
  const rows = Math.max(1, nextRow);
  const startRow =
    rootRows.length > 0 ? (rootRows[0] + rootRows[rootRows.length - 1]) / 2 : 0;
  return {
    rows,
    lane: {
      shipment,
      top,
      height: rows * ROW + LANE_PAD * 2,
      places,
      startY: top + LANE_PAD + startRow * ROW + ROW / 2,
    },
  };
}

export function shorten(text: string, max = 20): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A road from (x1, y1) to (x2, y2): an S-curve, so a fork reads as a fork. */
export function roadPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const bend = x1 + (x2 - x1) * BEND;
  return `M${x1} ${y1} C${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`;
}

/** The point a given share of the way along that road (a cubic with these control points). */
export function roadPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
): { x: number; y: number } {
  const bend = x1 + (x2 - x1) * BEND;
  const u = 1 - t;
  return {
    x:
      u * u * u * x1 +
      3 * u * u * t * bend +
      3 * u * t * t * bend +
      t * t * t * x2,
    y:
      u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
  };
}

export type Open =
  | { kind: "place"; stopId: string }
  | { kind: "carrier"; stopId: string; fromId?: string }
  | null;

/** One road on the map: the one into a place from the place before it, or a further road into
 *  a place where routes meet. */
export interface Road {
  id: string;
  stop: ShipmentStop;
  link?: StopLink;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export function roadsOf(lane: Lane, supplierY: number): Road[] {
  const roads: Road[] = [];
  for (const { stop, x, y } of lane.places) {
    const start = roadFrom(lane, stop, supplierY);
    roads.push({
      id: stop.stop_id,
      stop,
      from: start,
      to: { x: x - RADIUS, y },
    });
    for (const link of stop.extra_parents ?? []) {
      const source = lane.places.find(
        (p) => p.stop.stop_id === link.from_stop_id,
      );
      if (!source) continue;
      roads.push({
        id: `${stop.stop_id}<${link.from_stop_id}`,
        stop,
        link,
        from: { x: source.x + RADIUS, y: source.y },
        to: { x: x - RADIUS, y },
      });
    }
  }
  return roads;
}

/** Everything sent to a place, over every road into it. */
export function sentInTotal(stop: ShipmentStop): number {
  return (
    stop.packages_sent +
    (stop.extra_parents ?? []).reduce(
      (sum, link) => sum + link.packages_sent,
      0,
    )
  );
}

/** Where the road into a place begins. */
function roadFrom(
  lane: Lane,
  stop: ShipmentStop,
  supplierY: number,
): { x: number; y: number } {
  const from = stop.parent_stop_id
    ? lane.places.find((p) => p.stop.stop_id === stop.parent_stop_id)
    : undefined;
  return {
    x: (from ? from.x : SUPPLIER_X) + RADIUS,
    y: from ? from.y : supplierY,
  };
}
