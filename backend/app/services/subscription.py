import calendar
from datetime import date, timedelta

from app.db import subscriptions as subs_db
from app.db.rls import rls_connection
from app.models.subscription import SubscriptionCreate, SubscriptionUpdate


class SubscriptionNotFoundError(Exception):
    """Raised when a subscription id is not visible to the caller — either it
    does not exist or RLS filtered it because it belongs to another user. The
    router maps both to 404 so existence is never leaked."""


# Month-based cycles map to a whole-month step; weekly is handled separately with
# day arithmetic.
_MONTHS_PER_CYCLE = {"monthly": 1, "quarterly": 3, "yearly": 12}


def _add_months(anchor: date, months: int) -> date:
    """Add whole months to a date, clamping the day to the target month's last
    day (e.g. Jan 31 + 1 month → Feb 28/29). Always computed from the original
    anchor rather than iteratively, so there is no month-to-month day drift."""
    month_index = anchor.month - 1 + months
    year = anchor.year + month_index // 12
    month = month_index % 12 + 1
    day = min(anchor.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def compute_next_renewal_date(start_date: date, billing_cycle: str, today: date) -> date:
    """Pure helper: the next renewal on/after tomorrow, given a start date and a
    billing cycle. Advances from `start_date` by whole cycle increments until the
    result is strictly after `today`. Independent of DB and HTTP so it is directly
    unit-testable. If `start_date` is already in the future it is returned as-is.
    """
    if start_date > today:
        return start_date

    if billing_cycle == "weekly":
        days_elapsed = (today - start_date).days
        # Whole weeks needed to land strictly after today (the +1 guarantees
        # strictness even when today is exactly on a renewal boundary).
        weeks = days_elapsed // 7 + 1
        return start_date + timedelta(days=7 * weeks)

    months_per = _MONTHS_PER_CYCLE.get(billing_cycle)
    if months_per is None:
        raise ValueError(f"Unknown billing_cycle: {billing_cycle!r}")

    steps = months_per
    candidate = _add_months(start_date, steps)
    while candidate <= today:
        steps += months_per
        candidate = _add_months(start_date, steps)
    return candidate


async def list_subscriptions(
    claims: dict,
    *,
    status: str | None,
    category: str | None,
    sort_by: str,
    order: str,
    limit: int,
    offset: int,
) -> dict:
    async with rls_connection(claims) as conn:
        rows = await subs_db.list_subscriptions(
            conn,
            status=status,
            category=category,
            sort_by=sort_by,
            order=order,
            limit=limit,
            offset=offset,
        )
        total = await subs_db.count_subscriptions(conn, status=status, category=category)
    return {"items": [dict(row) for row in rows], "total": total}


async def create_subscription(claims: dict, payload: SubscriptionCreate) -> dict:
    user_id = claims["sub"]
    data = payload.model_dump()

    next_renewal = data["next_renewal_date"]
    if next_renewal is None:
        next_renewal = compute_next_renewal_date(
            data["start_date"], data["billing_cycle"], date.today()
        )

    async with rls_connection(claims) as conn:
        row = await subs_db.insert_subscription(
            conn,
            user_id=user_id,
            name=data["name"],
            category=data["category"],
            price=data["price"],
            currency=data["currency"],
            billing_cycle=data["billing_cycle"],
            start_date=data["start_date"],
            next_renewal_date=next_renewal,
            status=data["status"],
            notes=data["notes"],
            manage_url=data["manage_url"],
        )
    return dict(row)


async def get_subscription(claims: dict, sub_id: str) -> dict:
    async with rls_connection(claims) as conn:
        row = await subs_db.get_subscription_by_id(conn, sub_id)
    if row is None:
        raise SubscriptionNotFoundError()
    return dict(row)


async def update_subscription(claims: dict, sub_id: str, payload: SubscriptionUpdate) -> dict:
    # exclude_unset distinguishes "field omitted" from "field explicitly set to
    # null" — only omitted fields are left untouched.
    fields = payload.model_dump(exclude_unset=True)

    async with rls_connection(claims) as conn:
        current = await subs_db.get_subscription_by_id(conn, sub_id)
        if current is None:
            raise SubscriptionNotFoundError()

        # Recompute the renewal date only when the inputs it derives from change
        # AND the client did not set a renewal date explicitly in this same patch
        # (explicit user intent always wins).
        if "next_renewal_date" not in fields and (
            "start_date" in fields or "billing_cycle" in fields
        ):
            effective_start = fields.get("start_date", current["start_date"])
            effective_cycle = fields.get("billing_cycle", current["billing_cycle"])
            fields["next_renewal_date"] = compute_next_renewal_date(
                effective_start, effective_cycle, date.today()
            )

        row = await subs_db.update_subscription(conn, sub_id, fields)
    if row is None:
        # The row was visible a moment ago but the update matched nothing —
        # e.g. deleted concurrently. Treat as not-found rather than 500.
        raise SubscriptionNotFoundError()
    return dict(row)


async def delete_subscription(claims: dict, sub_id: str) -> None:
    async with rls_connection(claims) as conn:
        deleted = await subs_db.delete_subscription(conn, sub_id)
    if deleted is None:
        raise SubscriptionNotFoundError()


async def cancel_subscription(
    claims: dict, sub_id: str, cancellation_date: date | None = None
) -> dict:
    cancel_date = cancellation_date or date.today()
    async with rls_connection(claims) as conn:
        row = await subs_db.cancel_subscription(conn, sub_id, cancel_date)
    if row is None:
        raise SubscriptionNotFoundError()
    return dict(row)
