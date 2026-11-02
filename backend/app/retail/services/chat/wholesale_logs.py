"""Chat tools for the wholesale lists a record page does not show: the shipments still on the way,
the receivings still being counted, the quantities recorded as lost or short, and the customers' and
suppliers' contact details.

Like `wholesale_records.py`, none of these works anything out: each calls the list function the
page's own endpoint calls (`wholesale/routers/{shipments,receivings,write_offs,master_data}.py`) and
turns the rows into short text, so the status, packages and quantities are the screen's. Quantities
are in sets (6 pairs = 1 set), money in Ks. Only for the accounts the wholesale screens admit.
"""

from collections import Counter
from datetime import date

from fastapi import Response
from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.models.user import User
from app.retail.services.chat.sources import ToolSource

PAIRS_PER_SET = 6
LISTED = 10
NOTE_CUT = 100


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _sets(pairs: float) -> str:
    sets = pairs / PAIRS_PER_SET
    return f"{sets:,.1f}".rstrip("0").rstrip(".") + (" set" if abs(sets - 1) < 1e-9 else " sets")


def _n(count: int, word: str) -> str:
    return f"{count:,} {word}" + ("" if count == 1 else "s")


def _cut(text: str | None) -> str:
    flat = " ".join((text or "").split())
    return flat if len(flat) <= NOTE_CUT else flat[: NOTE_CUT - 1].rstrip() + "…"


def _counts(rows: list[dict], key: str) -> str:
    return ", ".join(f"{count} {name}" for name, count in Counter(row[key] for row in rows).most_common())


def build_wholesale_log_tools(db: Session, user: User, sources: list[ToolSource]) -> list:
    # Imported here: wholesale is a separate package, needed only when these tools run.
    from app.wholesale.routers import master_data, receivings, shipments, write_offs

    everything = {"page": 1, "page_size": 2000, "user": user, "db": db}

    def cite(name: str, label: str, route: str) -> None:
        sources.append(
            ToolSource(name, label, branch="Wholesale", as_of=date.today().isoformat(), route=route)
        )

    @tool
    def get_wholesale_shipments(status: str = "", search: str = "") -> str:
        """The wholesale shipments: how many there are in each status, then the ones still on the way
        (not every package finally received) with supplier, voucher, carrier, date sent and packages
        sent, received and still to come. `status` limits the list to one status as the page names it;
        `search` matches a shipment or voucher number, supplier, carrier or place."""
        rows = shipments.list_shipments_endpoint(search=search, shipment_status=None, response=Response(), **everything)
        cite("get_wholesale_shipments", "Wholesale shipments", "today")
        if not rows:
            return "No wholesale shipments match."
        shown = [row for row in rows if row["shipment_status"] == status] if status else [
            row for row in rows if row["final_remaining"] > 0
        ]
        lines = [f"{len(rows)} shipment(s): {_counts(rows, 'shipment_status')}."]
        if not shown:
            lines.append("None are still on the way." if not status else f"None have the status '{status}'.")
        else:
            lines.append(("Shipments with that status:" if status else "Still on the way:"))
            for row in sorted(shown, key=lambda r: r["sent_on"], reverse=True)[:LISTED]:
                lines.append(
                    f"- {row['shipment_no']} ({row['supplier_name']}, voucher {row['voucher_no']}, {row['carrier_name']}, "
                    f"sent {row['sent_on']}): {row['shipment_status']}; {row['total_packages']} packages sent, "
                    f"{row['final_received_packages']} received, {row['final_remaining']} still to come"
                    + (f", {row['final_lost_packages']} lost" if row["final_lost_packages"] else "")
                )
            if len(shown) > LISTED:
                lines.append(f"(and {len(shown) - LISTED} more)")
        return "\n".join(lines)

    @tool
    def get_wholesale_receivings(status: str = "", search: str = "") -> str:
        """The wholesale receivings (goods counted at a gate): how many in each status, then the ones
        not finished with gate, voucher, date, sets counted against expected, packages opened and the
        cost so far. `status` limits the list to one status as the page names it; `search` matches a
        receiving, shipment or voucher number, supplier or gate."""
        rows = receivings.list_receivings_endpoint(search=search, receiving_status_filter=None, response=Response(), **everything)
        cite("get_wholesale_receivings", "Wholesale receivings", "today")
        if not rows:
            return "No wholesale receivings match."
        shown = [row for row in rows if row["receiving_status"] == status] if status else [
            row for row in rows if row["counted_quantity_pairs"] != row["expected_quantity_pairs"]
            or row["opened_package_count"] < row["total_packages"]
        ]
        lines = [f"{len(rows)} receiving(s): {_counts(rows, 'receiving_status')}."]
        if not shown:
            lines.append("All are fully counted." if not status else f"None have the status '{status}'.")
        else:
            lines.append("Receivings with that status:" if status else "Not fully counted yet:")
            for row in sorted(shown, key=lambda r: r["received_on"], reverse=True)[:LISTED]:
                lines.append(
                    f"- {row['receiving_no']} ({row['supplier_name']}, voucher {row['voucher_no']}, {row['gate']}, "
                    f"{row['received_on']}): {row['receiving_status']}; counted {_sets(row['counted_quantity_pairs'])} of "
                    f"{_sets(row['expected_quantity_pairs'])}, {row['opened_package_count']} of {row['total_packages']} "
                    f"packages opened, cost so far {_ks(row['total_cost'])}"
                )
            if len(shown) > LISTED:
                lines.append(f"(and {len(shown) - LISTED} more)")
        return "\n".join(lines)

    @tool
    def get_wholesale_write_offs(search: str = "") -> str:
        """The quantities recorded as lost or short in wholesale (the explanation log shared by
        shipments, supplier voucher lines and customer order lines): how many entries by reason, then
        the newest with what it belongs to, the product, the quantity and the note. `search` matches a
        reference, product or reason."""
        rows = write_offs.list_wholesale_write_offs(search=search, response=Response(), **everything)
        cite("get_wholesale_write_offs", "Wholesale lost or short quantities", "today")
        if not rows:
            return "No quantities have been recorded as lost or short."
        lines = [f"{len(rows)} entr{'y' if len(rows) == 1 else 'ies'}: {_counts(rows, 'reason')}."]
        for row in sorted(rows, key=lambda r: r["created_at"], reverse=True)[:LISTED]:
            what = f"{row['stock_code']} {row['description']}".strip() if row["stock_code"] else (row["description"] or "")
            note = f" - {_cut(row['note'])}" if row["note"] else ""
            conversions = row["unit_conversions"] or {}
            # A shipment's quantity is in packages; a voucher or order line's is in pairs, sets or dozens.
            amount = (
                _n(row["quantity"], "package")
                if row["unit"] not in conversions
                else _sets(row["quantity"] * conversions[row["unit"]])
            )
            lines.append(
                f"- {row['created_at']:%Y-%m-%d} {row['subject_type']} {row['reference']}: {what}, "
                f"{amount}, {row['reason']}{note}"
            )
        if len(rows) > LISTED:
            lines.append(f"(and {len(rows) - LISTED} more)")
        return "\n".join(lines)

    @tool
    def get_wholesale_contacts(kind: str = "customer", search: str = "") -> str:
        """Contact details kept in wholesale master data: phone and address of customers or suppliers.
        `kind` is "customer" or "supplier"; `search` matches the name. Use it for "what is X's phone /
        address". How much a customer owes is get_wholesale_customers_owing."""
        wanted = kind.strip().lower()
        if wanted not in ("customer", "supplier"):
            return 'kind must be "customer" or "supplier".'
        lister = master_data.list_customers if wanted == "customer" else master_data.list_suppliers
        rows = lister(search=search, active_only=True, response=Response(), **everything)
        cite("get_wholesale_contacts", f"Wholesale {wanted}s", "customers" if wanted == "customer" else "suppliers")
        if not rows:
            return f"No {wanted} matches."
        lines = [f"{len(rows)} {wanted}(s) match:" if search else f"{len(rows)} {wanted}(s):"]
        for row in rows[:LISTED]:
            lines.append(f"- {row['name']}: phone {row['phone'] or 'not recorded'}, address {_cut(row['address']) or 'not recorded'}")
        if len(rows) > LISTED:
            lines.append(f"(and {len(rows) - LISTED} more; give a name to narrow it)")
        return "\n".join(lines)

    return [
        get_wholesale_shipments,
        get_wholesale_receivings,
        get_wholesale_write_offs,
        get_wholesale_contacts,
    ]
