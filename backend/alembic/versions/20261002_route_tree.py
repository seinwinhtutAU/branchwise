"""one shipment, many routes: a split shipment is folded back into the shipment it came from

Revision ID: 20261002_route_tree
Revises: 20261002_route_stops

A shipment's route is now a tree of places (wholesale_shipment_stops.parent_stop_id) and every
place where a route ends is a stop with is_gate set, so a shipment no longer stores its own
final gate (final_location, final_received_packages) and a split no longer makes a second
shipment (split_from_shipment_id). See docs/wholesale/shipment-route-tree-design.md.

This is not reversible except from a backup: a folded shipment's number is gone.
"""

import uuid

from alembic import op
import sqlalchemy as sa


revision = "20261002_route_tree"
down_revision = "20261002_route_stops"
branch_labels = None
depends_on = None


def _same(a: str, b: str) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def fold_shipments(conn) -> None:
    """Turns every shipment into a tree of stops ending in gate stops, and folds each shipment
    that was split off another back into it. Every figure the old rows held is kept: arrived
    packages, losses, receivings and write-offs. Written against the old columns only, so it can
    be run on a database that still has them."""
    shipments = (
        conn.execute(
            sa.text(
                "SELECT id, shipment_no, cargo_name, final_location, total_packages, total_pairs, "
                "packages_sent_by_cargo, final_received_packages, lost_packages, split_from_shipment_id "
                "FROM wholesale_shipments ORDER BY created_at, shipment_no"
            )
        )
        .mappings()
        .all()
    )
    if not shipments:
        return
    by_id = {row["id"]: dict(row) for row in shipments}

    stop_rows = (
        conn.execute(
            sa.text(
                "SELECT id, shipment_id, leg_order, stop_name, carrier_name, packages_received, lost_packages "
                "FROM wholesale_shipment_stops ORDER BY shipment_id, leg_order"
            )
        )
        .mappings()
        .all()
    )
    chains: dict[str, list[dict]] = {sid: [] for sid in by_id}
    for row in stop_rows:
        chains.setdefault(row["shipment_id"], []).append(
            {
                "id": row["id"],
                "name": row["stop_name"],
                "carrier": row["carrier_name"],
                "received": row["packages_received"],
                "lost": row["lost_packages"],
                "is_gate": False,
                "new": False,
            }
        )

    def root_of(shipment_id: str) -> str:
        seen = set()
        while by_id[shipment_id]["split_from_shipment_id"] in by_id and shipment_id not in seen:
            seen.add(shipment_id)
            shipment_id = by_id[shipment_id]["split_from_shipment_id"]
        return shipment_id

    # trees[root_id] = {"children": {parent_id | None: [node, ...]}, "nodes": {id: node}}
    trees: dict[str, dict] = {}
    gate_of: dict[str, dict] = {}
    stop_remap: dict[str, str] = {}  # a stop that was merged away -> the stop that took its place
    receiving_stop: dict[str, str] = {}  # shipment id -> stop its receivings now point at
    deleted_stops: list[str] = []
    totals: dict[str, dict] = {}

    def add(tree: dict, parent: dict | None, node: dict) -> dict:
        node["parent"] = parent["id"] if parent else None
        tree["children"].setdefault(node["parent"], []).append(node)
        tree["nodes"][node["id"]] = node
        return node

    def make_gate(shipment: dict) -> dict:
        return {
            "id": str(uuid.uuid4()),
            "name": shipment["final_location"],
            "carrier": "",
            "received": shipment["final_received_packages"],
            "lost": 0,
            "is_gate": True,
            "new": True,
        }

    for shipment in shipments:
        sid = shipment["id"]
        root_id = root_of(sid)
        if root_id == sid:
            tree = {"children": {}, "nodes": {}}
            trees[sid] = tree
            parent = None
            for node in chains[sid]:
                parent = add(tree, parent, node)
            gate = add(tree, parent, make_gate(shipment))
            gate_of[sid] = gate
            receiving_stop[sid] = gate["id"]
            totals[sid] = {
                "total_packages": shipment["total_packages"],
                "total_pairs": shipment["total_pairs"],
                "packages_sent_by_cargo": shipment["packages_sent_by_cargo"],
                "lost_packages": shipment["lost_packages"],
            }
            # The shipment's own loss at the end of its route belongs to its gate stop.
            continue

        tree = trees[root_id]
        root = by_id[root_id]
        cursor: dict | None = None
        sharing = True
        first_new: dict | None = None
        for node in chains[sid]:
            match = None
            if sharing:
                match = next(
                    (
                        existing
                        for existing in tree["children"].get(cursor["id"] if cursor else None, [])
                        if not existing["is_gate"] and _same(existing["name"], node["name"])
                    ),
                    None,
                )
            if match is not None:
                match["received"] += node["received"]
                match["lost"] += node["lost"]
                stop_remap[node["id"]] = match["id"]
                deleted_stops.append(node["id"])
                cursor = match
                continue
            sharing = False
            cursor = add(tree, cursor, node)
            first_new = first_new or cursor
        gate = make_gate(shipment)
        counted_place = None
        if sharing and shipment["packages_sent_by_cargo"] > 0:
            counted_place = next(
                (
                    existing
                    for existing in tree["children"].get(cursor["id"] if cursor else None, [])
                    if not existing["is_gate"] and _same(existing["name"], gate["name"])
                ),
                None,
            )
        if counted_place is not None:
            # The goods stayed at a stop of the original route and were counted there.
            counted_place["received"] += shipment["total_packages"]
            receiving_stop[sid] = counted_place["id"]
        else:
            gate = add(tree, cursor, gate)
            first_new = first_new or gate
            receiving_stop[sid] = gate["id"]
        if (
            first_new is not None
            and first_new["parent"] is None
            and not _same(shipment["cargo_name"], root["cargo_name"])
            and (first_new["carrier"] or "").strip() in ("", "—")
        ):
            first_new["carrier"] = shipment["cargo_name"]
        sums = totals[root_id]
        sums["total_packages"] += shipment["total_packages"]
        sums["total_pairs"] += shipment["total_pairs"]
        sums["packages_sent_by_cargo"] += shipment["packages_sent_by_cargo"]
        sums["lost_packages"] += shipment["lost_packages"]

    # Write the trees.
    for root_id, tree in trees.items():
        order = 0
        stack = list(reversed(tree["children"].get(None, [])))
        while stack:
            node = stack.pop()
            order += 1
            params = {
                "id": node["id"],
                "sid": root_id,
                "parent": node["parent"],
                "order": order,
                "name": node["name"],
                "carrier": node["carrier"],
                "received": node["received"],
                "lost": node["lost"],
                "gate": node["is_gate"],
            }
            if node["new"]:
                conn.execute(
                    sa.text(
                        "INSERT INTO wholesale_shipment_stops (id, shipment_id, parent_stop_id, leg_order, stop_name, "
                        "carrier_name, packages_received, packages_sent, lost_packages, is_gate) "
                        "VALUES (:id, :sid, :parent, :order, :name, :carrier, :received, 0, :lost, :gate)"
                    ),
                    params,
                )
            else:
                conn.execute(
                    sa.text(
                        "UPDATE wholesale_shipment_stops SET shipment_id = :sid, parent_stop_id = :parent, "
                        "leg_order = :order, stop_name = :name, carrier_name = :carrier, "
                        "packages_received = :received, lost_packages = :lost, is_gate = :gate WHERE id = :id"
                    ),
                    params,
                )
            stack.extend(reversed(tree["children"].get(node["id"], [])))
        sums = totals[root_id]
        conn.execute(
            sa.text(
                "UPDATE wholesale_shipments SET total_packages = :total_packages, total_pairs = :total_pairs, "
                "packages_sent_by_cargo = :packages_sent_by_cargo, lost_packages = :lost_packages WHERE id = :id"
            ),
            {**sums, "id": root_id},
        )

    # Receivings, write-offs and merged stops follow the shipment they were folded into.
    for shipment in shipments:
        sid = shipment["id"]
        root_id = root_of(sid)
        root_no = by_id[root_id]["shipment_no"]
        conn.execute(
            sa.text(
                "UPDATE wholesale_receivings SET shipment_id = :root, shipment_no = :no, stop_id = :stop "
                "WHERE shipment_id = :sid"
            ),
            {"root": root_id, "no": root_no, "stop": receiving_stop[sid], "sid": sid},
        )
        if root_id != sid:
            conn.execute(
                sa.text(
                    "UPDATE wholesale_write_offs SET subject_id = :root, reference = :no "
                    "WHERE subject_type = 'shipment' AND subject_id = :sid"
                ),
                {"root": root_id, "no": root_no, "sid": sid},
            )
    for old, new in stop_remap.items():
        conn.execute(
            sa.text(
                "UPDATE wholesale_write_offs SET subject_id = :new WHERE subject_type = 'shipment_leg' AND subject_id = :old"
            ),
            {"new": new, "old": old},
        )
    for stop_id in deleted_stops:
        conn.execute(sa.text("DELETE FROM wholesale_shipment_stops WHERE id = :id"), {"id": stop_id})
    for shipment in shipments:
        if root_of(shipment["id"]) != shipment["id"]:
            conn.execute(sa.text("DELETE FROM wholesale_shipments WHERE id = :id"), {"id": shipment["id"]})


def upgrade() -> None:
    op.add_column(
        "wholesale_shipment_stops",
        sa.Column("is_gate", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Places on a tree share a draw order only within the whole shipment, and are rewritten on
    # every save; the uniqueness the chain relied on is not needed.
    op.drop_constraint("uq_wholesale_shipment_stops_shipment_id_leg_order", "wholesale_shipment_stops", type_="unique")

    fold_shipments(op.get_bind())

    op.drop_column("wholesale_shipment_stops", "packages_sent")
    op.drop_constraint("fk_wholesale_shipments_split_from_shipment_id", "wholesale_shipments", type_="foreignkey")
    op.drop_column("wholesale_shipments", "split_from_shipment_id")
    op.drop_column("wholesale_shipments", "final_received_packages")
    op.drop_column("wholesale_shipments", "final_location")


def downgrade() -> None:
    raise NotImplementedError("Folding split shipments back together cannot be undone; restore from a backup.")
