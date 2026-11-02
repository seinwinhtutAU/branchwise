"""The Delivery screen's backend: a supplier voucher travelling as freight, and the
stops it passes through on the way to a receiving gate. See
app/wholesale/services/shipments_service.py for the transactions and
app/wholesale/services/shipments.py for the derived figures."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.models.entities import Shipment
from app.wholesale.schemas.shipments import ShipmentCreate, ShipmentUpdate, ShipmentWriteOffIn
from app.services.branches import resolve_wholesale_branch_id
from app.wholesale.services.lifecycle import get_allowed_shipment_actions
from app.wholesale.services.shipments import shipment_derived
from app.wholesale.services.write_offs import write_off_shipment, write_off_to_dict
from app.wholesale.services.receivings_service import counts_by_stop
from app.wholesale.services.shipments_service import (
    create_shipment,
    delete_shipment,
    get_shipment,
    list_shipments,
    update_shipment,
)
from app.wholesale.routers.common import paginate, require_wholesale

router = APIRouter(prefix="/api/wholesale/shipments", tags=["wholesale"])


def _stop_out(stop, derived_stops: dict[str, dict]) -> dict:
    derived = derived_stops[stop.id]
    return {
        "stop_id": stop.id,
        "parent_stop_id": stop.parent_stop_id,
        "leg_order": stop.leg_order,
        "stop_name": stop.stop_name,
        "carrier_name": stop.carrier_name,
        # What reached this place: what a receiving counted there, else what was typed.
        "packages_received": derived["packages_arrived"],
        # How many the carrier took from the place before.
        "packages_sent": stop.packages_sent,
        "package_change_kind": stop.package_change_kind,
        "packages_after_change": stop.packages_after_change,
        "lost_packages": stop.lost_packages,
        "is_gate": stop.is_gate,
        "extra_parents": [
            {"from_stop_id": link.from_stop_id, "carrier_name": link.carrier_name, "packages_sent": link.packages_sent}
            for link in stop.links_in
        ],
        "counted": derived["counted"],
        "here_now": derived["here_now"],
    }


def _shipment_out(
    shipment: Shipment,
    counts: dict[str, int] | None = None,
    has_receiving: bool = False,
) -> dict:
    derived = shipment_derived(shipment, counts)
    allowed_actions = get_allowed_shipment_actions(
        shipment,
        derived["final_received_packages"],
        has_receiving=has_receiving,
    )
    return {
        "shipment_id": shipment.id,
        "branch_id": shipment.branch_id,
        "shipment_no": shipment.shipment_no,
        "voucher_no": shipment.voucher_no,
        "supplier_name": shipment.supplier_name,
        "carrier_name": shipment.carrier_name,
        "sent_on": shipment.sent_on,
        "total_packages": shipment.total_packages,
        "total_quantity_pairs": shipment.total_quantity_pairs,
        "total_unit": shipment.total_unit.value,
        "packages_sent_by_cargo": shipment.packages_sent_by_cargo,
        # Over every gate; a gate that has been counted uses the counted number.
        "final_received_packages": derived["final_received_packages"],
        "lost_packages": derived["lost_packages"],
        "final_lost_packages": derived["final_lost_packages"],
        "cargo_remaining": derived["cargo_remaining"],
        "final_remaining": derived["final_remaining"],
        "shipment_status": derived["shipment_status"],
        "allowed_actions": allowed_actions,
        "version_id": getattr(shipment, "version_id", 1),
        "destination_count": derived["destination_count"],
        "arrived_pct": derived["arrived_pct"],
        "gates": [stop.stop_name for stop in shipment.stops if stop.is_gate],
        "stops": [_stop_out(stop, derived["stops"]) for stop in shipment.stops],
        "created_at": shipment.created_at,
        "updated_at": shipment.updated_at,
    }


@router.get("")
def list_shipments_endpoint(
    search: Annotated[str, Query(max_length=100)] = "",
    shipment_status: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=2000)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    require_wholesale(user)
    shipments = list_shipments(db, user.branch_id)
    counts, with_receiving = counts_by_stop(db, [shipment.id for shipment in shipments])
    rows = [
        _shipment_out(shipment, counts, has_receiving=shipment.id in with_receiving)
        for shipment in shipments
    ]
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["shipment_no"].lower() or query in row["voucher_no"].lower()
            or query in row["supplier_name"].lower() or query in row["carrier_name"].lower()
            or any(query in stop["stop_name"].lower() for stop in row["stops"])
        ]
    if shipment_status:
        rows = [row for row in rows if row["shipment_status"] == shipment_status]
    return paginate(rows, page, page_size, response)


@router.get("/{shipment_id}")
def get_shipment_endpoint(
    shipment_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    shipment = get_shipment(db, shipment_id, user.branch_id)
    counts, with_receiving = counts_by_stop(db, [shipment.id])
    return _shipment_out(shipment, counts, has_receiving=shipment.id in with_receiving)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_shipment_endpoint(
    payload: ShipmentCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    branch_id = resolve_wholesale_branch_id(user, payload.branch_id, db)
    shipment = create_shipment(db, branch_id, payload)
    return _shipment_out(shipment)


@router.patch("/{shipment_id}")
def update_shipment_endpoint(
    shipment_id: str,
    payload: ShipmentUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    shipment = update_shipment(db, shipment_id, user.branch_id, payload, operator_id=user.id)
    counts, with_receiving = counts_by_stop(db, [shipment.id])
    return _shipment_out(shipment, counts, has_receiving=shipment.id in with_receiving)


@router.post("/{shipment_id}/write-off", status_code=status.HTTP_201_CREATED)
def write_off_shipment_endpoint(
    shipment_id: str,
    payload: ShipmentWriteOffIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    entry = write_off_shipment(
        db, shipment_id, payload.stop_id, payload.quantity, payload.reason, payload.note, user.id,
        branch_id=user.branch_id,
    )
    return write_off_to_dict(entry)


@router.delete("/{shipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shipment_endpoint(
    shipment_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    require_wholesale(user)
    delete_shipment(db, shipment_id, user.branch_id, operator_id=user.id)
