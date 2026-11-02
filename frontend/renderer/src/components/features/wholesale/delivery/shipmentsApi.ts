// The Delivery screen's writes: creating a shipment with its route, updating either, and a
// write-off.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "../shared/apiClient";
import { type Shipment, type ShipmentStop } from "./shipments";
import { fromPairs, toPairs, type UnitConversions } from "../shared/units";

// ── Shipments ──────────────────────────────────────────────────────────────

interface ShipmentStopWire {
  stop_id: string;
  parent_stop_id: string | null;
  leg_order: number;
  stop_name: string;
  carrier_name: string;
  packages_received: number;
  packages_sent: number;
  package_change_kind?: "split" | "combine" | null;
  packages_after_change?: number | null;
  lost_packages?: number;
  is_gate: boolean;
  extra_parents?: {
    from_stop_id: string;
    carrier_name: string;
    packages_sent: number;
  }[];
  counted?: boolean;
}

export interface ShipmentWire {
  shipment_id: string;
  branch_id: string | null;
  shipment_no: string;
  voucher_no: string;
  supplier_name: string;
  carrier_name: string;
  sent_on: string;
  total_packages: number;
  total_quantity_pairs: number;
  total_unit: string;
  packages_sent_by_cargo: number;
  final_received_packages: number;
  lost_packages?: number;
  final_lost_packages?: number;
  allowed_actions?: string[];
  version_id?: number;
  stops: ShipmentStopWire[];
}

export const SHIPMENTS_URL = `${apiBaseUrl}/api/wholesale/shipments`;

/** The wire shape uses total_quantity_pairs (what the server actually stores); the screens still
 *  say total_quantity_pairs (what it was written in), converted here at the one seam rather than
 *  renamed through every call site. */
function shipmentFromWire(wire: ShipmentWire): Shipment {
  return {
    shipment_id: wire.shipment_id,
    shipment_no: wire.shipment_no,
    voucher_no: wire.voucher_no,
    supplier_name: wire.supplier_name,
    carrier_name: wire.carrier_name,
    sent_on: wire.sent_on,
    total_packages: wire.total_packages,
    // Shipment responses carry the normalized pair total; the screen model stores the
    // value in the shipment's displayed unit and converts it back at the one seam.
    total_quantity_pairs: fromPairs(
      wire.total_quantity_pairs,
      wire.total_unit as Shipment["total_unit"],
    ),
    total_unit: wire.total_unit as Shipment["total_unit"],
    packages_sent_by_cargo: wire.packages_sent_by_cargo,
    final_received_packages: wire.final_received_packages,
    lost_packages: wire.lost_packages ?? 0,
    final_lost_packages: wire.final_lost_packages ?? 0,
    allowed_actions: wire.allowed_actions ?? [],
    version_id: wire.version_id ?? 1,
    stops: wire.stops.map((stop) => ({
      stop_id: stop.stop_id,
      parent_stop_id: stop.parent_stop_id,
      leg_order: stop.leg_order,
      stop_name: stop.stop_name,
      carrier_name: stop.carrier_name,
      packages_received: stop.packages_received,
      packages_sent: stop.packages_sent ?? stop.packages_received,
      package_change_kind: stop.package_change_kind ?? null,
      packages_after_change: stop.packages_after_change ?? null,
      lost_packages: stop.lost_packages ?? 0,
      is_gate: stop.is_gate,
      extra_parents: (stop.extra_parents ?? []).map((link) => ({ ...link })),
      counted: stop.counted ?? false,
    })),
  };
}

/** A stop as the server takes it: its id is its key, and a place not saved yet carries a
 *  temporary key that the places after it can name as their parent. */
function stopToWire(stop: ShipmentStop): {
  key: string;
  parent_key: string | null;
  stop_name: string;
  carrier_name: string;
  packages_received: number;
  packages_sent: number;
  package_change_kind: "split" | "combine" | null;
  packages_after_change: number | null;
  is_gate: boolean;
  extra_parents: {
    from_key: string;
    carrier_name: string;
    packages_sent: number;
  }[];
} {
  return {
    key: stop.stop_id,
    parent_key: stop.parent_stop_id,
    stop_name: stop.stop_name,
    carrier_name: stop.carrier_name === "—" ? "" : stop.carrier_name,
    packages_received: stop.packages_received,
    packages_sent: stop.packages_sent,
    package_change_kind: stop.package_change_kind ?? null,
    packages_after_change: stop.packages_after_change ?? null,
    is_gate: stop.is_gate,
    extra_parents: (stop.extra_parents ?? []).map((link) => ({
      from_key: link.from_stop_id,
      carrier_name: link.carrier_name === "—" ? "" : link.carrier_name,
      packages_sent: link.packages_sent,
    })),
  };
}

export interface NewShipmentInput {
  voucher_no: string;
  supplier_name: string;
  carrier_name: string;
  sent_on: string;
  total_packages: number;
  /** Quantity in `total_unit`; converted to the API's canonical pairs on write. */
  total_quantity_pairs: number;
  total_unit: Shipment["total_unit"];
  /** The route; at least one place is a gate. */
  stops: ShipmentStop[];
}

export function shipmentsFromWire(wires: ShipmentWire[]): Shipment[] {
  return wires.map(shipmentFromWire);
}

export async function createShipment(
  session: Session,
  input: NewShipmentInput,
): Promise<Shipment> {
  const wire = await request<ShipmentWire>(
    session,
    "/api/wholesale/shipments",
    {
      method: "POST",
      body: {
        voucher_no: input.voucher_no,
        supplier_name: input.supplier_name,
        carrier_name: input.carrier_name,
        sent_on: input.sent_on,
        total_packages: input.total_packages,
        // Shipment form values are kept in the unit the user selected. The API stores
        // this field in pairs, just as the receiving endpoints do below.
        total_quantity_pairs: toPairs(
          input.total_quantity_pairs,
          input.total_unit,
        ),
        total_unit: input.total_unit,
        stops: input.stops.map(stopToWire),
      },
    },
  );
  return shipmentFromWire(wire);
}

export async function updateShipment(
  session: Session,
  shipmentId: string,
  patch: Partial<Shipment> & Pick<Shipment, "total_unit">,
): Promise<Shipment> {
  const body: Record<string, unknown> = {};
  if (patch.voucher_no !== undefined) body.voucher_no = patch.voucher_no;
  if (patch.supplier_name !== undefined)
    body.supplier_name = patch.supplier_name;
  if (patch.carrier_name !== undefined) body.carrier_name = patch.carrier_name;
  if (patch.sent_on !== undefined) body.sent_on = patch.sent_on;
  if (patch.total_packages !== undefined)
    body.total_packages = patch.total_packages;
  if (patch.total_quantity_pairs !== undefined)
    body.total_quantity_pairs = toPairs(
      patch.total_quantity_pairs,
      patch.total_unit,
    );
  if (patch.total_unit !== undefined) body.total_unit = patch.total_unit;
  if (patch.stops !== undefined) body.stops = patch.stops.map(stopToWire);

  const wire = await request<ShipmentWire>(
    session,
    `/api/wholesale/shipments/${shipmentId}`,
    { method: "PATCH", body },
  );
  return shipmentFromWire(wire);
}

export async function deleteShipment(
  session: Session,
  shipmentId: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/shipments/${shipmentId}`, {
    method: "DELETE",
  });
}

export type WriteOffReason =
  "lost_in_transit" | "damaged" | "short_shipped" | "other" | "repackaged";

export interface WriteOffInput {
  /** Pairs (packages, for a shipment). Left out when `color_breakdown` says what it is made of. */
  quantity?: number;
  /** The colours the quantity is made of ("black1s,white1s"); the server adds them up. */
  color_breakdown?: string;
  reason?: WriteOffReason;
  note: string;
}

export interface WriteOffWire extends Omit<WriteOffInput, "quantity" | "reason" | "color_breakdown"> {
  quantity: number;
  color_breakdown: string;
  reason: WriteOffReason;
  write_off_id: string;
  branch_id: string | null;
  subject_type: "shipment" | "shipment_leg" | "voucher_line" | "order_line";
  subject_id: string;
  reference: string;
  description: string;
  stock_code: string;
  unit: string;
  unit_conversions?: UnitConversions;
  /** A normal shortfall changes outstanding quantities; a quantity change is read-only history. */
  record_type?: "shortfall" | "quantity_change";
  quantity_before?: number | null;
  quantity_after?: number | null;
  recorded_by_user_id: string;
  created_at: string;
}

export async function writeOffShipment(
  session: Session,
  shipmentId: string,
  input: WriteOffInput & { stop_id?: string },
): Promise<WriteOffWire> {
  return request<WriteOffWire>(
    session,
    `/api/wholesale/shipments/${shipmentId}/write-off`,
    { method: "POST", body: input },
  );
}
