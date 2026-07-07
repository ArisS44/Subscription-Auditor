from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from app.models.subscription import BillingCycle


class TopExpense(BaseModel):
    """One of the largest active subscriptions, normalized to its monthly cost so
    subscriptions on different billing cycles are comparable."""

    id: UUID
    name: str
    currency: str
    monthly_equivalent: Decimal


class UpcomingRenewal(BaseModel):
    """An active subscription renewing within the look-ahead window."""

    id: UUID
    name: str
    price: Decimal
    currency: str
    billing_cycle: BillingCycle
    next_renewal_date: date


class CategorySpend(BaseModel):
    """Monthly-equivalent spend for one (currency, category) pair. Currencies are
    kept separate — never converted."""

    currency: str
    category: str
    monthly_equivalent: Decimal


class AnalyticsResponse(BaseModel):
    """Overview roll-up. Every money figure is monthly-equivalent and grouped by
    currency (no FX conversion). Only active subscriptions contribute. An empty
    portfolio yields empty dicts/lists, never null."""

    monthly_burn_by_currency: dict[str, Decimal]
    annual_projection_by_currency: dict[str, Decimal]
    top_expenses: list[TopExpense]
    upcoming_renewals: list[UpcomingRenewal]
    spend_by_category: list[CategorySpend]
