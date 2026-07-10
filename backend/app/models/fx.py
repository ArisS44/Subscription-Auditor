from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class FxRatesResponse(BaseModel):
    """Rates from one base currency to a set of quotes, plus when they were last
    fetched. Money conversion is always an estimate labeled at the UI layer."""

    base: str
    rates: dict[str, Decimal]
    as_of: datetime


class FxConversionResponse(BaseModel):
    """A single converted amount. `rate` and `as_of` are surfaced so the UI can
    show the estimate basis."""

    amount: Decimal
    base: str
    quote: str
    rate: Decimal
    converted: Decimal
    as_of: datetime
