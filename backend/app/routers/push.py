from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

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


@router.get("/subscriptions", response_model=list[PushSubscriptionResponse])
async def list_devices(claims: Claims) -> list[PushSubscriptionResponse]:
    """The caller's registered devices, so Settings can list and revoke them.

    A collection noun rather than `GET /subscribe`: the POST path is verb-shaped
    (an action), and a GET on it would read as fetching that action while actually
    returning a list.

    `list_for_user` goes through `rls_connection`, so Postgres — not a WHERE clause
    here — is what limits the result to the caller's own rows. The encryption keys
    are structurally absent: the query does not select them and
    `PushSubscriptionResponse` has no field to carry them.
    """
    rows = await svc.list_for_user(claims)
    return [PushSubscriptionResponse(**row) for row in rows]


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    endpoint: Annotated[str, Query(min_length=1, max_length=2048)], claims: Claims
) -> None:
    # The endpoint is a URL, and it is carried as a QUERY parameter rather than in
    # the path. A URL nested inside a URL path does not survive the production
    # ingress: Azure Container Apps fronts the app with Envoy, which normalizes
    # percent-encoded and duplicate slashes before routing, so `%2F%2F` arrives
    # collapsed and the value no longer matches any stored row. That made revocation
    # return 404 in production while working locally against uvicorn, where no such
    # normalization happens - a defect no test could catch outside a real deploy.
    # Query strings are not path-normalized, so the value arrives byte-exact.
    #
    # It is matched exactly against the caller's stored rows and is never fetched.
    # RLS scopes the delete to the caller, so one user cannot unsubscribe another's
    # device.
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
