"""app/wholesale/services/shipments.py — package counts along a route are not forced to add up
(a place can re-pack), only kept at zero or more; and what is "here now" at a place."""

from types import SimpleNamespace

from app.wholesale.services.shipments import (
    StopInput,
    final_received,
    final_remaining,
    here_now,
    normalise_flow,
    shipment_status,
)


def _stop(key, parent_key=None, received=0, is_gate=False, sent=None) -> StopInput:
    return StopInput(
        key=key, parent_key=parent_key, stop_name=key, carrier_name="",
        packages_received=received, is_gate=is_gate, packages_sent=sent,
    )


def test_package_counts_are_left_as_entered_so_a_place_can_repack() -> None:
    # Yangon got 10 packages, re-packed them, and 8 reached the gate. Nothing is trimmed to make
    # the route add up — the count of boxes is allowed to change.
    stops = [_stop("Yangon", None, 10), _stop("Gate", "Yangon", 8, is_gate=True)]
    settled = normalise_flow(stops)
    assert [stop.packages_received for stop in settled] == [10, 8]


def test_more_boxes_can_arrive_than_were_sent() -> None:
    # Two boxes opened and packed into three: more coming out than going in is fine.
    stops = [_stop("Yangon", None, 2), _stop("Gate", "Yangon", 3, is_gate=True)]
    settled = normalise_flow(stops)
    assert settled[1].packages_received == 3


def test_no_figure_goes_below_zero() -> None:
    settled = normalise_flow([_stop("Yangon", None, -1, sent=-2)])
    assert (settled[0].packages_received, settled[0].packages_sent) == (0, 0)


def _shipment(stops, total=10, sent=10, lost=0):
    return SimpleNamespace(total_packages=total, packages_sent_by_cargo=sent, lost_packages=lost, stops=stops)


def _node(id, parent, received, is_gate=False, lost=0, sent=None):
    return SimpleNamespace(
        id=id, parent_stop_id=parent, packages_received=received, is_gate=is_gate, lost_packages=lost,
        packages_sent=received if sent is None else sent,
    )


def test_goods_already_on_the_road_are_not_here_any_more() -> None:
    # 10 reached Yangon, the carrier took 8 on (and only 7 arrived): 2 are still at Yangon, the
    # 1 missing is on that road, not at Yangon.
    yangon = _node("y", None, 10)
    shipment = _shipment([yangon, _node("g", "y", 7, is_gate=True, sent=8)])
    assert here_now(shipment, yangon) == 2


def test_here_now_is_what_arrived_at_a_place_less_what_was_sent_on() -> None:
    yangon = _node("y", None, 10)
    shipment = _shipment([yangon, _node("a", "y", 4, is_gate=True), _node("b", "y", 3, is_gate=True)])
    assert here_now(shipment, yangon) == 3


def test_a_counted_place_uses_the_counted_number() -> None:
    yangon = _node("y", None, 10)
    shipment = _shipment([yangon, _node("a", "y", 4, is_gate=True)])
    assert here_now(shipment, yangon, {"y": 7}) == 3


def test_a_gate_holds_what_it_got_so_nothing_is_on_the_way_there() -> None:
    gate = _node("g", None, 4, is_gate=True)
    assert here_now(_shipment([gate]), gate) == 0


def test_the_gates_of_every_route_add_up() -> None:
    shipment = _shipment([_node("a", None, 4, is_gate=True), _node("b", None, 3, is_gate=True)])
    assert final_received(shipment) == 7
    assert final_remaining(shipment, 7) == 3
    assert shipment_status(shipment, 7) == "partly_delivered"


def test_a_shipment_is_completed_when_every_package_is_at_a_gate_or_written_off() -> None:
    shipment = _shipment([_node("a", None, 6, is_gate=True), _node("b", None, 3, is_gate=True, lost=1)])
    assert shipment_status(shipment, final_received(shipment)) == "completed"
