import asyncio
import logging
from enum import Enum

from pywebpush import WebPushException, webpush

from app.config import settings
from app.db import push as push_db
from app.db.rls import rls_connection
from app.models.push import NotificationPayload, PushSubscriptionCreate, PushTestResult

logger = logging.getLogger("app.services.push")


class PushSubscriptionNotFoundError(Exception):
    """Raised when an unsubscribe targets an endpoint the caller does not own —
    either it does not exist or RLS filtered it. The router maps this to 404 so
    existence of another user's registration is never leaked."""


# Push service HTTP statuses that mean the subscription is permanently gone: the
# browser rotated it, the user revoked permission, or the platform dropped it.
# The correct response is to delete the row, never to retry it. Every other
# failure is transient (timeout, 5xx, network) and the row is left in place.
_PERMANENT_GONE_STATUSES = frozenset({404, 410})


class DeliveryOutcome(Enum):
    """The result vocabulary a delivery channel reports back. Deliberately not
    push-specific: a future email channel classifies its own failures into the
    same three cases, so the orchestration that prunes on EXPIRED and retains on
    FAILED works unchanged across channels."""

    DELIVERED = "delivered"
    EXPIRED = "expired"  # permanent rejection → prune the stored credential
    FAILED = "failed"  # transient failure → keep it, try again later


class PushChannel:
    """The Web Push delivery adapter. Its single responsibility is *how* to send
    one message to one device — it holds no notion of when or why a message is
    sent, and touches no reminder logic and no database. A sibling EmailChannel
    can implement the same `send`-returns-`DeliveryOutcome` shape and slot in
    beside it without any caller changing.

    `pywebpush` is synchronous (it uses `requests`), so each send runs in a worker
    thread to avoid blocking the event loop."""

    async def send(
        self,
        *,
        endpoint: str,
        p256dh: str,
        auth: str,
        payload_json: str,
        ttl: int | None = None,
    ) -> DeliveryOutcome:
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {"p256dh": p256dh, "auth": auth},
                },
                data=payload_json,
                # VAPID authenticates THIS backend to the push service (a separate
                # concern from the p256dh/auth pair, which encrypts the payload to
                # the device). Key and subject are environment-driven — never
                # hardcoded. pywebpush derives the `aud` and `exp` claims itself.
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
                # TTL tells the push service how long to hold the message for a
                # device that is offline at send time. Without it (pywebpush's
                # default of 0) an asleep laptop drops the reminder entirely.
                ttl=settings.push_ttl_seconds if ttl is None else ttl,
            )
            return DeliveryOutcome.DELIVERED
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in _PERMANENT_GONE_STATUSES:
                # No log line: an expected, benign lifecycle event. The caller
                # counts it as pruned.
                return DeliveryOutcome.EXPIRED
            # Transient. Log the status only — never the endpoint, keys, or body.
            logger.warning("push delivery failed status=%s", status)
            return DeliveryOutcome.FAILED
        except Exception as exc:  # network error, encoding error, etc.
            logger.warning("push delivery error type=%s", type(exc).__name__)
            return DeliveryOutcome.FAILED


# Module-level singleton. The reminder job (a later Task) reuses this same adapter
# through its own user-less orchestration; this Task's only caller is the
# user-scoped test-send below.
channel = PushChannel()


async def subscribe(claims: dict, payload: PushSubscriptionCreate) -> dict:
    """Register (or refresh) one device for the caller. Idempotent per device via
    the upsert — re-subscribing the same endpoint updates rotated keys instead of
    duplicating the row."""
    user_id = claims["sub"]
    async with rls_connection(claims) as conn:
        row = await push_db.upsert_subscription(
            conn,
            user_id=user_id,
            endpoint=payload.endpoint,
            p256dh_key=payload.keys.p256dh,
            auth_key=payload.keys.auth,
            user_agent=payload.user_agent,
        )
    return dict(row)


async def unsubscribe(claims: dict, endpoint: str) -> None:
    """Remove one device registration by endpoint. Deleting the stored credential
    outright — not flagging it — is what makes withdrawal of push consent real.
    Raises PushSubscriptionNotFoundError if nothing matched under RLS."""
    async with rls_connection(claims) as conn:
        deleted = await push_db.delete_by_endpoint(conn, endpoint)
    if deleted is None:
        raise PushSubscriptionNotFoundError()


async def list_for_user(claims: dict) -> list[dict]:
    """The caller's registered devices, without encryption keys."""
    async with rls_connection(claims) as conn:
        rows = await push_db.list_subscriptions_for_response(conn)
    return [dict(row) for row in rows]


async def deliver_to_user(claims: dict, payload: NotificationPayload) -> PushTestResult:
    """Fan out one notification to every device the caller has registered.

    Best-effort by design: one dead endpoint does not abort delivery to the
    others. Endpoints the push service reports as permanently gone are pruned as
    they are found; transient failures leave the row untouched. This is user-
    scoped orchestration (it reads and prunes the caller's own rows under RLS),
    kept separate from `PushChannel` so the adapter stays mechanism-only."""
    payload_json = payload.model_dump_json()

    async with rls_connection(claims) as conn:
        subs = await push_db.list_subscriptions(conn)

    sent = pruned = failed = 0
    for row in subs:
        outcome = await channel.send(
            endpoint=row["endpoint"],
            p256dh=row["p256dh_key"],
            auth=row["auth_key"],
            payload_json=payload_json,
        )
        if outcome is DeliveryOutcome.DELIVERED:
            sent += 1
        elif outcome is DeliveryOutcome.EXPIRED:
            async with rls_connection(claims) as conn:
                await push_db.delete_by_id(conn, row["id"])
            pruned += 1
        else:
            failed += 1

    # Counts and outcomes only — the no-content rule applies with full force to
    # work the user did not initiate and to notification copy alike.
    logger.info(
        "push fan-out total=%d sent=%d pruned=%d failed=%d",
        len(subs),
        sent,
        pruned,
        failed,
    )
    return PushTestResult(total=len(subs), sent=sent, pruned=pruned, failed=failed)
