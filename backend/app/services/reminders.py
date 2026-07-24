import logging

from app.config import settings
from app.db import reminders as reminders_db
from app.db.pool import get_pool
from app.models.jobs import JobRunResult
from app.services import notifications_copy
from app.services.push import DeliveryOutcome, channel

logger = logging.getLogger("app.services.reminders")

# The renewal-reminder engine. It decides WHAT to send and WHETHER to send it;
# the push channel decides HOW. Delivery is a collaborator (the module singleton
# `channel` from services/push.py), so a second channel could be swapped in
# without changing this logic. It runs entirely under a service-role connection
# because it has no user — see db/reminders.py for why that power is confined
# there. It never calls services/push.deliver_to_user, which is user-scoped
# orchestration; fanning out here is the job's own service-role orchestration
# around the same mechanism-only channel.send.


async def run_due_reminders() -> JobRunResult:
    """Find due renewal reminders across all users, claim each in the ledger before
    sending (so a re-run cannot double-send), render bilingual copy, and fan out to
    each user's devices — pruning permanently-dead endpoints, retaining on
    transient failure. Returns counts only."""
    due = sent = skipped = pruned = failed = 0
    pool = get_pool()

    async with pool.acquire() as conn:
        rows = await reminders_db.get_due_reminders(conn, limit=settings.reminder_job_batch_size)
        due = len(rows)

        for row in rows:
            user_id = row["user_id"]
            subscription_id = row["id"]
            renewal_date = row["next_renewal_date"]

            # Claim FIRST. If the row already existed, a prior run handled this
            # reminder — skip without sending. This is the idempotency guard.
            claimed = await reminders_db.claim_delivery(
                conn,
                user_id=user_id,
                subscription_id=subscription_id,
                due_date=renewal_date,
            )
            if not claimed:
                skipped += 1
                continue

            payload = notifications_copy.render_renewal_reminder(
                row["preferred_language"],
                name=row["name"],
                price=row["price"],
                currency=row["currency"],
                renewal_date=renewal_date,
            )
            payload_json = payload.model_dump_json()

            devices = await reminders_db.get_active_push_subscriptions(conn, user_id=user_id)
            delivered_any = False
            for device in devices:
                outcome = await channel.send(
                    endpoint=device["endpoint"],
                    p256dh=device["p256dh_key"],
                    auth=device["auth_key"],
                    payload_json=payload_json,
                )
                if outcome is DeliveryOutcome.DELIVERED:
                    delivered_any = True
                elif outcome is DeliveryOutcome.EXPIRED:
                    await reminders_db.delete_push_subscription(conn, subscription_id=device["id"])
                    pruned += 1
                # FAILED: leave the device row in place; a transient failure is not
                # grounds to prune.

            if delivered_any:
                delivery_id = await reminders_db.get_delivery_id(
                    conn,
                    user_id=user_id,
                    subscription_id=subscription_id,
                    due_date=renewal_date,
                )
                if delivery_id is not None:
                    await reminders_db.mark_delivered(conn, delivery_id=delivery_id)
                sent += 1
            else:
                # Claimed but nothing was delivered (no devices, or every send
                # failed transiently). The claim row stays so this run is counted;
                # delivered_at remains NULL, marking it as not-yet-delivered.
                failed += 1

    # Counts and outcomes only — never a name, endpoint, key, or body.
    logger.info(
        "run-due complete due=%d sent=%d skipped_already_sent=%d pruned=%d failed=%d",
        due,
        sent,
        skipped,
        pruned,
        failed,
    )
    return JobRunResult(
        due=due, sent=sent, skipped_already_sent=skipped, pruned=pruned, failed=failed
    )
