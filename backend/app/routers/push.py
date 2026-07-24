from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import settings
from app.deps import get_current_claims
from app.models.push import (
    NotificationPayload,
    PushSubscriptionCreate,
    PushSubscriptionResponse,
    PushTestResult,
)
from app.services import push as svc
from app.services.push import PushSubscriptionNotFoundError

router = APIRouter(prefix="/push", tags=["push"])

Claims = Annotated[dict, Depends(get_current_claims)]

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="Push subscription not found"
)


@router.post(
    "/subscribe", response_model=PushSubscriptionResponse, status_code=status.HTTP_201_CREATED
)
async def subscribe(payload: PushSubscriptionCreate, claims: Claims) -> PushSubscriptionResponse:
    # Ownership comes from the JWT inside the service — PushSubscriptionCreate has
    # no user_id field for a client to supply.
    row = await svc.subscribe(claims, payload)
    return PushSubscriptionResponse(**row)


@router.delete("/subscribe/{endpoint:path}", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(endpoint: str, claims: Claims) -> None:
    # The endpoint is a URL captured as a path parameter (`:path` so its slashes
    # survive). It is matched exactly against the caller's stored rows and is never
    # fetched. RLS scopes the delete to the caller, so one user cannot unsubscribe
    # another's device.
    try:
        await svc.unsubscribe(claims, endpoint)
    except PushSubscriptionNotFoundError as err:
        raise _NOT_FOUND from err


@router.post("/test", response_model=PushTestResult)
async def test_send(claims: Claims) -> PushTestResult:
    # Development-only: it exists solely to prove the push pipeline before the
    # reminder engine exists. Outside development it must not be reachable, so it
    # returns an identical 404 to a nonexistent route rather than advertising that
    # a gated endpoint lives here.
    if settings.env != "development":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    payload = NotificationPayload(
        title="Subscription Auditor",
        body="Test notification — your push setup is working.",
    )
    return await svc.deliver_to_user(claims, payload)
