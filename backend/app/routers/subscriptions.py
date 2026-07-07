from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.deps import get_current_claims
from app.models.subscription import (
    Category,
    SubscriptionCancel,
    SubscriptionCreate,
    SubscriptionListResponse,
    SubscriptionResponse,
    SubscriptionStatus,
    SubscriptionUpdate,
)
from app.services import subscription as svc
from app.services.subscription import SubscriptionNotFoundError

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

# Annotated dependency: keeps the callable out of the parameter default, so it
# reads as a normal typed parameter and avoids the flake8-bugbear B008 warning
# about function calls in defaults.
Claims = Annotated[dict, Depends(get_current_claims)]

_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscription not found")


@router.get("", response_model=SubscriptionListResponse)
async def list_subscriptions(
    claims: Claims,
    status_filter: Annotated[SubscriptionStatus | None, Query(alias="status")] = None,
    category: Annotated[Category | None, Query()] = None,
    sort_by: Annotated[
        Literal["name", "price", "next_renewal_date", "created_at"], Query()
    ] = "created_at",
    order: Annotated[Literal["asc", "desc"], Query()] = "asc",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> SubscriptionListResponse:
    result = await svc.list_subscriptions(
        claims,
        status=status_filter,
        category=category,
        sort_by=sort_by,
        order=order,
        limit=limit,
        offset=offset,
    )
    return SubscriptionListResponse(**result)


@router.post("", response_model=SubscriptionResponse, status_code=status.HTTP_201_CREATED)
async def create_subscription(payload: SubscriptionCreate, claims: Claims) -> SubscriptionResponse:
    # user_id is taken from the JWT inside the service, never from `payload` —
    # SubscriptionCreate has no user_id field for a client to supply.
    row = await svc.create_subscription(claims, payload)
    return SubscriptionResponse(**row)


@router.get("/{sub_id}", response_model=SubscriptionResponse)
async def get_subscription(sub_id: UUID, claims: Claims) -> SubscriptionResponse:
    try:
        row = await svc.get_subscription(claims, str(sub_id))
    except SubscriptionNotFoundError as err:
        raise _NOT_FOUND from err
    return SubscriptionResponse(**row)


@router.patch("/{sub_id}", response_model=SubscriptionResponse)
async def update_subscription(
    sub_id: UUID, payload: SubscriptionUpdate, claims: Claims
) -> SubscriptionResponse:
    try:
        row = await svc.update_subscription(claims, str(sub_id), payload)
    except SubscriptionNotFoundError as err:
        raise _NOT_FOUND from err
    return SubscriptionResponse(**row)


@router.delete("/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subscription(sub_id: UUID, claims: Claims) -> None:
    try:
        await svc.delete_subscription(claims, str(sub_id))
    except SubscriptionNotFoundError as err:
        raise _NOT_FOUND from err


@router.post("/{sub_id}/cancel", response_model=SubscriptionResponse)
async def cancel_subscription(
    sub_id: UUID, claims: Claims, payload: SubscriptionCancel | None = None
) -> SubscriptionResponse:
    cancellation_date = payload.cancellation_date if payload else None
    try:
        row = await svc.cancel_subscription(claims, str(sub_id), cancellation_date)
    except SubscriptionNotFoundError as err:
        raise _NOT_FOUND from err
    return SubscriptionResponse(**row)
