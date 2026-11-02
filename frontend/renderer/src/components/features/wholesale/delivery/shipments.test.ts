import { describe, expect, it } from "vitest";
import {
  childrenOf,
  finalDestination,
  insertStop,
  newStop,
  normaliseFlow,
  packagesAvailableOnRoad,
  orderStops,
  packagesAvailableToSend,
  packagesHere,
  packagesSentFrom,
  removeStop,
  shipmentStatus,
  type Shipment,
  type ShipmentStop,
} from "./shipments";

function stop(
  id: string,
  parent: string | null,
  received: number,
  isGate = false,
  sent = received,
): ShipmentStop {
  return {
    packages_sent: sent,
    stop_id: id,
    parent_stop_id: parent,
    leg_order: 0,
    stop_name: id,
    carrier_name: "",
    packages_received: received,
    lost_packages: 0,
    is_gate: isGate,
  };
}

function shipment(stops: ShipmentStop[], total = 5): Shipment {
  return {
    shipment_id: "s1",
    shipment_no: "SHP-1",
    voucher_no: "V1",
    supplier_name: "Maldini",
    carrier_name: "Shwe Moe",
    sent_on: "2026-10-01",
    total_packages: total,
    total_quantity_pairs: 10,
    total_unit: "set",
    packages_sent_by_cargo: total,
    final_received_packages: 0,
    stops,
  };
}

const forked = (): Shipment =>
  shipment([
    stop("Yangon", null, 5),
    stop("Gate A", "Yangon", 2, true),
    stop("Gate B", "Yangon", 2, true),
  ]);

describe("a route that forks", () => {
  it("counts what is still at a place after what went on from it", () => {
    const route = forked();
    expect(packagesHere(route, route.stops[0])).toBe(1);
  });

  it("has nothing on the way at a gate", () => {
    const route = forked();
    expect(packagesHere(route, route.stops[1])).toBe(0);
  });

  it("adds up every gate and names them all", () => {
    const route = normaliseFlow(forked());
    expect(route.final_received_packages).toBe(4);
    expect(finalDestination(route)).toBe("Gate A, Gate B");
    expect(shipmentStatus(route)).toBe("partly_delivered");
  });
});

describe("what was sent along a road", () => {
  it("leaves goods already on the road out of what is here", () => {
    // 10 reached Yangon, the carrier took 8 on and only 7 arrived: 2 are still at Yangon.
    const route = shipment([
      stop("Yangon", null, 10),
      stop("Gate", "Yangon", 7, true, 8),
    ]);
    expect(packagesHere(route, route.stops[0])).toBe(2);
  });

  it("counts every road leaving a place, including an extra road", () => {
    const route = shipment([
      stop("Yangon", null, 2),
      stop("Bago", "Yangon", 1, false, 3),
      {
        ...stop("Gate", "Bago", 1, true, 1),
        extra_parents: [
          { from_stop_id: "Yangon", carrier_name: "", packages_sent: 2 },
        ],
      },
    ]);
    expect(packagesSentFrom(route, "Yangon")).toBe(5);
  });

  it("uses the number after a package split for what is here now", () => {
    const route = shipment(
      [
        {
          ...stop("Yangon", null, 2),
          package_change_kind: "split",
          packages_after_change: 6,
        },
        stop("Bago", "Yangon", 3, false, 3),
        stop("Gate", "Yangon", 3, true, 3),
      ],
      2,
    );
    expect(packagesHere(route, route.stops[0])).toBe(0);
  });

  it("sets the outbound limit from handling, or from arrivals when unchanged", () => {
    const unchanged = stop("Yangon", null, 2);
    const split = {
      ...stop("Bago", null, 3),
      package_change_kind: "split" as const,
      packages_after_change: 6,
    };
    const combined = {
      ...stop("Mandalay", null, 3),
      package_change_kind: "combine" as const,
      packages_after_change: 1,
    };
    expect(packagesAvailableToSend(unchanged)).toBe(2);
    expect(packagesAvailableToSend(split)).toBe(6);
    expect(packagesAvailableToSend(combined)).toBe(1);
  });

  it("uses the parent stop's post-combination packages for a normal road", () => {
    const route = shipment(
      [
        {
          ...stop("Yangon", null, 3),
          package_change_kind: "combine",
          packages_after_change: 2,
        },
        stop("Magway", "Yangon", 0, true, 0),
      ],
      3,
    );

    expect(packagesAvailableOnRoad(route, route.stops[1])).toBe(2);
  });

  it("makes what the cargo company sent the total over every road leaving the supplier", () => {
    const route = normaliseFlow(
      shipment([
        stop("Gate A", null, 2, true, 3),
        stop("Gate B", null, 1, true, 2),
        stop("Later", "Gate A", 1, false, 9),
      ]),
    );
    expect(route.packages_sent_by_cargo).toBe(5);
  });
});

describe("keeping the route in drawing order", () => {
  it("puts each place right after the one it came from", () => {
    const scrambled = [
      stop("Gate B", "Yangon", 1, true),
      stop("Yangon", null, 5),
      stop("Gate A", "Yangon", 1, true),
    ];
    expect(orderStops(scrambled).map((s) => s.stop_id)).toEqual([
      "Yangon",
      "Gate B",
      "Gate A",
    ]);
  });

  it("numbers the places and keeps no figure below zero", () => {
    const route = normaliseFlow(
      shipment([stop("Yangon", null, -3), stop("Gate", "Yangon", 2, true)]),
    );
    expect(route.stops.map((s) => [s.leg_order, s.packages_received])).toEqual([
      [1, 0],
      [2, 2],
    ]);
  });
});

describe("editing the route", () => {
  it("puts a new stop between two places", () => {
    const route = shipment([
      stop("Yangon", null, 5),
      stop("Gate", "Yangon", 5, true),
    ]);
    const added = insertStop(
      route,
      "Yangon",
      newStop("Yangon", "Bago", ""),
      "Gate",
    );
    const bago = added.stops.find(
      (s) => s.stop_name === "Bago",
    ) as ShipmentStop;
    expect(bago.parent_stop_id).toBe("Yangon");
    expect(added.stops.find((s) => s.stop_id === "Gate")?.parent_stop_id).toBe(
      bago.stop_id,
    );
  });

  it("starts another route from a place without disturbing the first", () => {
    const route = shipment([
      stop("Yangon", null, 5),
      stop("Gate A", "Yangon", 5, true),
    ]);
    const added = insertStop(
      route,
      "Yangon",
      newStop("Yangon", "Gate B", "", true),
    );
    expect(childrenOf(added, "Yangon").map((s) => s.stop_name)).toEqual([
      "Gate A",
      "Gate B",
    ]);
  });

  it("hands what came after a removed stop to the place before it", () => {
    const route = shipment([
      stop("Yangon", null, 5),
      stop("Bago", "Yangon", 5),
      stop("Gate", "Bago", 5, true),
    ]);
    const removed = removeStop(route, "Bago");
    expect(removed.stops.map((s) => s.stop_id)).toEqual(["Yangon", "Gate"]);
    expect(removed.stops[1].parent_stop_id).toBe("Yangon");
  });

  it("keeps the last gate", () => {
    const route = shipment([stop("Gate", null, 5, true)]);
    expect(removeStop(route, "Gate").stops).toHaveLength(1);
  });
});
