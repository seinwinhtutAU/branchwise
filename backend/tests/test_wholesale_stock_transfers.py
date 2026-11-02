from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.entities import (
    ProductGroup,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    ShipmentStop,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesaleUnit,
)


def _setup(db: Session) -> SupplierVoucher:
    """A voucher for 10 sets of A1001 (black 6, white 4), all counted in at "Gate"."""
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    db.add(User(id="test-user-id", name="Tester", email="t@example.com", role=UserRole.WHOLESALE, branch_id=branch.id))
    voucher = SupplierVoucher(
        branch_id=branch.id, voucher_no="VCH-1", supplier_name="Factory", voucher_date=date(2026, 9, 10),
        carrier_name="Cargo", total_packages=2,
        lines=[SupplierVoucherLine(
            stock_code="A1001", description="Sandal", product_group=ProductGroup.MAN,
            color_breakdown="black6s,white4s", colors=[], unit=WholesaleUnit.SET, quantity_pairs=60,
            buying_price=10000,
        )],
    )
    db.add(voucher)
    shipment = Shipment(
        branch_id=branch.id,
        shipment_no="SHP-1",
        voucher_no="VCH-1",
        supplier_name="Factory",
        carrier_name="Cargo",
        sent_on=date(2026, 9, 11),
        total_packages=2,
        total_quantity_pairs=60,
        total_unit=WholesaleUnit.SET,
        packages_sent_by_cargo=2,
        stops=[ShipmentStop(leg_order=1, stop_name="Gate", carrier_name="", packages_received=2, is_gate=True)],
    )
    db.add(shipment)
    db.flush()
    db.add(Receiving(
        branch_id=branch.id, receiving_no="RCV-1", shipment_id=shipment.id, stop_id=shipment.stops[-1].id, shipment_no="SHP-1", voucher_no="VCH-1",
        supplier_name="Factory", gate="Gate", received_on=date(2026, 9, 12), total_packages=2, total_quantity_pairs=60,
        total_unit=WholesaleUnit.SET,
        packages=[
            ReceivingPackage(package_no=1, opened=True, received_on=date(2026, 9, 12), items=[
                ReceivingItem(stock_code="A1001", description="Sandal", product_group=ProductGroup.MAN,
                              color_breakdown="black6s,white1s", colors=[], unit=WholesaleUnit.SET, quantity_pairs=42),
            ]),
            ReceivingPackage(package_no=2, opened=True, received_on=date(2026, 9, 12), items=[
                ReceivingItem(stock_code="A1001", description="Sandal", product_group=ProductGroup.MAN,
                              color_breakdown="white3s", colors=[], unit=WholesaleUnit.SET, quantity_pairs=18),
            ]),
        ],
    ))
    db.commit()
    return voucher


def _move(client: TestClient, voucher: SupplierVoucher, colors: str, to: str = "Warehouse A", **extra):
    return client.post(
        "/api/wholesale/stock-transfers",
        json={
            "voucher_id": voucher.id, "to_location": to, "moved_on": "2026-09-14",
            "lines": [{"stock_code": "A1001", "color_breakdown": colors, "unit": "set"}], **extra,
        },
    )


def _pool(client: TestClient, voucher: SupplierVoucher) -> dict:
    gates = client.get(f"/api/wholesale/stock-transfers/pool?voucher_id={voucher.id}").json()["gates"]
    return {g["location"]: {p["stock_code"]: p for p in g["products"]} for g in gates}


def _count(client: TestClient, transfer: dict, colors: str | None = None):
    """The destination counts a move; by default it counts exactly what was sent."""
    line = transfer["lines"][0]
    return client.put(
        f"/api/wholesale/stock-transfers/{transfer['transfer_id']}/count",
        json={"counted_on": "2026-09-15",
              "lines": [{"stock_code": line["stock_code"], "color_breakdown": colors or line["color_breakdown"], "unit": "set"}]},
    )


def test_pool_shows_what_was_counted_at_the_gate_by_colour(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    product = _pool(authed_client, voucher)["Gate"]["A1001"]
    assert product["counted_pairs"] == {"black": 36, "white": 24}
    assert product["left_pairs"] == {"black": 36, "white": 24}
    assert product["moved_pairs"] == {}


def test_transfer_moves_stock_out_of_the_pool_and_into_the_warehouse(
    authed_client: TestClient, db_session: Session
) -> None:
    voucher = _setup(db_session)
    moved = _move(authed_client, voucher, "black4s,white1s", note="First truck")
    assert moved.status_code == 201
    body = moved.json()
    assert (body["from_location"], body["to_location"]) == ("Gate", "Warehouse A")
    assert body["lines"][0]["quantity_pairs"] == 30
    from app.wholesale.models.master_data import WholesalePlace

    place = db_session.query(WholesalePlace).filter(WholesalePlace.name == "Warehouse A").one()
    assert place.is_warehouse is True

    product = _pool(authed_client, voucher)["Gate"]["A1001"]
    assert product["moved_pairs"] == {"black": 24, "white": 6}
    assert product["left_pairs"] == {"black": 12, "white": 18}

    rows = authed_client.get("/api/wholesale/inventory?page_size=2000").json()
    kinds = {(r["movement_type"], r["location"]) for r in rows if r["reference"] == "VCH-1"}
    # The goods left the gate at once, but the warehouse has nothing until it counts them.
    assert ("transfer_out", "Gate") in kinds and ("transfer_in", "Warehouse A") not in kinds
    assert _count(authed_client, body).status_code == 200
    rows = authed_client.get("/api/wholesale/inventory?page_size=2000").json()
    kinds = {(r["movement_type"], r["location"]) for r in rows if r["reference"] == "VCH-1"}
    assert ("transfer_in", "Warehouse A") in kinds

    listed = authed_client.get(f"/api/wholesale/stock-transfers?voucher_id={voucher.id}").json()
    assert [t["to_location"] for t in listed] == ["Warehouse A"]


def test_transfer_promotes_an_existing_place_to_warehouse(
    authed_client: TestClient, db_session: Session
) -> None:
    from app.wholesale.models.master_data import WholesalePlace

    voucher = _setup(db_session)
    place = WholesalePlace(name="Yangon Depot", active=True, is_warehouse=False)
    db_session.add(place)
    db_session.commit()

    moved = _move(authed_client, voucher, "black1s", to="Yangon Depot")

    assert moved.status_code == 201
    db_session.refresh(place)
    assert place.is_warehouse is True


def test_transfer_cannot_take_more_than_is_left_at_the_gate(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    assert _move(authed_client, voucher, "black4s").status_code == 201
    too_much = _move(authed_client, voucher, "black3s")
    assert too_much.status_code == 422
    assert "black" in too_much.json()["detail"]
    assert _move(authed_client, voucher, "black2s").status_code == 201  # exactly what was left


def test_transfer_rules(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    assert _move(authed_client, voucher, "pink1s").status_code == 422  # a colour never counted
    assert _move(authed_client, voucher, "black1s", from_location="Nowhere").status_code == 422
    assert _move(authed_client, voucher, "black1").status_code == 422  # colour needs a unit letter
    other = authed_client.post(
        "/api/wholesale/stock-transfers",
        json={"voucher_id": voucher.id, "to_location": "Warehouse A", "moved_on": "2026-09-14",
              "lines": [{"stock_code": "Z9999", "color_breakdown": "black1s", "unit": "set"}]},
    )
    assert other.status_code == 422


def test_moving_to_the_same_gate_records_and_counts_the_transfer(
    authed_client: TestClient, db_session: Session
) -> None:
    voucher = _setup(db_session)

    moved = _move(authed_client, voucher, "black4s,white1s", to="Gate")

    assert moved.status_code == 201
    transfer = moved.json()
    assert (transfer["from_location"], transfer["to_location"]) == ("Gate", "Gate")
    assert transfer["counted_on"] == "2026-09-14"
    assert transfer["lines"][0]["counted_color_breakdown"] == "black4s,white1s"
    assert transfer["lines"][0]["counted_quantity_pairs"] == 30

    # The destination was made a warehouse, but the move remains visible instead of silently
    # treating the receiving as warehouse stock.
    listed = authed_client.get(f"/api/wholesale/stock-transfers?voucher_id={voucher.id}").json()
    assert [(row["from_location"], row["to_location"]) for row in listed] == [("Gate", "Gate")]
    pool = authed_client.get(f"/api/wholesale/stock-transfers/pool?voucher_id={voucher.id}").json()
    assert pool["gates"] == []
    assert pool["warehouse_gates"] == ["Gate"]

    # The same-place transfer is counted in full, so it nets to zero at Gate and the original
    # receiving is now usable warehouse stock rather than stock in transit or double-counted.
    records = authed_client.get("/api/wholesale/inventory/stock?page_size=2000").json()
    record = next(row for row in records if row["stock_code"] == "A1001")
    assert record["warehouse_pairs"] == 60
    assert record["available_pairs"] == 60
    assert record["moving_pairs"] == 0
    rows = authed_client.get("/api/wholesale/inventory?page_size=2000").json()
    kinds = {(row["movement_type"], row["location"]) for row in rows if row["reference"] == "VCH-1"}
    assert ("transfer_out", "Gate") in kinds
    assert ("transfer_in", "Gate") in kinds


def test_undoing_a_transfer_puts_the_stock_back_at_the_gate(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    transfer = _move(authed_client, voucher, "black6s").json()
    assert _pool(authed_client, voucher)["Gate"]["A1001"]["left_pairs"] == {"white": 24}
    assert authed_client.delete(f"/api/wholesale/stock-transfers/{transfer['transfer_id']}").status_code == 204
    assert _pool(authed_client, voucher)["Gate"]["A1001"]["left_pairs"] == {"black": 36, "white": 24}


def _order(client: TestClient) -> dict:
    return client.post(
        "/api/wholesale/orders",
        json={"customer_name": "Daw May", "customer_phone": "09", "customer_address": "Yangon",
              "order_date": "2026-09-13",
              "lines": [{"stock_code": "A1001", "description": "Sandal", "product_group": "man",
                         "supplier_name": "Factory", "color_breakdown": "black4s", "unit": "set",
                         "selling_price": 18000}]},
    ).json()


def _allocate(client: TestClient, order: dict):
    line_id = order["lines"][0]["order_line_id"]
    return client.put(f"/api/wholesale/orders/lines/{line_id}/allocation", json={"color_breakdown": "black4s"})


def _deliver(client: TestClient, order: dict, location: str):
    return client.post(
        "/api/wholesale/inventory/deliveries",
        json={"order_id": order["order_id"], "stock_code": "A1001", "location": location,
              "color_breakdown": "black2s", "unit": "set", "delivered_on": "2026-09-15", "note": ""},
    )


def test_goods_at_a_gate_that_is_not_a_warehouse_cannot_be_allocated_or_delivered(
    authed_client: TestClient, db_session: Session
) -> None:
    voucher = _setup(db_session)
    order = _order(authed_client)
    # Counted at "Gate", which is only a gate: nothing is in stock yet.
    assert _allocate(authed_client, order).status_code == 422
    assert _deliver(authed_client, order, "Gate").status_code == 422

    transfer = _move(authed_client, voucher, "black6s").json()  # every black set leaves the gate
    # Not counted at "Warehouse A" yet, so it is not stock there: nothing is set aside or delivered.
    line = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()["lines"][0]
    assert not line["allocated_color_breakdown"]
    assert _deliver(authed_client, order, "Warehouse A").status_code == 422
    # Counting makes it stock there; the waiting order is set aside by itself.
    assert _count(authed_client, transfer).status_code == 200
    line = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()["lines"][0]
    assert line["allocated_color_breakdown"]
    assert _deliver(authed_client, order, "Warehouse A").status_code == 201
    assert _deliver(authed_client, order, "Gate").status_code == 422
    # And the transfer can't be undone: the goods have already left the warehouse.
    assert authed_client.delete(f"/api/wholesale/stock-transfers/{transfer['transfer_id']}").status_code == 409


def test_goods_counted_at_a_warehouse_are_in_stock_without_a_move(
    authed_client: TestClient, db_session: Session
) -> None:
    voucher = _setup(db_session)
    from app.wholesale.models.master_data import WholesalePlace

    db_session.add(WholesalePlace(name="Gate", active=True, is_warehouse=True))
    db_session.commit()
    order = _order(authed_client)
    assert _allocate(authed_client, order).status_code == 200
    assert _deliver(authed_client, order, "Gate").status_code == 201
    # Nothing is waiting to be moved from a warehouse, and it cannot be moved from as a gate.
    pool = authed_client.get(f"/api/wholesale/stock-transfers/pool?voucher_id={voucher.id}").json()
    assert pool["gates"] == []
    assert pool["warehouse_gates"] == ["Gate"]
    assert _move(authed_client, voucher, "black1s").status_code == 422


def test_stock_records_split_the_stock_between_gate_and_warehouse(
    authed_client: TestClient, db_session: Session
) -> None:
    voucher = _setup(db_session)
    moved = _move(authed_client, voucher, "black4s,white1s")
    assert moved.status_code == 201

    def record() -> dict:
        records = authed_client.get("/api/wholesale/inventory/stock?page_size=2000").json()
        return next(r for r in records if r["stock_code"] == "A1001")

    # Until the warehouse counts, the goods are on their way to it, not in its stock.
    before = record()
    by_place = {loc["location"]: loc for loc in before["locations"]}
    assert by_place["Gate"]["on_hand_pairs"] == 60 - 30
    assert by_place["Warehouse A"]["on_hand_pairs"] == 0
    assert before["on_hand_pairs"] == 30
    assert before["moving_pairs"] == 30
    assert before["moving"] == [{"location": "Warehouse A", "pairs": 30}]

    assert _count(authed_client, moved.json()).status_code == 200
    after = record()
    by_place = {loc["location"]: loc for loc in after["locations"]}
    assert by_place["Warehouse A"]["on_hand_pairs"] == 30
    assert "black" in by_place["Warehouse A"]["colors"]
    assert after["on_hand_pairs"] == 60
    assert after["moving_pairs"] == 0 and after["moving"] == []


def _stock_by_place(client: TestClient) -> dict:
    records = client.get("/api/wholesale/inventory/stock?page_size=2000").json()
    record = next(r for r in records if r["stock_code"] == "A1001")
    return {loc["location"]: loc["on_hand_pairs"] for loc in record["locations"]}, record["on_hand_pairs"]


def test_the_destination_counts_on_arrival_and_a_difference_shows_there(
    authed_client: TestClient, db_session: Session
) -> None:
    voucher = _setup(db_session)
    moved = _move(authed_client, voucher, "black4s,white1s").json()  # 30 pairs sent
    counted = authed_client.put(
        f"/api/wholesale/stock-transfers/{moved['transfer_id']}/count",
        json={"counted_on": "2026-09-15", "lines": [{"stock_code": "A1001", "color_breakdown": "black4s", "unit": "set"}]},
    )
    assert counted.status_code == 200
    line = counted.json()["lines"][0]
    assert line["quantity_pairs"] == 30 and line["counted_quantity_pairs"] == 24
    assert counted.json()["counted_on"] == "2026-09-15"

    by_place, total = _stock_by_place(authed_client)
    assert by_place["Gate"] == 30  # the gate still lost what it sent
    assert by_place["Warehouse A"] == 24  # the warehouse holds what it counted
    assert total == 54  # the 6 pairs that did not arrive are a difference, not stock


def test_an_uncounted_move_is_not_warehouse_stock(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    _move(authed_client, voucher, "black4s,white1s")
    by_place, total = _stock_by_place(authed_client)
    assert by_place.get("Warehouse A", 0) == 0
    assert total == 30  # what stayed at the gate; the 30 sent are on their way


def test_goods_move_between_two_warehouses_without_a_voucher(
    authed_client: TestClient, db_session: Session
) -> None:
    from app.wholesale.models.master_data import WholesaleProduct

    voucher = _setup(db_session)
    db_session.add(WholesaleProduct(stock_code="A1001", description="Sandal", product_group=ProductGroup.MAN))
    db_session.commit()
    first = _move(authed_client, voucher, "black4s,white1s")  # 30 pairs into Warehouse A
    assert first.status_code == 201
    assert _count(authed_client, first.json()).status_code == 200

    moved = authed_client.post(
        "/api/wholesale/stock-transfers",
        json={
            "from_location": "Warehouse A", "to_location": "Warehouse B", "moved_on": "2026-09-16",
            "lines": [{"stock_code": "A1001", "color_breakdown": "black2s", "unit": "set"}],
        },
    )
    assert moved.status_code == 201
    assert moved.json()["voucher_id"] is None
    by_place, total = _stock_by_place(authed_client)
    assert by_place["Warehouse A"] == 30 - 12
    assert by_place.get("Warehouse B", 0) == 0  # not counted at B yet
    assert _count(authed_client, moved.json()).status_code == 200
    by_place, total = _stock_by_place(authed_client)
    assert by_place["Warehouse B"] == 12
    assert total == 60

    too_much = authed_client.post(
        "/api/wholesale/stock-transfers",
        json={
            "from_location": "Warehouse A", "to_location": "Warehouse B", "moved_on": "2026-09-16",
            "lines": [{"stock_code": "A1001", "color_breakdown": "black9s", "unit": "set"}],
        },
    )
    assert too_much.status_code == 422
    assert "Warehouse A" in too_much.json()["detail"]


def _voucher_row(client: TestClient, voucher: SupplierVoucher) -> dict:
    rows = client.get("/api/wholesale/supplier-vouchers").json()
    return next(row for row in rows if row["voucher_id"] == voucher.id)


def test_a_voucher_says_how_much_is_still_waiting_to_move(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    assert _voucher_row(authed_client, voucher)["to_move_pairs"] == 60
    assert _move(authed_client, voucher, "black36p").status_code == 201
    assert _voucher_row(authed_client, voucher)["to_move_pairs"] == 24
    assert _move(authed_client, voucher, "white24p").status_code == 201
    assert _voucher_row(authed_client, voucher)["to_move_pairs"] == 0


def test_goods_counted_at_a_warehouse_gate_never_wait_to_move(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    from app.wholesale.models.master_data import WholesalePlace

    db_session.add(WholesalePlace(name="Gate", active=True, is_warehouse=True))
    db_session.commit()
    assert _voucher_row(authed_client, voucher)["to_move_pairs"] == 0


def test_a_move_the_destination_has_not_counted_is_still_pending(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    assert _move(authed_client, voucher, "black36p,white24p").status_code == 201
    row = _voucher_row(authed_client, voucher)
    assert (row["to_move_pairs"], row["to_count_pairs"]) == (0, 60)


def test_goods_counted_at_a_gate_say_whether_that_gate_is_a_warehouse(
    authed_client: TestClient, db_session: Session
) -> None:
    _setup(db_session)

    def counted_in() -> list[dict]:
        rows = authed_client.get("/api/wholesale/inventory?page_size=2000").json()
        return [r for r in rows if r["movement_type"] == "in"]

    assert counted_in() and all(r["at_warehouse"] is False for r in counted_in())
    from app.wholesale.models.master_data import WholesalePlace

    db_session.add(WholesalePlace(name="Gate", active=True, is_warehouse=True))
    db_session.commit()
    assert all(r["at_warehouse"] is True for r in counted_in())


def test_stock_records_keep_gate_goods_out_of_warehouse_stock(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)

    def record() -> dict:
        records = authed_client.get("/api/wholesale/inventory/stock?page_size=2000").json()
        return next(r for r in records if r["stock_code"] == "A1001")

    # Counted at a gate that is not a warehouse: held there, but not warehouse stock or available.
    gate_only = record()
    assert (gate_only["on_hand_pairs"], gate_only["warehouse_pairs"], gate_only["at_gate_pairs"]) == (60, 0, 60)
    assert gate_only["available_pairs"] == 0
    assert [(loc["location"], loc["is_warehouse"]) for loc in gate_only["locations"]] == [("Gate", False)]

    moved = _move(authed_client, voucher, "black4s,white1s").json()  # 30 pairs
    assert _count(authed_client, moved).status_code == 200
    after = record()
    assert (after["warehouse_pairs"], after["at_gate_pairs"]) == (30, 30)
    assert after["available_pairs"] == 30


def test_pool_keeps_warehouse_gates_ready_to_move(authed_client: TestClient, db_session: Session) -> None:
    voucher = _setup(db_session)
    from app.wholesale.models.master_data import WholesalePlace

    db_session.add(WholesalePlace(name="Gate", active=True, is_warehouse=True))
    db_session.commit()
    pool = authed_client.get(f"/api/wholesale/stock-transfers/pool?voucher_id={voucher.id}").json()
    (entry,) = pool["gates"]
    assert entry["location"] == "Gate"
    (product,) = entry["products"]
    assert product["stock_code"] == "A1001"
    assert product["counted_pairs"] == {"black": 36, "white": 24}
    assert product["left_pairs"] == {"black": 36, "white": 24}
