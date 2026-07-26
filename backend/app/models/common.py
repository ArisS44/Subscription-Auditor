"""Field types shared by more than one resource model.

Only types that genuinely belong to two or more resources live here — a type used
by a single resource stays next to that resource's models (see `Price` and
`Currency` in `subscription.py`).
"""

from typing import Annotated

from pydantic import Field

# Reminder lead time in days, mirrored byte-for-byte from two DB CHECK
# constraints that must agree: `profiles.renewal_lead_days` (the per-user default,
# from the profiles migration) and `subscriptions.reminder_lead_days` (the
# optional per-subscription override, from the notification-schema migration).
# Defined once so the bound cannot drift between the two surfaces. Pydantic
# rejects an out-of-range value with a clean 422 at the trust boundary; the DB
# CHECK is the backstop.
LEAD_DAYS_MIN = 0
LEAD_DAYS_MAX = 30

LeadDays = Annotated[int, Field(ge=LEAD_DAYS_MIN, le=LEAD_DAYS_MAX)]
