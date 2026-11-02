// The shipment half of the wholesale data model drawn in diagram/wholesale/erd.mmd: one
// supplier voucher travelling here as freight, and the stops it passes through on the way.
//
// The stops are the point of this screen. A shipment records how many packages the cargo
// company sent, then each stop records how many it received and how many it sent onward,
// so a package that goes missing between two towns is visible as a gap rather than a
// mystery at the end.
//
// Backed by /api/wholesale/shipments (see wholesale/api.ts and
// backend/app/services/wholesale/shipments.py, which ports every function below —
// normaliseFlow especially — so an edit is re-settled identically on the screen and on
// the server). SEED_SHIPMENTS below is only the store's initial value, shown for the
// instant before DeliveryPage's own fetch resolves and replaces it with the real rows;
// it is not what anyone edits any more.

import {} from "../shared/shared";
import { toPairs, type Unit } from "../shared/units";

export type ShipmentStatus =
  "waiting_at_cargo" | "in_transit" | "partly_delivered" | "completed";

export type PackageChangeKind = "split" | "combine";

/** One place on a shipment's route. The route is a tree: `parent_stop_id` is the place the
 *  goods came from (null: straight from the cargo company), so a place can have more than one
 *  place after it. A place where a route ends is a gate. Any place can be counted. */
export interface ShipmentStop {
  /** The stop's id once saved; a temporary key (`new-…`) until then. */
  stop_id: string;
  parent_stop_id: string | null;
  leg_order: number;
  stop_name: string;
  /** Who carried the goods from the place before to here. */
  carrier_name: string;
  /** How many packages reached this place — what a receiving counted there, else what was
   *  typed. Only a fact about this place: it never has to add up with its neighbours. */
  packages_received: number;
  /** How many the carrier took from the place before and set off with. What was sent and what
   *  arrived are told apart, so a package lost on the road shows on that road. For a place
   *  straight after the supplier it is what the cargo company sent. */
  packages_sent: number;
  /** Optional handling here: the boxes that arrived were split or combined before leaving. */
  package_change_kind?: PackageChangeKind | null;
  packages_after_change?: number | null;
  lost_packages?: number;
  is_gate: boolean;
  /** A receiving has counted this place. */
  counted?: boolean;
  /** Further roads into this place, besides the one from `parent_stop_id`: where routes that
   *  forked meet again. */
  extra_parents?: StopLink[];
}

/** One further road into a place. */
export interface StopLink {
  from_stop_id: string;
  carrier_name: string;
  packages_sent: number;
}

/** One slip: a supplier voucher's goods travelling here as freight, along a route that can
 *  fork. */
export interface Shipment {
  shipment_id: string;
  shipment_no: string;
  /** Which supplier voucher is travelling as this shipment. */
  voucher_no: string;
  supplier_name: string;
  carrier_name: string;
  sent_on: string;
  total_packages: number;
  /** What is inside those packages — the supplier's own count of the goods, alongside
   *  the count of boxes they travel in, in whatever unit the voucher is written in. */
  total_quantity_pairs: number;
  total_unit: Unit;
  /** What the cargo company sent: the total of what it sent along each road leaving the
   *  supplier. Worked out from the places. */
  packages_sent_by_cargo: number;
  /** Packages that have reached a gate, over every route. */
  final_received_packages: number;
  lost_packages?: number;
  final_lost_packages?: number;
  allowed_actions?: string[];
  version_id?: number;
  /** The route, depth first: a place always comes after the one it came from. */
  stops: ShipmentStop[];
}

/** The goods on this shipment, in pairs. */
export function shipmentPairs(shipment: Shipment): number {
  return toPairs(shipment.total_quantity_pairs, shipment.total_unit);
}

/** Packages the cargo company still has not sent. */
export function cargoRemaining(shipment: Shipment): number {
  return Math.max(0, shipment.total_packages - shipment.packages_sent_by_cargo);
}

export function gateStops(shipment: Shipment): ShipmentStop[] {
  return shipment.stops.filter((stop) => stop.is_gate);
}

/** Where this shipment ends, for a line of text: its gates' names. */
export function finalDestination(shipment: Shipment): string {
  return gateStops(shipment)
    .map((stop) => stop.stop_name)
    .filter(Boolean)
    .join(", ");
}

/** The places that come straight after `parentId` (null: after the cargo company). */
export function childrenOf(
  shipment: Shipment,
  parentId: string | null,
): ShipmentStop[] {
  return shipment.stops.filter((stop) => stop.parent_stop_id === parentId);
}

/** How many packages have left a place across every road, including roads that rejoin later. */
export function packagesSentFrom(shipment: Shipment, stopId: string): number {
  return (
    childrenOf(shipment, stopId).reduce(
      (sum, child) => sum + child.packages_sent,
      0,
    ) +
    shipment.stops.reduce(
      (sum, other) =>
        sum +
        (other.extra_parents ?? [])
          .filter((link) => link.from_stop_id === stopId)
          .reduce((inner, link) => inner + link.packages_sent, 0),
      0,
    )
  );
}

/** Packages available after an optional split or combination at this place. */
export function packagesAfterChange(stop: ShipmentStop): number {
  return stop.package_change_kind && stop.packages_after_change != null
    ? stop.packages_after_change
    : stop.packages_received;
}

/** The most this place may send across all of its outgoing roads. */
export function packagesAvailableToSend(stop: ShipmentStop): number {
  return packagesAfterChange(stop);
}

/** The most packages that can be sent on one road into `stop`.  A normal road starts at the
 * stop's parent; an additional road starts at `sourceId`.  All other roads leaving the same
 * source reserve their packages first. */
export function packagesAvailableOnRoad(
  shipment: Shipment,
  stop: ShipmentStop,
  sourceId: string | null = stop.parent_stop_id,
): number {
  const packagesOnRoad =
    sourceId === stop.parent_stop_id
      ? stop.packages_sent
      : (stop.extra_parents?.find((link) => link.from_stop_id === sourceId)
          ?.packages_sent ?? 0);
  if (sourceId === null) {
    return Math.max(
      0,
      shipment.total_packages -
        (shipment.packages_sent_by_cargo - packagesOnRoad),
    );
  }
  const source = shipment.stops.find((entry) => entry.stop_id === sourceId);
  if (!source) return 0;
  const sentElsewhere = packagesSentFrom(shipment, sourceId) - packagesOnRoad;
  return Math.max(0, packagesAvailableToSend(source) - sentElsewhere);
}

/** Packages that have reached a place and have not been sent on from it: what is "here now".
 *  Goods already on the road are not here. A gate holds what it received, so nothing is on
 *  the way there. */
export function packagesHere(shipment: Shipment, stop: ShipmentStop): number {
  if (stop.is_gate) return 0;
  const onward = packagesSentFrom(shipment, stop.stop_id);
  return Math.max(
    0,
    packagesAfterChange(stop) - onward - (stop.lost_packages ?? 0),
  );
}

/** Packages that have reached a gate, over every route. */
function finalReceived(shipment: Shipment): number {
  return gateStops(shipment).reduce(
    (sum, stop) => sum + stop.packages_received,
    0,
  );
}

/** Packages of this shipment that have still not reached a gate.
 *
 *  Measured against everything the shipment set out with, not against what the last place
 *  happened to pass on: if 10 leave the supplier and 7 reach the gate, 3 are still owed. */
export function finalRemaining(shipment: Shipment): number {
  return Math.max(
    0,
    shipment.total_packages -
      shipment.final_received_packages -
      (shipment.lost_packages ?? 0),
  );
}

export function shipmentStatus(shipment: Shipment): ShipmentStatus {
  if (shipment.packages_sent_by_cargo <= 0) return "waiting_at_cargo";
  if (
    shipment.total_packages > 0 &&
    shipment.final_received_packages + (shipment.lost_packages ?? 0) >=
      shipment.total_packages
  ) {
    return "completed";
  }
  if (shipment.final_received_packages > 0) return "partly_delivered";
  return "in_transit";
}

/** Puts the places in drawing order (depth first, each place right after the one it came
 *  from), which is the order the server stores them in. */
export function orderStops(stops: ShipmentStop[]): ShipmentStop[] {
  const known = new Set(stops.map((stop) => stop.stop_id));
  const ordered: ShipmentStop[] = [];
  const visit = (parentId: string | null): void => {
    for (const stop of stops) {
      const parent =
        stop.parent_stop_id !== null && known.has(stop.parent_stop_id)
          ? stop.parent_stop_id
          : null;
      if (parent === parentId) {
        ordered.push(stop);
        visit(stop.stop_id);
      }
    }
  };
  visit(null);
  return ordered;
}

/** Tidies the figures after an edit. Package counts are not forced to follow each other: a
 *  place may re-count and re-pack, so what reached the next place can honestly differ from
 *  what reached it, and nothing is trimmed to make a route add up (the goods are checked
 *  where they are counted, not the boxes). Only the impossible is removed: nothing below
 *  zero. */
export function normaliseFlow(shipment: Shipment): Shipment {
  const stops = orderStops(shipment.stops).map((stop, index) => ({
    ...stop,
    leg_order: index + 1,
    packages_received: Math.max(0, stop.packages_received),
    packages_sent: Math.max(0, stop.packages_sent),
    packages_after_change:
      stop.packages_after_change == null
        ? stop.packages_after_change
        : Math.max(0, stop.packages_after_change),
  }));
  const next = {
    ...shipment,
    packages_sent_by_cargo: stops
      .filter((stop) => stop.parent_stop_id === null)
      .reduce((sum, stop) => sum + stop.packages_sent, 0),
    stops,
  };
  return { ...next, final_received_packages: finalReceived(next) };
}

let stopCounter = 0;
/** A key for a place that has not been saved yet. */
function newStopKey(): string {
  stopCounter += 1;
  return `new-${Date.now()}-${stopCounter}`;
}

export function newStop(
  parentId: string | null,
  name: string,
  carrier: string,
  isGate = false,
): ShipmentStop {
  return {
    stop_id: newStopKey(),
    parent_stop_id: parentId,
    leg_order: 0,
    stop_name: name,
    carrier_name: carrier,
    packages_received: 0,
    packages_sent: 0,
    lost_packages: 0,
    is_gate: isGate,
  };
}

/** Adds a place straight after `parentId` (null: after the cargo company), taking over
 *  `adoptId` — a place that used to follow `parentId` — as its own follower, so the new place
 *  sits between the two. */
export function insertStop(
  shipment: Shipment,
  parentId: string | null,
  stop: ShipmentStop,
  adoptId?: string,
): Shipment {
  const added = { ...stop, parent_stop_id: parentId };
  const stops = shipment.stops.map((existing) =>
    existing.stop_id === adoptId
      ? { ...existing, parent_stop_id: added.stop_id }
      : existing,
  );
  // A place inserted in front of another takes that place's spot in the list, so the roads
  // leaving the same place keep the order they were drawn in.
  const at = stops.findIndex((existing) => existing.stop_id === adoptId);
  if (at === -1) return { ...shipment, stops: [...stops, added] };
  return {
    ...shipment,
    stops: [...stops.slice(0, at), added, ...stops.slice(at)],
  };
}

/** Takes a place off the route; whatever came after it now follows the place before it. A
 *  gate can only go while another gate is left. */
export function removeStop(shipment: Shipment, stopId: string): Shipment {
  const target = shipment.stops.find((stop) => stop.stop_id === stopId);
  if (!target) return shipment;
  if (target.is_gate && gateStops(shipment).length < 2) return shipment;
  return {
    ...shipment,
    stops: shipment.stops
      .filter((stop) => stop.stop_id !== stopId)
      .map((stop) => ({
        ...stop,
        parent_stop_id:
          stop.parent_stop_id === stopId
            ? target.parent_stop_id
            : stop.parent_stop_id,
        extra_parents: (stop.extra_parents ?? []).filter(
          (link) => link.from_stop_id !== stopId,
        ),
      })),
  };
}

/** Says the cargo company sent `total` packages in all: the first road takes whatever the other
 *  roads leaving the supplier did not. */
export function withCargoSent(shipment: Shipment, total: number): Shipment {
  const roots = shipment.stops.filter((stop) => stop.parent_stop_id === null);
  if (roots.length === 0) return shipment;
  const others = roots
    .slice(1)
    .reduce((sum, stop) => sum + stop.packages_sent, 0);
  return {
    ...shipment,
    stops: shipment.stops.map((stop) =>
      stop.stop_id === roots[0].stop_id
        ? { ...stop, packages_sent: Math.max(0, total - others) }
        : stop,
    ),
  };
}

/** Every place the goods pass through before `stopId`, over every road into it. */
function placesBefore(shipment: Shipment, stopId: string): Set<string> {
  const found = new Set<string>();
  const visit = (id: string): void => {
    const stop = shipment.stops.find((s) => s.stop_id === id);
    if (!stop) return;
    const parents = [
      ...(stop.parent_stop_id ? [stop.parent_stop_id] : []),
      ...(stop.extra_parents ?? []).map((link) => link.from_stop_id),
    ];
    for (const parent of parents) {
      if (!found.has(parent)) {
        found.add(parent);
        visit(parent);
      }
    }
  };
  visit(stopId);
  return found;
}

/** The places a road leaving `fromId` could join: not itself, not a place it already leads to,
 *  and not one before it or after it on the same road (that would be a loop or a shortcut). */
export function linkTargets(
  shipment: Shipment,
  fromId: string,
): ShipmentStop[] {
  const before = placesBefore(shipment, fromId);
  return shipment.stops.filter((stop) => {
    if (stop.stop_id === fromId || before.has(stop.stop_id)) return false;
    if (stop.parent_stop_id === fromId) return false;
    if (placesBefore(shipment, stop.stop_id).has(fromId)) return false;
    return true;
  });
}

/** Joins a second road from `fromId` into `toId`: where routes that forked meet again. */
export function addLink(
  shipment: Shipment,
  fromId: string,
  toId: string,
): Shipment {
  return {
    ...shipment,
    stops: shipment.stops.map((stop) =>
      stop.stop_id === toId
        ? {
            ...stop,
            extra_parents: [
              ...(stop.extra_parents ?? []),
              { from_stop_id: fromId, carrier_name: "", packages_sent: 0 },
            ],
          }
        : stop,
    ),
  };
}

/** Puts `stop` on the further road from `fromId` into `toId`: the goods go from `fromId` to the
 *  new place, then on to `toId`. The road keeps what was sent along it, on both halves. */
export function insertOnLink(
  shipment: Shipment,
  fromId: string,
  toId: string,
  stop: ShipmentStop,
): Shipment {
  const old = shipment.stops
    .find((entry) => entry.stop_id === toId)
    ?.extra_parents?.find((link) => link.from_stop_id === fromId);
  if (!old) return shipment;
  const added: ShipmentStop = {
    ...stop,
    parent_stop_id: fromId,
    packages_sent: old.packages_sent,
  };
  return {
    ...shipment,
    stops: [
      ...shipment.stops.map((entry) =>
        entry.stop_id === toId
          ? {
              ...entry,
              extra_parents: (entry.extra_parents ?? []).map((link) =>
                link.from_stop_id === fromId
                  ? { ...link, from_stop_id: added.stop_id, carrier_name: "" }
                  : link,
              ),
            }
          : entry,
      ),
      added,
    ],
  };
}
