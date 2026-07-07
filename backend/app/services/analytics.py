from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.db import analytics as analytics_db
from app.db.rls import rls_connection

# Constants for the monthly-equivalent conversion, as Decimals for exact money math.
_WEEKS_PER_YEAR = Decimal(52)
_MONTHS_PER_YEAR = Decimal(12)
_MONTHS_PER_QUARTER = Decimal(3)

UPCOMING_WINDOW_DAYS = 30
TOP_EXPENSES_LIMIT = 5


def monthly_equivalent(price: Decimal, billing_cycle: str) -> Decimal:
    """Convert a (price, billing_cycle) pair to its monthly-equivalent amount so
    subscriptions on different cycles can be summed. Pure and DB/HTTP-independent;
    the single source of the normalization factor. Returns full precision — the
    caller rounds only at the output boundary to avoid compounding rounding.

        weekly    -> price * 52 / 12
        monthly   -> price
        quarterly -> price / 3
        yearly    -> price / 12
    """
    if billing_cycle == "weekly":
        return price * _WEEKS_PER_YEAR / _MONTHS_PER_YEAR
    if billing_cycle == "monthly":
        return price
    if billing_cycle == "quarterly":
        return price / _MONTHS_PER_QUARTER
    if billing_cycle == "yearly":
        return price / _MONTHS_PER_YEAR
    raise ValueError(f"Unknown billing_cycle: {billing_cycle!r}")


def _money(amount: Decimal) -> Decimal:
    """Round a money amount to 2 decimal places (half-up) for the response."""
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def build_overview(claims: dict) -> dict:
    """Assemble the Overview payload from three RLS-scoped, active-only queries.
    Currencies are never converted — every figure is grouped by its own currency.
    An empty portfolio produces empty dicts/lists, not nulls or a crash.
    """
    today = date.today()
    async with rls_connection(claims) as conn:
        groups = await analytics_db.get_active_spend_by_group(conn)
        active_rows = await analytics_db.get_active_for_ranking(conn)
        upcoming = await analytics_db.get_upcoming_renewals(
            conn, start=today, end=today + timedelta(days=UPCOMING_WINDOW_DAYS)
        )

    # Monthly-equivalent burn per currency and per (currency, category), built from
    # SQL-summed buckets. The factor is applied here — the one place it lives.
    # monthly_equivalent is linear in price, so normalizing a summed bucket equals
    # summing the per-row monthly-equivalents.
    monthly_by_currency: dict[str, Decimal] = defaultdict(lambda: Decimal(0))
    by_category: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal(0))
    for g in groups:
        monthly = monthly_equivalent(g["subtotal"], g["billing_cycle"])
        currency = g["currency"]
        category = g["category"] or "other"  # null category grouped as "other"
        monthly_by_currency[currency] += monthly
        by_category[(currency, category)] += monthly

    monthly_burn = {cur: _money(v) for cur, v in monthly_by_currency.items()}
    annual = {cur: _money(v * _MONTHS_PER_YEAR) for cur, v in monthly_by_currency.items()}
    spend_by_category = [
        {"currency": cur, "category": cat, "monthly_equivalent": _money(v)}
        for (cur, cat), v in sorted(by_category.items())
    ]

    # Top expenses: rank each active subscription by its monthly-equivalent (same
    # helper). Done in Python because the sort key is that factor. Deterministic:
    # amount desc, then name asc.
    ranked = sorted(
        (
            {
                "id": r["id"],
                "name": r["name"],
                "currency": r["currency"],
                "monthly_equivalent": _money(monthly_equivalent(r["price"], r["billing_cycle"])),
            }
            for r in active_rows
        ),
        key=lambda e: (-e["monthly_equivalent"], e["name"]),
    )[:TOP_EXPENSES_LIMIT]

    return {
        "monthly_burn_by_currency": monthly_burn,
        "annual_projection_by_currency": annual,
        "top_expenses": ranked,
        "upcoming_renewals": [dict(r) for r in upcoming],
        "spend_by_category": spend_by_category,
    }
