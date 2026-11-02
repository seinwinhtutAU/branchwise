"""GET/POST/PATCH/DELETE /api/wholesale/shipments."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.entities import (
    Receiving,
    ReceivingPackage,
    Shipment,
    ShipmentStop,
    SupplierVoucher,
    WholesaleAuditLog,
)


def _make_user(db_session: Session, *, role: UserRole, branch_id: str | None = None) -> User:
    user = User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch_id)
    db_session.add(user)
    db_session.commit()
    return user


def _make_branch(db_session: Session, name: str = "Wholesale") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()
    return branch


def _stop(
    key,
    parent=None,
    received=0,
    *,
    gate=False,
    name=None,
    carrier="",
    packages_sent=None,
    extra_parents=None,
    package_change_kind=None,
    packages_after_change=None,
):
    result = {
        "key": key,
        "parent_key": parent,
        "stop_name": name or key,
        "carrier_name": carrier,
        "packages_received": received,
        "is_gate": gate,
    }
    if package_change_kind is not None:
        result["package_change_kind"] = package_change_kind
        result["packages_after_change"] = packages_after_change
    if packages_sent is not None:
        result["packages_sent"] = packages_sent
    if extra_parents is not None:
        result["extra_parents"] = extra_parents
    return result


def _shipment_payload(**overrides) -> dict:
    payload = {
        "voucher_no": "VCH-260825-0001",
        "supplier_name": "Goody Factory",
        "carrier_name": "Apex Logistics",
        "sent_on": "2026-08-27",
        "total_packages": 10,
        "total_quantity_pairs": 300,
        "total_unit": "pair",
        "packages_sent_by_cargo": 10,
        "stops": [
            _stop("Yangon", None, 10, carrier="U Hla Myint"),
            _stop("Downtown Gate", "Yangon", 7, gate=True),
        ],
    }
    payload.update(overrides)
    return payload


def _create(authed_client: TestClient, **overrides) -> dict:
    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


def _by_name(shipment: dict) -> dict:
    return {stop["stop_name"]: stop for stop in shipment["stops"]}


def _setup(db_session: Session) -> Branch:
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    return branch


def test_creating_a_shipment_assigns_a_reference_number_and_reads_back(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    body = _create(authed_client)
    # The reference is dated to when it was raised (today), not the shipment's own
    # sent_on — the same rule frontend/.../wholesale/shared.ts::nextReference follows.
    today = date.today().strftime("%y%m%d")
    assert body["shipment_no"] == f"SHP-{today}-0001"
    assert body["total_packages"] == 10
    assert body["cargo_remaining"] == 0
    assert body["final_received_packages"] == 7
    assert body["final_remaining"] == 3
    assert body["shipment_status"] == "partly_delivered"
    assert body["gates"] == ["Downtown Gate"]
    assert body["destination_count"] == 3

    yangon = _by_name(body)["Yangon"]
    gate = _by_name(body)["Downtown Gate"]
    assert yangon["parent_stop_id"] is None
    assert gate["parent_stop_id"] == yangon["stop_id"]
    assert gate["is_gate"] is True
    # Of the 10 that reached Yangon, 7 turned up at the gate: 3 are still "here".
    assert yangon["here_now"] == 3
    assert gate["here_now"] == 0

    reread = authed_client.get(f"/api/wholesale/shipments/{body['shipment_id']}")
    assert reread.status_code == 200
    assert reread.json()["shipment_no"] == f"SHP-{today}-0001"


def test_a_package_split_is_saved_and_used_for_packages_here_now(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    body = _create(
        authed_client,
        total_packages=2,
        packages_sent_by_cargo=2,
        stops=[
            _stop(
                "Yangon",
                None,
                2,
                package_change_kind="split",
                packages_after_change=6,
            ),
            _stop("Bago", "Yangon", 3, gate=True),
            _stop("Receiving", "Yangon", 3, gate=True),
        ],
    )
    yangon = _by_name(body)["Yangon"]
    assert yangon["package_change_kind"] == "split"
    assert yangon["packages_after_change"] == 6
    assert yangon["here_now"] == 0


def test_saving_a_split_updates_the_receiving_package_total(
    authed_client: TestClient, db_session: Session
):
    branch = _setup(db_session)
    shipment = _create(
        authed_client,
        total_packages=2,
        packages_sent_by_cargo=2,
        stops=[
            _stop("Yangon", None, 2),
            _stop("Downtown Gate", "Yangon", 2, gate=True),
        ],
    )
    yangon = _by_name(shipment)["Yangon"]
    gate = _by_name(shipment)["Downtown Gate"]
    receiving = Receiving(
        branch_id=branch.id,
        receiving_no="RCV-260827-0001",
        shipment_id=shipment["shipment_id"],
        stop_id=gate["stop_id"],
        shipment_no=shipment["shipment_no"],
        voucher_no=shipment["voucher_no"],
        supplier_name=shipment["supplier_name"],
        gate=gate["stop_name"],
        received_on=date.today(),
        total_packages=2,
        total_quantity_pairs=0,
        packages=[ReceivingPackage(package_no=1), ReceivingPackage(package_no=2)],
    )
    db_session.add(receiving)
    db_session.commit()

    response = authed_client.patch(
        f"/api/wholesale/shipments/{shipment['shipment_id']}",
        json={
            "stops": [
                _stop(
                    yangon["stop_id"],
                    None,
                    2,
                    name="Yangon",
                    package_change_kind="split",
                    packages_after_change=6,
                ),
                _stop(
                    "bago",
                    yangon["stop_id"],
                    3,
                    name="Bago",
                    packages_sent=3,
                    package_change_kind="combine",
                    packages_after_change=1,
                ),
                _stop(
                    gate["stop_id"],
                    "bago",
                    2,
                    gate=True,
                    name=gate["stop_name"],
                    packages_sent=1,
                    extra_parents=[
                        {
                            "from_key": yangon["stop_id"],
                            "carrier_name": "Carrier B",
                            "packages_sent": 3,
                        }
                    ],
                ),
            ]
        },
    )
    assert response.status_code == 200, response.text
    db_session.refresh(receiving)
    assert receiving.total_packages == 4
    assert len(receiving.packages) == 4


def test_shipment_package_correction_does_not_create_issue(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    shipment = _create(authed_client)

    response = authed_client.patch(
        f"/api/wholesale/shipments/{shipment['shipment_id']}",
        json={"total_packages": 8, "packages_sent_by_cargo": 8},
    )
    assert response.status_code == 200, response.text
    records = authed_client.get(
        "/api/wholesale/write-offs", params={"search": shipment["shipment_no"]}
    ).json()
    assert len(records) == 0
    issues = authed_client.get(
        "/api/wholesale/issues", params={"reference": shipment["shipment_no"]}
    ).json()
    assert len(issues) == 0


def test_places_cannot_send_more_than_available_after_handling(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    cases = [
        ("no change", {}),
        ("split", {"package_change_kind": "split", "packages_after_change": 2}),
        ("combine", {"package_change_kind": "combine", "packages_after_change": 1}),
    ]
    for label, handling in cases:
        response = authed_client.post(
            "/api/wholesale/shipments",
            json=_shipment_payload(
                total_packages=2,
                packages_sent_by_cargo=2,
                stops=[
                    _stop("Yangon", None, 2, **handling),
                    _stop("Receiving", "Yangon", 3, gate=True),
                ],
            ),
        )
        assert response.status_code == 422, label
        assert "sent out" in response.json()["detail"]


def test_a_second_shipment_the_same_day_gets_the_next_number(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    first = _create(authed_client)
    second = _create(authed_client)
    today = date.today().strftime("%y%m%d")
    assert first["shipment_no"] == f"SHP-{today}-0001"
    assert second["shipment_no"] == f"SHP-{today}-0002"


def test_more_packages_cannot_arrive_at_a_place_than_were_sent_to_it(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    response = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            packages_sent_by_cargo=5,
            stops=[_stop("Yangon", None, 10), _stop("Gate", "Yangon", 5, gate=True)],
        ),
    )
    assert response.status_code == 422
    assert "Yangon" in str(response.json()["detail"])


def test_more_packages_cannot_be_sent_than_the_shipment_has(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    response = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10,
            packages_sent_by_cargo=12,
            stops=[_stop("Yangon", None, 12), _stop("Gate", "Yangon", 12, gate=True)],
        ),
    )
    assert response.status_code == 422
    assert "than the shipment has" in str(response.json()["detail"])


def test_goods_can_go_two_ways_inside_one_shipment(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    body = _create(
        authed_client,
        total_packages=5,
        packages_sent_by_cargo=5,
        stops=[
            _stop("Yangon", None, 5, carrier="U Hla"),
            _stop("Gate A", "Yangon", 2, gate=True),
            _stop("Gate B", "Yangon", 3, gate=True),
        ],
    )
    assert body["gates"] == ["Gate A", "Gate B"]
    assert body["final_received_packages"] == 5
    assert body["shipment_status"] == "completed"
    stops = _by_name(body)
    assert stops["Gate A"]["parent_stop_id"] == stops["Yangon"]["stop_id"] == stops["Gate B"]["parent_stop_id"]
    assert stops["Yangon"]["here_now"] == 0


def test_a_route_that_is_not_a_tree_is_refused(authed_client: TestClient, db_session: Session):
    _setup(db_session)

    def refused(stops) -> str:
        response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload(stops=stops))
        assert response.status_code == 422
        return str(response.json()["detail"])

    assert "gate" in refused([_stop("Yangon", None, 5)])
    assert "ends" in refused([_stop("Yangon", None, 5, gate=True), _stop("Bago", "Yangon", 5, gate=True)])
    assert "not on the route" in refused([_stop("Yangon", "Nowhere", 5), _stop("Gate", "Yangon", 5, gate=True)])
    assert "circle" in refused(
        [_stop("A", "B", 1), _stop("B", "A", 1), _stop("Gate", None, 1, gate=True)]
    )
    assert "share a key" in refused([_stop("Gate", None, 1, gate=True), _stop("Gate", None, 1, gate=True)])


def test_saving_the_route_keeps_the_ids_of_places_that_stay(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    body = _create(authed_client)
    shipment_id = body["shipment_id"]
    before = _by_name(body)

    # A place is added at the front, one is renamed, and the gate stays.
    stops = [
        _stop("new-1", None, 10, name="Mandalay", carrier="U Hla"),
        _stop(before["Yangon"]["stop_id"], "new-1", 10, name="Yangon (Hlaing Tharyar)"),
        _stop(before["Downtown Gate"]["stop_id"], before["Yangon"]["stop_id"], 7, gate=True, name="Downtown Gate"),
    ]
    response = authed_client.patch(f"/api/wholesale/shipments/{shipment_id}", json={"stops": stops})
    assert response.status_code == 200, response.text
    after = _by_name(response.json())
    assert after["Yangon (Hlaing Tharyar)"]["stop_id"] == before["Yangon"]["stop_id"]
    assert after["Downtown Gate"]["stop_id"] == before["Downtown Gate"]["stop_id"]
    assert after["Yangon (Hlaing Tharyar)"]["parent_stop_id"] == after["Mandalay"]["stop_id"]
    assert [stop["stop_name"] for stop in response.json()["stops"]] == [
        "Mandalay",
        "Yangon (Hlaing Tharyar)",
        "Downtown Gate",
    ]


def test_places_left_out_of_a_saved_route_are_removed(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    body = _create(authed_client)
    gate = _by_name(body)["Downtown Gate"]
    response = authed_client.patch(
        f"/api/wholesale/shipments/{body['shipment_id']}",
        json={"stops": [_stop(gate["stop_id"], None, 7, gate=True, name=gate["stop_name"])]},
    )
    assert response.status_code == 200
    assert [stop["stop_name"] for stop in response.json()["stops"]] == ["Downtown Gate"]
    assert response.json()["stops"][0]["parent_stop_id"] is None


def test_a_place_with_a_receiving_counted_at_it_cannot_be_removed(authed_client: TestClient, db_session: Session):
    branch = _setup(db_session)
    body = _create(authed_client)
    yangon = _by_name(body)["Yangon"]
    gate = _by_name(body)["Downtown Gate"]
    db_session.add(
        Receiving(
            branch_id=branch.id, receiving_no="RCV-1", voucher_no="VCH-260825-0001", supplier_name="Goody Factory",
            gate="Yangon", shipment_no=body["shipment_no"], shipment_id=body["shipment_id"], stop_id=yangon["stop_id"],
            received_on=date.today(),
        )
    )
    db_session.commit()

    refused = authed_client.patch(
        f"/api/wholesale/shipments/{body['shipment_id']}",
        json={"stops": [_stop(gate["stop_id"], None, 7, gate=True, name=gate["stop_name"])]},
    )
    assert refused.status_code == 409


def test_a_road_that_ends_at_a_stop_instead_of_a_gate_is_refused(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    response = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            stops=[
                _stop("Yangon", None, 5),
                _stop("Gate", "Yangon", 3, gate=True),
                _stop("Mandalay", "Yangon", 2),
            ]
        ),
    )
    assert response.status_code == 422
    assert "Mandalay" in str(response.json()["detail"])


def test_two_roads_can_meet_again_at_one_place(authed_client: TestClient, db_session: Session):
    _setup(db_session)

    def merge_stops(extra_sent=3, arrived=5):
        gate = _stop("gate", "a", arrived, gate=True, name="Mandalay Gate")
        gate["packages_sent"] = 2
        gate["extra_parents"] = [{"from_key": "b", "carrier_name": "Ko Ko", "packages_sent": extra_sent}]
        return [
            _stop("y", None, 5, name="Yangon"),
            _stop("a", "y", 2, name="Bago"),
            _stop("b", "y", 3, name="Taungoo"),
            gate,
        ]

    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload(stops=merge_stops()))
    assert response.status_code == 201, response.text
    stops = _by_name(response.json())
    links = stops["Mandalay Gate"]["extra_parents"]
    assert links == [
        {"from_stop_id": stops["Taungoo"]["stop_id"], "carrier_name": "Ko Ko", "packages_sent": 3}
    ]
    # Taungoo only leads on through the extra road, so it is not a dead end.
    assert stops["Taungoo"]["here_now"] == 0

    # Saving an unchanged route must update its existing extra road, not insert a duplicate.
    unchanged_stops = [
        {
            "key": stop["stop_id"],
            "parent_key": stop["parent_stop_id"],
            "stop_name": stop["stop_name"],
            "carrier_name": stop["carrier_name"],
            "packages_received": stop["packages_received"],
            "packages_sent": stop["packages_sent"],
            "is_gate": stop["is_gate"],
            "extra_parents": [
                {
                    "from_key": link["from_stop_id"],
                    "carrier_name": link["carrier_name"],
                    "packages_sent": link["packages_sent"],
                }
                for link in stop["extra_parents"]
            ],
        }
        for stop in response.json()["stops"]
    ]
    updated = authed_client.patch(
        f"/api/wholesale/shipments/{response.json()['shipment_id']}",
        json={"stops": unchanged_stops},
    )
    assert updated.status_code == 200, updated.text
    assert _by_name(updated.json())["Mandalay Gate"]["extra_parents"] == links

    # More arriving than the two roads sent is refused.
    too_many = authed_client.post(
        "/api/wholesale/shipments", json=_shipment_payload(stops=merge_stops(arrived=9))
    )
    assert too_many.status_code == 422

    # A road that loops back is refused.
    loop = merge_stops()
    loop[1]["extra_parents"] = [{"from_key": "gate", "carrier_name": "", "packages_sent": 0}]
    looped = authed_client.post("/api/wholesale/shipments", json=_shipment_payload(stops=loop))
    assert looped.status_code == 422

    # A gate cannot be where an extra road starts.
    from_gate = merge_stops()
    from_gate[2]["extra_parents"] = [{"from_key": "gate", "carrier_name": "", "packages_sent": 0}]
    assert authed_client.post("/api/wholesale/shipments", json=_shipment_payload(stops=from_gate)).status_code == 422


def test_a_place_can_only_appear_once_on_a_route(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    response = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            stops=[
                _stop("a", None, 5, name="Yangon"),
                _stop("b", "a", 5, name=" yangon ", gate=True),
            ]
        ),
    )
    assert response.status_code == 422
    assert "once" in str(response.json()["detail"])


def test_a_gate_with_a_receiving_counted_at_it_cannot_become_a_stop(authed_client: TestClient, db_session: Session):
    branch = _setup(db_session)
    body = _create(authed_client)
    yangon = _by_name(body)["Yangon"]
    gate = _by_name(body)["Downtown Gate"]
    db_session.add(
        Receiving(
            branch_id=branch.id, receiving_no="RCV-2", voucher_no="VCH-260825-0001", supplier_name="Goody Factory",
            gate=gate["stop_name"], shipment_no=body["shipment_no"], shipment_id=body["shipment_id"],
            stop_id=gate["stop_id"], received_on=date.today(),
        )
    )
    db_session.commit()

    refused = authed_client.patch(
        f"/api/wholesale/shipments/{body['shipment_id']}",
        json={
            "stops": [
                _stop(yangon["stop_id"], None, 7, name=yangon["stop_name"]),
                _stop(gate["stop_id"], yangon["stop_id"], 7, name=gate["stop_name"]),
                _stop("New gate", gate["stop_id"], 7, gate=True),
            ]
        },
    )
    assert refused.status_code == 409


def test_a_place_that_was_counted_shows_the_counted_number(authed_client: TestClient, db_session: Session):
    branch = _setup(db_session)
    body = _create(authed_client)
    yangon = _by_name(body)["Yangon"]
    receiving = Receiving(
        branch_id=branch.id, receiving_no="RCV-1", voucher_no="VCH-260825-0001", supplier_name="Goody Factory",
        gate="Yangon", shipment_no=body["shipment_no"], shipment_id=body["shipment_id"], stop_id=yangon["stop_id"],
        received_on=date.today(),
    )
    db_session.add(receiving)
    db_session.commit()

    reread = authed_client.get(f"/api/wholesale/shipments/{body['shipment_id']}").json()
    counted = _by_name(reread)["Yangon"]
    assert counted["counted"] is True
    assert counted["packages_received"] == 0  # a receiving with no packages counted nothing
    assert _by_name(reread)["Downtown Gate"]["counted"] is False


def test_partial_update_leaves_other_fields_untouched(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    shipment_id = _create(authed_client)["shipment_id"]

    response = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}", json={"carrier_name": "Metro Freight"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["carrier_name"] == "Metro Freight"
    assert body["supplier_name"] == "Goody Factory"
    assert body["gates"] == ["Downtown Gate"]
    assert len(body["stops"]) == 2


def test_updating_the_sent_date_is_saved_and_audited(authed_client: TestClient, db_session: Session):
    """A date in the request body must not break the audit log's JSON payload."""
    _setup(db_session)
    shipment_id = _create(authed_client)["shipment_id"]

    response = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}", json={"sent_on": "2026-09-30", "total_packages": 3}
    )
    assert response.status_code == 200
    assert response.json()["sent_on"] == "2026-09-30"
    audit = db_session.query(WholesaleAuditLog).filter_by(entity_id=shipment_id, action="update").first()
    assert audit is not None


def test_a_saved_route_keeps_the_figures_as_entered_after_a_split(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    body = _create(authed_client)
    yangon = _by_name(body)["Yangon"]
    gate = _by_name(body)["Downtown Gate"]
    response = authed_client.patch(
        f"/api/wholesale/shipments/{body['shipment_id']}",
        json={
            "stops": [
                _stop(
                    yangon["stop_id"],
                    None,
                    10,
                    name="Yangon",
                    package_change_kind="split",
                    packages_after_change=12,
                ),
                _stop(gate["stop_id"], yangon["stop_id"], 12, gate=True, name=gate["stop_name"]),
            ]
        },
    )
    assert response.status_code == 200
    assert _by_name(response.json())["Downtown Gate"]["packages_received"] == 12


def test_deleting_a_shipment_removes_it(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    shipment_id = _create(authed_client)["shipment_id"]

    response = authed_client.delete(f"/api/wholesale/shipments/{shipment_id}")
    assert response.status_code == 204
    assert authed_client.get(f"/api/wholesale/shipments/{shipment_id}").status_code == 404
    assert db_session.query(ShipmentStop).count() == 0


def test_a_retail_account_is_refused(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session, "Retail")
    _make_user(db_session, role=UserRole.RETAIL, branch_id=branch.id)

    response = authed_client.get("/api/wholesale/shipments")
    assert response.status_code == 403


def test_another_branchs_shipment_is_404_not_403(authed_client: TestClient, db_session: Session):
    mine = _make_branch(db_session, "Mine")
    theirs = Branch(name="Theirs", phone_number="000", address="TBD")
    db_session.add(theirs)
    db_session.commit()

    other_shipment = Shipment(
        branch_id=theirs.id,
        shipment_no="SHP-260827-0001",
        voucher_no="VCH-260825-0001",
        supplier_name="Goody Factory",
        carrier_name="Apex Logistics",
        sent_on=date(2026, 8, 27),
        total_packages=5,
        total_quantity_pairs=100,
        stops=[ShipmentStop(leg_order=1, stop_name="Market Street Gate", carrier_name="", packages_received=0, is_gate=True)],
    )
    db_session.add(other_shipment)
    db_session.commit()

    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=mine.id)

    response = authed_client.get(f"/api/wholesale/shipments/{other_shipment.id}")
    assert response.status_code == 404


def test_negative_package_count_is_rejected(authed_client: TestClient, db_session: Session):
    _setup(db_session)

    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload(total_packages=-1))
    assert response.status_code == 422


def test_admin_without_branch_id_is_rejected(authed_client: TestClient, db_session: Session):
    _make_user(db_session, role=UserRole.ADMIN, branch_id=None)

    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload())
    assert response.status_code == 400


def test_admin_can_create_for_a_named_branch(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.ADMIN, branch_id=None)

    response = authed_client.post(
        "/api/wholesale/shipments", json=_shipment_payload(branch_id=branch.id)
    )
    assert response.status_code == 201
    assert response.json()["branch_id"] == branch.id


def test_there_is_no_split_endpoint_any_more(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    shipment_id = _create(authed_client)["shipment_id"]
    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={"packages": 1, "final_destination": "Somewhere", "carrier_name": ""},
    )
    assert response.status_code in (404, 405)


def test_completed_shipment_can_update_its_route_but_not_its_receiving_gate(
    authed_client: TestClient, db_session: Session
):
    branch = _setup(db_session)
    created = _create(
        authed_client,
        total_packages=10,
        packages_sent_by_cargo=10,
        stops=[_stop("Gate", None, 10, gate=True)],
    )
    shipment_id = created["shipment_id"]
    assert created["shipment_status"] == "completed"
    assert "edit" in created["allowed_actions"]
    gate = created["stops"][0]
    receiving = Receiving(
        branch_id=branch.id,
        receiving_no="RCV-260827-0099",
        voucher_no="VCH-260825-0001",
        supplier_name="Goody Factory",
        gate="Gate",
        shipment_no=created["shipment_no"],
        shipment_id=shipment_id,
        stop_id=gate["stop_id"],
        received_on=date.today(),
    )
    db_session.add(receiving)
    db_session.flush()
    db_session.add_all(
        ReceivingPackage(receiving_id=receiving.id, package_no=number)
        for number in range(1, 11)
    )
    db_session.commit()

    # The route around the gate and the ordinary shipment details remain correctable.
    response = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}",
        json={
            "carrier_name": "Other",
            "sent_on": "2026-08-28",
            "stops": [
                _stop("new-stop", None, 10, name="Yangon"),
                _stop(gate["stop_id"], "new-stop", 10, gate=True, name="Gate"),
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["carrier_name"] == "Other"
    assert [stop["stop_name"] for stop in response.json()["stops"]] == ["Yangon", "Gate"]

    renamed_gate = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}",
        json={
            "stops": [
                _stop("new-stop", None, 10, name="Yangon"),
                _stop(gate["stop_id"], "new-stop", 10, gate=True, name="Other gate"),
            ],
        },
    )
    assert renamed_gate.status_code == 409
    assert "receiving gate" in renamed_gate.json()["detail"]


def test_delete_guarded_when_receiving_exists(authed_client: TestClient, db_session: Session):
    branch = _setup(db_session)
    created = _create(authed_client, packages_sent_by_cargo=5, stops=[_stop("Gate", None, 0, gate=True)])
    shipment_id = created["shipment_id"]

    db_session.add(
        Receiving(
            branch_id=branch.id,
            receiving_no="RCV-260827-0001",
            voucher_no="VCH-260825-0001",
            supplier_name="Goody Factory",
            gate="Downtown Gate",
            shipment_no=created["shipment_no"],
            shipment_id=shipment_id,
            stop_id=created["stops"][0]["stop_id"],
            received_on=date.today(),
        )
    )
    db_session.commit()

    del_resp = authed_client.delete(f"/api/wholesale/shipments/{shipment_id}")
    assert del_resp.status_code == 409
    assert "receiving recorded" in del_resp.json()["detail"]


def test_write_off_shipment_guard_and_version_bump(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    created = _create(
        authed_client,
        total_packages=10,
        total_quantity_pairs=100,
        packages_sent_by_cargo=10,
        stops=[_stop("Gate", None, 5, gate=True)],
    )
    shipment_id = created["shipment_id"]
    assert created["version_id"] == 1

    # Record write-off on in-transit/partly-delivered shipment
    wo_resp = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/write-off",
        json={"quantity": 1, "reason": "lost_in_transit", "note": "Box lost"},
    )
    assert wo_resp.status_code == 201

    # Version should be bumped
    fetched = authed_client.get(f"/api/wholesale/shipments/{shipment_id}")
    assert fetched.json()["version_id"] == 2

    # Now update to completed (9 at the gate, since 1 lost, remaining 0)
    gate_id = fetched.json()["stops"][0]["stop_id"]
    upd_resp = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}",
        json={"stops": [_stop(gate_id, None, 9, gate=True, name="Gate")]},
    )
    assert upd_resp.status_code == 200
    assert upd_resp.json()["shipment_status"] == "completed"

    # Attempt write-off on completed shipment must raise 409 Conflict
    blocked_wo = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/write-off",
        json={"quantity": 1, "reason": "lost_in_transit", "note": "Too late"},
    )
    assert blocked_wo.status_code == 409


def test_a_carrier_sends_and_the_next_place_receives_two_different_numbers(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    body = _create(
        authed_client,
        total_packages=10,
        packages_sent_by_cargo=None,
        stops=[
            {**_stop("Yangon", None, 10), "packages_sent": 10},
            {**_stop("Gate", "Yangon", 7, gate=True), "packages_sent": 9},
        ],
    )
    stops = _by_name(body)
    assert stops["Yangon"]["packages_sent"] == 10
    assert stops["Gate"]["packages_sent"] == 9
    # 9 left Yangon (7 arrived: 2 are lost on the road); only 1 is still there.
    assert stops["Yangon"]["here_now"] == 1
    assert body["packages_sent_by_cargo"] == 10


def test_what_the_cargo_company_sent_is_what_it_sent_along_the_roads_leaving_the_supplier(
    authed_client: TestClient, db_session: Session
):
    _setup(db_session)
    body = _create(
        authed_client,
        packages_sent_by_cargo=None,
        stops=[
            {**_stop("Gate A", None, 2, gate=True), "packages_sent": 3},
            {**_stop("Gate B", None, 1, gate=True), "packages_sent": 2},
        ],
    )
    assert body["packages_sent_by_cargo"] == 5

    # Saying it the short way changes the first road.
    patched = authed_client.patch(
        f"/api/wholesale/shipments/{body['shipment_id']}", json={"packages_sent_by_cargo": 4}
    )
    stops = _by_name(patched.json())
    assert stops["Gate A"]["packages_sent"] == 4
    assert patched.json()["packages_sent_by_cargo"] == 6


def test_a_place_left_without_a_sent_figure_sent_what_arrived(authed_client: TestClient, db_session: Session):
    _setup(db_session)
    body = _create(authed_client, packages_sent_by_cargo=None, stops=[_stop("Yangon", None, 5), _stop("Gate", "Yangon", 4, gate=True)])
    stops = _by_name(body)
    assert (stops["Yangon"]["packages_sent"], stops["Gate"]["packages_sent"]) == (5, 4)


def test_receiving_gate_syncs_between_voucher_shipment_and_receiving(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _setup(db_session)
    voucher = SupplierVoucher(
        branch_id=branch.id,
        voucher_no="VCH-260825-0001",
        supplier_name="Goody Factory",
        voucher_date=date.today(),
        receiving_gate="Gate 1",
    )
    db_session.add(voucher)
    db_session.commit()

    created_shipment = _create(
        authed_client,
        stops=[_stop("Gate 1", None, 10, gate=True)],
    )
    shipment_id = created_shipment["shipment_id"]
    gate_stop = created_shipment["stops"][0]

    receiving = Receiving(
        branch_id=branch.id,
        receiving_no="RCV-260827-0001",
        voucher_no="VCH-260825-0001",
        supplier_name="Goody Factory",
        gate="Gate 1",
        shipment_no=created_shipment["shipment_no"],
        shipment_id=shipment_id,
        stop_id=gate_stop["stop_id"],
        received_on=date.today(),
    )
    db_session.add(receiving)
    db_session.commit()

    # 1. Update receiving gate -> updates shipment stop and voucher receiving_gate
    patch_rec = authed_client.patch(
        f"/api/wholesale/receivings/{receiving.id}",
        json={"gate": "Gate 2"},
    )
    assert patch_rec.status_code == 200
    db_session.refresh(voucher)
    stop = db_session.get(ShipmentStop, gate_stop["stop_id"])
    assert stop.stop_name == "Gate 2"
    assert voucher.receiving_gate == "Gate 2"

    # 2. Once receiving has started, its gate cannot be renamed through the shipment route.
    patch_shp = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}",
        json={
            "stops": [
                {
                    "key": gate_stop["stop_id"],
                    "stop_name": "Central Warehouse Gate",
                    "carrier_name": "",
                    "packages_received": 10,
                    "is_gate": True,
                }
            ]
        },
    )
    assert patch_shp.status_code == 409
    db_session.refresh(receiving)
    db_session.refresh(voucher)
    assert receiving.gate == "Gate 2"
    assert voucher.receiving_gate == "Gate 2"
