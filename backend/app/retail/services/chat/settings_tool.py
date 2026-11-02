"""The assistant's read of the business-wide settings (Settings page).

Some answers depend on a setting: how far back the Warning page looks, when the daily checks
unlock, how old a purchase price may be and still price a sale, the Branch Health weights, the buffer
months of the reorder list, today's exchange rates. The knowledge base and the written guides can be
out of date about these, so the assistant reads the value the app is using right now, through the same
readers the screens and services call, and says whether the owner changed it or it is still the
default. It only reads: nothing is saved, and no row is backfilled.
"""

from typing import Any

from langchain_core.tools import tool
from sqlalchemy.orm import Session

from app.models.app_settings import DEFAULT_SETTINGS, AppSetting
from app.models.user import User, UserRole
from app.retail.services.branch_health import (
    DIMENSIONS,
    default_sub_weights,
    get_branch_health_sub_weights,
)
from app.retail.services.chat.sources import ToolSource
from app.services.settings import (
    format_cutoff_time,
    get_branch_health_weights,
    get_purchasing_buffer_months,
)

# Plain words for every flat setting, shown next to its value. A test fails if a setting in
# DEFAULT_SETTINGS has no entry here, so a new setting cannot reach the assistant unexplained.
# (section, label, what it does)
SETTING_WORDS: dict[str, tuple[str, str, str]] = {
    "daily_check_cutoff_time": (
        "Daily checks",
        "Shop closing time",
        "after this time each day the daily import checks run and the Physical stock audit sheet unlocks",
    ),
    "sale_warning_window_days": (
        "Daily checks",
        "Sales checked by the Warning page",
        "how many days back (counting today) the Warning page checks sale records",
    ),
    "purchase_warning_window_days": (
        "Daily checks",
        "Purchases checked by the Warning page",
        "how many days back (counting today) the Warning page checks purchase records",
    ),
    "sale_list_window_days": (
        "Lists",
        "Sales list opens on the last",
        "days of sales shown before anyone picks dates",
    ),
    "purchase_list_window_days": (
        "Lists",
        "Purchases list opens on the last",
        "days of purchases shown before anyone picks dates",
    ),
    "show_buying_price_source": (
        "Lists",
        "Show where a buying price came from",
        "whether the sale and data lists show if a price came from a purchase, a stock count or a later recount",
    ),
    "purchase_lookback_window_days": (
        "How a sale is costed",
        "A purchase price counts if it is at most this old",
        "days before the sale; an older purchase price is treated as no price",
    ),
    "stock_lookback_window_days": (
        "How a sale is costed",
        "A stock-count price counts if it is at most this old",
        "days before the sale, used when there is no recent enough purchase price",
    ),
    "stock_forward_fallback_window_days": (
        "How a sale is costed",
        "A later stock count may price a sale up to",
        "days after the sale, the last resort when nothing earlier exists",
    ),
    "theme": ("Display", "Colour theme", "light, dark or follow the computer"),
    "branch_health_weights": (
        "Branch Health",
        "Weight of each part of the score",
        "how much sales, profit, inventory, customer and data quality count toward the 0-100 score",
    ),
    "today_exchange_rates": (
        "Wholesale",
        "Today's exchange rates",
        "Ks per 1 unit of a foreign currency; only prefills a new line, a saved line keeps its own rate",
    ),
    "wholesale_profit": (
        "Wholesale",
        "Selling price profit",
        "the profit added to a product's cost when the order form suggests a selling price: a share of the selling price or Ks on every set",
    ),
    "purchasing_buffer_months": (
        "Reorder list",
        "Target stock buffer in months",
        "how many months of sales to keep on hand for A (core), B (steady) and C (slow) products",
    ),
}

SECTIONS = (
    "Daily checks",
    "Lists",
    "How a sale is costed",
    "Branch Health",
    "Reorder list",
    "Wholesale",
    "Display",
)


def _saved(db: Session, key: str) -> tuple[Any, bool]:
    """(the value in use, whether the owner changed it). Read straight from the table; a key nobody
    saved is the default."""
    row = db.get(AppSetting, key)
    if row is None:
        return DEFAULT_SETTINGS[key], False
    return row.value, row.value != DEFAULT_SETTINGS[key]


def _percent(weights: dict[str, float]) -> str:
    return ", ".join(f"{name.replace('_', ' ')} {value * 100:.0f}" for name, value in weights.items())


def _flat_value(key: str, value: Any) -> str:
    if key == "daily_check_cutoff_time":
        return format_cutoff_time(str(value))
    if key == "show_buying_price_source":
        return "yes" if value else "no"
    if key.endswith("_days"):
        return f"{value} day" + ("" if value == 1 else "s")
    return str(value)


def read_settings(db: Session, user: User, topic: str = "") -> tuple[str, bool]:
    """The settings as text for the model, and whether a topic filter matched nothing."""
    wanted = topic.strip().casefold()
    sections: dict[str, list[str]] = {name: [] for name in SECTIONS}

    for key, (section, label, meaning) in SETTING_WORDS.items():
        if key in ("branch_health_weights", "today_exchange_rates", "purchasing_buffer_months", "wholesale_profit"):
            continue
        value, changed = _saved(db, key)
        sections[section].append(
            f"- {label}: {_flat_value(key, value)} ({'changed by the owner' if changed else 'default'}) "
            f"- {meaning}"
        )

    _, weights_changed = _saved(db, "branch_health_weights")
    sub_weights = get_branch_health_sub_weights(db)
    sub_changed = {k: v for k, v in sub_weights.items() if v != default_sub_weights()[k]}
    health = sections["Branch Health"]
    health.append(
        f"- Weight of each part of the score (percent): {_percent(get_branch_health_weights(db))} "
        f"({'changed by the owner' if weights_changed else 'default'}) - {SETTING_WORDS['branch_health_weights'][2]}"
    )
    if sub_changed:
        names = {sub.key: sub.label for d in DIMENSIONS for sub in d.sub_metrics}
        health.append(
            "- Measures whose weight the owner changed (percent): "
            + ", ".join(f"{names.get(k, k)} {v * 100:.0f}" for k, v in sub_changed.items())
        )
    else:
        health.append("- Weight of each measure inside a part: all default")

    buffer, buffer_changed = _saved(db, "purchasing_buffer_months")
    buffers = get_purchasing_buffer_months(db)
    sections["Reorder list"].append(
        f"- Target stock buffer: A {buffers['a']:g}, B {buffers['b']:g}, C {buffers['c']:g} months "
        f"({'changed by the owner' if buffer_changed else 'default'}) - {SETTING_WORDS['purchasing_buffer_months'][2]}"
    )

    if user.role in (UserRole.ADMIN, UserRole.DEVELOPMENT, UserRole.WHOLESALE):
        rates, _ = _saved(db, "today_exchange_rates")
        rate_text = (
            ", ".join(f"1 {code} = Ks {float(rate):,.2f}" for code, rate in rates.items())
            if rates
            else "none set"
        )
        sections["Wholesale"].append(
            f"- Today's exchange rates: {rate_text} - {SETTING_WORDS['today_exchange_rates'][2]}"
        )
        profit, profit_changed = _saved(db, "wholesale_profit")
        profit_text = (
            f"{float(profit['value']):g}% of the selling price"
            if profit["kind"] == "percent"
            else f"Ks {float(profit['value']):,.0f} on every set"
        )
        sections["Wholesale"].append(
            f"- Selling price profit: {profit_text} ({'changed by the owner' if profit_changed else 'default'}) "
            f"- {SETTING_WORDS['wholesale_profit'][2]}"
        )
        # Imported here: wholesale is a separate package, needed only for these accounts.
        from app.wholesale.services.health import saved_weights

        custom = saved_weights(db) is not None
        sections["Wholesale"].append(
            "- Wholesale health score weights: "
            + ("changed by the owner (see get_wholesale_health for the shares)" if custom else "default")
        )

    chosen = [
        name for name in SECTIONS if sections[name] and (not wanted or wanted in name.casefold())
    ]
    if not chosen:
        return "", True
    lines = ["Business settings as they are right now (the Settings page edits these):"]
    for name in chosen:
        lines.append(f"## {name}")
        lines.extend(sections[name])
    if not wanted:
        lines.append(
            "The Early Warning alert rules are built into the app, not settings: no setting changes when an alert fires."
        )
    return "\n".join(lines), False


def build_settings_tool(db: Session, user: User, sources: list[ToolSource]):
    @tool
    def get_app_settings(topic: str = "") -> str:
        """The business-wide settings as they are saved right now, each marked as changed by the owner
        or still the default: the shop closing time, how many days the Warning page checks, how old a
        purchase or stock price may be to price a sale, the Branch Health weights, the reorder buffer
        months and today's exchange rates. Use it for any answer that depends on a setting, and never
        take such a value from the knowledge base or a guide, which can be out of date. `topic` is
        optional and narrows to one group: checks, lists, costed, health, reorder, wholesale, display
        (a word from the group's name)."""
        text, nothing = read_settings(db, user, _TOPIC_WORDS.get(topic.strip().casefold(), topic))
        if nothing:
            return f"No setting group matches '{topic}'. Groups: {', '.join(SECTIONS)}."
        sources.append(
            ToolSource(
                "get_app_settings",
                "Settings",
                branch="All branches",
                route="settings",
            )
        )
        return text

    return get_app_settings


# A few short words the model tends to use for the group names.
_TOPIC_WORDS = {
    "checks": "daily",
    "check": "daily",
    "lists": "lists",
    "costed": "costed",
    "cost": "costed",
    "costing": "costed",
    "health": "health",
    "reorder": "reorder",
    "purchasing": "reorder",
    "buffer": "reorder",
    "wholesale": "wholesale",
    "display": "display",
    "theme": "display",
}
