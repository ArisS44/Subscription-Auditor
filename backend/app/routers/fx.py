from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import get_current_claims
from app.models.fx import FxConversionResponse, FxRatesResponse
from app.services import fx as svc

router = APIRouter(prefix="/fx", tags=["fx"])

Claims = Annotated[dict, Depends(get_current_claims)]

# ISO 4217 three-letter code, uppercase — same shape as the currency validation on
# subscriptions. Applied to every currency query param so junk never reaches the
# service or an external call.
_CurrencyQuery = Annotated[str, Query(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]

_UNAVAILABLE = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="Currency rates are temporarily unavailable",
)


@router.get("/rates", response_model=FxRatesResponse)
async def get_rates(
    claims: Claims,
    base: _CurrencyQuery,
    symbols: Annotated[str | None, Query(description="Comma-separated quote codes")] = None,
) -> FxRatesResponse:
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()] if symbols else None
    try:
        result = await svc.get_rates(base, symbol_list)
    except svc.FxUnavailableError as err:
        raise _UNAVAILABLE from err
    return FxRatesResponse(**result)


@router.get("/convert", response_model=FxConversionResponse)
async def convert(
    claims: Claims,
    amount: Annotated[Decimal, Query(gt=0)],
    from_currency: Annotated[
        str, Query(alias="from", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    ],
    to_currency: Annotated[
        str, Query(alias="to", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    ],
) -> FxConversionResponse:
    try:
        result = await svc.convert(amount, from_currency, to_currency)
    except svc.FxUnavailableError as err:
        raise _UNAVAILABLE from err
    return FxConversionResponse(**result)
