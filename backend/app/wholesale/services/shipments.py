"""The Delivery screen's business rules — one slip travelling as freight along a route that can
fork: from the cargo company through any number of places, each route ending at a gate. Ports
frontend/renderer/src/components/features/wholesale/delivery/shipments.ts.

How many packages reached a place is only a fact about that place: figures along a route are not
forced to add up, because a place may re-count and re-pack. `counts` below is what receivings
have counted per place (stop id -> packages); a counted place uses that number instead of the one
typed on the stop.
"""

from dataclasses import dataclass, field

from app.wholesale.models.entities import Shipment, ShipmentStop
from app.wholesale.services.shared import share_pct


@dataclass
class LinkInput:
    """A further road into a place, from the place with key `from_key`."""

    from_key: str
    carrier_name: str = ""
    packages_sent: int = 0


@dataclass
class StopInput:
    """One place on a route as the client sends it. `key` is the stop's id when it already
    exists, otherwise any string that is unique in the request; `parent_key` names the stop
    before it, None when the goods came straight from the cargo company."""

    key: str
    parent_key: str | None
    stop_name: str
    carrier_name: str
    packages_received: int
    is_gate: bool
    # None means "not said": it is then the number that arrived (or, for the first place after
    # the supplier, what the request says the cargo company sent).
    packages_sent: int | None = None
    package_change_kind: str | None = None
    packages_after_change: int | None = None
    extra_parents: list[LinkInput] = field(default_factory=list)


def arrived(stop: ShipmentStop, counts: dict[str, int] | None = None) -> int:
    """Packages that reached this place: what a receiving counted there, else what was typed."""
    if counts and stop.id in counts:
        return counts[stop.id]
    return stop.packages_received


def gates(shipment: Shipment) -> list[ShipmentStop]:
    return [stop for stop in shipment.stops if stop.is_gate]


def children_by_parent(shipment: Shipment) -> dict[str | None, list[ShipmentStop]]:
    result: dict[str | None, list[ShipmentStop]] = {}
    for stop in shipment.stops:
        result.setdefault(stop.parent_stop_id, []).append(stop)
    return result


def here_now(shipment: Shipment, stop: ShipmentStop, counts: dict[str, int] | None = None) -> int:
    """Packages available at this place after an optional split/combine, less the ones sent on
    or written off here. Goods already on the road are not "here"; a gate holds what it
    received, so it has none "on the way"."""
    if stop.is_gate:
        return 0
    onward = sum(child.packages_sent for child in children_by_parent(shipment).get(stop.id, []))
    onward += sum(
        link.packages_sent for other in shipment.stops for link in getattr(other, "links_in", []) if link.from_stop_id == stop.id
    )
    available = (
        stop.packages_after_change
        if stop.package_change_kind is not None and stop.packages_after_change is not None
        else arrived(stop, counts)
    )
    return max(0, available - onward - stop.lost_packages)


def cargo_remaining(shipment: Shipment) -> int:
    """Packages the cargo company still has not sent."""
    return max(0, shipment.total_packages - shipment.packages_sent_by_cargo)


def final_received(shipment: Shipment, counts: dict[str, int] | None = None) -> int:
    """Packages that have reached a gate, over every route."""
    return sum(arrived(stop, counts) for stop in gates(shipment))


def total_lost(shipment: Shipment) -> int:
    return getattr(shipment, "lost_packages", 0) + sum(stop.lost_packages for stop in shipment.stops)


def final_remaining(shipment: Shipment, received: int) -> int:
    """Packages of this shipment that have still not reached a gate, measured against everything
    the shipment set out with."""
    return max(0, shipment.total_packages - received - total_lost(shipment))


def shipment_status(shipment: Shipment, received: int) -> str:
    if shipment.packages_sent_by_cargo <= 0:
        return "waiting_at_cargo"
    if shipment.total_packages > 0 and received + total_lost(shipment) >= shipment.total_packages:
        return "completed"
    if received > 0:
        return "partly_delivered"
    return "in_transit"


def destination_count(shipment: Shipment) -> int:
    """Every place the packages arrive at on the way here: the cargo company and each place on
    the route (the gates included). The supplier is not counted — that is where the goods start."""
    return len(shipment.stops) + 1


def arrived_pct(shipment: Shipment, received: int) -> int:
    return share_pct(received, shipment.total_packages)


def normalise_flow(stops: list[StopInput]) -> list[StopInput]:
    """Tidies the figures after an edit. Package counts are NOT forced to follow each other: a
    place may re-count and re-pack, so what reached the next place can honestly be a different
    number, and nothing is trimmed to make a route add up. The goods (sets, by color) are checked
    where they are counted, not the boxes.

    Only the impossible is removed: no figure below zero."""
    settled = [
        StopInput(
            key=stop.key,
            parent_key=stop.parent_key,
            stop_name=stop.stop_name,
            carrier_name=stop.carrier_name,
            packages_received=max(0, stop.packages_received),
            is_gate=stop.is_gate,
            packages_sent=None if stop.packages_sent is None else max(0, stop.packages_sent),
            package_change_kind=stop.package_change_kind,
            packages_after_change=(
                None
                if stop.packages_after_change is None
                else max(0, stop.packages_after_change)
            ),
            extra_parents=[
                LinkInput(link.from_key, link.carrier_name, max(0, link.packages_sent))
                for link in stop.extra_parents
            ],
        )
        for stop in stops
    ]
    return settled


def shipment_derived(shipment: Shipment, counts: dict[str, int] | None = None) -> dict:
    """Every worked-out figure for one shipment, as its API response includes them."""
    received = final_received(shipment, counts)
    return {
        "final_received_packages": received,
        "cargo_remaining": cargo_remaining(shipment),
        "lost_packages": total_lost(shipment),
        "final_lost_packages": getattr(shipment, "lost_packages", 0),
        "final_remaining": final_remaining(shipment, received),
        "shipment_status": shipment_status(shipment, received),
        "destination_count": destination_count(shipment),
        "arrived_pct": arrived_pct(shipment, received),
        "stops": {
            stop.id: {
                "packages_arrived": arrived(stop, counts),
                "packages_sent": stop.packages_sent,
                "here_now": here_now(shipment, stop, counts),
                "counted": bool(counts) and stop.id in counts,
            }
            for stop in shipment.stops
        },
    }
