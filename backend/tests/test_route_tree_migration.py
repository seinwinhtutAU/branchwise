"""The data move behind "one shipment, many routes": every shipment becomes a tree of stops ending
in gate stops, and a shipment that was split off another is folded back into it."""

import importlib.util
from pathlib import Path

import sqlalchemy as sa

_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261002_route_tree.py"
_spec = importlib.util.spec_from_file_location("route_tree_migration", _PATH)
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def _database() -> sa.engine.Connection:
    engine = sa.create_engine("sqlite://")
    conn = engine.connect()
    for statement in (
        """CREATE TABLE wholesale_shipments (
            id TEXT PRIMARY KEY, shipment_no TEXT, cargo_name TEXT, final_location TEXT,
            total_packages INT, total_pairs INT, packages_sent_by_cargo INT,
            final_received_packages INT, lost_packages INT, split_from_shipment_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP)""",
        """CREATE TABLE wholesale_shipment_stops (
            id TEXT PRIMARY KEY, shipment_id TEXT, parent_stop_id TEXT, leg_order INT,
            stop_name TEXT, carrier_name TEXT, packages_received INT, packages_sent INT,
            lost_packages INT DEFAULT 0, is_gate BOOLEAN DEFAULT 0)""",
        "CREATE TABLE wholesale_receivings (id TEXT PRIMARY KEY, shipment_id TEXT, shipment_no TEXT, stop_id TEXT)",
        "CREATE TABLE wholesale_write_offs (id TEXT PRIMARY KEY, subject_type TEXT, subject_id TEXT, reference TEXT)",
    ):
        conn.execute(sa.text(statement))
    return conn


def _shipment(conn, sid, no, *, gate, total, sent, final=0, cargo="Shwe Moe", split_from=None, created=1):
    conn.execute(
        sa.text(
            "INSERT INTO wholesale_shipments VALUES (:id, :no, :cargo, :gate, :total, :total * 10, :sent, :final, 0, :split, :created)"
        ),
        {"id": sid, "no": no, "cargo": cargo, "gate": gate, "total": total, "sent": sent, "final": final, "split": split_from, "created": f"2026-10-0{created}"},
    )


def _leg(conn, lid, sid, order, name, received, carrier="Truck"):
    conn.execute(
        sa.text("INSERT INTO wholesale_shipment_stops VALUES (:id, :sid, NULL, :o, :n, :c, :r, 0, 0, 0)"),
        {"id": lid, "sid": sid, "o": order, "n": name, "c": carrier, "r": received},
    )


def _receiving(conn, rid, sid):
    conn.execute(sa.text("INSERT INTO wholesale_receivings VALUES (:id, :sid, 'old', NULL)"), {"id": rid, "sid": sid})


def _tree(conn, sid):
    rows = conn.execute(
        sa.text(
            "SELECT s.id, s.stop_name, p.stop_name AS parent, s.packages_received, s.is_gate, s.leg_order "
            "FROM wholesale_shipment_stops s LEFT JOIN wholesale_shipment_stops p ON p.id = s.parent_stop_id "
            "WHERE s.shipment_id = :sid ORDER BY s.leg_order"
        ),
        {"sid": sid},
    ).all()
    return rows


def test_a_single_chain_ends_in_a_gate_that_keeps_the_arrived_figure() -> None:
    conn = _database()
    _shipment(conn, "s1", "SHP-1", gate="Bago Gate", total=5, sent=5, final=4)
    _leg(conn, "l1", "s1", 1, "Yangon", 5)
    _receiving(conn, "r1", "s1")

    migration.fold_shipments(conn)

    tree = _tree(conn, "s1")
    assert [(r.stop_name, r.parent, r.packages_received, bool(r.is_gate)) for r in tree] == [
        ("Yangon", None, 5, False),
        ("Bago Gate", "Yangon", 4, True),
    ]
    receiving = conn.execute(sa.text("SELECT stop_id FROM wholesale_receivings")).scalar()
    assert receiving == tree[1].id


def test_a_split_from_cargo_becomes_a_second_route_of_the_same_shipment() -> None:
    conn = _database()
    _shipment(conn, "s1", "SHP-1", gate="Gate A", total=3, sent=3)
    _shipment(conn, "s2", "SHP-2", gate="Gate B", total=2, sent=0, split_from="s1", created=2, cargo="Other Cargo")
    _receiving(conn, "r2", "s2")
    conn.execute(sa.text("INSERT INTO wholesale_write_offs VALUES ('w1', 'shipment', 's2', 'SHP-2')"))

    migration.fold_shipments(conn)

    assert conn.execute(sa.text("SELECT COUNT(*) FROM wholesale_shipments")).scalar() == 1
    shipment = conn.execute(sa.text("SELECT total_packages, total_pairs, packages_sent_by_cargo FROM wholesale_shipments")).one()
    assert tuple(shipment) == (5, 50, 3)
    tree = _tree(conn, "s1")
    assert [(r.stop_name, r.parent, bool(r.is_gate)) for r in tree] == [("Gate A", None, True), ("Gate B", None, True)]
    receiving = conn.execute(sa.text("SELECT shipment_id, shipment_no, stop_id FROM wholesale_receivings")).one()
    assert tuple(receiving) == ("s1", "SHP-1", tree[1].id)
    assert conn.execute(sa.text("SELECT subject_id, reference FROM wholesale_write_offs")).one() == ("s1", "SHP-1")
    # A different cargo company shows on the branch's first place.
    carrier = conn.execute(sa.text("SELECT carrier_name FROM wholesale_shipment_stops WHERE stop_name = 'Gate B'")).scalar()
    assert carrier == "Other Cargo"


def test_a_split_from_a_stop_shares_the_stops_it_already_travelled_through() -> None:
    conn = _database()
    _shipment(conn, "s1", "SHP-1", gate="Gate A", total=3, sent=3)
    _leg(conn, "p1", "s1", 1, "Yangon", 3)
    _shipment(conn, "s2", "SHP-2", gate="Gate B", total=2, sent=2, split_from="s1", created=2)
    _leg(conn, "c1", "s2", 1, "Yangon", 2)
    conn.execute(sa.text("INSERT INTO wholesale_write_offs VALUES ('w1', 'shipment_leg', 'c1', 'SHP-2')"))

    migration.fold_shipments(conn)

    tree = _tree(conn, "s1")
    assert [(r.stop_name, r.parent, r.packages_received, bool(r.is_gate)) for r in tree] == [
        ("Yangon", None, 5, False),
        ("Gate A", "Yangon", 0, True),
        ("Gate B", "Yangon", 0, True),
    ]
    assert conn.execute(sa.text("SELECT subject_id FROM wholesale_write_offs")).scalar() == "p1"
    assert conn.execute(sa.text("SELECT COUNT(*) FROM wholesale_shipment_stops WHERE id = 'c1'")).scalar() == 0


def test_goods_counted_at_a_stop_make_that_stop_the_counted_place() -> None:
    conn = _database()
    _shipment(conn, "s1", "SHP-1", gate="Gate A", total=3, sent=3)
    _leg(conn, "p1", "s1", 1, "Yangon", 3)
    _shipment(conn, "s2", "SHP-2", gate="Yangon", total=2, sent=2, split_from="s1", created=2)
    _receiving(conn, "r2", "s2")

    migration.fold_shipments(conn)

    tree = _tree(conn, "s1")
    assert [(r.stop_name, r.packages_received, bool(r.is_gate)) for r in tree] == [("Yangon", 5, False), ("Gate A", 0, True)]
    assert conn.execute(sa.text("SELECT stop_id FROM wholesale_receivings")).scalar() == "p1"


def _carriers_migration():
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261003_one_carrier_list.py"
    spec = importlib.util.spec_from_file_location("one_carrier_list_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cargo_companies_and_carriers_in_use_join_the_one_carrier_list() -> None:
    engine = sa.create_engine("sqlite://")
    conn = engine.connect()
    conn.execute(sa.text("CREATE TABLE wholesale_carriers (id TEXT PRIMARY KEY, name TEXT, active BOOLEAN)"))
    conn.execute(sa.text("CREATE TABLE wholesale_cargo_companies (id TEXT PRIMARY KEY, name TEXT)"))
    conn.execute(sa.text("CREATE TABLE wholesale_shipments (id TEXT PRIMARY KEY, cargo_name TEXT)"))
    conn.execute(sa.text("CREATE TABLE wholesale_shipment_stops (id TEXT PRIMARY KEY, carrier_name TEXT)"))
    conn.execute(sa.text("INSERT INTO wholesale_carriers VALUES ('c1', 'U Hla', 1), ('c2', 'Ko Zaw', 1)"))
    conn.execute(sa.text("INSERT INTO wholesale_cargo_companies VALUES ('g1', 'Apex Logistics'), ('g2', 'u hla')"))
    conn.execute(sa.text("INSERT INTO wholesale_shipments VALUES ('s1', 'Metro Freight'), ('s2', 'shwe moe cargo')"))
    conn.execute(sa.text("INSERT INTO wholesale_shipment_stops VALUES ('t1', 'Ma Khin'), ('t2', '—'), ('t3', '')"))

    _carriers_migration().fold_cargo_companies(conn)

    names = sorted(row[0] for row in conn.execute(sa.text("SELECT name FROM wholesale_carriers")))
    assert names == ["Metro Freight", "Ko Zaw", "Ma Khin", "Apex Logistics", "U Hla"]


def test_existing_places_start_with_sent_equal_to_arrived_except_the_first_road() -> None:
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261004_stop_sent.py"
    spec = importlib.util.spec_from_file_location("stop_sent_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    engine = sa.create_engine("sqlite://")
    conn = engine.connect()
    conn.execute(sa.text("CREATE TABLE wholesale_shipments (id TEXT PRIMARY KEY, packages_sent_by_cargo INT)"))
    conn.execute(
        sa.text(
            "CREATE TABLE wholesale_shipment_stops (id TEXT PRIMARY KEY, shipment_id TEXT, parent_stop_id TEXT, "
            "leg_order INT, packages_received INT, packages_sent INT DEFAULT 0)"
        )
    )
    conn.execute(sa.text("INSERT INTO wholesale_shipments VALUES ('one', 10), ('two', 6)"))
    conn.execute(
        sa.text(
            "INSERT INTO wholesale_shipment_stops (id, shipment_id, parent_stop_id, leg_order, packages_received) VALUES "
            "('a', 'one', NULL, 1, 7), ('b', 'one', 'a', 2, 7), "
            "('c', 'two', NULL, 1, 3), ('d', 'two', NULL, 2, 2)"
        )
    )

    module.backfill_stop_sent(conn)

    sent = dict(conn.execute(sa.text("SELECT id, packages_sent FROM wholesale_shipment_stops")).all())
    # One road: the cargo company really sent 10, only 7 arrived — that is kept. A later road
    # starts equal to what arrived. With two roads the first keeps what is left (6 - 2 = 4).
    assert sent == {"a": 10, "b": 7, "c": 4, "d": 2}
