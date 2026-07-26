from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.common import LeadDays


class ProfileResponse(BaseModel):
    id: UUID
    email: str
    display_name: str | None = None
    preferred_language: str
    onboarding_completed: bool
    # How many days before a renewal the user wants reminding, and whether the
    # monthly review is on. Both are read here; only `renewal_lead_days` is
    # writable (see ProfileUpdate) — the monthly-review feature is a later
    # session, so its Settings control stays disabled but must still show the
    # stored value truthfully rather than a hardcoded guess.
    renewal_lead_days: int
    monthly_review_enabled: bool


class ProfileUpdate(BaseModel):
    """Partial update for the caller's own profile. Fields optional so a
    PATCH sends only what changes. `preferred_language` mirrors the DB CHECK on
    profiles.preferred_language (defense in depth).

    `monthly_review_enabled` is deliberately absent: it is readable but not
    writable, and leaving it out here is one of the two walls that enforce that
    (the other is the `_UPDATABLE_COLUMNS` allowlist in `db/profiles.py`).
    """

    display_name: str | None = Field(default=None, max_length=100)
    preferred_language: Literal["auto", "en", "el"] | None = None
    onboarding_completed: bool | None = None
    renewal_lead_days: LeadDays | None = None

    @field_validator("renewal_lead_days")
    @classmethod
    def _reject_explicit_null(cls, value: int | None) -> int:
        """Reject `"renewal_lead_days": null` while still allowing the field to be
        omitted. Pydantic skips validators for fields left unset, so this runs
        only when the client actually sent a value — making "omitted" a no-op and
        an explicit null a clean 422.

        This matters because the profile value is the fallback that a subscription's
        NULL `reminder_lead_days` inherits via COALESCE in the reminder engine.
        Nulling it here would leave that COALESCE with nothing to resolve to, so
        the user-facing default must always be a real number. Note the opposite
        rule on subscriptions, where NULL is a meaningful value.
        """
        if value is None:
            raise ValueError("renewal_lead_days cannot be null")
        return value
