from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Enum value sets, kept byte-for-byte identical to the CHECK constraints in
# supabase/migrations/..._create_subscriptions_table.sql. Two independent walls
# enforce the same rule (defense in depth): Pydantic rejects bad input at the API
# boundary with a clean 422, the DB CHECK is the backstop. If these ever drift
# from the migration, that is a bug.
Category = Literal["ai_tool", "streaming", "productivity", "cloud_storage", "other"]
BillingCycle = Literal["weekly", "monthly", "quarterly", "yearly"]
SubscriptionStatus = Literal["active", "cancelled", "paused"]

# Length caps live in Pydantic, not the DB (the TEXT columns are unbounded) — the
# backend is the trust boundary, so it caps free-text input to bound resource use.
_NAME_MAX = 200
_NOTES_MAX = 2000

# NUMERIC(10, 2) in the DB; mirrored here so an over-precise or oversized price is
# a clean 422 rather than a DB-level error.
Price = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]
# ISO 4217 three-letter code, uppercase (e.g. USD, EUR, GBP).
Currency = Annotated[str, Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]


class SubscriptionCreate(BaseModel):
    """Fields a client may supply when creating a subscription. `user_id` is
    intentionally absent — it is taken from the caller's JWT in the router, never
    from the request body. `cancellation_date` is absent too — it is set only via
    the cancel endpoint, not on create.
    """

    name: str = Field(min_length=1, max_length=_NAME_MAX)
    category: Category | None = None
    price: Price
    currency: Currency = "USD"
    billing_cycle: BillingCycle
    start_date: date
    # Optional: when omitted the service layer computes it from start_date +
    # billing_cycle; when supplied, user intent wins and it is stored as-is.
    next_renewal_date: date | None = None
    status: SubscriptionStatus = "active"
    notes: str | None = Field(default=None, max_length=_NOTES_MAX)


class SubscriptionUpdate(BaseModel):
    """Partial update: every field optional so a PATCH sends only what changes.
    A field left unset is untouched; the service layer distinguishes 'omitted'
    from 'explicitly set' via `model_dump(exclude_unset=True)`.
    """

    name: str | None = Field(default=None, min_length=1, max_length=_NAME_MAX)
    category: Category | None = None
    price: Price | None = None
    currency: Currency | None = None
    billing_cycle: BillingCycle | None = None
    start_date: date | None = None
    next_renewal_date: date | None = None
    status: SubscriptionStatus | None = None
    cancellation_date: date | None = None
    notes: str | None = Field(default=None, max_length=_NOTES_MAX)


class SubscriptionResponse(BaseModel):
    """The full Session-2 column set as returned to the client."""

    id: UUID
    user_id: UUID
    name: str
    category: Category | None = None
    price: Decimal
    currency: str
    billing_cycle: BillingCycle
    start_date: date
    next_renewal_date: date | None = None
    status: SubscriptionStatus
    cancellation_date: date | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class SubscriptionListResponse(BaseModel):
    """A page of subscriptions plus the total count of rows matching the filter
    (before pagination), so the client can render page controls."""

    items: list[SubscriptionResponse]
    total: int


class SubscriptionCancel(BaseModel):
    """Optional body for the cancel endpoint. When `cancellation_date` is omitted
    the service defaults it to today."""

    cancellation_date: date | None = None
